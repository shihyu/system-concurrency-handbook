# 第15章 手寫線程池實戰

## 15.1 結構設計

<!-- subsection-diagram -->
### 本小節示意圖

```text
  ThreadPool 核心組件圖

  ┌─────────────────────────────────────────────────────────────────┐
  │                        ThreadPool                               │
  │                                                                 │
  │  ┌─────────────────────────────────────────────────────────┐   │
  │  │  state: AtomicInteger                                   │   │
  │  │  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌────────┐ │   │
  │  │  │ RUNNING  │→ │SHUTDOWN  │→ │  STOP    │→ │TERMINATED│ │   │
  │  │  └──────────┘  └──────────┘  └──────────┘  └────────┘ │   │
  │  └─────────────────────────────────────────────────────────┘   │
  │                              │ 控制                             │
  │  ┌──────────────────┐        │        ┌──────────────────┐     │
  │  │  task_queue      │        │        │  workers         │     │
  │  │  BlockingQueue   │◄───────┴───────►│  Set<Thread>     │     │
  │  │                  │    協作          │                  │     │
  │  │  [Task][Task]    │  ─poll()─►      │  [W1][W2][W3][W4]│     │
  │  │  [Task][Task]    │                 │   ↑執行任務↑      │     │
  │  └──────────────────┘                 └──────────────────┘     │
  │          ▲ submit()                                             │
  │          │                   飽和時觸發                          │
  │  ┌───────┴──────┐        ┌──────────────────────────────┐      │
  │  │   外部呼叫方  │        │  reject_policy               │      │
  │  │  (Producer)  │        │  RejectedExecutionHandler    │      │
  │  └──────────────┘        │  Abort / CallerRuns / Discard│      │
  │                           └──────────────────────────────┘      │
  │                                                                 │
  │  組件職責：                                                      │
  │  • task_queue：緩衝待執行任務，解耦生產者與消費者               │
  │  • workers：實際執行任務的執行緒集合，數量在 [core, max] 間調整 │
  │  • state：協調關閉流程，防止競態                                 │
  │  • reject_policy：佇列+執行緒都滿時的降級策略                   │
  └─────────────────────────────────────────────────────────────────┘
```

需要的核心欄位：

- **任務佇列（task_queue）**：BlockingQueue，生產者 submit 入佇，worker 出佇執行
- **worker 集合（workers）**：追蹤所有活躍執行緒，用於關閉時中斷
- **運行狀態（state）**：AtomicInteger，防止在關閉中繼續接受任務
- **拒絕策略（reject_policy）**：飽和時的處理方式，預設拋出例外

## 15.2 Worker 邏輯

<!-- subsection-diagram -->
### 本小節示意圖

```text
  Worker 主循環流程圖

  Worker 執行緒啟動
        │
        ▼
  ┌─────────────────────┐
  │  loop（主循環）      │ ◄────────────────────────────┐
  └──────────┬──────────┘                               │
             │                                          │
             ▼                                          │
  ┌─────────────────────────────────────┐               │
  │  task = queue.poll(keepAliveTime)   │               │
  │  （等待最多 keepAliveTime 超時）     │               │
  └──────────────┬──────────────────────┘               │
                 │                                       │
        task != null?                                    │
        ┌────────┴────────┐                             │
        │是               │否（等待超時）                │
        ▼                 ▼                             │
  ┌───────────┐   是否為核心執行緒？                     │
  │ execute() │   ┌────────┴────────┐                   │
  │  task     │   │是               │否（非核心）         │
  └─────┬─────┘   ▼                 ▼                   │
        │   繼續等待，        workers.size > core?        │
        │   不退出            ┌────────┴────────┐        │
        │                    │是               │否       │
        │                    ▼                 ▼         │
        │             ┌─────────────┐    繼續等待        │
        │             │ 退出 loop   │    不退出 ─────────►│
        │             │ workers.    │
        │             │ remove(this)│
        └─────────────►            │ ←──────────── shutdown?
                      └─────────────┘                   ▲
                                                        │
                               pool.state == SHUTDOWN  ─┘
                               且 queue 已空 → 退出
```

worker 持續從佇列取任務執行，遇到關閉訊號退出。

Worker 的關鍵設計點：
1. **keepAlive 超時**：非核心執行緒等待超過 keepAliveTime 後縮容退出，避免資源浪費
2. **中斷響應**：`shutdownNow()` 時送出中斷，worker 的 `poll()` 會拋出 `InterruptedException` 並退出
3. **退出清理**：worker 退出前從 `workers` 集合中移除自己，並在必要時判斷是否需要觸發 `TERMINATED` 狀態

## 15.3 提交與關閉（對應 15.3.1~15.3.6）

<!-- subsection-diagram -->
### 本小節示意圖

```text
  submit(task) 流程圖

  submit(task)
       │
       ▼
  ┌──────────────────────────┐
  │ state == RUNNING ?        │
  └──────────┬───────────────┘
       是 │           │ 否（SHUTDOWN/STOP）
          ▼           ▼
  ┌──────────────┐  ┌─────────────────────┐
  │ queue.offer  │  │ reject(task)        │
  │ (task) 成功? │  │ RejectedExecution   │
  └──────┬───────┘  └─────────────────────┘
    是 │     │ 否（佇列滿）
       ▼     ▼
  ┌──────┐  ┌────────────────────────────┐
  │ 返回 │  │ workers.size < maxPoolSize? │
  └──────┘  └────────────┬───────────────┘
                  是 │           │ 否
                     ▼           ▼
             ┌──────────────┐  ┌─────────────────────┐
             │ 新建 Worker  │  │ reject(task)        │
             │ 執行此任務   │  │（飽和拒絕）          │
             └──────────────┘  └─────────────────────┘

  ─────────────────────────────────────────────────────────────────

  shutdown() 流程圖

  shutdown()
       │
       ├─► 1. 原子設定 state = SHUTDOWN
       │
       ├─► 2. 中斷所有閒置 workers（喚醒正在 poll() 等待的執行緒）
       │
       ├─► 3. 不再接受新的 submit()
       │
       └─► 4. 等待佇列排空 + workers 歸零 → 轉入 TERMINATED
            （可用 awaitTermination() 阻塞等待）
```

- **submit**：放入佇列或觸發拒絕
- **shutdown**：停止收新任務，排空後結束

關閉的正確姿勢是先呼叫 `shutdown()`，再以迴圈呼叫 `awaitTermination()` 直到返回 `true` 或超時強制中斷（`shutdownNow()`）。

## 15.4 測試

<!-- subsection-diagram -->
### 本小節示意圖

```text
  測試場景清單與期望行為

  ┌─────────────────────────────────────────────────────────────────┐
  │  場景 1：正常提交                                                │
  │  操作：提交 N 個任務（N ≤ queue capacity）                      │
  │  期望：所有任務按完成，無例外，result 集合 size == N             │
  ├─────────────────────────────────────────────────────────────────┤
  │  場景 2：飽和拒絕                                                │
  │  操作：workers 全忙 + 佇列滿時繼續提交                          │
  │  期望：觸發 RejectedExecutionException（或自定義策略動作）       │
  │  驗證：已進入佇列的任務仍能正常完成                              │
  ├─────────────────────────────────────────────────────────────────┤
  │  場景 3：優雅關閉（shutdown）                                    │
  │  操作：提交 N 個任務後立即 shutdown()                           │
  │  期望：所有已提交任務執行完畢，awaitTermination 返回 true       │
  │  禁止：shutdown 後再 submit 拋出 RejectedExecutionException     │
  ├─────────────────────────────────────────────────────────────────┤
  │  場景 4：強制中斷（shutdownNow）                                 │
  │  操作：任務執行中呼叫 shutdownNow()                             │
  │  期望：返回未執行任務列表，正在執行的任務收到中斷訊號           │
  │  驗證：list.size == 未執行任務數量                               │
  ├─────────────────────────────────────────────────────────────────┤
  │  場景 5：keepAlive 縮容                                          │
  │  操作：高峰期超過 coreSize，低峰期閒置超過 keepAliveTime        │
  │  期望：非核心執行緒自動退出，workers.size 降回 coreSize         │
  │  驗證：等待 keepAliveTime + buffer 後檢查 activeCount           │
  └─────────────────────────────────────────────────────────────────┘

  壓測指標：
  ┌─────────────┬──────────────────────────────────────────────────┐
  │  吞吐量     │ tasks/second，對比序列執行的加速比               │
  │  延遲 P99   │ 第 99 百分位任務完成時間，反映長尾效能           │
  │  拒絕比例   │ rejected / total，評估參數設定是否合理           │
  │  佇列水位   │ queue.size() 峰值，評估是否需要擴容              │
  └─────────────┴──────────────────────────────────────────────────┘
```

壓測觀察吞吐、延遲、拒絕比例。

測試線程池時需涵蓋正常路徑和各種邊界情況。特別注意關閉時的競態：`shutdown()` 和最後一個任務完成之間存在時間視窗，測試需等待 `awaitTermination()` 返回 `true` 才能斷言結果。

```text
while (running) {
  task = queue.pop()
  run(task)
}
```

## 跨語言完整範例

最簡執行緒池：channel 做佇列，N 個 goroutine/thread 做 worker，展示核心機制。

### C

```c
/* 編譯: gcc -O2 -pthread -o ch15_c ch15.c && ./ch15_c */
#include <stdio.h>
#include <stdlib.h>
#include <pthread.h>
#include <unistd.h>
#include <stdatomic.h>

#define WORKERS   4
#define TASKS     20
#define QCAP      64

typedef struct { int id; } Task;

/* 環形緩衝佇列 */
typedef struct {
    Task        buf[QCAP];
    int         head, tail, size;
    pthread_mutex_t mu;
    pthread_cond_t  not_empty;
    atomic_int  shutdown;
    atomic_int  completed;
} Pool;

static Pool pool;

static void pool_init(void) {
    pool.head = pool.tail = pool.size = 0;
    atomic_store(&pool.shutdown, 0);
    atomic_store(&pool.completed, 0);
    pthread_mutex_init(&pool.mu, NULL);
    pthread_cond_init(&pool.not_empty, NULL);
}

static void pool_submit(int task_id) {
    pthread_mutex_lock(&pool.mu);
    pool.buf[pool.tail] = (Task){task_id};
    pool.tail = (pool.tail + 1) % QCAP;
    pool.size++;
    pthread_cond_signal(&pool.not_empty);
    pthread_mutex_unlock(&pool.mu);
}

static void *worker_loop(void *arg) {
    int wid = *(int *)arg;
    for (;;) {
        pthread_mutex_lock(&pool.mu);
        while (pool.size == 0 && !atomic_load(&pool.shutdown))
            pthread_cond_wait(&pool.not_empty, &pool.mu);
        if (pool.size == 0) {           /* shutdown + 空佇列 */
            pthread_mutex_unlock(&pool.mu);
            break;
        }
        Task t = pool.buf[pool.head];
        pool.head = (pool.head + 1) % QCAP;
        pool.size--;
        pthread_mutex_unlock(&pool.mu);

        usleep(20000);                  /* 模擬 20ms 工作 */
        int done = atomic_fetch_add(&pool.completed, 1) + 1;
        printf("Worker%d finished task %2d (total done: %d)\n",
               wid, t.id, done);
    }
    return NULL;
}

int main(void) {
    pool_init();
    pthread_t threads[WORKERS];
    int ids[WORKERS];
    for (int i = 0; i < WORKERS; i++) {
        ids[i] = i;
        pthread_create(&threads[i], NULL, worker_loop, &ids[i]);
    }
    for (int i = 0; i < TASKS; i++) {
        pool_submit(i);
    }
    /* 等佇列排空後再 shutdown */
    pthread_mutex_lock(&pool.mu);
    while (pool.size > 0)
        pthread_cond_wait(&pool.not_empty, &pool.mu);
    atomic_store(&pool.shutdown, 1);
    pthread_cond_broadcast(&pool.not_empty);
    pthread_mutex_unlock(&pool.mu);

    for (int i = 0; i < WORKERS; i++) pthread_join(threads[i], NULL);
    printf("All %d tasks done.\n", atomic_load(&pool.completed));
    return 0;
}
```

### C++

```cpp
// 編譯: g++ -std=c++17 -O2 -pthread -o ch15_cpp ch15.cpp && ./ch15_cpp
#include <iostream>
#include <queue>
#include <thread>
#include <mutex>
#include <condition_variable>
#include <functional>
#include <vector>
#include <atomic>

class SimpleThreadPool {
    std::queue<std::function<void()>> tasks;
    std::vector<std::thread> workers;
    std::mutex mu;
    std::condition_variable cv;
    bool stopped = false;
    std::atomic<int> completed{0};

public:
    explicit SimpleThreadPool(int n) {
        for (int i = 0; i < n; i++) {
            workers.emplace_back([this, i] {
                for (;;) {
                    std::function<void()> task;
                    {
                        std::unique_lock lk(mu);
                        cv.wait(lk, [this]{ return stopped || !tasks.empty(); });
                        if (stopped && tasks.empty()) return;
                        task = std::move(tasks.front());
                        tasks.pop();
                    }
                    task();
                    completed++;
                }
            });
        }
    }

    void submit(std::function<void()> f) {
        { std::lock_guard lk(mu); tasks.push(std::move(f)); }
        cv.notify_one();
    }

    int done_count() const { return completed.load(); }

    void shutdown() {
        { std::lock_guard lk(mu); stopped = true; }
        cv.notify_all();
        for (auto &t : workers) t.join();
    }
};

int main() {
    SimpleThreadPool pool(4);
    std::mutex print_mu;

    for (int i = 0; i < 20; i++) {
        pool.submit([i, &print_mu, &pool] {
            std::this_thread::sleep_for(std::chrono::milliseconds(20));
            std::lock_guard lk(print_mu);
            std::cout << "Task " << std::setw(2) << i
                      << " done, total=" << pool.done_count() + 1 << "\n";
        });
    }
    pool.shutdown();
    std::cout << "All tasks completed, total=" << pool.done_count() << "\n";
    return 0;
}
```

### Rust

```rust
// 執行: cargo run 或 rustc ch15.rs -o ch15 && ./ch15
use std::sync::{Arc, Mutex, Condvar};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::thread;
use std::collections::VecDeque;

type Job = Box<dyn FnOnce() + Send + 'static>;

struct SimplePool {
    queue:     Mutex<VecDeque<Option<Job>>>,
    cv:        Condvar,
    completed: AtomicUsize,
}

impl SimplePool {
    fn new() -> Arc<Self> {
        Arc::new(SimplePool {
            queue:     Mutex::new(VecDeque::new()),
            cv:        Condvar::new(),
            completed: AtomicUsize::new(0),
        })
    }

    fn submit(self: &Arc<Self>, f: impl FnOnce() + Send + 'static) {
        self.queue.lock().unwrap().push_back(Some(Box::new(f)));
        self.cv.notify_one();
    }

    fn spawn_workers(self: &Arc<Self>, n: usize) -> Vec<thread::JoinHandle<()>> {
        (0..n).map(|_| {
            let pool = Arc::clone(self);
            thread::spawn(move || loop {
                let job = {
                    let mut q = pool.cv
                        .wait_while(pool.queue.lock().unwrap(), |q| q.is_empty())
                        .unwrap();
                    q.pop_front().unwrap()
                };
                match job {
                    Some(f) => { f(); pool.completed.fetch_add(1, Ordering::Relaxed); }
                    None    => break,
                }
            })
        }).collect()
    }

    fn shutdown(self: &Arc<Self>, handles: Vec<thread::JoinHandle<()>>, n: usize) {
        for _ in 0..n {
            self.queue.lock().unwrap().push_back(None);
            self.cv.notify_one();
        }
        for h in handles { h.join().unwrap(); }
    }
}

fn main() {
    const WORKERS: usize = 4;
    const TASKS:   usize = 20;

    let pool = SimplePool::new();
    let handles = pool.spawn_workers(WORKERS);

    for i in 0..TASKS {
        let p = Arc::clone(&pool);
        pool.submit(move || {
            thread::sleep(std::time::Duration::from_millis(20));
            let done = p.completed.load(Ordering::Relaxed) + 1;
            println!("Task {:2} done, completed so far: {}", i, done);
        });
    }
    pool.shutdown(handles, WORKERS);
    println!("Total completed: {}", pool.completed.load(Ordering::Relaxed));
}
```

### Go

```go
// 執行: go run ch15.go
package main

import (
	"fmt"
	"sync"
	"sync/atomic"
	"time"
)

// SimplePool：channel 作為任務佇列，goroutine 作為 worker
type SimplePool struct {
	jobs      chan func()
	wg        sync.WaitGroup
	completed int64
}

func NewPool(workers, queueSize int) *SimplePool {
	p := &SimplePool{jobs: make(chan func(), queueSize)}
	for i := 0; i < workers; i++ {
		workerID := i
		go func() {
			for job := range p.jobs {
				job()
				atomic.AddInt64(&p.completed, 1)
				fmt.Printf("  Worker%d: task done (total=%d)\n",
					workerID, atomic.LoadInt64(&p.completed))
			}
		}()
	}
	return p
}

func (p *SimplePool) Submit(f func()) {
	p.wg.Add(1)
	p.jobs <- func() {
		defer p.wg.Done()
		f()
	}
}

func (p *SimplePool) Shutdown() {
	p.wg.Wait()
	close(p.jobs)
}

func main() {
	const numWorkers = 4
	const numTasks   = 20

	pool := NewPool(numWorkers, 64)
	for i := 0; i < numTasks; i++ {
		taskID := i
		pool.Submit(func() {
			time.Sleep(20 * time.Millisecond)
			_ = taskID
		})
	}
	pool.Shutdown()
	fmt.Printf("All done, completed=%d\n", atomic.LoadInt64(&pool.completed))
}
```

### Python

```python
# 執行: python3 ch15.py
import queue
import threading
import time
from typing import Callable


class SimpleThreadPool:
    """最簡執行緒池：queue 做佇列，Thread 做 worker。"""

    def __init__(self, num_workers: int, queue_size: int = 64):
        self._queue = queue.Queue(maxsize=queue_size)
        self._completed = 0
        self._lock = threading.Lock()
        self._workers = [
            threading.Thread(target=self._worker_loop, name=f"Worker-{i}",
                             daemon=True)
            for i in range(num_workers)
        ]
        for w in self._workers:
            w.start()

    def _worker_loop(self):
        """Worker 主循環：不斷從佇列取任務並執行。"""
        while True:
            task = self._queue.get()
            if task is None:        # None 作為關閉訊號
                self._queue.task_done()
                break
            try:
                task()
                with self._lock:
                    self._completed += 1
                    print(f"{threading.current_thread().name}: "
                          f"task done (total={self._completed})")
            finally:
                self._queue.task_done()

    def submit(self, fn: Callable):
        self._queue.put(fn)

    def shutdown(self):
        """等待所有任務完成後關閉。"""
        self._queue.join()          # 等佇列排空
        for _ in self._workers:
            self._queue.put(None)   # 每個 worker 一個停止訊號
        for w in self._workers:
            w.join()
        return self._completed


if __name__ == "__main__":
    pool = SimpleThreadPool(num_workers=4, queue_size=64)

    for i in range(20):
        def make_task(task_id):
            def task():
                time.sleep(0.02)
                _ = task_id     # 實際工作
            return task
        pool.submit(make_task(i))

    total = pool.shutdown()
    print(f"All tasks completed, total={total}")
```

## 完整專案級範例（Python）

檔案：`examples/python/ch15.py`

```bash
python3 examples/python/ch15.py
```

```python
"""Chapter 15: custom thread pool — 手動實作執行緒池的核心機制。"""
import queue
import threading

q = queue.Queue()
stop = object()              # 哨兵值，用來通知 worker 退出


def worker():
    """Worker 主循環：取任務執行，遇到 stop 哨兵則退出。"""
    while True:
        task = q.get()
        if task is stop:
            q.task_done()
            return
        try:
            task()
        finally:
            q.task_done()


if __name__ == "__main__":
    num_workers = 3
    workers = [threading.Thread(target=worker, daemon=True)
               for _ in range(num_workers)]
    for w in workers: w.start()

    # 提交 5 個任務
    for i in range(5):
        task_id = i
        q.put(lambda tid=task_id: print(f"task {tid} on {threading.current_thread().name}"))

    # 等所有任務完成，再送停止訊號
    q.join()
    for _ in workers: q.put(stop)
    for w in workers: w.join()
    print("pool shutdown complete")
```
