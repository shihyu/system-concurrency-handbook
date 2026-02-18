# 第11章 死鎖

## 11.1 死鎖定義

<!-- subsection-diagram -->
### 本小節示意圖

```text
  資源分配圖：循環等待形成死鎖

  ┌─────────────┐         ┌─────────────┐
  │  Thread T1  │         │  Thread T2  │
  └──────┬──────┘         └──────┬──────┘
         │ 持有(hold)              │ 持有(hold)
         ▼                        ▼
  ┌─────────────┐         ┌─────────────┐
  │  Resource A │         │  Resource B │
  └─────────────┘         └─────────────┘
         ▲                        ▲
         │ 等待(wait)              │ 等待(wait)
  ┌──────┴──────┐         ┌──────┴──────┐
  │  Thread T2  │         │  Thread T1  │
  └─────────────┘         └─────────────┘

  T1 → 持有 A，等待 B
  T2 → 持有 B，等待 A
  ↔ 形成有向循環 ⇒ 永遠無法推進 ⇒ 死鎖
```

兩個或以上執行緒互相等待對方釋放資源，永遠走不下去。

死鎖（Deadlock）是指一組執行緒陷入永久等待的狀態：每個執行緒都在等待另一個執行緒持有的資源，而那個執行緒也在等待更多資源，形成一個閉合的等待環。作業系統無法自動解除這種僵局，程式將永久掛起。

## 11.2 演化過程（對應 11.2.1~11.2.3）

<!-- subsection-diagram -->
### 本小節示意圖

```text
  時間軸：安全狀態 → 不安全狀態 → 死鎖

  時間點   Thread T1              Thread T2            系統狀態
  ──────   ──────────────────     ──────────────────   ────────────
   t0      (就緒)                 (就緒)               ✅ 安全

   t1      lock(A) ✓              lock(B) ✓            ⚠️  危險
           [持有 A]               [持有 B]

   t2      try lock(B) → 阻塞     try lock(A) → 阻塞   🔴 不安全
           [持有 A，等 B]         [持有 B，等 A]
           ╔══════════╗           ╔══════════╗
           ║  WAITING ║           ║  WAITING ║
           ╚══════════╝           ╚══════════╝

   t3      ████████████           ████████████         💀 死鎖
           (永遠等待)              (永遠等待)
           CPU 佔用 0%，但無法繼續

  ──────────────────────────────────────────────────────
  關鍵轉折：t1→t2 時，兩個執行緒都已「持有資源並等待」
  一旦形成循環，無外部干預則永不解除
```

不安全排程 + 資源競用，逐步滑向死鎖。

死鎖的形成通常是逐步的：系統從安全狀態出發，隨著執行緒依序取得部分資源，進入不安全狀態，最終當所有執行緒都在等待對方持有的資源時，死鎖完成。

## 11.3 四必要條件

<!-- subsection-diagram -->
### 本小節示意圖

```text
  死鎖四必要條件（缺一不可）

  ┌────────────────────────────────────────────────────────────────┐
  │  條件一：互斥（Mutual Exclusion）                               │
  │                                                                │
  │  ┌────────┐    只能一人使用    ┌────────────┐                  │
  │  │ T1佔用 │ ────────────────► │   廁所     │ ◄── T2 被擋在外  │
  │  └────────┘                   │（互斥資源）│                  │
  │                               └────────────┘                  │
  │  白話：廁所同時只能一個人用，資源不能共享                       │
  └────────────────────────────────────────────────────────────────┘

  ┌────────────────────────────────────────────────────────────────┐
  │  條件二：持有且等待（Hold and Wait）                            │
  │                                                                │
  │  ┌──────────────────────────┐                                 │
  │  │ T1 手握 Lock A           │                                 │
  │  │      └→ 還要申請 Lock B  │  ← 不先放 A，直接等 B           │
  │  └──────────────────────────┘                                 │
  │  白話：手拿叉子，還要等筷子，但不肯放叉子                       │
  └────────────────────────────────────────────────────────────────┘

  ┌────────────────────────────────────────────────────────────────┐
  │  條件三：不可剝奪（No Preemption）                              │
  │                                                                │
  │  OS/排程器 ─✗→ 強制搶走 T1 的 Lock A                          │
  │                                                                │
  │  只有 T1 自己 release() 才能釋放，外力無法強取                  │
  │  白話：手裡的漢堡不能被別人硬搶走                               │
  └────────────────────────────────────────────────────────────────┘

  ┌────────────────────────────────────────────────────────────────┐
  │  條件四：循環等待（Circular Wait）                              │
  │                                                                │
  │       T1 ──等待──► Lock B (被 T2 持有)                        │
  │        ▲                    │                                  │
  │        │                    ▼                                  │
  │       Lock A ◄──等待── T2                                     │
  │  (被 T1 持有)                                                  │
  │                                                                │
  │  白話：A 等 B，B 等 A，繞成一個圈                               │
  └────────────────────────────────────────────────────────────────┘

  ⚡ 破壞任一條件即可預防死鎖！
```

死鎖的四個必要條件：

- **互斥**：資源在某時刻只能被一個執行緒佔用
- **持有且等待**：執行緒持有至少一個資源，同時等待獲取其他執行緒持有的資源
- **不可剝奪**：已分配的資源不能被強制奪走，只能由持有者主動釋放
- **循環等待**：存在一個執行緒等待鏈，形成閉合迴路

四個條件缺一不可，破壞其中任何一個即可預防死鎖。

## 11.4 預防與處理

<!-- subsection-diagram -->
### 本小節示意圖

```text
  三種策略對比

  ┌──────────────────┬───────────────────────────┬──────────────────────┐
  │     策略         │        做法               │   代價 / 適用場景    │
  ├──────────────────┼───────────────────────────┼──────────────────────┤
  │ 固定加鎖順序     │ 所有執行緒按相同順序加鎖  │ 代價：需全局規劃順序 │
  │                  │                           │ 適用：鎖數量固定、   │
  │ T1: lock(A→B)    │  ┌──┐    ┌──┐            │       關係清晰       │
  │ T2: lock(A→B)    │  │A │───►│B │            │                      │
  │ (不再交叉)       │  └──┘    └──┘            │ ✅ 最可靠            │
  ├──────────────────┼───────────────────────────┼──────────────────────┤
  │ tryLock + 逾時   │ 嘗試加鎖，超過期限就放棄  │ 代價：需處理失敗重試 │
  │                  │                           │ 適用：鎖等待時間可   │
  │ if tryLock(B,    │  ┌───────────────┐        │       預期、業務允   │
  │   100ms):        │  │嘗試 100ms 後  │        │       許重試         │
  │   use B          │  │放棄，釋放 A   │        │                      │
  │ else:            │  └───────────────┘        │ ⚠️  可能活鎖        │
  │   release A      │                           │                      │
  ├──────────────────┼───────────────────────────┼──────────────────────┤
  │ 縮小持鎖範圍     │ 盡量縮短持鎖時間          │ 代價：需重新設計邏輯 │
  │                  │                           │ 適用：業務邏輯可拆   │
  │ 只在讀寫共享     │  ┌──────────────────────┐ │       分、IO操作多   │
  │ 資料時持鎖，     │  │lock │ op │ unlock    │ │                      │
  │ IO 等慢操作移出  │  └──────────────────────┘ │ ✅ 提升整體吞吐量   │
  │ 臨界區外         │   短   短   短             │                      │
  └──────────────────┴───────────────────────────┴──────────────────────┘

  死鎖偵測與恢復（補救手段）：
  ┌─────────────────────────────────────────────────────────────────┐
  │  偵測：定期掃描資源分配圖，尋找循環                              │
  │  恢復：選擇犧牲者（victim）→ 強制回滾或終止，釋放其資源          │
  │  適用：資料庫系統（如 MySQL 死鎖偵測）                           │
  └─────────────────────────────────────────────────────────────────┘
```

三種主流預防策略：

- **固定鎖順序**：所有執行緒按相同的全局排序依序加鎖，確保不存在循環等待
- **`tryLock` + timeout**：嘗試加鎖，超時後放棄並釋放已持有的鎖，待稍後重試
- **減少持鎖時間**：將不需要持鎖的操作（如 I/O、計算）移到臨界區外，降低衝突視窗

```text
T1: lock(A) -> wait(B)
T2: lock(B) -> wait(A)
=> deadlock

修正後（固定順序）:
T1: lock(A) -> lock(B) -> unlock(B) -> unlock(A)
T2: lock(A) -> lock(B) -> unlock(B) -> unlock(A)
=> 不再有循環，死鎖不可能發生
```

## 跨語言完整範例

固定加鎖順序避免死鎖：兩把鎖按 id 排序後加鎖，無論執行緒以何種順序呼叫，都不會形成循環等待。

### C

```c
/* 編譯: gcc -O2 -pthread -o ch11_c ch11.c && ./ch11_c */
#include <stdio.h>
#include <pthread.h>
#include <unistd.h>

typedef struct { int id; pthread_mutex_t mu; } Lock;

/* 按 id 排序後加鎖，破壞循環等待條件 */
void lock_ordered(Lock *a, Lock *b) {
    if (a->id < b->id) {
        pthread_mutex_lock(&a->mu);
        pthread_mutex_lock(&b->mu);
    } else {
        pthread_mutex_lock(&b->mu);
        pthread_mutex_lock(&a->mu);
    }
}

void unlock_ordered(Lock *a, Lock *b) {
    pthread_mutex_unlock(&a->mu);
    pthread_mutex_unlock(&b->mu);
}

Lock res_a = {0, PTHREAD_MUTEX_INITIALIZER};
Lock res_b = {1, PTHREAD_MUTEX_INITIALIZER};
int shared = 0;

void *thread_fn(void *arg) {
    int id = *(int *)arg;
    for (int i = 0; i < 5; i++) {
        lock_ordered(&res_a, &res_b);
        shared++;
        printf("Thread %d: shared = %d\n", id, shared);
        unlock_ordered(&res_a, &res_b);
        usleep(1000);
    }
    return NULL;
}

int main(void) {
    pthread_t t1, t2;
    int id1 = 1, id2 = 2;
    pthread_create(&t1, NULL, thread_fn, &id1);
    pthread_create(&t2, NULL, thread_fn, &id2);
    pthread_join(t1, NULL);
    pthread_join(t2, NULL);
    printf("Final shared = %d\n", shared);
    return 0;
}
```

### C++

```cpp
// 編譯: g++ -std=c++17 -O2 -pthread -o ch11_cpp ch11.cpp && ./ch11_cpp
#include <iostream>
#include <mutex>
#include <thread>
#include <vector>

struct OrderedLock {
    int id;
    std::mutex mu;
};

// std::scoped_lock 內部用 std::lock() 實作死鎖安全加鎖
void transfer(OrderedLock &from, OrderedLock &to, int &counter) {
    std::scoped_lock lk(from.mu, to.mu);   // 同時安全地鎖兩把
    counter++;
    std::cout << "transferred, counter=" << counter << "\n";
}

int main() {
    OrderedLock account_a{0, {}};
    OrderedLock account_b{1, {}};
    int counter = 0;
    std::mutex cout_mu;

    std::vector<std::thread> threads;
    for (int i = 0; i < 4; i++) {
        // 奇偶執行緒使用不同方向，但 scoped_lock 保證不死鎖
        if (i % 2 == 0)
            threads.emplace_back(transfer, std::ref(account_a),
                                 std::ref(account_b), std::ref(counter));
        else
            threads.emplace_back(transfer, std::ref(account_b),
                                 std::ref(account_a), std::ref(counter));
    }
    for (auto &t : threads) t.join();
    std::cout << "Final counter=" << counter << "\n";
    return 0;
}
```

### Rust

```rust
// 執行: cargo run 或 rustc ch11.rs && ./ch11
use std::sync::{Arc, Mutex};
use std::thread;

struct Resource {
    id: u32,
    data: Mutex<i32>,
}

// 按 id 排序後取鎖，確保全局順序
fn locked_update(a: &Resource, b: &Resource) {
    let (first, second) = if a.id < b.id { (a, b) } else { (b, a) };
    let mut g1 = first.data.lock().unwrap();
    let mut g2 = second.data.lock().unwrap();
    *g1 += 1;
    *g2 += 1;
    println!("updated: res[{}]={}, res[{}]={}", first.id, *g1, second.id, *g2);
}

fn main() {
    let res_a = Arc::new(Resource { id: 0, data: Mutex::new(0) });
    let res_b = Arc::new(Resource { id: 1, data: Mutex::new(0) });

    let handles: Vec<_> = (0..4).map(|i| {
        let (a, b) = (Arc::clone(&res_a), Arc::clone(&res_b));
        thread::spawn(move || {
            // 一半執行緒傳 (a,b)，另一半傳 (b,a)，但排序保證安全
            if i % 2 == 0 { locked_update(&a, &b); }
            else           { locked_update(&b, &a); }
        })
    }).collect();

    for h in handles { h.join().unwrap(); }
    println!("Done, no deadlock.");
}
```

### Go

```go
// 執行: go run ch11.go
package main

import (
	"fmt"
	"sync"
)

type Resource struct {
	id int
	mu sync.Mutex
}

// 按 id 排序加鎖，破壞循環等待
func lockedTransfer(a, b *Resource, counter *int, mu *sync.Mutex) {
	first, second := a, b
	if a.id > b.id {
		first, second = b, a
	}
	first.mu.Lock()
	second.mu.Lock()
	defer first.mu.Unlock()
	defer second.mu.Unlock()

	mu.Lock()
	*counter++
	fmt.Printf("transfer done, counter=%d\n", *counter)
	mu.Unlock()
}

func main() {
	resA := &Resource{id: 0}
	resB := &Resource{id: 1}
	counter := 0
	var printMu sync.Mutex
	var wg sync.WaitGroup

	for i := 0; i < 8; i++ {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			if i%2 == 0 {
				lockedTransfer(resA, resB, &counter, &printMu)
			} else {
				lockedTransfer(resB, resA, &counter, &printMu)
			}
		}(i)
	}
	wg.Wait()
	fmt.Printf("Final counter=%d, no deadlock!\n", counter)
}
```

### Python

```python
# 執行: python3 ch11.py
import threading
import time


class OrderedLock:
    def __init__(self, lock_id: int):
        self.id = lock_id
        self.mu = threading.Lock()


def locked_transfer(a: OrderedLock, b: OrderedLock, counter: list):
    """按 id 排序後加鎖，確保不形成循環等待。"""
    first, second = (a, b) if a.id < b.id else (b, a)
    with first.mu:
        time.sleep(0.001)          # 模擬工作，增加競爭機會
        with second.mu:
            counter[0] += 1
            print(f"Thread {threading.current_thread().name}: "
                  f"counter={counter[0]}")


if __name__ == "__main__":
    res_a = OrderedLock(0)
    res_b = OrderedLock(1)
    counter = [0]

    threads = []
    for i in range(8):
        # 奇偶執行緒傳入順序相反，但 ordered lock 保證安全
        if i % 2 == 0:
            t = threading.Thread(target=locked_transfer,
                                 args=(res_a, res_b, counter), name=f"T{i}")
        else:
            t = threading.Thread(target=locked_transfer,
                                 args=(res_b, res_a, counter), name=f"T{i}")
        threads.append(t)
        t.start()

    for t in threads:
        t.join()
    print(f"Final counter={counter[0]}, no deadlock!")
```

## 完整專案級範例（Python）

檔案：`examples/python/ch11.py`

```bash
python3 examples/python/ch11.py
```

```python
"""Chapter 11: deadlock avoidance via timeout and ordered locking."""
import threading
import time

A = threading.Lock()
B = threading.Lock()


def worker1():
    """持有 A 後嘗試取 B，超時則主動放棄避免死鎖。"""
    with A:
        time.sleep(0.05)
        if B.acquire(timeout=0.1):
            print("w1 got B")
            B.release()
        else:
            print("w1 timeout on B — 避免死鎖，稍後重試")


def worker2():
    """持有 B 後嘗試取 A，超時則主動放棄避免死鎖。"""
    with B:
        time.sleep(0.05)
        if A.acquire(timeout=0.1):
            print("w2 got A")
            A.release()
        else:
            print("w2 timeout on A — 避免死鎖，稍後重試")


if __name__ == "__main__":
    t1 = threading.Thread(target=worker1)
    t2 = threading.Thread(target=worker2)
    t1.start(); t2.start(); t1.join(); t2.join()
    print("程式正常結束，無死鎖")
```
