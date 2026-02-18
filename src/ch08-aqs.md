# 第8章 AQS 佇列同步器

## 8.1 AQS 核心（對應 8.1.1~8.1.2）

<!-- subsection-diagram -->
### 本小節示意圖（ASCII）

```text
  AQS（AbstractQueuedSynchronizer）核心結構
  ════════════════════════════════════════════════════════

  AQS 由兩個核心元件組成：

  ┌─────────────────────────────────────────────────────┐
  │                    AQS 物件                         │
  │                                                     │
  │  state: int = 0   ← 核心同步狀態（CAS 競爭）        │
  │  head: Node*  ──────────────────────────────────┐   │
  │  tail: Node*  ──────────────────────────────────┼─┐ │
  └──────────────────────────────────────────────────┼─┼─┘
                                                     │ │
  CLH 雙向等待佇列：                                  │ │
  ┌──────────┐    ┌──────────────┐    ┌──────────────┐ │
  │  head    │    │   Node(T2)   │    │   Node(T3)   │ │
  │ (dummy)  │◄──►│  waitStatus  │◄──►│  waitStatus  │◄┘
  │  Node    │    │  = SIGNAL    │    │  = SIGNAL    │
  │          │    │  thread=T2   │    │  thread=T3   │
  └──────────┘    └──────────────┘    └──────┬───────┘
                                              │
                                           tail ◄── 最後入隊

  獨占模式 acquire 流程（以 ReentrantLock.lock 為例）：
  ┌─────────────────────────────────────────────────────┐
  │                                                     │
  │  Thread 呼叫 acquire(1)                             │
  │       │                                             │
  │       ▼                                             │
  │  tryAcquire()  ─── 成功（CAS state: 0→1）──► 持有鎖 │
  │       │                                             │
  │       │ 失敗（state != 0，鎖被佔用）                │
  │       ▼                                             │
  │  addWaiter(EXCLUSIVE)                               │
  │  建立 Node(thread=自己)，CAS 加入佇列尾部           │
  │       │                                             │
  │       ▼                                             │
  │  acquireQueued()                                    │
  │  ┌───────────────────────────────────────────┐      │
  │  │  for(;;) {                                │      │
  │  │    若前驅是 head → 再嘗試 tryAcquire()    │      │
  │  │    若成功 → 自己成為新 head，退出迴圈     │      │
  │  │    若失敗 → 前驅設為 SIGNAL               │      │
  │  │    LockSupport.park()（掛起執行緒）       │      │
  │  │    等待 unpark() 喚醒後繼續迴圈           │      │
  │  │  }                                        │      │
  │  └───────────────────────────────────────────┘      │
  │       │                                             │
  │  release(1) 時：                                    │
  │  tryRelease() → state 0 → unpark(head.next.thread) │
  └─────────────────────────────────────────────────────┘
```

AQS = `state`（整數狀態）+ FIFO 等待佇列。

## 8.2 獨占與共享（對應 8.2.1~8.2.4）

<!-- subsection-diagram -->
### 本小節示意圖（ASCII）

```text
  獨占模式 vs 共享模式對比
  ════════════════════════════════════════════════════════

  獨占模式（Exclusive）— ReentrantLock
  ┌─────────────────────────────────────────────────────┐
  │  state: 0 → 1（被獲取） → 0（釋放）                │
  │                                                     │
  │  時間軸：                                           │
  │  ─────────────────────────────────────────────►    │
  │  T1 獲取 ████████████████████ T1 釋放              │
  │  T2 等待 ░░░░░░░░░░░░░░░░░░░░ T2 獲取 ████████     │
  │  T3 等待 ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░ T3 獲取  │
  │                                                     │
  │  state 只有 0 和 1，一次只有一個執行緒在臨界區      │
  │  tryAcquire：CAS(state, 0, 1) 成功才獲取           │
  │  tryRelease：state = 0，unpark 下一個等待者        │
  └─────────────────────────────────────────────────────┘

  共享模式（Shared）— Semaphore(permits=2)
  ┌─────────────────────────────────────────────────────┐
  │  state: 2（可用名額） → 1 → 0（滿） → 1 → 2        │
  │                                                     │
  │  時間軸：                                           │
  │  ─────────────────────────────────────────────►    │
  │  T1 獲取(state:2→1)████████████████ T1 釋放(→2)   │
  │  T2 獲取(state:1→0)████████████████ T2 釋放(→1)   │
  │  T3 等待(state=0) ░░░░░░░░░░░░░░░░ T3 獲取(1→0)██ │
  │  T4 等待(state=0) ░░░░░░░░░░░░░░░░ T4 等待...      │
  │                                                     │
  │  tryAcquireShared：state > 0 → CAS(state, s, s-1) │
  │  tryReleaseShared：CAS(state, s, s+1)              │
  │                                                     │
  │  setHeadAndPropagate：獲取成功後                   │
  │  如果還有名額（state > 0），傳播喚醒後續等待者      │
  │  ┌────────────────────────────────────────────┐    │
  │  │  T2 獲取成功後：                           │    │
  │  │  state = 1 > 0 → unpark(T3) 傳播           │    │
  │  └────────────────────────────────────────────┘    │
  └─────────────────────────────────────────────────────┘

  獨占 vs 共享 API 對比：
  ┌────────────────────────┬────────────────────────────┐
  │ 獨占（Exclusive）      │ 共享（Shared）              │
  ├────────────────────────┼────────────────────────────┤
  │ tryAcquire(arg)        │ tryAcquireShared(arg)       │
  │ tryRelease(arg)        │ tryReleaseShared(arg)       │
  │ acquire(arg)           │ acquireShared(arg)          │
  │ release(arg)           │ releaseShared(arg)          │
  │ ReentrantLock          │ Semaphore, ReadLock         │
  └────────────────────────┴────────────────────────────┘
```

- 獨占：一次一個（ReentrantLock）
- 共享：可多個（Semaphore/Read lock）

```text
state=0 -> acquire 成功 -> state=1
        -> 失敗 -> 入隊等待
```

白話例子：一個收銀櫃台（獨占） vs 多個自助結帳機（共享）。

## 示意圖

```text
state=1 (held)
wait queue: N1 -> N2 -> N3
release -> unpark N1 -> state 轉移
```

## 跨語言完整範例

主題：Semaphore 限制最多 N 個並發任務（5 個任務，最多 2 個同時運行）

### C（POSIX sem_t）

```c
// 編譯：gcc -std=c11 -pthread -o ch08_c ch08.c
#include <semaphore.h>
#include <pthread.h>
#include <stdio.h>
#include <unistd.h>

#define MAX_CONCURRENT 2
#define TASK_COUNT 5

static sem_t sem;

void *task(void *arg) {
    int id = *(int *)arg;
    sem_wait(&sem);                      // acquire（P 操作）
    printf("task %d: running\n", id);
    usleep(50000);                       // 模擬工作 50ms
    printf("task %d: done\n", id);
    sem_post(&sem);                      // release（V 操作）
    return NULL;
}

int main(void) {
    sem_init(&sem, 0, MAX_CONCURRENT);  // 最多 2 個並發
    pthread_t threads[TASK_COUNT];
    int ids[TASK_COUNT];
    for (int i = 0; i < TASK_COUNT; i++) {
        ids[i] = i;
        pthread_create(&threads[i], NULL, task, &ids[i]);
    }
    for (int i = 0; i < TASK_COUNT; i++)
        pthread_join(threads[i], NULL);
    sem_destroy(&sem);
    return 0;
}
```

### C++（std::counting_semaphore，C++20）

```cpp
// 編譯：g++ -std=c++20 -pthread -o ch08_cpp ch08.cpp
#include <semaphore>
#include <thread>
#include <chrono>
#include <iostream>
#include <vector>

constexpr int MAX_CONCURRENT = 2;
constexpr int TASK_COUNT = 5;

static std::counting_semaphore<MAX_CONCURRENT> sem(MAX_CONCURRENT);

void task(int id) {
    sem.acquire();                       // 獲取名額
    std::cout << "task " << id << ": running\n";
    std::this_thread::sleep_for(std::chrono::milliseconds(50));
    std::cout << "task " << id << ": done\n";
    sem.release();                       // 釋放名額
}

int main() {
    std::vector<std::thread> threads;
    for (int i = 0; i < TASK_COUNT; i++)
        threads.emplace_back(task, i);
    for (auto &t : threads) t.join();
}
```

### Rust（Semaphore via Arc<Mutex<i32>>）

```rust
// 執行：cargo run 或 rustc ch08.rs && ./ch08
use std::sync::{Arc, Condvar, Mutex};
use std::thread;
use std::time::Duration;

const MAX_CONCURRENT: i32 = 2;
const TASK_COUNT: usize = 5;

fn main() {
    // 用 Mutex<i32> + Condvar 模擬 Semaphore
    let pair = Arc::new((Mutex::new(MAX_CONCURRENT), Condvar::new()));
    let mut handles = Vec::new();

    for id in 0..TASK_COUNT {
        let pair = Arc::clone(&pair);
        handles.push(thread::spawn(move || {
            let (lock, cvar) = &*pair;
            // acquire
            let mut count = lock.lock().unwrap();
            while *count == 0 {
                count = cvar.wait(count).unwrap();
            }
            *count -= 1;
            drop(count);

            println!("task {}: running", id);
            thread::sleep(Duration::from_millis(50));
            println!("task {}: done", id);

            // release
            *lock.lock().unwrap() += 1;
            cvar.notify_one();
        }));
    }
    for h in handles { h.join().unwrap(); }
}
```

### Go（channel 作為 Semaphore）

```go
// 執行：go run ch08.go
package main

import (
	"fmt"
	"sync"
	"time"
)

const (
	maxConcurrent = 2
	taskCount     = 5
)

func main() {
	sem := make(chan struct{}, maxConcurrent) // 緩衝 channel 作 Semaphore
	var wg sync.WaitGroup

	for i := 0; i < taskCount; i++ {
		wg.Add(1)
		go func(id int) {
			defer wg.Done()
			sem <- struct{}{}              // acquire（放入代表佔用名額）
			fmt.Printf("task %d: running\n", id)
			time.Sleep(50 * time.Millisecond)
			fmt.Printf("task %d: done\n", id)
			<-sem                          // release（取出代表釋放名額）
		}(i)
	}
	wg.Wait()
}
```

### Python（threading.Semaphore）

```python
# 執行：python3 ch08.py
import threading
import time

MAX_CONCURRENT = 2
TASK_COUNT = 5

sem = threading.Semaphore(MAX_CONCURRENT)

def task(task_id):
    with sem:                            # acquire / release 自動管理
        print(f"task {task_id}: running")
        time.sleep(0.05)
        print(f"task {task_id}: done")

if __name__ == "__main__":
    ts = [threading.Thread(target=task, args=(i,)) for i in range(TASK_COUNT)]
    for t in ts: t.start()
    for t in ts: t.join()
```

## 完整專案級範例（Python）

檔案：`examples/python/ch08.py`

```bash
python3 examples/python/ch08.py
```

```python
"""Chapter 08: queue synchronizer flavor via semaphore."""
import threading
import time

sem = threading.Semaphore(2)


def task(i: int):
    with sem:
        print(f"task {i} enter")
        time.sleep(0.05)
        print(f"task {i} leave")


if __name__ == "__main__":
    ts = [threading.Thread(target=task, args=(i,)) for i in range(5)]
    for t in ts: t.start()
    for t in ts: t.join()
```
