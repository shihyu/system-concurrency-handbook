# 第9章 Lock 家族

## 9.1 顯式鎖

<!-- subsection-diagram -->
### 本小節示意圖

```text
  顯式鎖三種獲取路徑對比
  ════════════════════════════════════════════════════════

  lock()：無限等待，不可中斷
  ┌──────────────────────────────────────────────────────┐
  │  thread.lock()                                       │
  │       │                                              │
  │       ▼                                              │
  │  嘗試獲取鎖 ─── 成功 ──► 進入臨界區                 │
  │       │                                              │
  │       │ 失敗（鎖被佔用）                             │
  │       ▼                                              │
  │  park()（永久等待）                                  │
  │  ⚠ 即使收到 interrupt()，仍然繼續等待               │
  │  只有鎖被釋放後才被 unpark 喚醒                      │
  │  優點：簡單   缺點：可能永久阻塞                     │
  └──────────────────────────────────────────────────────┘

  tryLock(timeout)：超時等待
  ┌──────────────────────────────────────────────────────┐
  │  lock = thread.tryLock(1, TimeUnit.SECONDS)          │
  │       │                                              │
  │       ▼                                              │
  │  嘗試獲取鎖 ─── 成功 ──► 進入臨界區                 │
  │       │                                              │
  │       │ 失敗，記錄 deadline                          │
  │       ▼                                              │
  │  park(timeout)                                       │
  │  ┌─────────────────────────────────────────────┐    │
  │  │  等待期間：                                  │    │
  │  │  ├─ 被喚醒（鎖釋放）→ 重試 tryLock          │    │
  │  │  ├─ 超時      → 返回 false，不進臨界區      │    │
  │  │  └─ interrupt → 拋 InterruptedException     │    │
  │  └─────────────────────────────────────────────┘    │
  │  優點：避免永久阻塞   缺點：需處理返回值             │
  └──────────────────────────────────────────────────────┘

  lockInterruptibly()：可中斷等待
  ┌──────────────────────────────────────────────────────┐
  │  thread.lockInterruptibly()                          │
  │       │                                              │
  │       ▼                                              │
  │  嘗試獲取鎖 ─── 成功 ──► 進入臨界區                 │
  │       │                                              │
  │       │ 失敗，進入佇列等待                           │
  │       ▼                                              │
  │  parkInterruptibly()                                 │
  │  ┌─────────────────────────────────────────────┐    │
  │  │  等待期間：                                  │    │
  │  │  ├─ 被喚醒（鎖釋放）→ 重試獲取              │    │
  │  │  └─ interrupt → 立即拋 InterruptedException  │    │
  │  │     從等待佇列移除，不再等待                 │    │
  │  └─────────────────────────────────────────────┘    │
  │  優點：可取消   缺點：呼叫者必須處理異常             │
  └──────────────────────────────────────────────────────┘
```

比 `synchronized` 更可控：可中斷、可超時、可嘗試。

## 9.2 公平與非公平（對應 9.2.1~9.2.6）

<!-- subsection-diagram -->
### 本小節示意圖

```text
  公平鎖 vs 非公平鎖競爭示意
  ════════════════════════════════════════════════════════

  公平鎖（Fair Lock）— 嚴格 FIFO 順序
  ┌─────────────────────────────────────────────────────┐
  │                                                     │
  │  等待佇列：  T2 → T3 → T4（依入隊順序）            │
  │                                                     │
  │  T1 釋放鎖                                          │
  │       │                                             │
  │       ▼ 只喚醒佇列頭部                              │
  │  T2 獲取鎖（FIFO 頭部）                             │
  │                                                     │
  │  此時 T5 剛好到達：                                  │
  │  ┌──────────────────────────────────────────────┐   │
  │  │  T5 發現佇列不空 → 直接入隊尾部（不搶）      │   │
  │  │  等待佇列：T3 → T4 → T5                      │   │
  │  └──────────────────────────────────────────────┘   │
  │                                                     │
  │  ✅ 優點：無飢餓，等待時間可預期                    │
  │  ❌ 缺點：每次都要喚醒掛起執行緒（吞吐較低）        │
  └─────────────────────────────────────────────────────┘

  非公平鎖（Non-Fair Lock）— 先搶再排
  ┌─────────────────────────────────────────────────────┐
  │                                                     │
  │  等待佇列：  T2 → T3 → T4（已在等待）              │
  │                                                     │
  │  T1 釋放鎖                                          │
  │       │                                             │
  │       ▼ 喚醒佇列頭部 T2，同時...                   │
  │                                                     │
  │  此時 T5 剛好到達：                                  │
  │  ┌──────────────────────────────────────────────┐   │
  │  │  T5 先嘗試 CAS(state, 0, 1)                  │   │
  │  │  若 CAS 成功 → T5 直接獲取！（T2 繼續等）    │   │
  │  │  若 CAS 失敗 → T5 才入隊尾部                 │   │
  │  └──────────────────────────────────────────────┘   │
  │                                                     │
  │  ✅ 優點：減少上下文切換（T5 不必 park/unpark）     │
  │  ❌ 缺點：佇列中的執行緒可能被後來者插隊（飢餓）    │
  └─────────────────────────────────────────────────────┘

  效能對比：
  非公平鎖吞吐量通常比公平鎖高 2~10 倍（視競爭程度）
  ReentrantLock 預設是非公平鎖
```

公平降低飢餓但吞吐可能較低；非公平吞吐高但可能插隊。

## 9.3 悲觀與樂觀（對應 9.3.1~9.3.4）

<!-- subsection-diagram -->
### 本小節示意圖

```text
  悲觀鎖 vs 樂觀鎖（CAS）流程對比
  ════════════════════════════════════════════════════════

  悲觀鎖（Pessimistic Lock）— 假設衝突必然發生
  ┌─────────────────────────────────────────────────────┐
  │                                                     │
  │  ┌──────────┐                                       │
  │  │  lock()  │← 先鎖定資源（阻塞其他執行緒）        │
  │  └────┬─────┘                                       │
  │       │                                             │
  │       ▼                                             │
  │  ┌──────────┐                                       │
  │  │ read data│← 讀取資料（安全，因為已鎖定）         │
  │  └────┬─────┘                                       │
  │       │                                             │
  │       ▼                                             │
  │  ┌──────────┐                                       │
  │  │write data│← 修改資料                             │
  │  └────┬─────┘                                       │
  │       │                                             │
  │       ▼                                             │
  │  ┌──────────┐                                       │
  │  │ unlock() │← 釋放鎖                               │
  │  └──────────┘                                       │
  │                                                     │
  │  適用：衝突頻率高、臨界區長、寫操作多               │
  └─────────────────────────────────────────────────────┘

  樂觀鎖（Optimistic Lock）— 假設衝突很少，先做再驗
  ┌─────────────────────────────────────────────────────┐
  │                                                     │
  │  ┌─────────────────────┐                            │
  │  │ read data + version │← 讀值 + 記版本號（無鎖）  │
  │  └──────────┬──────────┘                            │
  │             │                                       │
  │             ▼                                       │
  │  ┌─────────────────────┐                            │
  │  │    compute new val  │← 計算新值（無鎖執行）      │
  │  └──────────┬──────────┘                            │
  │             │                                       │
  │             ▼                                       │
  │  ┌──────────────────────────────────────────────┐  │
  │  │  CAS(addr, old_val, new_val)                 │  │
  │  │      ── 且 ──                                │  │
  │  │  version 比較（version == old_version）      │  │
  │  └────────────────┬─────────────────────────────┘  │
  │                   │                                 │
  │          ┌────────┴────────┐                        │
  │          ▼                 ▼                        │
  │    CAS 成功              CAS 失敗（有衝突）         │
  │    version++             重新 read + retry          │
  │    操作完成              ↑─────────────────────┘   │
  │                                                     │
  │  適用：衝突頻率低、臨界區短、讀操作多               │
  └─────────────────────────────────────────────────────┘
```

衝突高用悲觀鎖，衝突低可走 CAS/版本號。

## 9.4 可中斷（對應 9.4.1~9.4.4）

<!-- subsection-diagram -->
### 本小節示意圖

```text
  可中斷等待 vs 不可中斷等待對比
  ════════════════════════════════════════════════════════

  lock()：不可中斷（忽略 interrupt）
  ┌──────────────────────────────────────────────────────┐
  │                                                      │
  │  Thread T_wait                    Thread T_other     │
  │  ──────────────                   ──────────────     │
  │  lock()（鎖被佔用）                                  │
  │  park()...（掛起等待）                               │
  │                        ──────►   T_wait.interrupt()  │
  │  中斷標記設為 true                                   │
  │  但 lock() 繼續等待！                                │
  │  ⚠ 不拋異常，繼續 park                             │
  │  直到鎖釋放才 unpark                                │
  │  獲取鎖後才能檢查中斷標記                           │
  │                                                      │
  └──────────────────────────────────────────────────────┘

  lockInterruptibly()：可中斷
  ┌──────────────────────────────────────────────────────┐
  │                                                      │
  │  Thread T_wait                    Thread T_other     │
  │  ──────────────                   ──────────────     │
  │  lockInterruptibly()                                 │
  │  （鎖被佔用）進入等待佇列                            │
  │  parkInterruptibly()...                              │
  │                        ──────►   T_wait.interrupt()  │
  │  ↓ 被喚醒（因 interrupt）                           │
  │  拋出 InterruptedException ←───────────────────────  │
  │  從等待佇列移除                                      │
  │  執行緒可以執行取消/清理邏輯                         │
  │                                                      │
  │  使用場景：可取消的任務、避免死鎖、實作超時          │
  └──────────────────────────────────────────────────────┘
```

等待鎖時可取消，避免永久卡死。

## 9.5 獨占/共享（對應 9.5.1~9.5.4）

<!-- subsection-diagram -->
### 本小節示意圖

```text
  獨占鎖 vs 共享鎖 相容矩陣
  ════════════════════════════════════════════════════════

  ┌──────────────────────┬────────────────┬──────────────┐
  │                      │  持有讀鎖中    │  持有寫鎖中  │
  ├──────────────────────┼────────────────┼──────────────┤
  │  新執行緒申請讀鎖     │  ✅ 允許（共享）│  ❌ 阻塞    │
  ├──────────────────────┼────────────────┼──────────────┤
  │  新執行緒申請寫鎖     │  ❌ 阻塞       │  ❌ 阻塞    │
  └──────────────────────┴────────────────┴──────────────┘

  說明：
  ┌─────────────────────────────────────────────────────┐
  │  讀鎖（共享）：                                     │
  │  • 多個執行緒可同時持有讀鎖                         │
  │  • 適合唯讀操作，不修改資料                         │
  │  • 相容性：讀-讀 允許 / 讀-寫 不允許               │
  │                                                     │
  │  寫鎖（獨占）：                                     │
  │  • 只有一個執行緒可持有寫鎖                         │
  │  • 持有期間排斥所有讀鎖和寫鎖                       │
  │  • 相容性：寫-讀 不允許 / 寫-寫 不允許             │
  │                                                     │
  │  AQS state 編碼（ReadWriteLock）：                  │
  │  ┌────────────────────────────────────────────┐     │
  │  │  32-bit state                              │     │
  │  │  高 16 位：讀鎖計數（讀者數量）            │     │
  │  │  低 16 位：寫鎖計數（重入次數）            │     │
  │  └────────────────────────────────────────────┘     │
  └─────────────────────────────────────────────────────┘
```

不同資源特性選不同模型。

## 9.6 可重入（對應 9.6.1~9.6.2）

<!-- subsection-diagram -->
### 本小節示意圖

```text
  可重入鎖（Reentrant Lock）計數器機制
  ════════════════════════════════════════════════════════

  場景：T1 持有鎖後呼叫遞迴方法，需要再次獲取同一把鎖

  ┌──────────────────────────────────────────────────────┐
  │  Thread T1                          state 計數器     │
  │  ──────────────────                 ─────────────    │
  │                                                      │
  │  1. lock()                          state = 0        │
  │     CAS(state, 0, 1) 成功           state = 1        │
  │     owner = T1                                       │
  │     ↓                                                │
  │  2. 呼叫 methodA()                                   │
  │     ↓                                                │
  │  3. lock()（重入）                  state = 1        │
  │     owner == T1（自己）→ 直接重入   state = 2        │
  │     recursions++                                     │
  │     ↓                                                │
  │  4. 呼叫 methodB()（繼續重入）                       │
  │     lock()                          state = 2        │
  │     owner == T1 → 直接重入          state = 3        │
  │     ↓                                                │
  │  5. methodB 完成                                     │
  │     unlock()                        state = 3        │
  │     recursions--                    state = 2        │
  │     ↓                                                │
  │  6. methodA 完成                                     │
  │     unlock()                        state = 2        │
  │     recursions--                    state = 1        │
  │     ↓                                                │
  │  7. 最外層完成                                       │
  │     unlock()                        state = 1        │
  │     state = 0，owner = null         state = 0 ✅     │
  │     喚醒等待的執行緒                                  │
  │                                                      │
  │  ⚠ 若不可重入：步驟 3 會死鎖（等自己釋放鎖）        │
  └──────────────────────────────────────────────────────┘
```

同執行緒可重複拿同一把鎖，靠計數器解決遞迴鎖死。

## 9.7 讀寫鎖（對應 9.7.1~9.7.6）

<!-- subsection-diagram -->
### 本小節示意圖

```text
  讀寫鎖時間軸示意
  ════════════════════════════════════════════════════════

  時間軸（從左到右）：
  ─────────────────────────────────────────────────────►

  R1: ████████████████████████                  ← 讀者1
  R2:       ████████████████████████            ← 讀者2（與R1並發）
  R3:             ████████████████████████      ← 讀者3（與R1/R2並發）

  W1:                              ░░░░░░████   ← 寫者1（等待R1/R2/R3結束）
                                   等待  ↑ 進入臨界區

  R4: （W1 等待期間到來）          ░░░░░░░░████ ← 可能被 W1 擋住（防寫者飢餓）
  R5:                                    ░░░████← W1 完成後 R4/R5 可進入

  規則：
  ┌─────────────────────────────────────────────────────┐
  │  ✅ 多個讀者同時進入（無寫者時）                    │
  │  ✅ 寫者獨占（進入時排除所有讀者和其他寫者）        │
  │  ⚠  寫者等待所有現有讀者完成才能進入               │
  │  ⚠  有等待寫者時，新讀者可能被阻止（防飢餓策略）   │
  └─────────────────────────────────────────────────────┘

  狀態轉換：
  ┌────────────────┬───────────────┬──────────────────────┐
  │  當前狀態      │ 申請讀鎖      │ 申請寫鎖             │
  ├────────────────┼───────────────┼──────────────────────┤
  │  無鎖          │ 立即獲取      │ 立即獲取             │
  │  讀鎖（1+個）  │ 立即獲取      │ 阻塞等待所有讀者退出 │
  │  寫鎖（1個）   │ 阻塞等待      │ 阻塞（除非重入）     │
  └────────────────┴───────────────┴──────────────────────┘
```

讀多寫少場景常見，讀可併發、寫需獨占。

## 9.8 park/unpark（對應 9.8.1~9.8.2）

<!-- subsection-diagram -->
### 本小節示意圖

```text
  LockSupport.park / unpark 原語
  ════════════════════════════════════════════════════════

  執行緒狀態轉換：

  Thread T
  ─────────────────────────────────────────────────────
  RUNNABLE
      │
      │ LockSupport.park()
      ▼
  WAITING ← 執行緒掛起，不消耗 CPU
  （操作系統層面：futex/pthread_cond_wait）
      │
      │ LockSupport.unpark(T)  ← 任意執行緒可呼叫
      ▼
  RUNNABLE ← 繼續執行 park() 之後的程式碼

  park / unpark 特殊語義（permit 模型）：
  ┌─────────────────────────────────────────────────────┐
  │  每個執行緒有一個「permit」（0 或 1）               │
  │                                                     │
  │  unpark(T)：                                        │
  │  • 若 T 在等待 → 立即喚醒 T，permit 保持 0         │
  │  • 若 T 未等待 → permit 設為 1（預存）              │
  │                                                     │
  │  park()：                                           │
  │  • 若 permit = 1 → 立即返回（消耗 permit 設為 0）  │
  │  • 若 permit = 0 → 掛起等待                        │
  │                                                     │
  │  結果：unpark 可以在 park 之前呼叫，不會丟失喚醒信號│
  └─────────────────────────────────────────────────────┘

  與 wait/notify 對比：
  ┌───────────────────┬─────────────────┬───────────────┐
  │ 特性              │ wait/notify     │ park/unpark   │
  ├───────────────────┼─────────────────┼───────────────┤
  │ 需要鎖            │ 是（必須在      │ 否（任何地方  │
  │                   │ synchronized 中）│ 都可呼叫）    │
  │ 喚醒特定執行緒    │ 否（notify 隨機）│ 是（指定 T）  │
  │ 先喚醒後等待      │ 信號丟失        │ permit 保存   │
  │ 虛假喚醒         │ 需要 while 迴圈 │ 也需要檢查    │
  └───────────────────┴─────────────────┴───────────────┘
```

底層掛起/喚醒原語。

## 示意圖

```text
讀寫鎖:
Readers: R1 R2 R3 可同時進
Writer : W 需要獨占，等所有 Reader 離開
```

## 跨語言完整範例

主題：讀寫鎖保護 map（3 個 reader 並發讀，1 個 writer 定期寫）

### C（pthread_rwlock）

```c
// 編譯：gcc -std=c11 -pthread -o ch09_c ch09.c
#include <pthread.h>
#include <stdio.h>
#include <unistd.h>

#define READERS 3

static int shared_data = 0;
static pthread_rwlock_t rwlock = PTHREAD_RWLOCK_INITIALIZER;

void *reader(void *arg) {
    int id = *(int *)arg;
    for (int i = 0; i < 3; i++) {
        pthread_rwlock_rdlock(&rwlock);       // 讀鎖（多讀者可並發）
        printf("reader %d: data = %d\n", id, shared_data);
        usleep(20000);
        pthread_rwlock_unlock(&rwlock);
        usleep(10000);
    }
    return NULL;
}

void *writer(void *arg) {
    for (int i = 1; i <= 3; i++) {
        usleep(30000);
        pthread_rwlock_wrlock(&rwlock);       // 寫鎖（獨占）
        shared_data = i * 10;
        printf("writer: data set to %d\n", shared_data);
        pthread_rwlock_unlock(&rwlock);
    }
    return NULL;
}

int main(void) {
    pthread_t readers[READERS], wr;
    int ids[READERS];
    for (int i = 0; i < READERS; i++) {
        ids[i] = i;
        pthread_create(&readers[i], NULL, reader, &ids[i]);
    }
    pthread_create(&wr, NULL, writer, NULL);
    for (int i = 0; i < READERS; i++) pthread_join(readers[i], NULL);
    pthread_join(wr, NULL);
    pthread_rwlock_destroy(&rwlock);
    return 0;
}
```

### C++（std::shared_mutex）

```cpp
// 編譯：g++ -std=c++17 -pthread -o ch09_cpp ch09.cpp
#include <shared_mutex>
#include <thread>
#include <chrono>
#include <iostream>
#include <vector>

static int shared_data = 0;
static std::shared_mutex rw;

void reader(int id) {
    for (int i = 0; i < 3; i++) {
        std::shared_lock lock(rw);            // 共享讀鎖
        std::cout << "reader " << id << ": data = " << shared_data << "\n";
        std::this_thread::sleep_for(std::chrono::milliseconds(20));
    }
}

void writer() {
    for (int i = 1; i <= 3; i++) {
        std::this_thread::sleep_for(std::chrono::milliseconds(30));
        std::unique_lock lock(rw);            // 獨占寫鎖
        shared_data = i * 10;
        std::cout << "writer: data set to " << shared_data << "\n";
    }
}

int main() {
    std::vector<std::thread> threads;
    for (int i = 0; i < 3; i++)
        threads.emplace_back(reader, i);
    threads.emplace_back(writer);
    for (auto &t : threads) t.join();
}
```

### Rust（RwLock<i32>）

```rust
// 執行：cargo run 或 rustc ch09.rs && ./ch09
use std::sync::{Arc, RwLock};
use std::thread;
use std::time::Duration;

fn main() {
    let data = Arc::new(RwLock::new(0i32));
    let mut handles = Vec::new();

    // 3 個讀者
    for id in 0..3 {
        let data = Arc::clone(&data);
        handles.push(thread::spawn(move || {
            for _ in 0..3 {
                let val = data.read().unwrap();  // 共享讀鎖
                println!("reader {}: data = {}", id, *val);
                drop(val);
                thread::sleep(Duration::from_millis(10));
            }
        }));
    }

    // 1 個寫者
    let data = Arc::clone(&data);
    handles.push(thread::spawn(move || {
        for i in 1..=3 {
            thread::sleep(Duration::from_millis(30));
            *data.write().unwrap() = i * 10;    // 獨占寫鎖
            println!("writer: data set to {}", i * 10);
        }
    }));

    for h in handles { h.join().unwrap(); }
}
```

### Go（sync.RWMutex）

```go
// 執行：go run ch09.go
package main

import (
	"fmt"
	"sync"
	"time"
)

var (
	sharedData int
	rw         sync.RWMutex
)

func reader(id int, wg *sync.WaitGroup) {
	defer wg.Done()
	for i := 0; i < 3; i++ {
		rw.RLock()                              // 共享讀鎖
		fmt.Printf("reader %d: data = %d\n", id, sharedData)
		time.Sleep(20 * time.Millisecond)
		rw.RUnlock()
		time.Sleep(10 * time.Millisecond)
	}
}

func writer(wg *sync.WaitGroup) {
	defer wg.Done()
	for i := 1; i <= 3; i++ {
		time.Sleep(30 * time.Millisecond)
		rw.Lock()                               // 獨占寫鎖
		sharedData = i * 10
		fmt.Printf("writer: data set to %d\n", sharedData)
		rw.Unlock()
	}
}

func main() {
	var wg sync.WaitGroup
	for i := 0; i < 3; i++ {
		wg.Add(1)
		go reader(i, &wg)
	}
	wg.Add(1)
	go writer(&wg)
	wg.Wait()
}
```

### Python（threading.RLock + 手動讀寫鎖）

```python
# 執行：python3 ch09.py
import threading
import time

shared_data = 0
rw = threading.Lock()          # 寫者用
read_count = 0
read_count_lock = threading.Lock()

def reader(reader_id):
    global read_count
    for _ in range(3):
        with read_count_lock:
            read_count += 1
            if read_count == 1:
                rw.acquire()   # 第一個讀者鎖定寫者
        print(f"reader {reader_id}: data = {shared_data}")
        time.sleep(0.02)
        with read_count_lock:
            read_count -= 1
            if read_count == 0:
                rw.release()   # 最後一個讀者釋放寫者鎖

def writer():
    global shared_data
    for i in range(1, 4):
        time.sleep(0.03)
        with rw:               # 獨占寫鎖
            shared_data = i * 10
            print(f"writer: data set to {shared_data}")

if __name__ == "__main__":
    ts = [threading.Thread(target=reader, args=(i,)) for i in range(3)]
    ts.append(threading.Thread(target=writer))
    for t in ts: t.start()
    for t in ts: t.join()
```

## 完整專案級範例（Python）

檔案：`examples/python/ch09.py`

```bash
python3 examples/python/ch09.py
```

```python
"""Chapter 09: lock family (Lock/RLock/Condition)."""
import threading

rlock = threading.RLock()
cond = threading.Condition(rlock)
ready = False


def producer():
    global ready
    with rlock:
        ready = True
        cond.notify_all()


def consumer():
    with rlock:
        while not ready:
            cond.wait()
        print("consumer got signal")


if __name__ == "__main__":
    t1 = threading.Thread(target=consumer)
    t2 = threading.Thread(target=producer)
    t1.start(); t2.start(); t1.join(); t2.join()
```
