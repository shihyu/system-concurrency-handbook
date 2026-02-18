# 第3章 三大核心問題：分工、同步、互斥

## 3.1 分工（對應 3.1.1~3.1.2）

<!-- subsection-diagram -->
### 本小節示意圖（ASCII）

```text
任務切分流水線（Pipeline 分工）：

  原始任務（序列）：
  ┌──────────────────────────────────────────────────────────────────────┐
  │  Input ──► Parse ──► Compute ──► Store  （全部串行，吞吐量受限）       │
  └──────────────────────────────────────────────────────────────────────┘

  分工並行化（三個執行緒分擔不同角色）：

  資料流向：

  ┌─────────────┐     Queue1      ┌──────────────┐     Queue2     ┌──────────────┐
  │   Input     │ ─────────────► │   Parse      │ ─────────────► │   Compute    │
  │  (讀取資料)  │                │  Thread T1   │                │  Thread T2   │
  └─────────────┘                └──────────────┘                └──────┬───────┘
                                                                         │  Queue3
                                                                         ▼
                                                                ┌──────────────┐
                                                                │   Store      │
                                                                │  Thread T3   │
                                                                └──────────────┘

  時間軸對比：

  串行（總時間 = T_parse + T_compute + T_store）：
  ┌────────┬─────────┬───────┐
  │ Parse  │ Compute │ Store │
  └────────┴─────────┴───────┘

  流水線並行（穩態吞吐量 ≈ max(T_parse, T_compute, T_store) 決定瓶頸）：
  Time: 1  2  3  4  5  6
  T1:  [P1][P2][P3][P4][P5][P6]  ← Parse
  T2:     [C1][C2][C3][C4][C5]   ← Compute（等 P1 完）
  T3:        [S1][S2][S3][S4]    ← Store（等 C1 完）
              ▲
           穩態後三個階段同時跑，吞吐量 ≈ 串行的 3 倍

  ⚠ 注意：Stage 之間必須用 Queue 緩衝（解耦速率差異）
  ⚠ 注意：最慢的 Stage 決定整個 Pipeline 的上限（木桶效應）
```

把任務切成可平行的小任務，減少單點瓶頸。

## 3.2 同步（對應 3.2.1~3.2.2）

<!-- subsection-diagram -->
### 本小節示意圖（ASCII）

```text
同步：因果關係約束（T1 完成 → T2 才能開始）

  因果關係圖：

  Thread T1                           Thread T2
  ──────────                          ──────────
  [計算數據]
  [準備結果]
       │
       │  signal / notify / set()
       ▼
  ┌────────────┐ ─────────────────────► ┌────────────┐
  │ done 事件  │                         │ 等待 done  │
  │ (已發出)   │                         │ wait() 阻塞│
  └────────────┘                         └─────┬──────┘
                                               │ 收到通知
                                               ▼
                                         [開始消費結果]
                                         [繼續往下執行]

  時間軸視角（等待/喚醒機制）：

  時間 ──────────────────────────────────────────────────►
  T1:  [工作][工作][工作] ──► signal ──────────────────────
  T2:  [wait...]░░░░░░░░░░░░░░░░░░░░░░░░ ──► [繼續執行]
                ▲                            ▲
           T2 被阻塞                     T1 發出信號後 T2 喚醒

  常見同步原語對比：

  ┌──────────────┬────────────────────────────────────────────────┐
  │  原語         │  語意                                          │
  ├──────────────┼────────────────────────────────────────────────┤
  │  Event/Flag  │  1:N 通知，一次性或可重置                        │
  │  Semaphore   │  計數信號量，允許 N 個執行緒同時通過              │
  │  Barrier     │  所有參與者都到達後才一起放行                     │
  │  CountDown   │  計數到 0 後通知等待者                           │
  │  Condition   │  wait/notify，配合鎖使用                         │
  └──────────────┴────────────────────────────────────────────────┘
```

約束「先後順序」，避免讀到半成品。

## 3.3 互斥（對應 3.3.1~3.3.2）

<!-- subsection-diagram -->
### 本小節示意圖（ASCII）

```text
互斥：臨界區保護（同一時間只有一個執行緒進入）

  ┌─────────────────────────────────────────────────────────────────┐
  │                       臨界區（Critical Section）                  │
  │                                                                 │
  │  ┌──────────┐     lock()    ┌───────────────────┐              │
  │  │ Thread 1 │ ─────────────►│  正在執行          │              │
  │  └──────────┘   成功，進入   │  counter++         │              │
  │                             └───────────────────┘              │
  │  ┌──────────┐     lock()    ┌───────────────────┐              │
  │  │ Thread 2 │ ─────────────►│  阻塞等待...       │              │
  │  └──────────┘   失敗，排隊   │  ░░░░░░░░░░░░░░   │              │
  │                             └───────────────────┘              │
  │  ┌──────────┐     lock()    ┌───────────────────┐              │
  │  │ Thread 3 │ ─────────────►│  阻塞等待...       │              │
  │  └──────────┘   失敗，排隊   │  ░░░░░░░░░░░░░░   │              │
  │                             └───────────────────┘              │
  └─────────────────────────────────────────────────────────────────┘

  鎖的生命週期：

  Thread 1:  ──► lock() ──► [臨界區] ──► unlock() ──►
                  │                          │
                  │ 獲取鎖（進入）            │ 釋放鎖
                  ▼                          ▼
  Thread 2:  ──► lock() ── 阻塞....... ──► [臨界區] ──► unlock() ──►
                           ▲               ▲
                        T1 持有鎖時        T1 unlock 後
                        T2 被阻塞          T2 被喚醒

  互斥保護的是「操作的不可分性」，確保中間狀態不被其他執行緒看見。
```

同一時間只允許一個執行單元修改共享資料。

白話例子：結帳金額是共享資源，兩個收銀機同時改同筆訂單會亂掉；互斥鎖好比「正在服務中，請稍候」的牌子。

## 示意圖

```text
三大核心問題綜合示意（Pipeline + 同步 + 互斥）：

  ┌──────────┐       Queue        ┌──────────────┐      Queue      ┌──────────┐
  │ Producer │ ──────────────────►│    Buffer    │───────────────► │ Consumer │
  │  Thread  │  (互斥：每次只有   │  (同步：      │ (互斥：每次只有  │  Thread  │
  │ 生產資料  │   一個寫入者)      │  Buffer 非空  │  一個讀取者)     │ 消費資料  │
  └──────────┘                    │  才能消費）   │                 └──────────┘
                                  └──────────────┘

  分工：Producer 和 Consumer 各自獨立執行（分工）
  同步：Consumer 等待 Buffer 有資料（同步）
  互斥：Buffer 的讀寫必須互斥，防止資料損毀（互斥）
```

## 跨語言完整範例

三執行緒 Pipeline（Producer → Buffer → Consumer），展示分工 + 同步 + 互斥。

### C（pthread + condition variable）

```c
#include <pthread.h>
#include <stdio.h>
#include <stdlib.h>

#define BUFFER_SIZE 8
#define ITEMS 10

int buffer[BUFFER_SIZE];
int head = 0, tail = 0, count = 0;
int done = 0;

pthread_mutex_t mu = PTHREAD_MUTEX_INITIALIZER;
pthread_cond_t not_full  = PTHREAD_COND_INITIALIZER;
pthread_cond_t not_empty = PTHREAD_COND_INITIALIZER;

void *producer(void *arg) {
    for (int i = 0; i < ITEMS; i++) {
        pthread_mutex_lock(&mu);
        while (count == BUFFER_SIZE)
            pthread_cond_wait(&not_full, &mu);
        buffer[tail] = i;
        tail = (tail + 1) % BUFFER_SIZE;
        count++;
        printf("[Producer] put %d\n", i);
        pthread_cond_signal(&not_empty);
        pthread_mutex_unlock(&mu);
    }
    pthread_mutex_lock(&mu);
    done = 1;
    pthread_cond_signal(&not_empty);
    pthread_mutex_unlock(&mu);
    return NULL;
}

void *consumer(void *arg) {
    while (1) {
        pthread_mutex_lock(&mu);
        while (count == 0 && !done)
            pthread_cond_wait(&not_empty, &mu);
        if (count == 0 && done) { pthread_mutex_unlock(&mu); break; }
        int val = buffer[head];
        head = (head + 1) % BUFFER_SIZE;
        count--;
        printf("[Consumer] got %d\n", val);
        pthread_cond_signal(&not_full);
        pthread_mutex_unlock(&mu);
    }
    return NULL;
}

int main(void) {
    pthread_t p, c;
    pthread_create(&p, NULL, producer, NULL);
    pthread_create(&c, NULL, consumer, NULL);
    pthread_join(p, NULL);
    pthread_join(c, NULL);
    return 0;
}
```

```bash
gcc -o pipeline pipeline.c -lpthread && ./pipeline
```

### C++（std::thread + condition_variable）

```cpp
#include <iostream>
#include <thread>
#include <queue>
#include <mutex>
#include <condition_variable>

const int ITEMS = 10;
std::queue<int> buffer;
std::mutex mu;
std::condition_variable not_empty;
bool producer_done = false;

void producer() {
    for (int i = 0; i < ITEMS; i++) {
        std::unique_lock<std::mutex> lock(mu);
        buffer.push(i);
        std::cout << "[Producer] put " << i << "\n";
        not_empty.notify_one();
    }
    std::unique_lock<std::mutex> lock(mu);
    producer_done = true;
    not_empty.notify_all();
}

void consumer() {
    while (true) {
        std::unique_lock<std::mutex> lock(mu);
        not_empty.wait(lock, [] { return !buffer.empty() || producer_done; });
        if (buffer.empty()) break;
        int val = buffer.front(); buffer.pop();
        std::cout << "[Consumer] got " << val << "\n";
    }
}

int main() {
    std::thread p(producer), c(consumer);
    p.join(); c.join();
}
```

```bash
g++ -std=c++17 -o pipeline pipeline.cpp -lpthread && ./pipeline
```

### Rust（std::sync::mpsc channel）

```rust
use std::sync::mpsc;
use std::thread;
use std::time::Duration;

const ITEMS: i32 = 10;

fn main() {
    let (tx, rx) = mpsc::channel::<i32>();

    let producer = thread::spawn(move || {
        for i in 0..ITEMS {
            println!("[Producer] put {}", i);
            tx.send(i).unwrap();
            thread::sleep(Duration::from_millis(10));
        }
        // tx 在此 drop，channel 自動關閉
    });

    let consumer = thread::spawn(move || {
        for val in rx {   // rx 迭代到 channel 關閉為止
            println!("[Consumer] got {}", val);
        }
        println!("[Consumer] done");
    });

    producer.join().unwrap();
    consumer.join().unwrap();
}
```

```bash
cargo run
```

### Go（goroutine + channel）

```go
package main

import (
    "fmt"
    "time"
)

const items = 10

func producer(ch chan<- int) {
    for i := 0; i < items; i++ {
        fmt.Printf("[Producer] put %d\n", i)
        ch <- i
        time.Sleep(10 * time.Millisecond)
    }
    close(ch)
}

func consumer(ch <-chan int) {
    for val := range ch {
        fmt.Printf("[Consumer] got %d\n", val)
    }
    fmt.Println("[Consumer] done")
}

func main() {
    ch := make(chan int, 4)  // 緩衝 channel 作為 buffer
    go producer(ch)
    consumer(ch)             // 主 goroutine 當 consumer
}
```

```bash
go run main.go
```

### Python（queue.Queue + threading）

```python
import queue
import threading

ITEMS = 10
buf: queue.Queue[int] = queue.Queue(maxsize=4)

def producer():
    for i in range(ITEMS):
        buf.put(i)                   # 滿了就阻塞（同步）
        print(f"[Producer] put {i}")
    buf.put(None)                    # 哨兵值通知結束

def consumer():
    while True:
        val = buf.get()              # 空了就阻塞（同步）
        if val is None:
            break
        print(f"[Consumer] got {val}")
    print("[Consumer] done")

if __name__ == "__main__":
    t_prod = threading.Thread(target=producer)
    t_cons = threading.Thread(target=consumer)
    t_prod.start()
    t_cons.start()
    t_prod.join()
    t_cons.join()
```

```bash
python3 pipeline.py
```

## 完整專案級範例（Python）

檔案：`examples/python/ch03.py`

```bash
python3 examples/python/ch03.py
```

```python
"""Chapter 03: split work + sync.

展示三大核心問題：
1. 分工：Producer 和 Consumer 各自獨立執行
2. 同步：Consumer 等待 Buffer 有資料（queue.Queue 內建阻塞語意）
3. 互斥：Queue 內部使用鎖保護 Buffer 讀寫
"""
import queue
import threading

buf: queue.Queue[int] = queue.Queue()
barrier = threading.Barrier(3)


def worker(name: str):
    s = 0
    while True:
        try:
            s += buf.get_nowait()
        except queue.Empty:
            break
    print(name, "partial=", s)
    barrier.wait()


if __name__ == "__main__":
    for i in range(1, 11):
        buf.put(i)
    ts = [threading.Thread(target=worker, args=(f"W{i}",)) for i in (1, 2)]
    for t in ts:
        t.start()
    barrier.wait()
    print("all workers reached sync point")
    for t in ts:
        t.join()
```
