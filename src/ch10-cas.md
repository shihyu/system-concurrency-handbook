# 第10章 CAS

## 10.1 CAS 基本模型

<!-- subsection-diagram -->
### 本小節示意圖

```text
  CAS（Compare-And-Swap）基本模型
  ════════════════════════════════════════════════════════

  函數語義：
  ┌─────────────────────────────────────────────────────┐
  │  bool CAS(addr, expected, new_val) {                │
  │      if (*addr == expected) {                        │
  │          *addr = new_val;                            │
  │          return true;    // 交換成功                 │
  │      } else {                                        │
  │          return false;   // 交換失敗（值已被改）     │
  │      }                                               │
  │  }                                                   │
  │  ⚠ 上面的 if-then 是原子執行，不可被打斷            │
  └─────────────────────────────────────────────────────┘

  執行流程示意：
  ┌──────────────────────────────────────────────────────┐
  │                                                      │
  │  記憶體位址 addr                                     │
  │  ┌──────────┐                                        │
  │  │  *addr   │ = 10（當前值）                         │
  │  └──────────┘                                        │
  │       │                                              │
  │       │ CAS(addr, expected=10, new_val=20)           │
  │       ▼                                              │
  │  ┌─────────────────────────────────────────────┐     │
  │  │  原子比較：*addr(10) == expected(10) ?       │     │
  │  │  ├─ 是（成功路徑）                          │     │
  │  │  │   *addr = 20                             │     │
  │  │  │   return true ✅                         │     │
  │  │  │   ┌──────────┐                           │     │
  │  │  │   │  *addr   │ = 20                      │     │
  │  │  │   └──────────┘                           │     │
  │  │  │                                          │     │
  │  │  └─ 否（失敗路徑，*addr 已被其他執行緒改為 15）   │
  │  │      return false ❌                        │     │
  │  │      呼叫者需要重新讀取並重試               │     │
  │  └─────────────────────────────────────────────┘     │
  │                                                      │
  │  硬體層：CMPXCHG 指令（x86）                         │
  │  ┌─────────────────────────────────────────────┐     │
  │  │  LOCK CMPXCHG [mem], reg                    │     │
  │  │  ├─ LOCK 前綴：鎖定快取行/記憶體匯流排     │     │
  │  │  ├─ 比較 EAX 與 [mem]                       │     │
  │  │  ├─ 相等 → [mem] = reg（ZF=1）              │     │
  │  │  └─ 不等 → EAX = [mem]（ZF=0，讓呼叫者重試）│     │
  │  └─────────────────────────────────────────────┘     │
  └──────────────────────────────────────────────────────┘
```

Compare-And-Swap：比較並交換。

## 10.2 底層支持（對應 10.2.1~10.2.2）

<!-- subsection-diagram -->
### 本小節示意圖

```text
  Intel x86 LOCK CMPXCHG vs ARM LL/SC
  ════════════════════════════════════════════════════════

  Intel x86 — LOCK CMPXCHG（單條原子指令）
  ┌─────────────────────────────────────────────────────┐
  │                                                     │
  │  CPU 執行 LOCK CMPXCHG                              │
  │       │                                             │
  │       ▼                                             │
  │  ┌──────────────────────────────────────────────┐  │
  │  │  Step 1：LOCK 前綴                           │  │
  │  │  鎖定對應快取行（Cache Line Lock）           │  │
  │  │  或在多 CPU 系統鎖定記憶體匯流排             │  │
  │  └─────────────────────┬────────────────────────┘  │
  │                         │                           │
  │                         ▼                           │
  │  ┌──────────────────────────────────────────────┐  │
  │  │  Step 2：原子比較                            │  │
  │  │  compare EAX（expected）with [mem]           │  │
  │  │  ├─ 相等 → exchange [mem] = new_reg          │  │
  │  │  │         ZF = 1（表示成功）                │  │
  │  │  └─ 不等 → EAX = [mem]（取回現值）          │  │
  │  │            ZF = 0（表示失敗）                │  │
  │  └─────────────────────┬────────────────────────┘  │
  │                         │                           │
  │                         ▼                           │
  │  ┌──────────────────────────────────────────────┐  │
  │  │  Step 3：UNLOCK                              │  │
  │  │  釋放快取行/匯流排鎖                         │  │
  │  └──────────────────────────────────────────────┘  │
  │  整個過程不可中斷，其他 CPU 必須等待             │  │
  └─────────────────────────────────────────────────────┘

  ARM — LL/SC（Load-Link / Store-Conditional，可能重試）
  ┌─────────────────────────────────────────────────────┐
  │                                                     │
  │  retry:                                             │
  │       │                                             │
  │       ▼                                             │
  │  ┌──────────────────────────────────────────────┐  │
  │  │  LDREX r0, [addr]  ← Load-Link              │  │
  │  │  記錄 addr 的「獨占監視器」標記              │  │
  │  │  r0 = *addr（讀取當前值）                   │  │
  │  └─────────────────────┬────────────────────────┘  │
  │                         │                           │
  │                         ▼ 計算新值                  │
  │                    r1 = r0 + 1                      │
  │                         │                           │
  │                         ▼                           │
  │  ┌──────────────────────────────────────────────┐  │
  │  │  STREX result, r1, [addr]  ← Store-Conditional│ │
  │  │  若獨占監視器標記仍有效（無其他寫入）        │  │
  │  │  ├─ 寫入成功：*addr = r1，result = 0         │  │
  │  │  └─ 寫入失敗：result = 1（有其他 CPU 寫入）  │  │
  │  └─────────────────────┬────────────────────────┘  │
  │                         │                           │
  │             ┌───────────┴───────────┐               │
  │             ▼                       ▼               │
  │        result == 0             result == 1          │
  │        成功，完成              失敗，回到 retry     │
  │                                ────────────────►    │
  │  LL/SC 通過重試避免總線鎖，對多核效能更友好        │  │
  └─────────────────────────────────────────────────────┘
```

依賴 CPU 原子指令；Java `Unsafe/VarHandle`、C++ `atomic`、Rust `Atomic*`、Go `sync/atomic`。

## 10.3 CAS 實作計數器（對應 10.3.1~10.3.3）

<!-- subsection-diagram -->
### 本小節示意圖

```text
  CAS 自旋計數器流程
  ════════════════════════════════════════════════════════

  單次遞增流程（樂觀自旋）：
  ┌─────────────────────────────────────────────────────┐
  │                                                     │
  │  ┌─────────────────────────────────────────────┐   │
  │  │  Step 1：load old = *counter                │   │
  │  │  讀取當前值（此時 counter = 5）              │   │
  │  └────────────────────────┬────────────────────┘   │
  │                            │ old = 5                │
  │                            ▼                        │
  │  ┌─────────────────────────────────────────────┐   │
  │  │  Step 2：new = old + 1 = 6                  │   │
  │  │  計算新值（純粹計算，無競爭）                │   │
  │  └────────────────────────┬────────────────────┘   │
  │                            │                        │
  │                            ▼                        │
  │  ┌─────────────────────────────────────────────┐   │
  │  │  Step 3：CAS(*counter, old=5, new=6)        │   │
  │  │  ├─ *counter 仍為 5 → 交換成功，counter=6  │   │
  │  │  │   ✅ done                                │   │
  │  │  └─ *counter 已改（別的執行緒改為 6）       │   │
  │  │      ❌ 失敗 → 回到 Step 1 重試             │   │
  │  └─────────────────────────────────────────────┘   │
  │                                                     │
  │  高競爭下的問題：                                   │
  │  ┌─────────────────────────────────────────────┐   │
  │  │  T1 讀 old=5 ─────────────────────────────► │   │
  │  │  T2 讀 old=5 → CAS 成功(5→6)              │   │
  │  │  T3 讀 old=5 → CAS 失敗，重試             │   │
  │  │  T4 讀 old=5 → CAS 失敗，重試             │   │
  │  │  T1      → CAS 失敗，重試                 │   │
  │  │  ...N 個執行緒競爭，每輪只有 1 個成功      │   │
  │  │  自旋 CPU 浪費 ∝ 執行緒數量               │   │
  │  └─────────────────────────────────────────────┘   │
  │  解法：LongAdder（分段計數，減少競爭）              │
  └─────────────────────────────────────────────────────┘
```

```text
do {
  old = load(x)
  new = old + 1
} while (!CAS(x, old, new))
```

## 10.4 ABA 問題（對應 10.4.1~10.4.3）

<!-- subsection-diagram -->
### 本小節示意圖

```text
  ABA 問題時間軸與帶版本號解法
  ════════════════════════════════════════════════════════

  問題：CAS 只比較值，不感知中間的變化

  Thread T1                   Thread T2
  ─────────────────           ─────────────────────────
  read: *addr = A             （暫停）
  （準備 CAS A → B）
        │
        │                     read: *addr = A
        │                     CAS(*addr, A, B) → 成功
        │                     *addr = B
        │
        │                     read: *addr = B
        │                     CAS(*addr, B, A) → 成功
        │                     *addr = A  ← 改回 A
        │
        ▼
  CAS(*addr, A, B)            （T1 繼續執行）
  ← *addr 仍為 A，CAS 成功！
  但 A 其實已經歷了 A→B→A 的變化
  ⚠ T1 誤以為「什麼都沒發生」，中間的 B 被忽略

  ABA 問題的後果：
  ┌─────────────────────────────────────────────────────┐
  │  無鎖棧場景（stack pop + push）：                   │
  │  T1 準備 pop A（讀到 head=A, next=B）               │
  │  T2 pop A, pop B, push A（棧頂還是A，但B丟失）      │
  │  T1 CAS(head, A, B) 成功，但 B 已經不在棧裡！       │
  │  → 棧結構損壞                                       │
  └─────────────────────────────────────────────────────┘

  解法：帶版本號的 CAS（Double-CAS / Stamped Reference）

  時間軸（帶版本號）：
  ┌──────────────────────────────────────────────────────┐
  │                                                      │
  │  初始：(value=A, version=v1)                         │
  │                                                      │
  │  Thread T1                   Thread T2               │
  │  ─────────────────           ────────────────────    │
  │  read: (A, v1)               read: (A, v1)           │
  │  （準備 CAS）                                         │
  │                              CAS((A,v1),(B,v2))→成功 │
  │                              state: (B, v2)          │
  │                                                      │
  │                              CAS((B,v2),(A,v3))→成功 │
  │                              state: (A, v3)  ← 版本不同│
  │                                                      │
  │  CAS((A,v1),(B,v2))                                  │
  │  當前: (A, v3) ≠ expected: (A, v1)                  │
  │  → CAS 失敗！❌                                      │
  │  → T1 重新讀取，感知到 ABA 變化                      │
  │                                                      │
  │  版本號每次修改單調遞增，即使值迴圈也能區分          │
  │  (A,v1) → (B,v2) → (A,v3)   v3 ≠ v1                │
  └──────────────────────────────────────────────────────┘

  各語言帶版本號的實現：
  ┌──────────────────────────────────────────────────────┐
  │  Java:  AtomicStampedReference<V>                    │
  │         compareAndSet(expect, update, stamp, newStamp)│
  │                                                      │
  │  C++:   std::atomic<std::pair<T,int>>（128-bit CAS） │
  │         或自訂 tagged pointer                        │
  │                                                      │
  │  Rust:  AtomicU64（將 value 和 version 打包）        │
  │                                                      │
  │  Go:    sync/atomic.CompareAndSwapUint64（打包）     │
  └──────────────────────────────────────────────────────┘
```

A->B->A 會讓 CAS 誤判「沒變過」。

解法：加版本號（stamp/tagged pointer）。

## 示意圖

```text
loop:
  old = load
  new = f(old)
  if CAS(old,new) 成功 -> done
  else -> retry
```

## 跨語言完整範例

主題：CAS 計數器（多執行緒自旋遞增，對比 mutex 版本）

### C（C11 atomic，CAS 自旋）

```c
// 編譯：gcc -std=c11 -pthread -o ch10_c ch10.c
#include <stdatomic.h>
#include <pthread.h>
#include <stdio.h>

#define THREADS 4
#define INCREMENTS 10000

static atomic_int counter = ATOMIC_VAR_INIT(0);

void *cas_worker(void *arg) {
    for (int i = 0; i < INCREMENTS; i++) {
        int old, new_val;
        do {
            old = atomic_load_explicit(&counter, memory_order_relaxed);
            new_val = old + 1;
        } while (!atomic_compare_exchange_weak_explicit(
                     &counter, &old, new_val,
                     memory_order_relaxed, memory_order_relaxed));
    }
    return NULL;
}

int main(void) {
    pthread_t threads[THREADS];
    for (int i = 0; i < THREADS; i++)
        pthread_create(&threads[i], NULL, cas_worker, NULL);
    for (int i = 0; i < THREADS; i++)
        pthread_join(threads[i], NULL);
    printf("counter = %d (expected %d)\n",
           atomic_load(&counter), THREADS * INCREMENTS);
    return 0;
}
```

### C++（std::atomic compare_exchange_weak）

```cpp
// 編譯：g++ -std=c++17 -pthread -o ch10_cpp ch10.cpp
#include <atomic>
#include <thread>
#include <iostream>
#include <vector>

constexpr int THREADS = 4;
constexpr int INCREMENTS = 10000;

static std::atomic<int> counter{0};

void cas_worker() {
    for (int i = 0; i < INCREMENTS; i++) {
        int old = counter.load(std::memory_order_relaxed);
        while (!counter.compare_exchange_weak(
                   old, old + 1,
                   std::memory_order_relaxed)) {
            // old 自動被 compare_exchange_weak 更新為當前值
        }
    }
}

int main() {
    std::vector<std::thread> threads;
    for (int i = 0; i < THREADS; i++)
        threads.emplace_back(cas_worker);
    for (auto &t : threads) t.join();
    std::cout << "counter = " << counter
              << " (expected " << THREADS * INCREMENTS << ")\n";
}
```

### Rust（AtomicI32 fetch_add vs compare_exchange）

```rust
// 執行：cargo run 或 rustc ch10.rs && ./ch10
use std::sync::atomic::{AtomicI32, Ordering};
use std::sync::Arc;
use std::thread;

const THREADS: usize = 4;
const INCREMENTS: usize = 10_000;

fn main() {
    let counter = Arc::new(AtomicI32::new(0));
    let mut handles = Vec::new();

    for _ in 0..THREADS {
        let counter = Arc::clone(&counter);
        handles.push(thread::spawn(move || {
            for _ in 0..INCREMENTS {
                // CAS 自旋遞增
                let mut old = counter.load(Ordering::Relaxed);
                loop {
                    match counter.compare_exchange_weak(
                        old, old + 1,
                        Ordering::Relaxed, Ordering::Relaxed)
                    {
                        Ok(_) => break,
                        Err(cur) => old = cur, // 更新 old 後重試
                    }
                }
            }
        }));
    }
    for h in handles { h.join().unwrap(); }
    println!("counter = {} (expected {})",
             counter.load(Ordering::SeqCst),
             THREADS * INCREMENTS);
}
```

### Go（sync/atomic CompareAndSwap）

```go
// 執行：go run ch10.go
package main

import (
	"fmt"
	"sync"
	"sync/atomic"
)

const (
	threads    = 4
	increments = 10000
)

func main() {
	var counter int64
	var wg sync.WaitGroup

	for i := 0; i < threads; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for j := 0; j < increments; j++ {
				// CAS 自旋遞增
				for {
					old := atomic.LoadInt64(&counter)
					if atomic.CompareAndSwapInt64(&counter, old, old+1) {
						break // CAS 成功退出
					}
					// 失敗則重試（old 在下次 Load 時更新）
				}
			}
		}()
	}
	wg.Wait()
	fmt.Printf("counter = %d (expected %d)\n", counter, threads*increments)
}
```

### Python（模擬 CAS，Lock 保護原子性）

```python
# 執行：python3 ch10.py
import threading

THREADS = 4
INCREMENTS = 10000

class AtomicInt:
    def __init__(self, initial=0):
        self._val = initial
        self._lock = threading.Lock()

    def load(self):
        return self._val

    def compare_and_swap(self, expected, new_val):
        with self._lock:
            if self._val == expected:
                self._val = new_val
                return True
            return False

counter = AtomicInt(0)

def cas_worker():
    for _ in range(INCREMENTS):
        while True:
            old = counter.load()
            if counter.compare_and_swap(old, old + 1):
                break  # CAS 成功

if __name__ == "__main__":
    ts = [threading.Thread(target=cas_worker) for _ in range(THREADS)]
    for t in ts: t.start()
    for t in ts: t.join()
    print(f"counter = {counter.load()} (expected {THREADS * INCREMENTS})")
```

## 完整專案級範例（Python）

檔案：`examples/python/ch10.py`

```bash
python3 examples/python/ch10.py
```

```python
"""Chapter 10: CAS increment loop."""
import threading


class AtomicInt:
    def __init__(self):
        self.v = 0
        self.m = threading.Lock()

    def cas(self, expect: int, new: int) -> bool:
        with self.m:
            if self.v == expect:
                self.v = new
                return True
            return False


if __name__ == "__main__":
    a = AtomicInt()
    for _ in range(5):
        while True:
            old = a.v
            if a.cas(old, old + 1):
                break
    print("value=", a.v)
```
