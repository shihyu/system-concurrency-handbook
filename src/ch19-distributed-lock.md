# 第19章 分散式鎖架構

## 19.1 為什麼需要分散式鎖

<!-- subsection-diagram -->
### 本小節示意圖

```text
單節點 vs 多節點鎖的邊界

  ─── 單節點（JVM Mutex 夠用）─────────────────────────────────

  ┌──────────────────────────────────────┐
  │           App Instance               │
  │                                      │
  │  Thread A ──┐                        │
  │             ├─► [JVM Mutex] ─► DB    │
  │  Thread B ──┘                        │
  │   (等待)                             │
  └──────────────────────────────────────┘
  ✓ 同一 JVM 內，mutex 可保護共享資源

  ─── 多節點（JVM Mutex 失效）────────────────────────────────

  ┌─────────────────────┐       ┌─────────────────────┐
  │   App Instance 1    │       │   App Instance 2    │
  │                     │       │                     │
  │  [JVM Lock A]       │       │  [JVM Lock B]       │
  │  ↑ 只保護本 JVM     │       │  ↑ 只保護本 JVM     │
  └──────────┬──────────┘       └──────────┬──────────┘
             │                             │
             │ 都能同時存取                 │
             ▼                             ▼
  ┌──────────────────────────────────────────────────────┐
  │              共享資源：DB / Redis / 文件              │
  │                                                      │
  │  Lock A 和 Lock B 互不可見 → 兩個實例同時操作 → 競態│
  └──────────────────────────────────────────────────────┘

  ✗ 跨 JVM / 跨進程 / 跨機器 → 需要分散式鎖

  ─── 分散式鎖解法 ────────────────────────────────────────────

  ┌─────────────────────┐       ┌─────────────────────┐
  │   App Instance 1    │       │   App Instance 2    │
  └──────────┬──────────┘       └──────────┬──────────┘
             │                             │
             │ 先搶鎖                       │ 搶鎖失敗，等待
             ▼                             ▼
  ┌──────────────────────────────────────────────────────┐
  │           Redis / ZooKeeper（分散式鎖服務）           │
  │                                                      │
  │   lock:order = "instance-1-uuid"  TTL=10s           │
  └──────────────────────────────────────────────────────┘
             │ 持有鎖
             ▼
  ┌──────────────────────────────────────────────────────┐
  │                    共享資源：DB                       │
  └──────────────────────────────────────────────────────┘
```

單機鎖只能管單進程，服務多副本時會失效。

## 19.2 超賣案例（對應 19.2.1~19.2.2）

<!-- subsection-diagram -->
### 本小節示意圖

```text
read-modify-write 競態導致超賣

  時間軸 ──────────────────────────────────────────────────────►
           T+0      T+1      T+2      T+3      T+4      T+5

  App1    [讀 stock]                  [扣減]   [寫 stock=0]
           stock=1                    stock=1-1=0

  App2              [讀 stock]                  [扣減]   [寫 stock=-1]
                     stock=1                    stock=1-1=0
                     ↑ 讀到舊值！                ↑ 再次扣減 → 超賣！

  ┌──────────────────────────────────────────────────────────┐
  │  問題根源：Read-Modify-Write 非原子                       │
  │                                                          │
  │  Step 1: stock = DB.read("stock_001")   → stock = 1     │
  │  Step 2: if stock > 0: stock -= 1       → stock = 0     │
  │  Step 3: DB.write("stock_001", stock)   → stock = 0     │
  │                                                          │
  │  兩個 App 在 Step 1 和 Step 3 之間沒有互斥               │
  │  → 都讀到 stock=1 → 都認為可以扣減 → stock 變 -1        │
  └──────────────────────────────────────────────────────────┘

  正確做法：加分散式鎖後

  App1    [取鎖 ✓][讀 stock=1][扣減][寫 stock=0][釋放鎖]
  App2    [等鎖─────────────────────────────][取鎖][讀 stock=0][售罄]

  結果：stock = 0（正確），不超賣
```

多節點同時扣庫存，若無跨節點互斥，庫存會變負數。

## 19.3 JVM 本地鎖邊界（對應 19.3.1~19.3.2）

<!-- subsection-diagram -->
### 本小節示意圖

```text
JVM 本地鎖的可見範圍邊界

  ┌──────────────────────────────────────────────────────────────┐
  │  機器 A                                                       │
  │  ┌────────────────────────────────────────────────────────┐  │
  │  │  App Instance 1 (JVM)                                  │  │
  │  │                                                        │  │
  │  │  synchronized(lockObj) { ... }  ← JVM 鎖               │  │
  │  │  ┌──────────────────────────┐                          │  │
  │  │  │  Thread Pool             │                          │  │
  │  │  │  T1 ──┐                  │                          │  │
  │  │  │       ├─► [JVM Lock] ✓  │                          │  │
  │  │  │  T2 ──┘                  │                          │  │
  │  │  └──────────────────────────┘                          │  │
  │  └────────────────────────────────────────────────────────┘  │
  └──────────────────────────────────────────────────────────────┘
                      │ JVM Lock 邊界到此為止
                      │ 鎖的狀態不會跨越這條線
  ─ ─ ─ ─ ─ ─ ─ ─ ─ ─│─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─
  網路                 │
  ┌────────────────────▼─────────────────────────────────────────┐
  │  機器 B                                                       │
  │  ┌────────────────────────────────────────────────────────┐  │
  │  │  App Instance 2 (JVM)                                  │  │
  │  │                                                        │  │
  │  │  synchronized(lockObj) { ... }  ← 完全獨立的 JVM 鎖   │  │
  │  │  ↑ 和機器A的鎖物件不同，互不可見                       │  │
  │  └────────────────────────────────────────────────────────┘  │
  └──────────────────────────────────────────────────────────────┘
                      │
                      ▼
  ┌──────────────────────────────────────────────────────────────┐
  │  共享資源：MySQL / Redis                                      │
  │  兩個 App 可以同時操作 → 競態！                              │
  └──────────────────────────────────────────────────────────────┘

  結論：synchronized 只在同 JVM 內有效，
        水平擴展後必須用外部分散式鎖。
```

`synchronized` 只在同 JVM 內有效。

## 19.4 分散式鎖要求（對應 19.4.1~19.4.2）

<!-- subsection-diagram -->
### 本小節示意圖

```text
分散式鎖五大需求與實現挑戰

  ┌──────────────────────────────────────────────────────────────┐
  │  需求 1：互斥性（Mutual Exclusion）                           │
  │  同一時刻只有一個客戶端持有鎖                                │
  │  實現：Redis SET NX（Not Exist）原子指令                     │
  │  挑戰：網路分區時可能出現兩個持有者                          │
  └──────────────────────────────────────────────────────────────┘

  ┌──────────────────────────────────────────────────────────────┐
  │  需求 2：不死鎖（No Deadlock）                                │
  │  持鎖客戶端崩潰後，鎖必須自動釋放                            │
  │  實現：TTL 自動過期（SET NX PX 10000）                       │
  │  挑戰：TTL 設定多長？太短 → 任務未完鎖已過期                │
  └──────────────────────────────────────────────────────────────┘

  ┌──────────────────────────────────────────────────────────────┐
  │  需求 3：可重入（Reentrancy）                                 │
  │  同一客戶端可多次獲取同一把鎖                                │
  │  實現：鎖值包含 clientID，每次重入計數                       │
  │  挑戰：需要 Lua 腳本保證 check-increment 原子性              │
  └──────────────────────────────────────────────────────────────┘

  ┌──────────────────────────────────────────────────────────────┐
  │  需求 4：高可用（High Availability）                          │
  │  鎖服務本身不能是單點                                        │
  │  實現：Redis Sentinel / Cluster；ZooKeeper Quorum            │
  │  挑戰：主從切換窗口期可能導致鎖丟失                          │
  └──────────────────────────────────────────────────────────────┘

  ┌──────────────────────────────────────────────────────────────┐
  │  需求 5：可續租（Watchdog / Lease Renewal）                   │
  │  任務執行時間超過 TTL 時，自動延長鎖的生命週期               │
  │  實現：後台執行緒定期 EXPIRE key new_ttl                     │
  │  挑戰：續租執行緒本身崩潰 → 鎖不再續租 → 自然過期           │
  └──────────────────────────────────────────────────────────────┘

  各需求依賴關係：
  互斥 ──► NX 指令
  不死鎖 ──► TTL
  誤刪保護 ──► UUID value
  可重入 ──► Lua 原子 check-increment
  可續租 ──► Watchdog 執行緒
```

- 互斥
- 可釋放（不死鎖）
- 故障可恢復
- 最好可重入/可續租

## 19.5 AP/CP 取捨（對應 19.5.1~19.5.4）

<!-- subsection-diagram -->
### 本小節示意圖

```text
CAP 定理與分散式鎖選型

           一致性 (C)
              ▲
              │
              │   CP 區域
              │   ZooKeeper ●
              │   etcd      ●
              │
              │
  ────────────┼────────────────────► 可用性 (A)
              │
              │   AP 區域
              │              ● Redis (主從)
              │              ● Redis Cluster
              │
  (P = 分區容忍，實際分散式系統必須接受 P)

  ─── Redis (偏 AP) ──────────────────────────────────────────

  優點：
  ・極高吞吐（單機 10萬+ QPS）
  ・低延遲（sub-millisecond）
  ・部署簡單

  弱點：
  ・主從複製非同步 → 主節點掛掉切換期間，新主可能無鎖記錄
  ・Cluster 模式 → SET NX 無法跨 slot 原子操作
  ・Redlock 演算法有爭議（時鐘漂移問題）

  適用：電商庫存、快取更新、冪等控制等容忍極短暫鎖丟失的場景

  ─── ZooKeeper (偏 CP) ──────────────────────────────────────

  優點：
  ・強一致性（Zab 協議 Quorum 提交）
  ・臨時節點 + Watcher 天然支援鎖失效通知
  ・公平鎖（順序節點）

  弱點：
  ・寫入延遲高（需要多數節點確認）
  ・單機 QPS 約 1 萬（vs Redis 10 萬+）
  ・ZooKeeper 本身是有狀態的複雜系統

  適用：金融交易、配置管理、Leader 選舉等強一致性要求的場景

  ┌─────────────────────────────────────────────────────────┐
  │  選型建議：                                              │
  │  ・高吞吐 + 可接受極短暫不一致 → Redis                 │
  │  ・強一致 + 低吞吐可接受     → ZooKeeper / etcd        │
  └─────────────────────────────────────────────────────────┘
```

Redis 常偏 AP；ZooKeeper 常偏 CP。

## 19.6 Redis 鎖演進（對應 19.6.1~19.6.12）

<!-- subsection-diagram -->
### 本小節示意圖

```text
Redis 分散式鎖四代演進

  ─────────────────────────────────────────────────────────────
  V1：SET NX（最簡版）
  ─────────────────────────────────────────────────────────────

  SET lock_key 1 NX
       │
       ▼
  ✓ 獲得鎖
  DEL lock_key  ← 崩潰時沒執行 → 鎖永久存在 → 死鎖！

  問題：無 TTL，崩潰後永不釋放

  ─────────────────────────────────────────────────────────────
  V2：SET NX PX ttl（加 TTL）
  ─────────────────────────────────────────────────────────────

  SET lock_key 1 NX PX 10000
       │
       ▼
  ✓ 獲得鎖（10秒後自動過期）
  DEL lock_key  ← 若任務執行時間 > 10s，鎖已被其他人拿走
                  此時 DEL 刪掉別人的鎖！→ 誤刪！

  問題：鎖的 value 沒有身份，誰都可以刪

  ─────────────────────────────────────────────────────────────
  V3：SET NX PX + Lua 原子 check-delete（加身份驗證）
  ─────────────────────────────────────────────────────────────

  SET lock_key {uuid} NX PX 10000
       │
       ▼
  ✓ 獲得鎖
  解鎖時執行 Lua 腳本（原子）：
  ┌────────────────────────────────────────────┐
  │  if redis.call('GET', key) == uuid then   │
  │      return redis.call('DEL', key)         │
  │  else                                      │
  │      return 0  -- 不是我的鎖，不刪          │
  │  end                                       │
  └────────────────────────────────────────────┘

  問題：任務執行超過 TTL → 鎖過期 → 他人取鎖 → 兩個持有者！

  ─────────────────────────────────────────────────────────────
  V4：Lua + Watchdog 續租（完整版）
  ─────────────────────────────────────────────────────────────

  ┌──────────────────────────────────────────────────────────┐
  │                                                          │
  │  主執行緒                   Watchdog 執行緒               │
  │  ──────────────────────     ────────────────────────     │
  │  SET lock {uuid} NX PX 30s                               │
  │  開始執行業務邏輯 ─────────► 每 10s 執行：               │
  │                             EXPIRE lock 30s (續租)       │
  │  業務完成                   ↑ 確保鎖不過期               │
  │  Lua check-delete ─────────► Watchdog 停止               │
  │                                                          │
  │  若主執行緒崩潰：                                         │
  │  Watchdog 也停止 → 鎖 TTL 自然倒數 → 30s 後自動釋放    │
  └──────────────────────────────────────────────────────────┘

  演進總結：
  ┌──────┬──────────────────┬──────────────────────────────┐
  │  版本 │  解決的問題       │  引入的問題                  │
  ├──────┼──────────────────┼──────────────────────────────┤
  │  V1  │  互斥            │  崩潰 → 死鎖                  │
  │  V2  │  死鎖（TTL）      │  誤刪他人的鎖                 │
  │  V3  │  誤刪（UUID+Lua） │  任務超時鎖過期               │
  │  V4  │  超時（Watchdog） │  Watchdog 複雜度增加          │
  └──────┴──────────────────┴──────────────────────────────┘
```

1. `SET key val NX PX ttl`
2. `finally` 解鎖
3. 用 Lua 比對 value 再刪（防誤刪）
4. 看門狗續租（避免任務未完鎖先過期）

```text
ClientA set lock=uuidA ttl=10s
ClientB 不能覆蓋
unlock 必須檢查 value==uuidA
```

## 示意圖

```text
App1 --SET NX PX--> Redis(lock:order)
App2 --SET NX PX--> fail (已被占用)
App1 --Lua check value then del--> unlock
```

## 跨語言完整範例

### C — MockRedis 模擬 SET NX PX + Lua check-delete

```c
#include <stdio.h>
#include <string.h>
#include <time.h>
#include <pthread.h>

#define KEY_MAX 64
#define VAL_MAX 64

typedef struct {
    char key[KEY_MAX];
    char val[VAL_MAX];
    long expire_ms;        /* UNIX 毫秒時間戳，0 表示無記錄 */
    int  used;
} RedisEntry;

#define STORE_SIZE 16
static RedisEntry store[STORE_SIZE];
static pthread_mutex_t store_mu = PTHREAD_MUTEX_INITIALIZER;

static long now_ms(void) {
    struct timespec ts;
    clock_gettime(CLOCK_MONOTONIC, &ts);
    return ts.tv_sec * 1000L + ts.tv_nsec / 1000000L;
}

/* SET key val NX PX ttl → 1: 成功, 0: 已存在 */
int redis_set_nx_px(const char *key, const char *val, int ttl_ms) {
    pthread_mutex_lock(&store_mu);
    long now = now_ms();
    int slot = -1;
    for (int i = 0; i < STORE_SIZE; i++) {
        if (store[i].used && strcmp(store[i].key, key) == 0) {
            if (store[i].expire_ms > now) { /* 鎖仍有效 */
                pthread_mutex_unlock(&store_mu);
                return 0;
            }
            slot = i;  /* 已過期，可覆蓋 */
            break;
        }
        if (!store[i].used && slot == -1) slot = i;
    }
    if (slot == -1) { pthread_mutex_unlock(&store_mu); return 0; }
    strncpy(store[slot].key, key, KEY_MAX - 1);
    strncpy(store[slot].val, val, VAL_MAX - 1);
    store[slot].expire_ms = now + ttl_ms;
    store[slot].used = 1;
    pthread_mutex_unlock(&store_mu);
    return 1;
}

/* Lua: if GET(key)==val then DEL(key) end → 1: 刪成功, 0: 不是自己的鎖 */
int redis_lua_unlock(const char *key, const char *val) {
    pthread_mutex_lock(&store_mu);
    for (int i = 0; i < STORE_SIZE; i++) {
        if (store[i].used && strcmp(store[i].key, key) == 0) {
            if (strcmp(store[i].val, val) == 0) {
                store[i].used = 0;
                pthread_mutex_unlock(&store_mu);
                return 1;
            }
            break;
        }
    }
    pthread_mutex_unlock(&store_mu);
    return 0;
}

int main(void) {
    const char *key = "lock:order";
    const char *uuid_a = "client-A-uuid";
    const char *uuid_b = "client-B-uuid";

    int ok = redis_set_nx_px(key, uuid_a, 10000);
    printf("Client A 加鎖: %s\n", ok ? "成功" : "失敗");

    ok = redis_set_nx_px(key, uuid_b, 10000);
    printf("Client B 加鎖: %s (應為失敗)\n", ok ? "成功" : "失敗");

    /* Client B 嘗試刪 Client A 的鎖 → 應失敗 */
    ok = redis_lua_unlock(key, uuid_b);
    printf("Client B 解鎖: %s (應為失敗)\n", ok ? "成功" : "失敗");

    ok = redis_lua_unlock(key, uuid_a);
    printf("Client A 解鎖: %s (應為成功)\n", ok ? "成功" : "失敗");

    ok = redis_set_nx_px(key, uuid_b, 10000);
    printf("Client B 再次加鎖: %s (應為成功)\n", ok ? "成功" : "失敗");
    return 0;
}
```

### C++ — MockRedis SET NX PX + Lua check-delete

```cpp
#include <iostream>
#include <unordered_map>
#include <mutex>
#include <chrono>
#include <string>

class MockRedis {
    struct Entry { std::string val; long long expire_ms; };
    std::unordered_map<std::string, Entry> store_;
    std::mutex mu_;

    long long now_ms() {
        using namespace std::chrono;
        return duration_cast<milliseconds>(
            steady_clock::now().time_since_epoch()).count();
    }
public:
    bool set_nx_px(const std::string &key, const std::string &val, int ttl_ms) {
        std::lock_guard<std::mutex> lk(mu_);
        auto it = store_.find(key);
        if (it != store_.end() && it->second.expire_ms > now_ms())
            return false;
        store_[key] = {val, now_ms() + ttl_ms};
        return true;
    }
    bool lua_unlock(const std::string &key, const std::string &val) {
        std::lock_guard<std::mutex> lk(mu_);
        auto it = store_.find(key);
        if (it != store_.end() && it->second.val == val) {
            store_.erase(it);
            return true;
        }
        return false;
    }
};

int main() {
    MockRedis redis;
    std::string key = "lock:order";
    std::string uuid_a = "client-A-uuid";
    std::string uuid_b = "client-B-uuid";

    std::cout << "A 加鎖: " << redis.set_nx_px(key, uuid_a, 10000) << "\n";
    std::cout << "B 加鎖: " << redis.set_nx_px(key, uuid_b, 10000)
              << " (應為0)\n";
    std::cout << "B 解鎖: " << redis.lua_unlock(key, uuid_b)
              << " (應為0，誤刪保護生效)\n";
    std::cout << "A 解鎖: " << redis.lua_unlock(key, uuid_a) << "\n";
    std::cout << "B 再加鎖: " << redis.set_nx_px(key, uuid_b, 10000) << "\n";
}
```

### Rust — MockRedis SET NX PX + Lua check-delete

```rust
use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

struct MockRedis {
    store: Mutex<HashMap<String, (String, Instant)>>,
}

impl MockRedis {
    fn new() -> Self {
        MockRedis { store: Mutex::new(HashMap::new()) }
    }
    fn set_nx_px(&self, key: &str, val: &str, ttl_ms: u64) -> bool {
        let mut store = self.store.lock().unwrap();
        if let Some((_, exp)) = store.get(key) {
            if exp.elapsed() < Duration::from_millis(0) {
                return false; // still valid
            }
        }
        let entry = store.entry(key.to_string()).or_insert_with(|| {
            (String::new(), Instant::now())
        });
        if entry.1.elapsed().as_millis() == 0 && !entry.0.is_empty() {
            return false;
        }
        *entry = (val.to_string(), Instant::now() + Duration::from_millis(ttl_ms));
        true
    }
    fn lua_unlock(&self, key: &str, val: &str) -> bool {
        let mut store = self.store.lock().unwrap();
        if let Some((v, _)) = store.get(key) {
            if v == val {
                store.remove(key);
                return true;
            }
        }
        false
    }
}

fn main() {
    let redis = Arc::new(MockRedis::new());
    println!("A 加鎖: {}", redis.set_nx_px("lock:order", "uuid-a", 10000));
    println!("B 加鎖: {} (應為false)", redis.set_nx_px("lock:order", "uuid-b", 10000));
    println!("B 解鎖: {} (應為false，誤刪保護)", redis.lua_unlock("lock:order", "uuid-b"));
    println!("A 解鎖: {}", redis.lua_unlock("lock:order", "uuid-a"));
    println!("B 再加鎖: {}", redis.set_nx_px("lock:order", "uuid-b", 10000));
}
```

### Go — MockRedis SET NX PX + Lua check-delete

```go
package main

import (
    "fmt"
    "sync"
    "time"
)

type entry struct {
    val    string
    expiry time.Time
}

type MockRedis struct {
    mu    sync.Mutex
    store map[string]entry
}

func NewMockRedis() *MockRedis {
    return &MockRedis{store: make(map[string]entry)}
}

func (r *MockRedis) SetNXPX(key, val string, ttl time.Duration) bool {
    r.mu.Lock()
    defer r.mu.Unlock()
    if e, ok := r.store[key]; ok && time.Now().Before(e.expiry) {
        return false
    }
    r.store[key] = entry{val, time.Now().Add(ttl)}
    return true
}

// LuaUnlock 模擬原子 check-delete
func (r *MockRedis) LuaUnlock(key, val string) bool {
    r.mu.Lock()
    defer r.mu.Unlock()
    if e, ok := r.store[key]; ok && e.val == val {
        delete(r.store, key)
        return true
    }
    return false
}

func main() {
    redis := NewMockRedis()
    ttl := 10 * time.Second
    fmt.Println("A 加鎖:", redis.SetNXPX("lock:order", "uuid-a", ttl))
    fmt.Println("B 加鎖:", redis.SetNXPX("lock:order", "uuid-b", ttl), "(應為false)")
    fmt.Println("B 解鎖:", redis.LuaUnlock("lock:order", "uuid-b"), "(應為false，誤刪保護)")
    fmt.Println("A 解鎖:", redis.LuaUnlock("lock:order", "uuid-a"))
    fmt.Println("B 再加鎖:", redis.SetNXPX("lock:order", "uuid-b", ttl))
}
```

### Python — MockRedis SET NX PX + Lua check-delete（多執行緒驗證）

```python
"""Chapter 19: distributed lock protocol — MockRedis NX PX + Lua check-delete."""
import threading
import time
import uuid


class MockRedis:
    """模擬 Redis SET NX PX 與 Lua 原子解鎖。"""

    def __init__(self):
        self._store = {}          # key → (value, expire_time)
        self._mu = threading.Lock()

    def set_nx_px(self, key: str, val: str, ttl_ms: int) -> bool:
        """SET key val NX PX ttl → True: 成功取鎖"""
        deadline = time.monotonic() + ttl_ms / 1000
        with self._mu:
            cur = self._store.get(key)
            if cur and cur[1] > time.monotonic():
                return False       # 鎖仍有效，NX 失敗
            self._store[key] = (val, deadline)
            return True

    def lua_unlock(self, key: str, val: str) -> bool:
        """原子 check-and-delete：只有 value 匹配才刪除"""
        with self._mu:
            cur = self._store.get(key)
            if cur and cur[0] == val:
                del self._store[key]
                return True
            return False           # 不是自己的鎖，拒絕刪除


def acquire_and_work(redis: MockRedis, client_id: str, results: list):
    lock_key = "lock:order"
    token = f"{client_id}:{uuid.uuid4()}"
    ok = redis.set_nx_px(lock_key, token, 3000)
    results.append((client_id, "acquired" if ok else "failed"))
    if ok:
        time.sleep(0.05)          # 模擬業務處理
        released = redis.lua_unlock(lock_key, token)
        results.append((client_id, "released" if released else "release_failed"))


def main():
    redis = MockRedis()

    # 基本流程測試
    uuid_a = "client-A"
    ok = redis.set_nx_px("lock:order", uuid_a, 5000)
    print(f"A 加鎖: {ok}")                          # True
    ok = redis.set_nx_px("lock:order", "client-B", 5000)
    print(f"B 加鎖: {ok} (應為 False)")             # False
    ok = redis.lua_unlock("lock:order", "client-B")
    print(f"B 解鎖: {ok} (應為 False，誤刪保護)")   # False
    ok = redis.lua_unlock("lock:order", uuid_a)
    print(f"A 解鎖: {ok}")                          # True

    # 並發競爭測試
    print("\n並發競爭測試（10 客戶端搶同一把鎖）：")
    results = []
    threads = [
        threading.Thread(target=acquire_and_work,
                         args=(redis, f"client-{i}", results))
        for i in range(10)
    ]
    for t in threads:
        t.start()
    for t in threads:
        t.join()

    acquired = [r for r in results if r[1] == "acquired"]
    print(f"成功取鎖數量: {len(acquired)} (應為 1，互斥保證)")
    assert len(acquired) == 1, "互斥性失敗！"
    print("通過：分散式鎖互斥性正確")


if __name__ == "__main__":
    main()
```

## 完整專案級範例（Python）

檔案：`examples/python/ch19.py`

```bash
python3 examples/python/ch19.py
```

```python
"""Chapter 19: distributed lock protocol (mocked redis)."""
import time


class MockRedis:
    def __init__(self):
        self.store = {}

    def set_nx_px(self, key: str, val: str, ttl_ms: int) -> bool:
        now = time.time() * 1000
        cur = self.store.get(key)
        if cur and cur[1] > now:
            return False
        self.store[key] = (val, now + ttl_ms)
        return True

    def unlock_if_value(self, key: str, val: str) -> bool:
        cur = self.store.get(key)
        if cur and cur[0] == val:
            del self.store[key]
            return True
        return False


if __name__ == "__main__":
    r = MockRedis()
    owner = "uuid-a"
    ok = r.set_nx_px("lock:order", owner, 3000)
    print("lock acquired", ok)
    print("unlock", r.unlock_if_value("lock:order", owner))
```
