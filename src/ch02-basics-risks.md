# 第2章 並發基礎概念與風險

## 2.1 基本名詞（對應 2.1.1~2.1.9）

<!-- subsection-diagram -->
### 本小節示意圖

```text
進程 vs 線程：

  ┌──────────────────────────────────────────────────────┐
  │  Process 進程（資源容器）                              │
  │  ┌──────────────────────────────────────────────┐    │
  │  │  虛擬記憶體空間 / 檔案描述符 / 信號處理器        │    │
  │  └──────────────────────────────────────────────┘    │
  │                                                      │
  │  ┌────────────┐  ┌────────────┐  ┌────────────┐     │
  │  │  Thread A  │  │  Thread B  │  │  Thread C  │     │
  │  │ (執行單位)  │  │ (執行單位)  │  │ (執行單位)  │     │
  │  │  Stack     │  │  Stack     │  │  Stack     │     │
  │  │  PC/暫存器  │  │  PC/暫存器  │  │  PC/暫存器  │     │
  │  └────────────┘  └────────────┘  └────────────┘     │
  │       └──────────────┴──────────────┘               │
  │                   共享 Heap / 全域變數                │
  └──────────────────────────────────────────────────────┘

並發 Concurrency（交錯推進，不一定同時）：

  時間軸 ─────────────────────────────────────────────►
         ┌───┬───┬───┬───┬───┬───┬───┬───┬───┐
  Core0  │ A │ B │ A │ C │ B │ C │ A │ B │ C │
         └───┴───┴───┴───┴───┴───┴───┴───┴───┘
          ▲   ▲
        切換  切換（Context Switch）

並行 Parallelism（真正同時，需要多核）：

  時間軸 ──────────────────────────────────────────────►
         ┌─────────────────────────────────────────┐
  Core0  │  A  │  A  │  A  │  A  │  A  │  A  │    │
         ├─────────────────────────────────────────┤
  Core1  │  B  │  B  │  B  │  B  │  B  │  B  │    │
         └─────────────────────────────────────────┘

同步 Sync（呼叫後阻塞等待結果）：

  caller ──► [發出請求] ──► [等待中...] ──► [得到結果] ──► 繼續往下

異步 Async（呼叫後立即返回，結果晚點通知）：

  caller ──► [發出請求] ──► 繼續做其他事情 ...
                  └──────────────────────────► [callback/future 收到結果]

阻塞 Blocking（等待期間執行流停住）：

  T1: ──► [發出 I/O 請求] ──► ░░░░░░░░ WAIT ░░░░░░░░ ──► [繼續]
                               ▲ 這段時間 CPU 不執行此線程

非阻塞 Non-blocking（不停住，改輪詢或事件驅動）：

  T1: ──► [發出 I/O 請求] ──► [做其他工作] ──► [輪詢/事件] ──► [繼續]
```

- 進程：資源容器。
- 線程：執行單位。
- 並發：交錯進行。
- 並行：同時進行。
- 同步/異步：拿結果的方式。
- 阻塞/非阻塞：等待時是否卡住執行流。

## 2.2 三大風險（對應 2.2.1~2.2.3）

<!-- subsection-diagram -->
### 本小節示意圖

```text
並發三大風險三角形：

                        ┌──────────────────────┐
                        │    安全性（Safety）    │
                        │    結果正確性         │
                        │                      │
                        │  典型症狀：           │
                        │  ・counter 結果偏小   │
                        │  ・資料庫記錄重複      │
                        │  ・賬戶餘額計算錯誤    │
                        └──────────┬───────────┘
                                   │
                         三者往往互相影響
                        ┌──────────┴───────────┐
                        │                      │
           ┌────────────┴──────────┐  ┌────────┴──────────────┐
           │   活躍性（Liveness）   │  │   效能（Performance）  │
           │   程式能繼續推進       │  │   速度是否夠快          │
           │                      │  │                        │
           │  典型症狀：           │  │  典型症狀：             │
           │  ・死鎖 Deadlock      │  │  ・鎖競爭（Contention） │
           │    T1 等 T2 的鎖      │  │  ・上下文切換過多        │
           │    T2 等 T1 的鎖      │  │  ・快取失效（Cache Miss）│
           │  ・飢餓 Starvation    │  │  ・假共享（False Sharing）│
           │    低優先級線程永遠    │  │                        │
           │    搶不到鎖           │  │  解法：鎖粒度、CAS、     │
           │  ・活鎖 Livelock      │  │  無鎖結構、線程池調優    │
           │    雙方都在讓步但都    │  │                        │
           │    無法推進           │  │                        │
           └──────────────────────┘  └────────────────────────┘

三者關係：
  ・過度加鎖 → 安全性高，但效能差
  ・不加鎖   → 效能好，但安全性崩潰
  ・鎖粒度錯 → 可能同時損失效能和活躍性（死鎖）

死鎖示意（T1/T2 互等）：

  T1: ──► [持有 Lock A] ──► [等待 Lock B] ─► 永久阻塞
  T2: ──► [持有 Lock B] ──► [等待 Lock A] ─► 永久阻塞
                    ▲                  ▲
                    └──── 循環等待 ─────┘
```

- 安全性：結果錯（資料競爭）。
- 活躍性：做不完（死鎖/飢餓/活鎖）。
- 效能：做得慢（鎖競爭、上下文切換）。

## 2.3 鎖分類（對應 2.3.1~2.3.8）

<!-- subsection-diagram -->
### 本小節示意圖

```text
鎖分類樹狀圖：

                              ┌──────────┐
                              │   鎖     │
                              └────┬─────┘
         ┌──────────┬──────────────┼──────────────┬──────────────┐
         ▼          ▼              ▼              ▼              ▼
    ┌─────────┐ ┌─────────┐ ┌───────────┐ ┌──────────┐ ┌─────────────┐
    │悲觀/樂觀 │ │公平/非公平│ │可重入/不可│ │共享/獨占 │ │  自旋/阻塞  │
    └────┬────┘ └────┬────┘ │重入       │ └────┬─────┘ └──────┬──────┘
         │           │      └─────┬─────┘       │              │
    ┌────┴────┐  ┌───┴────┐  ┌───┴────┐    ┌───┴────┐    ┌───┴────┐
    │悲觀鎖   │  │公平鎖   │  │可重入鎖│    │共享鎖  │    │自旋鎖  │
    │先鎖再操作│  │FIFO 排隊│  │同線程可│    │多讀者  │    │忙等    │
    │         │  │         │  │多次獲得│    │同時持有│    │適合短臨│
    │例：     │  │例：     │  │        │    │        │    │界區    │
    │Mutex    │  │Java     │  │例：    │    │例：    │    │        │
    │         │  │ReentrantLock│Java  │    │RWLock  │    │        │
    │         │  │(fair=true)│ Reentrant│  │ReadLock│    │        │
    └─────────┘  └─────────┘  │Lock   │    └────────┘    └────────┘
    ┌─────────┐  ┌─────────┐  └────────┘   ┌────────┐    ┌────────┐
    │樂觀鎖   │  │非公平鎖  │  ┌────────┐   │獨占鎖  │    │阻塞鎖  │
    │先操作後  │  │可插隊   │  │不可重入│   │同時只有│    │掛起線程│
    │校驗衝突  │  │         │  │同線程再│   │一個持有│    │適合長臨│
    │         │  │例：     │  │次獲取  │   │        │    │界區    │
    │例：CAS/ │  │Java     │  │→ 死鎖  │   │例：    │    │        │
    │MVCC     │  │Reentrant│  │        │   │Mutex/  │    │例：OS  │
    │         │  │Lock     │  │        │   │WriteLock│   │futex   │
    └─────────┘  │(預設)   │  └────────┘   └────────┘    └────────┘
                 └─────────┘

各鎖使用場景選擇指引：

  ┌────────────────┬─────────────────────────────────────────────┐
  │  場景           │  推薦鎖類型                                  │
  ├────────────────┼─────────────────────────────────────────────┤
  │  讀多寫少       │  共享讀鎖（RWLock）                           │
  │  衝突少         │  樂觀鎖（CAS/MVCC）                          │
  │  衝突多         │  悲觀鎖（Mutex）                             │
  │  臨界區極短     │  自旋鎖（SpinLock）                           │
  │  臨界區較長     │  阻塞鎖（OS Mutex）                           │
  │  需要遞迴獲取   │  可重入鎖（ReentrantLock）                    │
  └────────────────┴─────────────────────────────────────────────┘
```

- 悲觀/樂觀
- 公平/非公平
- 可重入/不可重入
- 可中斷/不可中斷
- 共享/獨占
- 自旋/阻塞

白話例子：
- 公平鎖像銀行抽號，先到先得。
- 非公平鎖像空位誰搶到誰先辦。
- 可重入鎖像房間主人可以再進自己的房間；不可重入則會把自己鎖在外面。

## 示意圖

```text
競態條件（Race Condition）導致丟失更新：

  時間軸 ─────────────────────────────────────────────────►
         Step 1          Step 2          Step 3
  T1: ──►[read x=0] ──► [計算 0+1=1] ──►           [write x=1] ──►
  T2: ──►[read x=0] ────────────────────►[計算 0+1=1] ──► [write x=1]

  預期：x = 2
  實際：x = 1  ← T1 的更新被 T2 覆蓋，丟失一次遞增！
```

## 跨語言完整範例

無鎖版 vs 加鎖版 counter++（展示 race condition）。

### C（pthread + 無鎖/加鎖對比）

```c
#include <pthread.h>
#include <stdio.h>
#include <stdlib.h>

#define THREADS 4
#define ITER    100000

long unsafe_counter = 0;
long safe_counter = 0;
pthread_mutex_t lock = PTHREAD_MUTEX_INITIALIZER;

void *unsafe_inc(void *arg) {
    for (int i = 0; i < ITER; i++)
        unsafe_counter++;   /* 非原子，有競態 */
    return NULL;
}

void *safe_inc(void *arg) {
    for (int i = 0; i < ITER; i++) {
        pthread_mutex_lock(&lock);
        safe_counter++;     /* 加鎖保護，結果正確 */
        pthread_mutex_unlock(&lock);
    }
    return NULL;
}

int main(void) {
    pthread_t tid[THREADS];
    for (int i = 0; i < THREADS; i++)
        pthread_create(&tid[i], NULL, unsafe_inc, NULL);
    for (int i = 0; i < THREADS; i++)
        pthread_join(tid[i], NULL);
    printf("unsafe_counter = %ld (expected %d)\n", unsafe_counter, THREADS * ITER);

    for (int i = 0; i < THREADS; i++)
        pthread_create(&tid[i], NULL, safe_inc, NULL);
    for (int i = 0; i < THREADS; i++)
        pthread_join(tid[i], NULL);
    printf("safe_counter   = %ld (expected %d)\n", safe_counter, THREADS * ITER);
    return 0;
}
```

```bash
gcc -O0 -o race race.c -lpthread && ./race
```

### C++（std::thread + std::mutex）

```cpp
#include <iostream>
#include <thread>
#include <mutex>
#include <vector>

const int THREADS = 4, ITER = 100000;
long unsafe_counter = 0;
long safe_counter = 0;
std::mutex lock;

void unsafe_inc() {
    for (int i = 0; i < ITER; i++)
        unsafe_counter++;
}

void safe_inc() {
    for (int i = 0; i < ITER; i++) {
        std::lock_guard<std::mutex> g(lock);
        safe_counter++;
    }
}

void run(void(*fn)()) {
    std::vector<std::thread> ts;
    for (int i = 0; i < THREADS; i++) ts.emplace_back(fn);
    for (auto &t : ts) t.join();
}

int main() {
    run(unsafe_inc);
    std::cout << "unsafe: " << unsafe_counter << " (expected " << THREADS*ITER << ")\n";
    run(safe_inc);
    std::cout << "safe:   " << safe_counter   << " (expected " << THREADS*ITER << ")\n";
}
```

```bash
g++ -std=c++17 -O0 -o race race.cpp -lpthread && ./race
```

### Rust（std::thread + Mutex vs AtomicI64）

```rust
use std::sync::{Arc, Mutex};
use std::sync::atomic::{AtomicI64, Ordering};
use std::thread;

const THREADS: usize = 4;
const ITER: i64 = 100_000;

fn main() {
    // 加鎖版：結果正確
    let safe = Arc::new(Mutex::new(0i64));
    let mut handles = vec![];
    for _ in 0..THREADS {
        let c = Arc::clone(&safe);
        handles.push(thread::spawn(move || {
            for _ in 0..ITER { *c.lock().unwrap() += 1; }
        }));
    }
    for h in handles { h.join().unwrap(); }
    println!("safe (mutex):  {} (expected {})", *safe.lock().unwrap(), THREADS as i64 * ITER);

    // 原子版：無鎖且正確
    let atomic = Arc::new(AtomicI64::new(0));
    let mut handles = vec![];
    for _ in 0..THREADS {
        let c = Arc::clone(&atomic);
        handles.push(thread::spawn(move || {
            for _ in 0..ITER { c.fetch_add(1, Ordering::Relaxed); }
        }));
    }
    for h in handles { h.join().unwrap(); }
    println!("safe (atomic): {} (expected {})", atomic.load(Ordering::SeqCst), THREADS as i64 * ITER);
}
```

```bash
cargo run
```

### Go（goroutine + sync.Mutex vs atomic）

```go
package main

import (
    "fmt"
    "sync"
    "sync/atomic"
)

const threads, iter = 4, 100_000

func main() {
    // 無鎖（競態，結果通常偏小）
    var unsafe_counter int64
    var wg sync.WaitGroup
    wg.Add(threads)
    for i := 0; i < threads; i++ {
        go func() {
            defer wg.Done()
            for j := 0; j < iter; j++ {
                unsafe_counter++ // data race!
            }
        }()
    }
    wg.Wait()
    fmt.Printf("unsafe:  %d (expected %d)\n", unsafe_counter, threads*iter)

    // 原子版（無鎖且正確）
    var safe_counter int64
    wg.Add(threads)
    for i := 0; i < threads; i++ {
        go func() {
            defer wg.Done()
            for j := 0; j < iter; j++ {
                atomic.AddInt64(&safe_counter, 1)
            }
        }()
    }
    wg.Wait()
    fmt.Printf("safe:    %d (expected %d)\n", safe_counter, threads*iter)
}
```

```bash
go run main.go
# 加 -race 旗標可偵測競態：
go run -race main.go
```

### Python（threading + Lock 對比）

```python
import threading

THREADS, ITER = 4, 100_000

unsafe_counter = 0
safe_counter = 0
lock = threading.Lock()

def unsafe_inc():
    global unsafe_counter
    for _ in range(ITER):
        unsafe_counter += 1   # Python GIL 下通常安全，但不保證

def safe_inc():
    global safe_counter
    for _ in range(ITER):
        with lock:
            safe_counter += 1

def run_threads(fn):
    ts = [threading.Thread(target=fn) for _ in range(THREADS)]
    for t in ts: t.start()
    for t in ts: t.join()

run_threads(unsafe_inc)
print(f"unsafe: {unsafe_counter} (expected {THREADS * ITER})")
run_threads(safe_inc)
print(f"safe:   {safe_counter} (expected {THREADS * ITER})")
```

```bash
python3 race.py
```

## 完整專案級範例（Python）

檔案：`examples/python/ch02.py`

```bash
python3 examples/python/ch02.py
```

```python
"""Chapter 02: race risk and lock.

展示：
1. 無鎖版 counter（可能有競態，Python GIL 有時會掩蓋，但 C/Rust/Go 明確可見）
2. 有鎖版 counter（結果正確，永遠等於 THREADS * ITER）
"""
import threading

THREADS = 4
ITER = 50_000

counter = 0
lock = threading.Lock()


def inc(n: int):
    global counter
    for _ in range(n):
        with lock:
            counter += 1


if __name__ == "__main__":
    threads = [threading.Thread(target=inc, args=(ITER,)) for _ in range(THREADS)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    print(f"counter = {counter} (expected {THREADS * ITER})")
```
