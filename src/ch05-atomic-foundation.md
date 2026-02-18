# 第5章 原子性底層

## 5.1 原子性定義

<!-- subsection-diagram -->
### 本小節示意圖

```text
原子性定義：「不可被拆開觀察，要嘛全成功，要嘛回到原狀」

  骰子比喻（原子操作的語意）：

  ┌──────────────────────────────────────────────────────────────────┐
  │  原子操作（Atomic）                                               │
  │                                                                  │
  │  狀態 A ──────────────────────────────────────► 狀態 B           │
  │   (x=0)         不可見中間態                     (x=1)            │
  │                                                                  │
  │  其他執行緒只能看到 A 或 B，永遠看不到「介於中間的半完成狀態」       │
  │                           ✓ 成功                                 │
  └──────────────────────────────────────────────────────────────────┘

  非原子操作（Non-Atomic）：x++ 的危險：

  ┌──────────────────────────────────────────────────────────────────┐
  │  非原子操作（x++）                                                │
  │                                                                  │
  │  狀態 A         中間態（可被觀察！）           狀態 B              │
  │   (x=0)                                        (x=1)            │
  │     │                                            │              │
  │     ▼                                            ▼              │
  │  ① LOAD r1=0  ─────────────────────────►  ③ STORE x=1          │
  │                     ▲                                           │
  │                     │                                           │
  │              ② ADD r1=r1+1                                      │
  │              （r1 在暫存器，                                      │
  │               此刻 x 仍是 0）                                    │
  │                     ▲                                           │
  │              其他執行緒在 ① 和 ③ 之間可以讀取 x=0 的舊值！         │
  └──────────────────────────────────────────────────────────────────┘

  比喻：銀行轉帳必須是原子的
  ┌────────────────────────────────────────────────────────────────┐
  │  轉帳 $100：扣款 A 帳戶 + 入款 B 帳戶                            │
  │                                                                │
  │  原子（正確）：                                                  │
  │  [A=1000, B=500] ──► [A=900, B=600]   ← 只有這兩種狀態          │
  │                                                                │
  │  非原子（危險）：                                                │
  │  [A=1000, B=500]                                               │
  │      ↓ 扣款 A                                                  │
  │  [A=900,  B=500]  ← 此刻系統崩潰，$100 憑空消失！               │
  └────────────────────────────────────────────────────────────────┘
```

一個操作不可被拆開觀察，要嘛全成，要嘛全不成。

## 5.2 CPU 如何做原子（對應 5.2.1~5.2.3）

<!-- subsection-diagram -->
### 本小節示意圖

```text
CPU 實現原子操作的三種方式：

┌─────────────────────────────────────────────────────────────────────────────┐
│  方式 1：總線鎖（Bus Lock）—— 老方法，代價高                                  │
│                                                                             │
│  CPU0   CPU1   CPU2   CPU3                                                  │
│   │      │      │      │                                                    │
│   └──────┴──────┴──────┘                                                    │
│              │                                                              │
│         系統匯流排（Bus）                                                     │
│              │                                                              │
│           記憶體（RAM）                                                       │
│                                                                             │
│  CPU0 執行 LOCK 指令時：                                                     │
│  ① 拉低 LOCK# 信號線，獨占整條匯流排                                          │
│  ② 其他 CPU 的記憶體存取全部被阻塞                                             │
│  ③ 完成操作後釋放 LOCK# 信號線                                                │
│                                                                             │
│  缺點：鎖住整條匯流排，其他無關的記憶體操作也被阻塞，性能差                      │
└─────────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────────┐
│  方式 2：快取鎖（Cache Lock）+ MESI 協議 —— 現代主流                         │
│                                                                             │
│  ┌──────────────────┐     ┌──────────────────┐                             │
│  │      CPU0        │     │      CPU1        │                             │
│  │  ┌────────────┐  │     │  ┌────────────┐  │                             │
│  │  │ L1 Cache   │  │     │  │ L1 Cache   │  │                             │
│  │  │ [x] M ─────┼──┼─────┼──┼─[x] I     │  │  M=Modified, I=Invalid     │
│  │  └────────────┘  │     │  └────────────┘  │                             │
│  └──────────────────┘     └──────────────────┘                             │
│                                                                             │
│  CPU0 對 x 做原子操作時：                                                    │
│  ① CPU0 將 x 所在的快取行標記為 Modified（獨占修改）                          │
│  ② 通過 MESI 協議，通知 CPU1 其快取行變為 Invalid（無效）                     │
│  ③ CPU0 完成修改後，數據透過快取一致性協議同步                                │
│                                                                             │
│  優點：只鎖定快取行，不鎖整條匯流排，範圍更小、性能更好                         │
│  限制：跨快取行（Cache Line Boundary）的操作仍需要總線鎖                      │
└─────────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────────┐
│  方式 3：CAS 指令（Compare-And-Swap）—— 無鎖演算法基石                       │
│                                                                             │
│  x86 指令：CMPXCHG（Compare and Exchange）                                  │
│                                                                             │
│  偽代碼（原子執行，不可被中斷）：                                              │
│  ┌─────────────────────────────────────────────────────────┐               │
│  │  atomic {                                               │               │
│  │      if (*addr == expected) {                           │               │
│  │          *addr = new_value;                             │               │
│  │          return SUCCESS;                                │               │
│  │      } else {                                           │               │
│  │          return FAIL;      // 呼叫方通常自旋重試          │               │
│  │      }                                                  │               │
│  │  }                                                      │               │
│  └─────────────────────────────────────────────────────────┘               │
│                                                                             │
│  優點：無鎖、輕量；缺點：ABA 問題（需加版本號解決）                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

- 總線鎖（老方法）
- 快取鎖（現代常見）
- 原子指令（如 CAS）

## 5.3 互斥鎖模型（對應 5.3.1~5.3.2）

<!-- subsection-diagram -->
### 本小節示意圖

```text
互斥鎖完整生命週期（含 OS 阻塞/喚醒路徑）：

  Thread 1 時間軸：
  ──────────────────────────────────────────────────────────────────────────►
  [正常執行] ──► [lock()] ──► [臨界區工作] ──► [unlock()] ──► [正常執行]
                  │                              │
                  │ 成功獲取鎖（快路徑，             │ 釋放鎖
                  │ futex 不陷入核心）              │
                  ▼                              ▼
            進入臨界區                      喚醒等待佇列中的 Thread 2

  Thread 2 時間軸（競爭失敗的情況）：
  ──────────────────────────────────────────────────────────────────────────►
  [正常執行] ──► [lock()] ──► ░░░░░░░░░░░░░░░░░░░░░░ ──► [臨界區工作] ──►
                  │           ▲                  ▲
                  │    阻塞等待（OS 掛起 Thread 2）│ 被喚醒，重新競爭
                  ▼                              │
          ┌──────────────────┐                  │
          │  OS 核心層         │                  │
          │                  │                  │
          │  futex 系統呼叫   │                  │
          │  Thread2 進入     │                  │
          │  等待佇列（睡眠）  │──────────────────┘
          │                  │    Thread1 unlock() 後
          └──────────────────┘    OS 喚醒 Thread2

  鎖的兩個路徑：

  快路徑（Fast Path）—— 無競爭：
  lock() ──► CAS 操作成功 ──► 進入臨界區         （不需要 syscall，最快）

  慢路徑（Slow Path）—— 有競爭：
  lock() ──► CAS 失敗 ──► futex_wait（陷入核心）
           ──► 睡眠等待 ──► 被 unlock 方的 futex_wake 喚醒
           ──► 重新嘗試 CAS ──► 進入臨界區

  ⚠ 每次 syscall（陷入核心）大約耗時 1000~5000 ns
  ⚠ 高競爭下鎖的開銷可能超過臨界區本身的工作量
```

鎖把臨界區包起來，保證同時只有一個執行緒改共享資料。

## 5.4 CAS

<!-- subsection-diagram -->
### 本小節示意圖

```text
CAS（Compare-And-Swap）完整流程：

  呼叫：CAS(addr, expected=10, new=11)

  ┌─────────────────────────────────────────────────────────────────────┐
  │                                                                     │
  │  ① Load old value                                                   │
  │     old = *addr   → old = 10                                        │
  │                          │                                          │
  │  ② Compare                                                          │
  │     old == expected?  10 == 10 ?                                    │
  │                          │                                          │
  │              ┌───────────┴───────────┐                              │
  │              │ YES（匹配）            │ NO（不匹配）                  │
  │              ▼                       ▼                              │
  │  ③a Swap new value      ③b 返回 FAIL                                │
  │     *addr = new = 11        呼叫方重試                               │
  │     返回 SUCCESS              │                                     │
  │              │                │                                     │
  │              └───────────┬───┘                                      │
  │                          ▼                                          │
  │                   整個步驟由 CPU 原子執行                             │
  │                   其他 CPU 看不到中間狀態                             │
  └─────────────────────────────────────────────────────────────────────┘

  CAS 自旋重試模式（無鎖計數器的典型用法）：

  ┌─────────────────────────────────────────────────────────────────────┐
  │  loop {                                                             │
  │      old = atomic_load(counter)   ← 讀取當前值                      │
  │                                                                     │
  │      new = old + 1                ← 計算期望新值                     │
  │                                                                     │
  │      if CAS(counter, old, new) {  ← 原子地「確認沒人改過再寫入」      │
  │          break                    ← 成功，退出                       │
  │      }                                                              │
  │      // 失敗：說明 counter 已被其他執行緒改變，重新讀取再試             │
  │  }                                                                  │
  └─────────────────────────────────────────────────────────────────────┘

  ABA 問題（CAS 的已知陷阱）：

  時間  執行緒 T1              執行緒 T2
  ──── ────────────────────── ──────────────────────────────────────
   t1  load: old = A
   t2                         CAS(A → B) 成功，值改為 B
   t3                         CAS(B → A) 成功，值又改回 A
   t4  CAS(A → C) 成功！      ← T1 誤以為沒人動過，但其實發生了 A→B→A

  解法：使用帶版本號的 CAS（如 Java AtomicStampedReference）
  CAS(addr, (expected_val, expected_stamp), (new_val, new_stamp + 1))
```

先比對舊值，符合才寫入新值，不符合就重試。

## 示意圖

```text
CAS 成功/失敗對比：

  初始：counter = 10

  情況 A（CAS 成功）：
  T1: load=10 → CAS(addr, expect=10, new=11) → 10==10 → swap → counter=11 ✓

  情況 B（CAS 失敗，觸發重試）：
  T1: load=10 → [T2 搶先改成 11] → CAS(addr, expect=10, new=11) → 10≠11 → FAIL
  T1: load=11 → CAS(addr, expect=11, new=12) → 11==11 → swap → counter=12 ✓
```

## 跨語言完整範例

CAS 自旋計數器（多執行緒安全遞增，無鎖實作）。

### C（GCC atomic + CAS 自旋）

```c
#include <stdatomic.h>
#include <pthread.h>
#include <stdio.h>

#define THREADS 4
#define ITER    100000

atomic_long counter = 0;

long cas_increment(atomic_long *c) {
    long old, new_val;
    do {
        old = atomic_load_explicit(c, memory_order_relaxed);
        new_val = old + 1;
    } while (!atomic_compare_exchange_weak_explicit(
                 c, &old, new_val,
                 memory_order_release,
                 memory_order_relaxed));
    return new_val;
}

void *worker(void *arg) {
    for (int i = 0; i < ITER; i++)
        cas_increment(&counter);
    return NULL;
}

int main(void) {
    pthread_t tid[THREADS];
    for (int i = 0; i < THREADS; i++)
        pthread_create(&tid[i], NULL, worker, NULL);
    for (int i = 0; i < THREADS; i++)
        pthread_join(tid[i], NULL);
    printf("counter = %ld (expected %d)\n", counter, THREADS * ITER);
    return 0;
}
```

```bash
gcc -std=c11 -O2 -o cas_counter cas_counter.c -lpthread && ./cas_counter
```

### C++（std::atomic compare_exchange_weak）

```cpp
#include <iostream>
#include <thread>
#include <atomic>
#include <vector>

const int THREADS = 4, ITER = 100000;
std::atomic<long> counter{0};

void cas_increment(std::atomic<long> &c) {
    long old_val = c.load(std::memory_order_relaxed);
    while (!c.compare_exchange_weak(
               old_val, old_val + 1,
               std::memory_order_release,
               std::memory_order_relaxed))
        ;   // old_val 自動被更新為最新值，繼續重試
}

void worker() {
    for (int i = 0; i < ITER; i++)
        cas_increment(counter);
}

int main() {
    std::vector<std::thread> ts;
    for (int i = 0; i < THREADS; i++) ts.emplace_back(worker);
    for (auto &t : ts) t.join();
    std::cout << "counter = " << counter
              << " (expected " << THREADS * ITER << ")\n";
}
```

```bash
g++ -std=c++17 -O2 -o cas_counter cas_counter.cpp -lpthread && ./cas_counter
```

### Rust（AtomicI64 + compare_exchange）

```rust
use std::sync::Arc;
use std::sync::atomic::{AtomicI64, Ordering};
use std::thread;

const THREADS: usize = 4;
const ITER: i64 = 100_000;

fn cas_increment(counter: &AtomicI64) {
    loop {
        let old = counter.load(Ordering::Relaxed);
        match counter.compare_exchange_weak(
            old, old + 1,
            Ordering::Release,
            Ordering::Relaxed,
        ) {
            Ok(_) => break,
            Err(_) => continue,   // 失敗，重試（old 已自動更新）
        }
    }
}

fn main() {
    let counter = Arc::new(AtomicI64::new(0));
    let mut handles = vec![];
    for _ in 0..THREADS {
        let c = Arc::clone(&counter);
        handles.push(thread::spawn(move || {
            for _ in 0..ITER { cas_increment(&c); }
        }));
    }
    for h in handles { h.join().unwrap(); }
    println!("counter = {} (expected {})", counter.load(Ordering::SeqCst), THREADS as i64 * ITER);
}
```

```bash
cargo run
```

### Go（sync/atomic CompareAndSwap）

```go
package main

import (
    "fmt"
    "sync"
    "sync/atomic"
)

const threads, iter = 4, 100_000

func casIncrement(counter *int64) {
    for {
        old := atomic.LoadInt64(counter)
        if atomic.CompareAndSwapInt64(counter, old, old+1) {
            break   // 成功
        }
        // 失敗：counter 已被其他 goroutine 改變，重試
    }
}

func main() {
    var counter int64
    var wg sync.WaitGroup
    wg.Add(threads)
    for i := 0; i < threads; i++ {
        go func() {
            defer wg.Done()
            for j := 0; j < iter; j++ {
                casIncrement(&counter)
            }
        }()
    }
    wg.Wait()
    fmt.Printf("counter = %d (expected %d)\n", counter, threads*iter)
}
```

```bash
go run main.go
```

### Python（模擬 CAS，threading.Lock 實作）

```python
import threading

class AtomicInt:
    """模擬 CAS 語意的原子整數（Python 無原生 CAS，用鎖模擬語意）"""
    def __init__(self, value: int = 0):
        self._value = value
        self._lock = threading.Lock()

    def compare_and_swap(self, expected: int, new: int) -> bool:
        with self._lock:
            if self._value == expected:
                self._value = new
                return True
            return False

    def load(self) -> int:
        with self._lock:
            return self._value

def cas_increment(counter: AtomicInt):
    while True:
        old = counter.load()
        if counter.compare_and_swap(old, old + 1):
            break

THREADS, ITER = 4, 100_000
counter = AtomicInt(0)

def worker():
    for _ in range(ITER):
        cas_increment(counter)

if __name__ == "__main__":
    threads = [threading.Thread(target=worker) for _ in range(THREADS)]
    for t in threads: t.start()
    for t in threads: t.join()
    print(f"counter = {counter.load()} (expected {THREADS * ITER})")
```

```bash
python3 cas_counter.py
```

## 完整專案級範例（Python）

檔案：`examples/python/ch05.py`

```bash
python3 examples/python/ch05.py
```

```python
"""Chapter 05: atomicity with CAS-like primitive.

展示：
1. CAS（Compare-And-Swap）的語意：比對舊值，符合才寫入新值
2. 多執行緒安全遞增（無鎖計數器模擬）
3. CAS 失敗時重試機制
"""
import threading


class AtomicInt:
    def __init__(self, value: int = 0):
        self._v = value
        self._m = threading.Lock()

    def compare_and_swap(self, expect: int, new: int) -> bool:
        with self._m:
            if self._v == expect:
                self._v = new
                return True
            return False

    def get(self) -> int:
        with self._m:
            return self._v


def cas_increment(a: AtomicInt):
    """CAS 自旋重試直到成功。"""
    while True:
        old = a.get()
        if a.compare_and_swap(old, old + 1):
            break


if __name__ == "__main__":
    a = AtomicInt(10)
    print("cas 10->11", a.compare_and_swap(10, 11), "now", a.get())
    print("cas 10->12", a.compare_and_swap(10, 12), "now", a.get())  # 失敗，值已是 11

    # 多執行緒 CAS 計數器
    counter = AtomicInt(0)
    THREADS, ITER = 4, 10000
    ts = [threading.Thread(target=lambda: [cas_increment(counter) for _ in range(ITER)])
          for _ in range(THREADS)]
    for t in ts: t.start()
    for t in ts: t.join()
    print(f"final counter = {counter.get()} (expected {THREADS * ITER})")
```
