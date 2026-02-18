# 第13章 線程池

## 13.1 狀態與生命週期（對應 13.1.1~13.1.2）

<!-- subsection-diagram -->
### 本小節示意圖（ASCII）

```text
  線程池狀態機

                    ┌─────────────┐
               ──►  │   RUNNING   │  ◄── 正常接受任務並處理
                    └──────┬──────┘
                           │
               ┌───────────┴──────────────┐
               │ shutdown()               │ shutdownNow()
               ▼                          ▼
        ┌─────────────┐            ┌─────────────┐
        │  SHUTDOWN   │            │    STOP     │
        │（不收新任務) │            │（立即中斷） │
        │  繼續排隊中  │            │  返回未執行  │
        │  的舊任務    │            │  任務列表    │
        └──────┬──────┘            └──────┬──────┘
               │ 佇列清空                  │ workers 停止
               │ workers 歸零             │
               └───────────┬─────────────┘
                            ▼
                    ┌─────────────┐
                    │   TIDYING   │  ← 所有任務已完成
                    │ worker=0    │    呼叫 terminated() hook
                    └──────┬──────┘
                            │ terminated() 完成
                            ▼
                    ┌─────────────┐
                    │ TERMINATED  │  ← 最終狀態，資源全部釋放
                    └─────────────┘

  注意：狀態只能單向推進，不可逆轉
```

管理執行緒建立、運作、關閉，避免每次任務都開新執行緒。

線程池維護一組預先建立的執行緒，持續從任務佇列取出任務執行。這樣避免了頻繁建立/銷毀執行緒的開銷（每次建立約耗費數十微秒），並提供統一的資源上限，防止系統因過多執行緒而耗盡記憶體。

## 13.2 建立方式（對應 13.2.1~13.2.4）

<!-- subsection-diagram -->
### 本小節示意圖（ASCII）

```text
  四種線程池類型對比

  ┌─────────────┬──────────────────┬─────────────────┬──────────────────┐
  │    類型      │    執行緒數量    │    任務佇列     │    適用場景      │
  ├─────────────┼──────────────────┼─────────────────┼──────────────────┤
  │ Fixed        │ 固定 N 個        │ 無界佇列        │ CPU 密集計算     │
  │ Thread Pool  │ 永遠存在         │ LinkedBlocking  │ 任務量穩定       │
  │              │                  │ Queue           │ Web 後端服務     │
  │              │  [T][T][T][T]    │  [Q─Q─Q─Q─…]   │                  │
  ├─────────────┼──────────────────┼─────────────────┼──────────────────┤
  │ Cached       │ 彈性 0~MAX       │ SynchronousQueue│ 短暫突發流量     │
  │ Thread Pool  │ 閒置 60s 後回收  │ (容量=0，直接   │ 任務量不可預測   │
  │              │                  │  handoff)       │ 但單個任務快     │
  │              │  [T]?[T]?[T]?    │  [直接交付]     │                  │
  ├─────────────┼──────────────────┼─────────────────┼──────────────────┤
  │ Scheduled    │ 固定核心 N 個    │ DelayedQueue    │ 定時任務排程     │
  │ Thread Pool  │ 支援延遲/週期    │ (按時間排序)    │ Cron 類工作      │
  │              │                  │                 │ 心跳、清理任務   │
  │              │  [T][T] (定時)   │  [t=10s][t=30s] │                  │
  ├─────────────┼──────────────────┼─────────────────┼──────────────────┤
  │ ForkJoin     │ N ≈ CPU 核數     │ 每執行緒私有    │ 分治演算法       │
  │ Pool         │ 工作竊取（steal) │ Deque           │ 遞迴並行處理     │
  │              │                  │ (可從別人尾部   │ Stream parallel  │
  │              │  [T]←steal─[T]   │  偷任務)        │                  │
  └─────────────┴──────────────────┴─────────────────┴──────────────────┘
```

固定池、快取池、排程池、分治池各有適用場景。選錯類型可能導致記憶體耗盡（Cached pool 在爆發流量下無限建執行緒）或效能低下（Fixed pool 在 I/O 密集時執行緒閒置）。

## 13.3 提交流程與拒絕策略（對應 13.3.1~13.3.2）

<!-- subsection-diagram -->
### 本小節示意圖（ASCII）

```text
  submit(task) 完整決策流程

  submit(task)
       │
       ▼
  ┌─────────────────────────────┐
  │ 核心執行緒數 < corePoolSize? │
  └──────────────┬──────────────┘
       是 │               │ 否
          ▼               ▼
  ┌───────────────┐  ┌─────────────────────────┐
  │ 新建 Worker   │  │ 任務佇列 queue 未滿？    │
  │ 執行此任務    │  └────────────┬────────────┘
  └───────────────┘       是 │            │ 否
                             ▼            ▼
                    ┌─────────────┐  ┌──────────────────────────┐
                    │ 入佇列等待  │  │ 執行緒數 < maxPoolSize?  │
                    └─────────────┘  └────────────┬─────────────┘
                                          是 │             │ 否
                                             ▼             ▼
                                    ┌──────────────┐  ┌─────────────────────┐
                                    │ 新建非核心   │  │      拒絕策略       │
                                    │ Worker 執行  │  ├─────────────────────┤
                                    └──────────────┘  │ AbortPolicy:拋例外  │
                                                       │ CallerRunsPolicy:   │
                                                       │   呼叫者自己跑      │
                                                       │ DiscardPolicy:靜默  │
                                                       │ DiscardOldest:丟最  │
                                                       │   舊的任務          │
                                                       └─────────────────────┘
```

核心是「任務佇列 + 工作執行緒 + 飽和策略」。

任務提交時，線程池按優先級嘗試：先用核心執行緒，再入佇列，再擴展到最大執行緒數，最後觸發拒絕策略。理解這個流程對調參（corePoolSize、maxPoolSize、queueCapacity）至關重要。

## 13.4 關閉（對應 13.4.1~13.4.2）

<!-- subsection-diagram -->
### 本小節示意圖（ASCII）

```text
  兩種關閉方式對比

  ┌──────────────────────────────────────────────────────────────┐
  │  shutdown()：優雅關閉                                         │
  │                                                              │
  │  1. 標記狀態為 SHUTDOWN                                       │
  │  2. 不再接受新的 submit() 呼叫                                │
  │  3. 已在佇列中的任務 ✅ 繼續執行完畢                         │
  │  4. 所有 worker 完成後進入 TERMINATED                        │
  │                                                              │
  │  Timeline:                                                   │
  │  ──┬──────────────────────────────────────┬──► 結束         │
  │    │ shutdown()                            │                 │
  │    │←── 不接受新任務 ──►│←── 排空佇列 ──►│                 │
  │    │  [Q任務1][Q任務2]  →  執行完畢        │                 │
  └──────────────────────────────────────────────────────────────┘

  ┌──────────────────────────────────────────────────────────────┐
  │  shutdownNow()：立即關閉                                      │
  │                                                              │
  │  1. 標記狀態為 STOP                                          │
  │  2. 對所有 worker 送出 interrupt() 訊號                      │
  │  3. 佇列中 ❌ 未執行的任務以 List 形式返回給呼叫者            │
  │  4. 正在執行的任務若響應中斷則提前結束                        │
  │                                                              │
  │  Timeline:                                                   │
  │  ──┬────────────────────┬──► 結束                           │
  │    │ shutdownNow()      │                                   │
  │    │←── 中斷 workers ──►│  返回未執行任務列表               │
  │    │  [Q任務1][Q任務2]  ← 取出並返回，不執行                 │
  └──────────────────────────────────────────────────────────────┘
```

- 優雅關閉（`shutdown`）：不收新任務，處理完已接收的任務後關閉。
- 立即關閉（`shutdownNow`）：嘗試中斷執行中的任務，返回未執行的任務列表。

實務上應搭配 `awaitTermination(timeout)` 等待關閉完成，避免主程式提前退出導致任務被截斷。

## 13.5 參數調優（對應 13.5.1~13.5.2）

<!-- subsection-diagram -->
### 本小節示意圖（ASCII）

```text
  線程數調優公式

  ┌─────────────────────────────────────────────────────────────┐
  │  符號定義                                                    │
  │  N  = CPU 核心數（Runtime.getRuntime().availableProcessors）│
  │  WT = 平均等待時間（Wait Time，例如 I/O 等待 900ms）         │
  │  ST = 平均服務時間（Service Time，例如 CPU 計算 100ms）      │
  └─────────────────────────────────────────────────────────────┘

  ┌─────────────────────────────────────────────────────────────┐
  │  CPU 密集型任務（幾乎不等待 I/O）                            │
  │                                                             │
  │  最佳執行緒數 = N + 1                                       │
  │                                                             │
  │  +1 的原因：當某執行緒因缺頁中斷等短暫暫停時，              │
  │            額外一個執行緒可立即接手 CPU，避免浪費            │
  │                                                             │
  │  範例：N=8 核 → 推薦 9 個執行緒                             │
  └─────────────────────────────────────────────────────────────┘

  ┌─────────────────────────────────────────────────────────────┐
  │  I/O 密集型任務（大量等待磁碟/網路）                         │
  │                                                             │
  │  最佳執行緒數 = N × (1 + WT/ST)                            │
  │                                                             │
  │  直覺：執行緒等待 I/O 時 CPU 是閒置的，                     │
  │        可讓更多執行緒同時在 CPU 上運行                       │
  │                                                             │
  │  範例：N=8，WT=900ms，ST=100ms                              │
  │        = 8 × (1 + 900/100)                                  │
  │        = 8 × 10 = 80 個執行緒                               │
  │                                                             │
  │  ⚠️  上限受記憶體限制，每個 Java 執行緒預設 256KB~1MB 棧    │
  └─────────────────────────────────────────────────────────────┘

  實務建議：先用公式估算，再透過壓測（吞吐量、延遲）調整
```

CPU 密集：執行緒數接近核心數（N+1）。
I/O 密集：可高於核心數，按 N×(1+WT/ST) 估算。

```text
Producer -> Queue -> Worker x N -> Result
```

## 跨語言完整範例

執行緒池處理批次任務：固定 4 個 worker，處理 20 個任務，顯示並發執行效果。

### C

```c
/* 編譯: gcc -O2 -pthread -o ch13_c ch13.c && ./ch13_c */
#include <stdio.h>
#include <stdlib.h>
#include <pthread.h>
#include <unistd.h>

#define WORKERS 4
#define TASKS   20
#define QUEUE_CAP 64

typedef void (*task_fn)(int);

typedef struct {
    task_fn  fn;
    int      arg;
} Task;

typedef struct {
    Task      queue[QUEUE_CAP];
    int       head, tail, size;
    pthread_mutex_t mu;
    pthread_cond_t  not_empty;
    int       done;           /* 1 = shutdown */
} Pool;

Pool pool = {.head=0, .tail=0, .size=0, .done=0,
             .mu=PTHREAD_MUTEX_INITIALIZER,
             .not_empty=PTHREAD_COND_INITIALIZER};

void pool_submit(task_fn fn, int arg) {
    pthread_mutex_lock(&pool.mu);
    pool.queue[pool.tail] = (Task){fn, arg};
    pool.tail = (pool.tail + 1) % QUEUE_CAP;
    pool.size++;
    pthread_cond_signal(&pool.not_empty);
    pthread_mutex_unlock(&pool.mu);
}

void *worker_loop(void *arg) {
    int id = *(int *)arg;
    for (;;) {
        pthread_mutex_lock(&pool.mu);
        while (pool.size == 0 && !pool.done)
            pthread_cond_wait(&pool.not_empty, &pool.mu);
        if (pool.size == 0 && pool.done) {
            pthread_mutex_unlock(&pool.mu);
            break;
        }
        Task t = pool.queue[pool.head];
        pool.head = (pool.head + 1) % QUEUE_CAP;
        pool.size--;
        pthread_mutex_unlock(&pool.mu);
        t.fn(t.arg);
    }
    printf("Worker %d exiting\n", id);
    return NULL;
}

void process_task(int task_id) {
    printf("Task %2d running on thread %lu\n",
           task_id, pthread_self() % 10000);
    usleep(50000);  /* 模擬 50ms 工作 */
}

int main(void) {
    pthread_t threads[WORKERS];
    int ids[WORKERS];
    for (int i = 0; i < WORKERS; i++) {
        ids[i] = i;
        pthread_create(&threads[i], NULL, worker_loop, &ids[i]);
    }
    for (int i = 0; i < TASKS; i++)
        pool_submit(process_task, i);

    /* 等佇列排空後關閉 */
    pthread_mutex_lock(&pool.mu);
    while (pool.size > 0)
        pthread_cond_wait(&pool.not_empty, &pool.mu);
    pool.done = 1;
    pthread_cond_broadcast(&pool.not_empty);
    pthread_mutex_unlock(&pool.mu);

    for (int i = 0; i < WORKERS; i++) pthread_join(threads[i], NULL);
    printf("All %d tasks completed.\n", TASKS);
    return 0;
}
```

### C++

```cpp
// 編譯: g++ -std=c++17 -O2 -pthread -o ch13_cpp ch13.cpp && ./ch13_cpp
#include <iostream>
#include <thread>
#include <queue>
#include <functional>
#include <mutex>
#include <condition_variable>
#include <vector>

class ThreadPool {
    std::vector<std::thread> workers;
    std::queue<std::function<void()>> tasks;
    std::mutex mu;
    std::condition_variable cv;
    bool stop = false;
public:
    explicit ThreadPool(int n) {
        for (int i = 0; i < n; i++)
            workers.emplace_back([this] {
                for (;;) {
                    std::function<void()> task;
                    {
                        std::unique_lock lk(mu);
                        cv.wait(lk, [this]{ return stop || !tasks.empty(); });
                        if (stop && tasks.empty()) return;
                        task = std::move(tasks.front());
                        tasks.pop();
                    }
                    task();
                }
            });
    }
    void submit(std::function<void()> f) {
        { std::lock_guard lk(mu); tasks.push(std::move(f)); }
        cv.notify_one();
    }
    ~ThreadPool() {
        { std::lock_guard lk(mu); stop = true; }
        cv.notify_all();
        for (auto &t : workers) t.join();
    }
};

int main() {
    ThreadPool pool(4);
    std::mutex print_mu;
    for (int i = 0; i < 20; i++) {
        pool.submit([i, &print_mu] {
            std::this_thread::sleep_for(std::chrono::milliseconds(50));
            std::lock_guard lk(print_mu);
            std::cout << "Task " << i << " done by thread "
                      << std::this_thread::get_id() << "\n";
        });
    }
    /* ThreadPool 解構時自動等待所有任務完成 */
    std::cout << "All tasks submitted, waiting...\n";
    return 0;
}
```

### Rust

```rust
// 執行: cargo run 或 rustc ch13.rs -o ch13 && ./ch13
use std::sync::{Arc, Mutex};
use std::sync::mpsc;
use std::thread;

type Job = Box<dyn FnOnce() + Send + 'static>;

struct ThreadPool {
    _workers: Vec<thread::JoinHandle<()>>,
    sender: mpsc::Sender<Option<Job>>,
}

impl ThreadPool {
    fn new(size: usize) -> Self {
        let (sender, receiver) = mpsc::channel::<Option<Job>>();
        let receiver = Arc::new(Mutex::new(receiver));
        let workers = (0..size).map(|_| {
            let rx = Arc::clone(&receiver);
            thread::spawn(move || loop {
                let msg = rx.lock().unwrap().recv().unwrap();
                match msg {
                    Some(job) => job(),
                    None => break,
                }
            })
        }).collect();
        ThreadPool { _workers: workers, sender }
    }

    fn submit<F: FnOnce() + Send + 'static>(&self, f: F) {
        self.sender.send(Some(Box::new(f))).unwrap();
    }

    fn shutdown(self) {
        for _ in &self._workers {
            self.sender.send(None).unwrap();
        }
        for w in self._workers { w.join().unwrap(); }
    }
}

fn main() {
    let pool = ThreadPool::new(4);
    let counter = Arc::new(Mutex::new(0));

    for i in 0..20 {
        let c = Arc::clone(&counter);
        pool.submit(move || {
            thread::sleep(std::time::Duration::from_millis(50));
            let mut n = c.lock().unwrap();
            *n += 1;
            println!("Task {:2} done, completed so far: {}", i, *n);
        });
    }
    pool.shutdown();
    println!("All tasks completed.");
}
```

### Go

```go
// 執行: go run ch13.go
package main

import (
	"fmt"
	"sync"
	"time"
)

func newWorkerPool(workers int, queueSize int) chan<- func() {
	jobs := make(chan func(), queueSize)
	for i := 0; i < workers; i++ {
		workerID := i
		go func() {
			for job := range jobs {
				fmt.Printf("  Worker %d picked up job\n", workerID)
				job()
			}
		}()
	}
	return jobs
}

func main() {
	const numWorkers = 4
	const numTasks   = 20

	pool := newWorkerPool(numWorkers, 64)
	var wg sync.WaitGroup

	for i := 0; i < numTasks; i++ {
		taskID := i
		wg.Add(1)
		pool <- func() {
			defer wg.Done()
			time.Sleep(50 * time.Millisecond)
			fmt.Printf("Task %2d completed\n", taskID)
		}
	}

	wg.Wait()
	close(pool)
	fmt.Printf("All %d tasks completed.\n", numTasks)
}
```

### Python

```python
# 執行: python3 ch13.py
import time
import threading
from concurrent.futures import ThreadPoolExecutor, as_completed


def process_task(task_id: int) -> str:
    """模擬一個需要 50ms 的工作任務。"""
    time.sleep(0.05)
    thread_name = threading.current_thread().name
    return f"Task {task_id:2d} done by {thread_name}"


if __name__ == "__main__":
    num_tasks   = 20
    num_workers = 4

    start = time.time()
    with ThreadPoolExecutor(max_workers=num_workers,
                            thread_name_prefix="Worker") as pool:
        futures = [pool.submit(process_task, i) for i in range(num_tasks)]
        for future in as_completed(futures):
            print(future.result())

    elapsed = time.time() - start
    # 序列需 20×0.05=1.0s，4 個 worker 並行約 0.25s
    print(f"\n完成 {num_tasks} 個任務，耗時 {elapsed:.2f}s "
          f"（序列估計 {num_tasks * 0.05:.2f}s）")
```

## 完整專案級範例（Python）

檔案：`examples/python/ch13.py`

```bash
python3 examples/python/ch13.py
```

```python
"""Chapter 13: thread pool — 使用 ThreadPoolExecutor 並行處理批次任務。"""
import time
from concurrent.futures import ThreadPoolExecutor


def square(x: int) -> int:
    """模擬 CPU 計算：計算平方值。"""
    time.sleep(0.01)  # 模擬少量計算時間
    return x * x


if __name__ == "__main__":
    inputs = list(range(16))
    start = time.time()

    with ThreadPoolExecutor(max_workers=4) as ex:
        results = list(ex.map(square, inputs))

    elapsed = time.time() - start
    print(f"結果: {results}")
    print(f"耗時: {elapsed:.2f}s（4 個 worker 並行）")
```
