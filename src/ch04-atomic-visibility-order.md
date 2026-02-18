# 第4章 本質問題：原子性、可見性、有序性

## 4.1 背景（對應 4.1.1~4.1.5）

<!-- subsection-diagram -->
### 本小節示意圖（ASCII）

```text
程式從源碼到執行的完整路徑，每個階段都可能引入問題：

  ┌──────────────────────────────────────────────────────────────────────────┐
  │  源碼（Source Code）                                                      │
  │  int x = 0;                                                              │
  │  x++;                                                                    │
  └───────────────────────────┬──────────────────────────────────────────────┘
                              │
                    ┌─────────▼──────────┐
                    │  編譯器優化          │  ← 潛在問題：指令重排、死碼刪除
                    │  (Compiler)         │     volatile/memory_order 可控制
                    └─────────┬──────────┘
                              │
                    ┌─────────▼──────────┐
                    │  機器碼              │  ← 一條 x++ 變成三條指令：
                    │  (Machine Code)     │     LOAD r1, [x]
                    └─────────┬──────────┘     ADD r1, 1
                              │                STORE [x], r1
                    ┌─────────▼──────────┐
                    │  CPU 亂序執行        │  ← 潛在問題：Out-of-Order Execution
                    │  (OoOE Pipeline)    │     CPU 可調整指令執行順序提升效率
                    └─────────┬──────────┘
                              │
              ┌───────────────┼───────────────┐
              │               │               │
    ┌─────────▼──────┐ ┌──────▼─────┐ ┌──────▼──────┐
    │  Store Buffer  │ │  L1 Cache  │ │  L2 Cache  │  ← 潛在問題：可見性
    │  (寫入緩衝)     │ │  (核心私有) │ │  (核心私有) │     一個核心的寫入
    └────────────────┘ └────────────┘ └────────────┘     對其他核心不立即可見
                              │
                    ┌─────────▼──────────┐
                    │  L3 Cache           │  ← 所有核心共享，但同步有延遲
                    └─────────┬──────────┘
                              │
                    ┌─────────▼──────────┐
                    │  Main Memory (RAM)  │  ← 最終一致，但時序不保證
                    └────────────────────┘

  結論：你以為的「按順序、立即可見」在並發環境中都是假設！
```

CPU、快取、編譯器優化都會讓「你以為的順序」和實際執行不同。

## 4.2 原子性（對應 4.2.1~4.2.4）

<!-- subsection-diagram -->
### 本小節示意圖（ASCII）

```text
x++ 非原子性拆解（Read-Modify-Write 三步）：

  高層語義（你寫的）：
  ┌─────────────────┐
  │    x++          │  ← 看起來是一個操作
  └─────────────────┘

  實際機器碼（三個獨立步驟）：
  ┌──────────┐    ┌──────────┐    ┌──────────┐
  │ LOAD(x)  │──► │ ADD(1)   │──► │ STORE(x) │
  │ r1 = x   │    │ r1 = r1+1│    │ x = r1   │
  └──────────┘    └──────────┘    └──────────┘
       ①               ②               ③
       ▲               ▲               ▲
  任何兩步之間都可能被其他執行緒打斷！

  兩個執行緒交錯導致丟失更新（Lost Update）：

  初始狀態：x = 0

  時間  Thread T1                    Thread T2
  ──── ──────────────────────────── ────────────────────────────
   t1  ① LOAD  r1_T1 = x = 0
   t2                               ① LOAD  r1_T2 = x = 0
   t3  ② ADD   r1_T1 = 0 + 1 = 1
   t4                               ② ADD   r1_T2 = 0 + 1 = 1
   t5  ③ STORE x = r1_T1 = 1
   t6                               ③ STORE x = r1_T2 = 1

  預期結果：x = 2
  實際結果：x = 1  ← T1 的遞增被 T2 覆蓋，一次更新永久丟失！

  解法：原子指令（LOCK XADD / fetch_add）確保三步不可分割
  ┌──────────────────────────────────────────────────────────┐
  │  LOCK XADD [x], 1  ← 一條不可分割的原子指令               │
  │  等價於：原子地 x = x + 1，中間態對其他 CPU 不可見          │
  └──────────────────────────────────────────────────────────┘
```

`x++` 不是原子，實際是讀、改、寫三步。

## 4.3 可見性（對應 4.3.1~4.3.4）

<!-- subsection-diagram -->
### 本小節示意圖（ASCII）

```text
快取不一致導致可見性問題：

  ┌─────────────────────────────┐     ┌─────────────────────────────┐
  │         Core 0              │     │         Core 1              │
  │                             │     │                             │
  │  Thread T1（寫入方）         │     │  Thread T2（讀取方）         │
  │                             │     │                             │
  │  x = 42;                    │     │  while (x == 0) { }        │
  │                             │     │  // 期望讀到 42              │
  │  ┌─────────────────────┐    │     │    ┌─────────────────────┐  │
  │  │  L1 Cache           │    │     │    │  L1 Cache           │  │
  │  │  ┌───────────────┐  │    │     │    │  ┌───────────────┐  │  │
  │  │  │  x = 42  (新) │  │    │     │    │  │  x = 0   (舊) │  │  │
  │  │  └───────────────┘  │    │     │    │  └───────────────┘  │  │
  │  └─────────────────────┘    │     │    └─────────────────────┘  │
  └──────────────┬──────────────┘     └─────────────────────────────┘
                 │                                  ▲
                 │  cache coherence 協議             │  Core1 讀到的是舊值！
                 │  （MESI 狀態機）                  │  可能永遠看不到 x=42
                 │                                  │
                 └──────────────────────────────────┘
                        需要 memory barrier 刷新

  MESI 快取一致性協議狀態：

  ┌────────────┬───────────────────────────────────────────────────┐
  │  狀態      │  含義                                              │
  ├────────────┼───────────────────────────────────────────────────┤
  │  Modified  │  本核心有最新值，其他核心的副本無效                    │
  │  Exclusive │  只有本核心有此快取行，且與記憶體一致                   │
  │  Shared    │  多個核心都有此快取行，且與記憶體一致                   │
  │  Invalid   │  此快取行無效，需要重新從記憶體/其他核心讀取            │
  └────────────┴───────────────────────────────────────────────────┘

  解法：使用 volatile（Java）/ atomic store（C++/Rust/Go）
  強制寫入時刷到記憶體，讀取時從記憶體重新讀。
```

A 執行緒改值，B 不一定立刻看得到，可能讀到舊快取。

## 4.4 有序性（對應 4.4.1~4.4.4）

<!-- subsection-diagram -->
### 本小節示意圖（ASCII）

```text
指令重排導致有序性問題：

  程式員視角（期望的執行順序）：

  Writer 執行緒             Reader 執行緒
  ──────────────────────    ───────────────────────
  ① data = 42              ③ if (ready == true)
  ② ready = true           ④     print(data)  // 期望印出 42

  CPU/編譯器重排後（實際可能的執行順序）：

  Writer 執行緒             Reader 執行緒
  ──────────────────────    ───────────────────────
  ② ready = true    ←─ ① 和 ② 被重排！
  ①' data = 42             ③ if (ready == true)   ← 看到 ready=true
                           ④     print(data)       ← 但 data 還是舊值！

  時間軸視角：

  時間 ─────────────────────────────────────────────────────►

  Writer: [ready=true] ...... [data=42]  ← 重排後 ready 先寫
                ↓
  Reader:       [讀到 ready=true] → [讀 data] ← 此時 data 可能還是 0！

  為什麼 CPU 會重排？
  ┌────────────────────────────────────────────────────────────┐
  │  CPU 保證：單執行緒內的語義不變（as-if-serial）               │
  │  CPU 不保證：跨執行緒的全域可見順序                           │
  │                                                            │
  │  data 和 ready 在單執行緒內沒有依賴關係                       │
  │  → CPU/編譯器認為可以任意調換順序                             │
  └────────────────────────────────────────────────────────────┘

  解法：Memory Barrier（記憶體屏障）

  Writer:  data = 42
           ┌─────────────────────────────────────────┐
           │  StoreStore Barrier（禁止跨屏障的寫重排）  │
           └─────────────────────────────────────────┘
           ready = true

  Reader:  if (ready)
           ┌─────────────────────────────────────────┐
           │  LoadLoad Barrier（禁止跨屏障的讀重排）   │
           └─────────────────────────────────────────┘
           print(data)   ← 現在保證讀到正確的 data
```

指令可能重排，只要單執行緒語義不變，編譯器就可能調整。

## 4.5 綜合解法（對應 4.5.1~4.5.2）

<!-- subsection-diagram -->
### 本小節示意圖（ASCII）

```text
三種問題 vs 三種解法對比：

  ┌──────────────────┬────────────────────────────────────────────────────────────┐
  │  解法             │  原子性 ✓/✗   可見性 ✓/✗   有序性 ✓/✗   適用場景         │
  ├──────────────────┼────────────────────────────────────────────────────────────┤
  │  原子類型          │    ✓           ✓           部分✓         計數器、狀態旗標  │
  │  (atomic int等)  │  CAS/fetch_add  強制刷新   依 memory_order  無鎖演算法      │
  ├──────────────────┼────────────────────────────────────────────────────────────┤
  │  互斥鎖            │    ✓           ✓            ✓           複雜臨界區         │
  │  (mutex/lock)    │  鎖保護整段     解鎖時刷新   鎖保證 HB 關係  讀寫都有的情況   │
  ├──────────────────┼────────────────────────────────────────────────────────────┤
  │  記憶體屏障         │    ✗           ✓            ✓           底層程式庫開發     │
  │  (memory_order)  │  不解決原子性   禁止快取優化  禁止重排       硬體驅動開發     │
  └──────────────────┴────────────────────────────────────────────────────────────┘

  選擇指引：

  需要原子計數/旗標？
      └──► 優先選 atomic（零鎖開銷）

  臨界區有多個操作需要一起保護？
      └──► 必須選 mutex（原子類型只能保護單個變數）

  寫底層庫、需要精細控制記憶體順序？
      └──► 結合 atomic + 精確的 memory_order

  producer-consumer 資料傳遞？
      └──► atomic flag（ready） + 適當 memory_order，或直接用 channel/queue
```

- 原子類 + CAS
- 鎖
- 記憶體屏障/語言記憶體模型規則

## 示意圖

```text
完整問題場景（寫端/讀端的可見性與有序性）：

  Writer:
    data = 42;     // Step 1：寫資料
    ready = true;  // Step 2：設旗標

  Reader:
    if (ready)     // Step 3：讀旗標
        print(data) // Step 4：讀資料

  若重排/不可見：可能讀到 ready=true 但 data=舊值（0 或垃圾值）
  解法：ready 使用 atomic，並在 writer 側加 release 屏障，reader 側加 acquire 屏障
```

## 跨語言完整範例

用 atomic flag 安全地在兩個執行緒間傳遞數據（producer-consumer with ready flag）。

### C（GCC __atomic 內建函式）

```c
#include <stdio.h>
#include <pthread.h>
#include <stdatomic.h>
#include <unistd.h>

int data = 0;
atomic_int ready = 0;

void *writer(void *arg) {
    data = 42;                                       /* 先寫資料 */
    atomic_store_explicit(&ready, 1,                 /* 再設旗標，release 語意 */
                          memory_order_release);
    return NULL;
}

void *reader(void *arg) {
    while (!atomic_load_explicit(&ready,             /* 等待旗標，acquire 語意 */
                                 memory_order_acquire))
        ;                                            /* 自旋等待 */
    printf("reader got data = %d\n", data);          /* 保證看到 data=42 */
    return NULL;
}

int main(void) {
    pthread_t w, r;
    pthread_create(&r, NULL, reader, NULL);
    usleep(10000);
    pthread_create(&w, NULL, writer, NULL);
    pthread_join(w, NULL);
    pthread_join(r, NULL);
    return 0;
}
```

```bash
gcc -std=c11 -o ready ready.c -lpthread && ./ready
```

### C++（std::atomic with memory_order）

```cpp
#include <iostream>
#include <thread>
#include <atomic>
#include <chrono>

int data = 0;
std::atomic<bool> ready{false};

void writer() {
    data = 42;                                     // 先寫資料
    ready.store(true, std::memory_order_release);  // release：之前的寫對 acquire 端可見
}

void reader() {
    while (!ready.load(std::memory_order_acquire)) // acquire：保證讀到 writer 的所有寫入
        std::this_thread::yield();
    std::cout << "reader got data = " << data << "\n";
}

int main() {
    std::thread r(reader);
    std::this_thread::sleep_for(std::chrono::milliseconds(10));
    std::thread w(writer);
    w.join();
    r.join();
}
```

```bash
g++ -std=c++17 -o ready ready.cpp -lpthread && ./ready
```

### Rust（std::sync::atomic with Ordering）

```rust
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::thread;
use std::time::Duration;

static mut DATA: i32 = 0;
static READY: AtomicBool = AtomicBool::new(false);

fn main() {
    let reader = thread::spawn(|| {
        while !READY.load(Ordering::Acquire) {
            thread::yield_now();
        }
        let val = unsafe { DATA };
        println!("reader got data = {}", val);
    });

    thread::sleep(Duration::from_millis(10));

    let writer = thread::spawn(|| {
        unsafe { DATA = 42; }                       // 先寫資料
        READY.store(true, Ordering::Release);        // release 屏障後設旗標
    });

    writer.join().unwrap();
    reader.join().unwrap();
}
```

```bash
cargo run
```

### Go（sync/atomic + channel 作為 ready 信號）

```go
package main

import (
    "fmt"
    "sync/atomic"
    "time"
)

var (
    data  int32
    ready atomic.Bool
)

func writer() {
    atomic.StoreInt32(&data, 42)  // 寫資料
    ready.Store(true)             // 設旗標（Go atomic 已包含適當 memory barrier）
}

func reader() {
    for !ready.Load() {           // 等待旗標
        time.Sleep(time.Microsecond)
    }
    fmt.Printf("reader got data = %d\n", atomic.LoadInt32(&data))
}

func main() {
    go reader()
    time.Sleep(10 * time.Millisecond)
    go writer()
    time.Sleep(100 * time.Millisecond) // 等兩個 goroutine 完成
}
```

```bash
go run main.go
```

### Python（threading.Event 作為 ready 信號）

```python
import threading
import time

data = {"value": None}
ready = threading.Event()   # Event 內建 happens-before 語意

def writer():
    data["value"] = 42      # 先寫資料
    ready.set()             # 設旗標（Event.set() 保證可見性）

def reader():
    ready.wait()            # 阻塞等待旗標（比自旋更節省 CPU）
    print(f"reader got data = {data['value']}")

if __name__ == "__main__":
    t_reader = threading.Thread(target=reader)
    t_reader.start()
    time.sleep(0.02)
    t_writer = threading.Thread(target=writer)
    t_writer.start()
    t_writer.join()
    t_reader.join()
```

```bash
python3 ready.py
```

## 完整專案級範例（Python）

檔案：`examples/python/ch04.py`

```bash
python3 examples/python/ch04.py
```

```python
"""Chapter 04: visibility/order via event.

展示：
1. Writer 先寫資料，再設旗標（模擬正確的 release 語意）
2. Reader 等待旗標後讀資料（模擬正確的 acquire 語意）
3. threading.Event 內建 happens-before 保證，確保讀到正確值
"""
import threading
import time

ready = threading.Event()
data = {"value": None}


def writer():
    data["value"] = 42      # Step 1：先寫資料
    ready.set()             # Step 2：設旗標（之後的 reader 保證看到 data=42）


def reader():
    ready.wait()            # 等待旗標（阻塞直到 writer 呼叫 set()）
    print("read value =", data["value"])   # 保證印出 42


if __name__ == "__main__":
    t1 = threading.Thread(target=writer)
    t2 = threading.Thread(target=reader)
    t2.start()
    time.sleep(0.02)
    t1.start()
    t1.join()
    t2.join()
```
