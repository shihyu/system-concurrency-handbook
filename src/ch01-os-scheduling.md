# 第1章 作業系統與線程調度

## 1.1 計算機基礎（對應 1.1.1~1.1.2）

<!-- subsection-diagram -->
### 本小節示意圖

```text
馮諾伊曼架構：CPU ↔ 記憶體 ↔ I/O

  ┌──────────────────────────────────────────────────────────┐
  │                        CPU                               │
  │  ┌──────────┐  ┌──────────┐  ┌──────────────────────┐  │
  │  │ 控制單元  │  │ 算術邏輯  │  │      暫存器組         │  │
  │  │  (CU)   │  │ 單元(ALU)│  │  R0 R1 R2 ... R15    │  │
  │  └────┬─────┘  └────┬─────┘  └──────────────────────┘  │
  └───────┼─────────────┼──────────────────────────────────┘
          │             │
          └──────┬───────┘
                 │  系統匯流排（System Bus）
    ┌────────────┴────────────────────────────┐
    │                                         │
    ▼                                         ▼
┌──────────┐                          ┌──────────────┐
│  記憶體   │                          │   I/O 裝置   │
│  (RAM)   │                          │  磁碟/網路/鍵盤│
└──────────┘                          └──────────────┘

快取層次（速度由快到慢，容量由小到大）：

  ┌─────────────────────────────────────────────────────────┐
  │  速度: 最快 ◄──────────────────────────────────► 最慢   │
  │  容量: 最小 ◄──────────────────────────────────► 最大   │
  └─────────────────────────────────────────────────────────┘

  ┌────────┐   ┌────────┐   ┌────────┐   ┌────────┐   ┌──────────┐   ┌──────┐
  │Register│──▶│  L1$   │──▶│  L2$   │──▶│  L3$   │──▶│   RAM    │──▶│ Disk │
  │  ~1ns  │   │  ~4ns  │   │ ~12ns  │   │ ~30ns  │   │ ~100ns   │   │~10ms │
  │  <1KB  │   │  64KB  │   │  512KB │   │   8MB  │   │  GB 級別  │   │ TB級 │
  └────────┘   └────────┘   └────────┘   └────────┘   └──────────┘   └──────┘
   核心獨享      核心獨享      核心獨享      插槽共享        DRAM         持久化
```

重點：CPU 做計算，記憶體放資料，I/O 負責進出。

白話例子：廚房裡，廚師=CPU，冰箱=記憶體，外送窗口=I/O。快取好比廚師的備料台，常用食材放在手邊，不用每次跑去冰箱。

## 1.2 多核與多 CPU（對應 1.2.1~1.2.5）

<!-- subsection-diagram -->
### 本小節示意圖

```text
單核時間切片（Concurrency，並發但非並行）：

時間軸 ──────────────────────────────────────────────►
       ┌─────┬─────┬─────┬─────┬─────┬─────┬─────┐
Core0  │  T1 │  T2 │  T1 │  T3 │  T2 │  T1 │  T3 │
       └─────┴─────┴─────┴─────┴─────┴─────┴─────┘
        ▲                               ▲
     Context Switch               Context Switch
     （上下文切換，有額外成本）

多核真並行（Parallelism）：

時間軸 ──────────────────────────────────────────────►
       ┌─────────────────────────────────────────┐
Core0  │  T1 │  T1 │  T1 │  T1 │  T1 │  T1 │   │
       ├─────────────────────────────────────────┤
Core1  │  T2 │  T2 │  T2 │  T2 │  T2 │  T2 │   │
       ├─────────────────────────────────────────┤
Core2  │  T3 │  T3 │  T3 │  T3 │  T3 │  T3 │   │
       ├─────────────────────────────────────────┤
Core3  │  T4 │  T4 │  T4 │  T4 │  T4 │  T4 │   │
       └─────────────────────────────────────────┘
        真正同時執行，吞吐量 ≈ 單核 × 核心數

NUMA 多插槽架構（跨 Socket 成本警示）：

  ┌────────────── Socket 0 ──────────────┐   ┌────────────── Socket 1 ──────────────┐
  │  ┌────────┐  ┌────────┐             │   │  ┌────────┐  ┌────────┐             │
  │  │ Core0  │  │ Core1  │  ...        │   │  │ Core4  │  │ Core5  │  ...        │
  │  └────────┘  └────────┘             │   │  └────────┘  └────────┘             │
  │       └──────────┘                  │   │       └──────────┘                  │
  │           L3 Cache (共享)            │   │           L3 Cache (共享)            │
  │           Local RAM                 │   │           Local RAM                 │
  └──────────────┬──────────────────────┘   └──────────────┬──────────────────────┘
                 │                                         │
                 └──────────── QPI / UPI 互連 ─────────────┘
                               （跨 Socket 延遲 ≈ 本地 RAM 的 2~3 倍）
  ⚠ 跨 Socket 存取 Remote RAM 比 Local RAM 慢得多，設計時盡量讓執行緒存取本地記憶體
```

重點：
- 單核：同時只能真做一件事，靠時間切換看起來像同時。
- 多核：可真並行。
- 多 CPU：更多插槽，但跨 Socket 總線協調成本高。

## 1.3 線程模型（對應 1.3.1~1.3.3）

<!-- subsection-diagram -->
### 本小節示意圖

```text
三種線程模型對比：

┌─────────────────────────────────────────────────────────────────────────────┐
│  模型 1：1:1 模型（Java / C++ / Rust 標準線程）                              │
│                                                                             │
│  User Space   [Thread A] [Thread B] [Thread C]                              │
│                    │          │          │         每個用戶線程               │
│  Kernel Space  [KThread]  [KThread]  [KThread]    直接對應一個核心線程        │
│                    │          │          │                                   │
│  CPU Core      [Core 0]   [Core 1]   [Core 2]                               │
│                                                                             │
│  優點：OS 直接調度，真正並行；阻塞不影響其他線程                                │
│  缺點：線程創建/切換成本高（syscall），線程數受 OS 限制                         │
└─────────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────────┐
│  模型 2：M:1 模型（舊版 Green Thread / 早期 JVM）                             │
│                                                                             │
│  User Space  [Thread A][Thread B][Thread C][Thread D][Thread E]             │
│                  │         │         │         │         │                  │
│              └───┴─────────┴─────────┴─────────┴─────────┘                 │
│                              User-Level Scheduler                           │
│                                       │                                     │
│  Kernel Space                     [KThread]  ← 只有一個核心線程              │
│                                       │                                     │
│  CPU Core                         [Core 0]                                  │
│                                                                             │
│  優點：切換快（不需要 syscall）                                                │
│  缺點：任一線程阻塞 → 整個進程卡住；無法利用多核                                │
└─────────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────────┐
│  模型 3：M:N 模型（Go goroutine / Erlang process）                            │
│                                                                             │
│  User Space  [G1][G2][G3][G4][G5][G6][G7][G8]  ← N 個 goroutine（可達百萬） │
│               └──┬──┘  └──┬──┘  └──┬──┘  └─┘                              │
│              [P0 Queue] [P1 Queue] [P2 Queue]  ← M 個邏輯處理器（≈CPU核數）  │
│                  │          │          │                                    │
│  Kernel Space [KThread0] [KThread1] [KThread2] ← K 個核心線程               │
│                  │          │          │                                    │
│  CPU Core     [Core 0]   [Core 1]   [Core 2]                               │
│                                                                             │
│  優點：輕量（goroutine ~2KB），阻塞自動切換，真並行                             │
│  缺點：Runtime 複雜；Work Stealing 調度有額外開銷                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

- 使用者線程：切換快，但碰到阻塞可能整批卡住。
- 核心線程：由 OS 調度，隔離好，成本較高。
- 混合模型：兩者折衷，Go 是最成功的 M:N 實作之一。

## 1.4 Java 線程與 OS 線程映射

<!-- subsection-diagram -->
### 本小節示意圖

```text
Java 線程完整映射鏈：

  Java 層                  JVM 層               OS 層          硬體層
  ─────────                ──────               ─────          ──────
  new Thread()
      │
      │ Java API
      ▼
  thread.start()
      │
      │ JNI 呼叫
      ▼
  ┌──────────────┐
  │  JVM Native  │ ──────────────────► pthread_create()
  │  Thread Code │                          │
  └──────────────┘                          │ Linux syscall
                                            ▼
                                    ┌───────────────┐
                                    │  OS Kernel    │
                                    │  pthread /    │
                                    │  clone()      │
                                    └───────┬───────┘
                                            │ 調度
                                            ▼
                                    ┌───────────────┐
                                    │   CPU Core    │
                                    │  執行機器碼    │
                                    └───────────────┘

Java 線程狀態機：

         ┌─────────────────────────────────────────────────┐
         │                                                 │
  start()│                                                 │run() 結束
         ▼                                                 │
  ┌─────────┐   OS 分配時間片    ┌───────────┐             │
  │   NEW   │──────────────────►│ RUNNABLE  │─────────────►│ TERMINATED │
  └─────────┘                   └─────┬─────┘             │            │
                                      │                   └────────────┘
                      synchronized/IO │阻塞
                      ┌───────────────┼───────────────┐
                      ▼               ▼               ▼
               ┌──────────┐  ┌──────────────┐  ┌──────────────┐
               │ BLOCKED  │  │   WAITING    │  │TIMED_WAITING │
               │(等待鎖)   │  │(wait/join/   │  │(sleep/       │
               └────┬─────┘  │ park 無超時)  │  │ wait有超時)   │
                    │        └──────┬───────┘  └──────┬───────┘
                    │               │                  │
                    │  鎖釋放        │ notify/          │ 超時/
                    │               │ unpark           │ interrupt
                    └───────────────┴──────────────────┘
                                    │
                                    ▼
                               RUNNABLE（重新競爭）
```

Java 的 `Thread` 最終也要跑在 OS 調度上。C/C++/Rust/Go 一樣，差別主要在 runtime 包裝方式。

## 跨語言對照

| 概念 | C | C++ | Rust | Go |
|------|---|-----|------|----|
| 執行單元 | pthread | std::thread | std::thread | goroutine（M:N） |
| 啟動方式 | pthread_create | thread.detach/join | thread::spawn | go func() |
| 核數查詢 | sysconf | thread::hardware_concurrency | num_cpus crate | runtime.NumCPU() |
| 線程模型 | 1:1（OS pthread） | 1:1（OS pthread） | 1:1（OS pthread） | M:N（Go runtime） |

## 示意圖

```text
多核並行執行示意（兩核四線程）：

時間軸 ────────────────────────────────────────────►
       ┌──────┬──────┬──────┬──────┬──────┬──────┐
Core0  │  T1  │  T1  │  T1  │  T3  │  T3  │  T3  │
       ├──────┼──────┼──────┼──────┼──────┼──────┤
Core1  │  T2  │  T2  │  T2  │  T4  │  T4  │  T4  │
       └──────┴──────┴──────┴──────┴──────┴──────┘
                           ▲
                      Context Switch
        （T1/T2 → T3/T4，OS 調度器決定切換時機）
```

## 跨語言完整範例

建立 2 個執行緒各自打印 tick，並印出 CPU 核心數。

### C（pthread）

```c
#include <pthread.h>
#include <stdio.h>
#include <unistd.h>

struct args { const char *name; int ticks; };

void *tick_worker(void *arg) {
    struct args *a = (struct args *)arg;
    for (int i = 0; i < a->ticks; i++) {
        printf("%s tick %d\n", a->name, i);
        usleep(50000);
    }
    return NULL;
}

int main(void) {
    long cpu_count = sysconf(_SC_NPROCESSORS_ONLN);
    printf("cpu_count = %ld\n", cpu_count);

    pthread_t t1, t2;
    struct args a1 = {"T1", 3}, a2 = {"T2", 3};
    pthread_create(&t1, NULL, tick_worker, &a1);
    pthread_create(&t2, NULL, tick_worker, &a2);
    pthread_join(t1, NULL);
    pthread_join(t2, NULL);
    return 0;
}
```

```bash
gcc -o tick tick.c -lpthread && ./tick
```

### C++（std::thread）

```cpp
#include <iostream>
#include <thread>
#include <chrono>

void tick_worker(const std::string &name, int ticks) {
    for (int i = 0; i < ticks; i++) {
        std::cout << name << " tick " << i << "\n";
        std::this_thread::sleep_for(std::chrono::milliseconds(50));
    }
}

int main() {
    unsigned int cores = std::thread::hardware_concurrency();
    std::cout << "cpu_count = " << cores << "\n";

    std::thread t1(tick_worker, "T1", 3);
    std::thread t2(tick_worker, "T2", 3);
    t1.join();
    t2.join();
    return 0;
}
```

```bash
g++ -std=c++17 -o tick tick.cpp -lpthread && ./tick
```

### Rust（std::thread）

```rust
use std::thread;
use std::time::Duration;

fn tick_worker(name: &str, ticks: u32) {
    for i in 0..ticks {
        println!("{} tick {}", name, i);
        thread::sleep(Duration::from_millis(50));
    }
}

fn main() {
    let cpu_count = std::thread::available_parallelism()
        .map(|n| n.get())
        .unwrap_or(1);
    println!("cpu_count = {}", cpu_count);

    let t1 = thread::spawn(|| tick_worker("T1", 3));
    let t2 = thread::spawn(|| tick_worker("T2", 3));
    t1.join().unwrap();
    t2.join().unwrap();
}
```

```bash
cargo run
```

### Go（goroutine）

```go
package main

import (
    "fmt"
    "runtime"
    "sync"
    "time"
)

func tickWorker(name string, ticks int, wg *sync.WaitGroup) {
    defer wg.Done()
    for i := 0; i < ticks; i++ {
        fmt.Printf("%s tick %d\n", name, i)
        time.Sleep(50 * time.Millisecond)
    }
}

func main() {
    fmt.Printf("cpu_count = %d\n", runtime.NumCPU())

    var wg sync.WaitGroup
    wg.Add(2)
    go tickWorker("T1", 3, &wg)
    go tickWorker("T2", 3, &wg)
    wg.Wait()
}
```

```bash
go run main.go
```

### Python（threading）

```python
import os
import threading
import time

def tick_worker(name: str, ticks: int):
    for i in range(ticks):
        print(f"{name} tick {i}")
        time.sleep(0.05)

if __name__ == "__main__":
    print(f"cpu_count = {os.cpu_count()}")
    t1 = threading.Thread(target=tick_worker, args=("T1", 3))
    t2 = threading.Thread(target=tick_worker, args=("T2", 3))
    t1.start()
    t2.start()
    t1.join()
    t2.join()
```

```bash
python3 tick.py
```

## 完整專案級範例（Python）

檔案：`examples/python/ch01.py`

```bash
python3 examples/python/ch01.py
```

```python
"""Chapter 01: OS scheduling and threads.

展示：
1. 印出 CPU 核心數
2. 建立 2 個執行緒各自打印 tick
3. 觀察執行緒交錯輸出（並發）
"""
import os
import threading
import time


def work(name: str, ticks: int = 3):
    for i in range(ticks):
        print(f"{name} tick {i}", flush=True)
        time.sleep(0.05)


if __name__ == "__main__":
    print(f"cpu_count = {os.cpu_count()}")
    t1 = threading.Thread(target=work, args=("T1",))
    t2 = threading.Thread(target=work, args=("T2",))
    t1.start()
    t2.start()
    t1.join()
    t2.join()
    print("done")
```
