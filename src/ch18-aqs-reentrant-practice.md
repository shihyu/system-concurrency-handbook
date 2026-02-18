# 第18章 AQS 可重入鎖實戰

## 18.1 目標

<!-- subsection-diagram -->
### 本小節示意圖

```text
手寫鎖 vs OS Mutex 功能對比

  ┌──────────────────────┬──────────────────┬──────────────────────┐
  │       功能           │   手寫可重入鎖   │     OS Mutex         │
  ├──────────────────────┼──────────────────┼──────────────────────┤
  │  互斥保護            │  ✓               │  ✓                   │
  ├──────────────────────┼──────────────────┼──────────────────────┤
  │  可重入              │  ✓ 計數器追蹤    │  △ 依 OS/語言而定    │
  │  (同執行緒多次鎖)    │    state 欄位    │    pthread 預設不可  │
  ├──────────────────────┼──────────────────┼──────────────────────┤
  │  可阻塞等待          │  ✓ park/unpark   │  ✓                   │
  ├──────────────────────┼──────────────────┼──────────────────────┤
  │  可喚醒              │  ✓ unpark 精確   │  ✓                   │
  │                      │    喚醒指定執行緒│                      │
  ├──────────────────────┼──────────────────┼──────────────────────┤
  │  可超時              │  ✓ 需自行實作    │  △ 部分 OS 支援      │
  │  (tryLock + timeout) │    計時邏輯      │    timedwait         │
  ├──────────────────────┼──────────────────┼──────────────────────┤
  │  可中斷              │  ✓ 需自行實作    │  △ 依實作而定        │
  │  (interrupt 喚醒)    │    中斷標記      │                      │
  ├──────────────────────┼──────────────────┼──────────────────────┤
  │  公平性控制          │  ✓ 可選公平/    │  ✗ 通常 OS 決定      │
  │                      │    非公平佇列   │                      │
  ├──────────────────────┼──────────────────┼──────────────────────┤
  │  自訂條件變數數量    │  ✓ 多個 Condition│  △ 有限              │
  └──────────────────────┴──────────────────┴──────────────────────┘

  目標：自己做出「可重入 + 可阻塞等待 + 可喚醒」的鎖，
        同時支援超時與中斷路徑。
```

自己做出「可重入 + 可阻塞等待 + 可喚醒」的鎖。

## 18.2 狀態定義

<!-- subsection-diagram -->
### 本小節示意圖

```text
可重入鎖的三個核心欄位

  ┌──────────────────────────────────────────────────────────┐
  │                   ReentrantLock 結構                      │
  │                                                          │
  │  ┌──────────────────────────────────────────────────┐   │
  │  │  state: AtomicInt                                │   │
  │  │                                                  │   │
  │  │   0    → 鎖空閒（free）                          │   │
  │  │   1    → 被持有一次                              │   │
  │  │   2    → 同一執行緒重入兩次                      │   │
  │  │   n    → 同一執行緒重入 n 次                     │   │
  │  │                                                  │   │
  │  │  作用：追蹤重入深度，state→0 才真正釋放鎖        │   │
  │  └──────────────────────────────────────────────────┘   │
  │                                                          │
  │  ┌──────────────────────────────────────────────────┐   │
  │  │  owner: Thread (nullable)                        │   │
  │  │                                                  │   │
  │  │   null     → 無人持有                            │   │
  │  │   Thread A → Thread A 持有                       │   │
  │  │                                                  │   │
  │  │  作用：判斷當前執行緒是否為持有者                 │   │
  │  │        若是 → state++（重入）                    │   │
  │  │        若否 → 進入等待佇列                       │   │
  │  └──────────────────────────────────────────────────┘   │
  │                                                          │
  │  ┌──────────────────────────────────────────────────┐   │
  │  │  waiters: Queue<Thread>                          │   │
  │  │                                                  │   │
  │  │   [Thread B] → [Thread C] → [Thread D] → null   │   │
  │  │                                                  │   │
  │  │  作用：FIFO 佇列儲存等待的執行緒                  │   │
  │  │        公平鎖：按入隊順序喚醒                    │   │
  │  │        非公平鎖：允許搶占                        │   │
  │  └──────────────────────────────────────────────────┘   │
  └──────────────────────────────────────────────────────────┘

  三個欄位的協作：

  owner=Thread A, state=2, waiters=[B, C]

  Thread A 再次 lock() → owner==A → state=3（重入）
  Thread B 呼叫 lock() → owner!=B → 入隊，park()
```

- `state`: 重入次數
- `owner`: 持有者執行緒
- queue: 等待節點

## 18.3 獲取與釋放（對應 18.3.1~18.3.3）

<!-- subsection-diagram -->
### 本小節示意圖

```text
可重入鎖狀態機

  ┌─────────────────────────────────────────────────────────────┐
  │  lock() 流程                                                 │
  └─────────────────────────────────────────────────────────────┘

  Thread 呼叫 lock()
         │
         ▼
  ┌──────────────────┐   是    ┌──────────────────────┐
  │ owner == current │ ──────► │  state++（重入）      │──► 返回
  │ 執行緒？         │         │  state=1→2→3→...      │
  └──────┬───────────┘         └──────────────────────┘
         │ 否
         ▼
  ┌──────────────────┐   是    ┌──────────────────────┐
  │  state == 0？    │ ──────► │  CAS(state, 0, 1)    │
  │  鎖空閒？        │         │  owner = current      │──► 進入臨界區
  └──────┬───────────┘         └──────────────────────┘
         │ 否（鎖被他人持有）
         ▼
  ┌──────────────────┐
  │  入隊（enqueue） │
  │  park()睡眠等待  │◄──────────────────────────────────┐
  └──────┬───────────┘                                   │
         │ 被 unpark() 喚醒                               │
         ▼                                               │
  ┌──────────────────┐   失敗（被搶占）                   │
  │  retry: 重新嘗試 │ ─────────────────────────────────►┘
  │  CAS(0→1)        │
  └──────────────────┘

  ┌─────────────────────────────────────────────────────────────┐
  │  unlock() 流程                                               │
  └─────────────────────────────────────────────────────────────┘

  Thread 呼叫 unlock()
         │
         ▼
  ┌──────────────────────────────────────────────┐
  │  assert owner == current（必須是持有者才能解鎖）│
  └──────────────────────────────────────────────┘
         │
         ▼
         state--
         │
         ├─── state > 0 ──► 仍有重入層，繼續持有鎖，返回
         │
         └─── state == 0 ──► 真正釋放
                    │
                    ▼
             owner = null
                    │
                    ▼
         ┌──────────────────────┐
         │  waiters 佇列有人？  │
         └──────┬───────────────┘
                │ 有              │ 無
                ▼                 ▼
         取出隊首 Thread        鎖空閒
         unpark() 喚醒          等待下次競爭

  重入計數示意：
  ┌──────────────────────────────────────────────────┐
  │  outer() {          inner() {                    │
  │    lock()  state=1    lock()  state=2            │
  │    inner()            ...                        │
  │    unlock() state=1   unlock() state=1           │
  │  }                  }                            │
  │                                                  │
  │  state: 1 ──► 2 ──► 1 ──► 0（真正釋放）         │
  └──────────────────────────────────────────────────┘
```

- owner 再次進入：`state++`
- 其他執行緒：排隊等待
- 釋放：`state--` 到 0 才真正解鎖

## 18.4 測試面向

<!-- subsection-diagram -->
### 本小節示意圖

```text
可重入鎖測試矩陣

  ┌─────────────────────┬────────────────────────┬────────────────────────┐
  │     測試面向        │     測試方法            │     驗收標準           │
  ├─────────────────────┼────────────────────────┼────────────────────────┤
  │  可重入正確性       │  同一執行緒連續 lock()  │  不死鎖                │
  │                     │  N 次後 unlock() N 次   │  state 歸零後其他執行  │
  │                     │  驗證臨界區資料一致性   │  緒可正常獲得鎖        │
  ├─────────────────────┼────────────────────────┼────────────────────────┤
  │  競爭公平性         │  M 個執行緒並發競爭     │  每個執行緒等待時間    │
  │                     │  記錄各自獲鎖時間       │  差異在合理範圍內      │
  │                     │  計算標準差             │  （公平模式）          │
  ├─────────────────────┼────────────────────────┼────────────────────────┤
  │  中斷路徑           │  執行緒等待鎖時         │  中斷後執行緒正確退出  │
  │                     │  從另一執行緒發送中斷   │  不留殭屍              │
  │                     │  驗證等待執行緒退出     │  鎖狀態保持一致        │
  ├─────────────────────┼────────────────────────┼────────────────────────┤
  │  超時路徑           │  tryLock(timeout=100ms) │  超時後返回 false      │
  │                     │  持鎖者睡眠 200ms       │  不死鎖                │
  │                     │  等待者應超時返回       │  計時誤差 < 10ms       │
  ├─────────────────────┼────────────────────────┼────────────────────────┤
  │  多條件變數         │  producer/consumer 模型 │  signal 精確喚醒一個   │
  │                     │  condition.await()      │  signalAll 喚醒全部    │
  │                     │  condition.signal()     │  不丟失喚醒            │
  ├─────────────────────┼────────────────────────┼────────────────────────┤
  │  壓力測試           │  1000 執行緒 × 10000    │  計數器最終值正確      │
  │                     │  次 lock/unlock         │  無資料競態            │
  │                     │  原子計數器累加         │  無死鎖                │
  └─────────────────────┴────────────────────────┴────────────────────────┘

  測試覆蓋路徑圖：

  lock()
  ├─ owner == self ─► state++ ─► [可重入路徑] ✓
  ├─ state == 0    ─► CAS 成功 ─► [首次獲取路徑] ✓
  ├─ state == 0    ─► CAS 失敗 ─► retry ─► [競爭路徑] ✓
  ├─ state > 0     ─► park() ─► unpark ─► [等待喚醒路徑] ✓
  ├─ state > 0     ─► park() ─► interrupt ─► [中斷路徑] ✓
  └─ state > 0     ─► tryLock + timeout ─► [超時路徑] ✓
```

- 可重入正確性
- 競爭時公平性/吞吐
- 中斷與超時路徑

## 示意圖

```text
owner=T1, state=2 (重入2次)
T1 unlock -> state=1
T1 unlock -> state=0 -> 喚醒下一個
```

## 跨語言完整範例

### C — pthread_mutex_t 遞迴鎖（PTHREAD_MUTEX_RECURSIVE）

```c
#include <stdio.h>
#include <pthread.h>

static pthread_mutex_t mu;
static int shared_value = 0;

void inner_work(void) {
    pthread_mutex_lock(&mu);      /* 重入：同執行緒第二次鎖 */
    shared_value += 10;
    printf("inner: shared_value = %d\n", shared_value);
    pthread_mutex_unlock(&mu);
}

void outer_work(void) {
    pthread_mutex_lock(&mu);      /* 第一次鎖 */
    shared_value += 1;
    printf("outer before inner: shared_value = %d\n", shared_value);
    inner_work();                 /* 呼叫 inner，不應死鎖 */
    printf("outer after inner: shared_value = %d\n", shared_value);
    pthread_mutex_unlock(&mu);
}

int main(void) {
    pthread_mutexattr_t attr;
    pthread_mutexattr_init(&attr);
    pthread_mutexattr_settype(&attr, PTHREAD_MUTEX_RECURSIVE);
    pthread_mutex_init(&mu, &attr);
    pthread_mutexattr_destroy(&attr);

    pthread_t t1, t2;
    pthread_create(&t1, NULL, (void *(*)(void *))outer_work, NULL);
    pthread_create(&t2, NULL, (void *(*)(void *))outer_work, NULL);
    pthread_join(t1, NULL);
    pthread_join(t2, NULL);

    printf("最終 shared_value = %d (expected 22)\n", shared_value);
    pthread_mutex_destroy(&mu);
    return 0;
}
```

### C++ — std::recursive_mutex 可重入鎖

```cpp
#include <iostream>
#include <mutex>
#include <thread>
#include <vector>

std::recursive_mutex rmu;
int shared_value = 0;

void inner_work() {
    std::lock_guard<std::recursive_mutex> lk(rmu);  /* 重入 */
    shared_value += 10;
    std::cout << "inner: " << shared_value << "\n";
}

void outer_work() {
    std::lock_guard<std::recursive_mutex> lk(rmu);  /* 首次鎖 */
    shared_value += 1;
    inner_work();  /* 同執行緒再次鎖，不應死鎖 */
}

int main() {
    std::vector<std::thread> threads;
    for (int i = 0; i < 4; i++)
        threads.emplace_back(outer_work);
    for (auto &t : threads)
        t.join();
    std::cout << "最終 shared_value = " << shared_value
              << " (expected 44)\n";
}
```

### Rust — parking_lot::ReentrantMutex 可重入鎖

```rust
use parking_lot::ReentrantMutex;
use std::cell::Cell;
use std::sync::Arc;
use std::thread;

fn inner_work(lock: &ReentrantMutex<Cell<i32>>) {
    let guard = lock.lock();          /* 重入：同執行緒第二次 */
    guard.set(guard.get() + 10);
    println!("inner: {}", guard.get());
}

fn outer_work(lock: Arc<ReentrantMutex<Cell<i32>>>) {
    let guard = lock.lock();          /* 首次鎖 */
    guard.set(guard.get() + 1);
    drop(guard);                      /* Rust 需手動 drop 才能重入 */
    inner_work(&lock);
}

fn main() {
    let lock = Arc::new(ReentrantMutex::new(Cell::new(0)));
    let mut handles = vec![];
    for _ in 0..4 {
        let l = Arc::clone(&lock);
        handles.push(thread::spawn(move || outer_work(l)));
    }
    for h in handles { h.join().unwrap(); }
    println!("最終值 = {}", lock.lock().get());
}
```

### Go — sync.Mutex + 輔助函式（Go 無原生 recursive mutex，用呼叫鏈迴避）

```go
package main

import (
    "fmt"
    "sync"
)

// Go 的 sync.Mutex 不可重入，正確做法是把鎖傳遞給子函式
// 而非在子函式重複 Lock 同一把鎖
type ReentrantGuard struct {
    mu    sync.Mutex
    owner int64
    depth int
    once  sync.Mutex
}

var mu sync.Mutex
var sharedValue int

// outer 持鎖後直接呼叫 inner（不再重複鎖）
func inner(val *int) {
    *val += 10
    fmt.Printf("inner: shared_value = %d\n", *val)
}

func outer() {
    mu.Lock()
    defer mu.Unlock()
    sharedValue += 1
    inner(&sharedValue) // inner 不重複 Lock，由 outer 持有鎖
}

func main() {
    var wg sync.WaitGroup
    for i := 0; i < 4; i++ {
        wg.Add(1)
        go func() {
            defer wg.Done()
            outer()
        }()
    }
    wg.Wait()
    fmt.Printf("最終 shared_value = %d (expected 44)\n", sharedValue)
}
```

### Python — threading.RLock 可重入鎖

```python
"""Chapter 18: reentrant lock — outer calls inner, both lock same RLock."""
import threading

rlock = threading.RLock()
shared_value = 0


def inner_work():
    with rlock:           # RLock 允許同執行緒第二次進入
        global shared_value
        shared_value += 10
        print(f"inner: shared_value = {shared_value}")


def outer_work():
    with rlock:           # 首次獲得鎖
        global shared_value
        shared_value += 1
        inner_work()      # 同執行緒再次 with rlock，不應死鎖


def main():
    threads = [threading.Thread(target=outer_work) for _ in range(4)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    print(f"最終 shared_value = {shared_value} (expected 44)")
    assert shared_value == 44, "RLock 可重入失敗！"
    print("通過：RLock 可重入，outer 呼叫 inner 不死鎖")


if __name__ == "__main__":
    main()
```

## 完整專案級範例（Python）

檔案：`examples/python/ch18.py`

```bash
python3 examples/python/ch18.py
```

```python
"""Chapter 18: reentrant lock."""
import threading

r = threading.RLock()


def outer():
    with r:
        inner()


def inner():
    with r:
        print("reentered")


if __name__ == "__main__":
    outer()
```
