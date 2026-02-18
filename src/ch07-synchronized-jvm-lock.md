# 第7章 synchronized 與 JVM 鎖實作

## 7.1 語法層（對應 7.1.1~7.1.3）

<!-- subsection-diagram -->
### 本小節示意圖（ASCII）

```text
  synchronized 三種語法形式與 bytecode 對應
  ════════════════════════════════════════════════════════

  形式 1：實例方法（鎖 this）
  ┌─────────────────────────────────────────────────────┐
  │  Java 源碼                                          │
  │  synchronized void increment() { count++; }         │
  │                                                     │
  │  bytecode（ACC_SYNCHRONIZED flag）                  │
  │  方法描述符帶有 ACC_SYNCHRONIZED                    │
  │  JVM 執行前自動 monitorenter(this)                  │
  │  JVM 執行後自動 monitorexit(this)                   │
  │                                                     │
  │  鎖對象：this（呼叫此方法的實例）                   │
  └─────────────────────────────────────────────────────┘

  形式 2：靜態方法（鎖 Class 對象）
  ┌─────────────────────────────────────────────────────┐
  │  Java 源碼                                          │
  │  static synchronized void reset() { count = 0; }   │
  │                                                     │
  │  bytecode（ACC_STATIC + ACC_SYNCHRONIZED）          │
  │  JVM 執行前 monitorenter(Counter.class)             │
  │  JVM 執行後 monitorexit(Counter.class)              │
  │                                                     │
  │  鎖對象：Counter.class（JVM 中 Class 對象）         │
  │  ⚠ 與實例鎖不同，互不衝突                          │
  └─────────────────────────────────────────────────────┘

  形式 3：程式區塊（鎖指定對象）
  ┌─────────────────────────────────────────────────────┐
  │  Java 源碼                                          │
  │  synchronized (lockObj) {                           │
  │      // critical section                            │
  │  }                                                  │
  │                                                     │
  │  bytecode（顯式指令）                               │
  │  0: aload lockObj    ← 將鎖對象壓棧                 │
  │  1: monitorenter     ← 嘗試獲取 monitor             │
  │  2: ... body ...                                    │
  │  3: monitorexit      ← 正常退出釋放                 │
  │  4: (exception path) │                             │
  │  5: monitorexit      ← 異常退出也釋放（finally）   │
  │                                                     │
  │  鎖對象：lockObj（任意 Object）                     │
  └─────────────────────────────────────────────────────┘

  三種形式對比：
  ┌─────────────────┬────────────────┬──────────────────┐
  │ 形式            │ 鎖對象         │ 適用場景         │
  ├─────────────────┼────────────────┼──────────────────┤
  │ 實例方法        │ this           │ 保護實例狀態     │
  │ 靜態方法        │ ClassName.class│ 保護靜態狀態     │
  │ synchronized 塊 │ 指定 Object    │ 精細控制臨界區   │
  └─────────────────┴────────────────┴──────────────────┘
```

- 實例方法鎖 `this`
- 類方法鎖 `Class`
- 程式區塊鎖指定對象

## 7.2~7.3 物件頭與鎖標記（對應 7.2.1~7.3.3）

<!-- subsection-diagram -->
### 本小節示意圖（ASCII）

```text
  64-bit JVM 物件頭（Mark Word）布局
  ════════════════════════════════════════════════════════

  Mark Word（64 bit = 8 bytes）在不同鎖狀態下的含義：

  無鎖狀態（biasable）：
  ┌──────────────────────────┬──────┬─────┬──┬──┐
  │  hashcode (31b) / unused │ age  │  0  │0 │1 │
  │  bit 63 ─────────── 7   │ 4b   │ 1b  │1b│1b│
  └──────────────────────────┴──────┴─────┴──┴──┘
                                               └─ lock bits = 01

  偏向鎖（Biased Lock）：
  ┌───────────────────────────────────┬──────┬──┬──┬──┐
  │  Thread ID (54b)  │ epoch (2b)    │ age  │1 │0 │1 │
  │  bit 63 ──────────────────── 10  │  4b  │1b│1b│1b│
  └───────────────────────────────────┴──────┴──┴──┴──┘
                                                   └─ lock bits = 01, biased=1

  輕量鎖（Lightweight Lock，CAS 競爭）：
  ┌────────────────────────────────────────────────┬──┬──┐
  │  Lock Record 指針（ptr to stack frame）(62b)   │0 │0 │
  │  bit 63 ──────────────────────────────────── 2│1b│1b│
  └────────────────────────────────────────────────┴──┴──┘
                                                       └─ lock bits = 00

  重量鎖（Heavyweight Lock，OS mutex）：
  ┌────────────────────────────────────────────────┬──┬──┐
  │  Monitor 物件指針（ptr to ObjectMonitor）(62b) │1 │0 │
  │  bit 63 ──────────────────────────────────── 2│1b│1b│
  └────────────────────────────────────────────────┴──┴──┘
                                                       └─ lock bits = 10

  GC 標記（Marked for GC）：
  ┌────────────────────────────────────────────────┬──┬──┐
  │  forwarding pointer                            │1 │1 │
  └────────────────────────────────────────────────┴──┴──┘
                                                       └─ lock bits = 11

  lock bits 速查表：
  ┌───────────┬─────────────────────────────────────────┐
  │ lock bits │ 含義                                    │
  ├───────────┼─────────────────────────────────────────┤
  │    01     │ 無鎖（biasable=0）或 偏向鎖（biased=1） │
  │    00     │ 輕量鎖（CAS LockRecord 指針）           │
  │    10     │ 重量鎖（Monitor 物件指針）              │
  │    11     │ GC 標記中                               │
  └───────────┴─────────────────────────────────────────┘
```

這是 JVM 實作細節：物件頭記錄鎖狀態。

## 7.4~7.5 Monitor 與 bytecode（對應 7.4.1~7.5.4）

<!-- subsection-diagram -->
### 本小節示意圖（ASCII）

```text
  ObjectMonitor 結構與 monitorenter/exit 流程
  ════════════════════════════════════════════════════════

  ObjectMonitor 內部結構：
  ┌─────────────────────────────────────────────────────┐
  │                ObjectMonitor                        │
  │                                                     │
  │  ┌─────────────────────────────────────────────┐   │
  │  │  owner: Thread*    ← 當前持有鎖的執行緒      │   │
  │  │  recursions: int   ← 重入計數器              │   │
  │  └─────────────────────────────────────────────┘   │
  │                                                     │
  │  ┌─────────────────────────────────────────────┐   │
  │  │  EntryList: LinkedList<Thread>              │   │
  │  │  （等待獲取鎖的執行緒佇列）                  │   │
  │  │  T2 ──► T3 ──► T4                          │   │
  │  └─────────────────────────────────────────────┘   │
  │                                                     │
  │  ┌─────────────────────────────────────────────┐   │
  │  │  WaitSet: LinkedList<Thread>                │   │
  │  │  （呼叫 wait() 後進入的執行緒集合）          │   │
  │  │  T5 ──► T6                                  │   │
  │  └─────────────────────────────────────────────┘   │
  └─────────────────────────────────────────────────────┘

  monitorenter 流程：
  ┌─────────────────────────────────────────────────────┐
  │  執行緒嘗試 monitorenter                            │
  │       │                                             │
  │       ▼                                             │
  │  owner == null ?                                    │
  │  ├─ 是 ──► CAS 設定 owner = 自己 ──► 成功，進入    │
  │  │                                                  │
  │  └─ 否 ──► owner == 自己（重入）?                  │
  │            ├─ 是 ──► recursions++ ──► 進入          │
  │            │                                        │
  │            └─ 否 ──► 加入 EntryList                │
  │                       park()（OS 睡眠）             │
  │                       等待 owner 釋放後被喚醒       │
  └─────────────────────────────────────────────────────┘

  monitorexit 流程：
  ┌─────────────────────────────────────────────────────┐
  │  執行緒執行 monitorexit                             │
  │       │                                             │
  │       ▼                                             │
  │  recursions > 0 ?                                   │
  │  ├─ 是 ──► recursions-- ──► 繼續持有               │
  │  │                                                  │
  │  └─ 否 ──► owner = null                            │
  │            從 EntryList 選一個執行緒 unpark()       │
  │            被喚醒的執行緒重新競爭 monitorenter      │
  └─────────────────────────────────────────────────────┘
```

進入臨界區會走 `monitorenter`，離開走 `monitorexit`。

## 7.6~7.10 鎖升級與優化（對應 7.6~7.10）

<!-- subsection-diagram -->
### 本小節示意圖（ASCII）

```text
  JVM 鎖升級路徑（只能升級，不可降級）
  ════════════════════════════════════════════════════════

  ┌──────────────────────────────────────────────────────┐
  │                                                      │
  │  ┌──────────┐                                        │
  │  │  無鎖    │ lock bits = 01（biased=0）             │
  │  │ Unlocked │ 首次分配物件，等待首次鎖定             │
  │  └────┬─────┘                                        │
  │       │ 首次被某執行緒獲取（無競爭）                 │
  │       ▼ 在 Mark Word 記錄 Thread ID                  │
  │  ┌──────────────┐                                    │
  │  │  偏向鎖      │ lock bits = 01（biased=1）         │
  │  │ Biased Lock  │ CAS 寫入 Thread ID，後續進入免 CAS │
  │  └──────┬───────┘ 優點：單執行緒場景近乎無鎖效能    │
  │         │                                            │
  │         │ 觸發條件：另一個執行緒嘗試獲取             │
  │         │ → 觸發 STW（Stop-The-World）撤銷偏向鎖     │
  │         ▼                                            │
  │  ┌──────────────┐                                    │
  │  │  輕量鎖      │ lock bits = 00                     │
  │  │ Lightweight  │ 在執行緒棧幀建立 Lock Record       │
  │  │    Lock      │ CAS 將 Mark Word 指向 Lock Record  │
  │  └──────┬───────┘ 優點：避免 OS mutex，自旋等待     │
  │         │                                            │
  │         │ 觸發條件：CAS 自旋超過閾值（預設 10 次）   │
  │         │ 或 等待執行緒數 > 1                        │
  │         ▼                                            │
  │  ┌──────────────┐                                    │
  │  │  重量鎖      │ lock bits = 10                     │
  │  │ Heavyweight  │ Mark Word 指向 ObjectMonitor       │
  │  │    Lock      │ 使用 OS Mutex（pthread_mutex）     │
  │  └──────────────┘ 代價最高，但公平，支援 wait/notify│
  │                                                      │
  │  升級觸發條件總結：                                  │
  │  ┌────────────────┬──────────────────────────────┐  │
  │  │ 無鎖 → 偏向鎖 │ 第一次被任意執行緒獲取        │  │
  │  │ 偏向鎖→輕量鎖 │ 第二個執行緒競爭（撤銷偏向）  │  │
  │  │ 輕量鎖→重量鎖 │ 自旋 CAS 失敗次數超過閾值    │  │
  │  └────────────────┴──────────────────────────────┘  │
  └──────────────────────────────────────────────────────┘
```

偏向鎖 -> 輕量鎖 -> 重量鎖，競爭越激烈成本越高。

```text
低競爭: fast path
高競爭: 進入等待佇列 + 喚醒
```

跨語言對應：其他語言沒有 `synchronized` 關鍵字，但 runtime 也有類似 fast/slow path 優化。

## 示意圖

```text
monitor(owner=T1)
queue: T2 -> T3
T1 exit monitor -> wake T2
```

## 跨語言完整範例

主題：mutex 保護共享計數器（4 個執行緒各加 10000 次，驗證最終結果正確）

### C（pthread_mutex）

```c
// 編譯：gcc -std=c11 -pthread -o ch07_c ch07.c
#include <pthread.h>
#include <stdio.h>

#define THREADS 4
#define INCREMENTS 10000

static int counter = 0;
static pthread_mutex_t mu = PTHREAD_MUTEX_INITIALIZER;

void *worker(void *arg) {
    for (int i = 0; i < INCREMENTS; i++) {
        pthread_mutex_lock(&mu);
        counter++;
        pthread_mutex_unlock(&mu);
    }
    return NULL;
}

int main(void) {
    pthread_t threads[THREADS];
    for (int i = 0; i < THREADS; i++)
        pthread_create(&threads[i], NULL, worker, NULL);
    for (int i = 0; i < THREADS; i++)
        pthread_join(threads[i], NULL);
    printf("counter = %d (expected %d)\n", counter, THREADS * INCREMENTS);
    pthread_mutex_destroy(&mu);
    return 0;
}
```

### C++（std::mutex）

```cpp
// 編譯：g++ -std=c++17 -pthread -o ch07_cpp ch07.cpp
#include <mutex>
#include <thread>
#include <iostream>
#include <vector>

constexpr int THREADS = 4;
constexpr int INCREMENTS = 10000;

static int counter = 0;
static std::mutex mu;

void worker() {
    for (int i = 0; i < INCREMENTS; i++) {
        std::scoped_lock lock(mu);
        counter++;
    }
}

int main() {
    std::vector<std::thread> threads;
    for (int i = 0; i < THREADS; i++)
        threads.emplace_back(worker);
    for (auto &t : threads)
        t.join();
    std::cout << "counter = " << counter
              << " (expected " << THREADS * INCREMENTS << ")\n";
}
```

### Rust（Mutex<i32>）

```rust
// 執行：cargo run 或 rustc ch07.rs && ./ch07
use std::sync::{Arc, Mutex};
use std::thread;

const THREADS: usize = 4;
const INCREMENTS: usize = 10_000;

fn main() {
    let counter = Arc::new(Mutex::new(0i32));
    let mut handles = Vec::new();

    for _ in 0..THREADS {
        let counter = Arc::clone(&counter);
        handles.push(thread::spawn(move || {
            for _ in 0..INCREMENTS {
                *counter.lock().unwrap() += 1;
            }
        }));
    }
    for h in handles { h.join().unwrap(); }
    println!("counter = {} (expected {})",
             *counter.lock().unwrap(),
             THREADS * INCREMENTS);
}
```

### Go（sync.Mutex）

```go
// 執行：go run ch07.go
package main

import (
	"fmt"
	"sync"
)

const (
	threads    = 4
	increments = 10000
)

func main() {
	var (
		counter int
		mu      sync.Mutex
		wg      sync.WaitGroup
	)
	for i := 0; i < threads; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for j := 0; j < increments; j++ {
				mu.Lock()
				counter++
				mu.Unlock()
			}
		}()
	}
	wg.Wait()
	fmt.Printf("counter = %d (expected %d)\n", counter, threads*increments)
}
```

### Python（threading.Lock）

```python
# 執行：python3 ch07.py
import threading

THREADS = 4
INCREMENTS = 10000

counter = 0
lock = threading.Lock()

def worker():
    global counter
    for _ in range(INCREMENTS):
        with lock:
            counter += 1

if __name__ == "__main__":
    ts = [threading.Thread(target=worker) for _ in range(THREADS)]
    for t in ts: t.start()
    for t in ts: t.join()
    print(f"counter = {counter} (expected {THREADS * INCREMENTS})")
```

## 完整專案級範例（Python）

檔案：`examples/python/ch07.py`

```bash
python3 examples/python/ch07.py
```

```python
"""Chapter 07: synchronized equivalent in Python."""
import threading

lock = threading.Lock()
total = 0


def add():
    global total
    for _ in range(10000):
        with lock:
            total += 1


if __name__ == "__main__":
    ts = [threading.Thread(target=add) for _ in range(4)]
    for t in ts: t.start()
    for t in ts: t.join()
    print("total=", total)
```
