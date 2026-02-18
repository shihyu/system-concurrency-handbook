# 第20章 秒殺系統架構

## 20.1 電商基礎架構

<!-- subsection-diagram -->
### 本小節示意圖

```text
電商系統分層架構

  使用者請求
       │
       ▼
  ┌───────────────────────────────────────────────────────┐
  │  接入層                                                │
  │  ┌──────────────┐    ┌──────────────┐                 │
  │  │     CDN      │    │    Nginx     │                 │
  │  │  靜態資源    │    │  反向代理    │                 │
  │  │  快取        │    │  負載均衡    │                 │
  │  └──────────────┘    └──────────────┘                 │
  └────────────────────────────┬──────────────────────────┘
                               │ 動態請求
                               ▼
  ┌───────────────────────────────────────────────────────┐
  │  閘道層                                                │
  │  ┌──────────────┐    ┌──────────────┐                 │
  │  │  限流        │    │  認證/鑑權   │                 │
  │  │  Token Bucket│    │  JWT / Session│                │
  │  └──────────────┘    └──────────────┘                 │
  └────────────────────────────┬──────────────────────────┘
                               │
                               ▼
  ┌───────────────────────────────────────────────────────┐
  │  業務層                                                │
  │  ┌──────────────────┐  ┌──────────────────┐           │
  │  │    訂單服務      │  │    庫存服務      │           │
  │  │  OrderService    │  │  StockService    │           │
  │  │  防重 / 支付     │  │  扣減 / 補償     │           │
  │  └────────┬─────────┘  └────────┬─────────┘           │
  └───────────┼─────────────────────┼─────────────────────┘
              │                     │
              ▼                     ▼
  ┌───────────────────────────────────────────────────────┐
  │  快取層                                                │
  │  ┌──────────────────────────────────────┐             │
  │  │  Redis Cluster                       │             │
  │  │  ・庫存計數（stock:sku:001 = 1000）  │             │
  │  │  ・防重 Token（setnx order:uid）     │             │
  │  │  ・限流計數器                        │             │
  │  └──────────────────────────────────────┘             │
  └────────────────────────────┬──────────────────────────┘
                               │ 讀未命中 / 最終持久化
                               ▼
  ┌───────────────────────────────────────────────────────┐
  │  資料層                                                │
  │  ┌──────────────────────────────────────┐             │
  │  │  MySQL（主從分離）                   │             │
  │  │  ・訂單表 / 庫存表                   │             │
  │  │  ・對賬記錄                          │             │
  │  └──────────────────────────────────────┘             │
  └───────────────────────────────────────────────────────┘
              │                     ↑
              ▼                     │ Consumer 消費
  ┌───────────────────────────────────────────────────────┐
  │  異步層                                                │
  │  ┌──────────────────┐  ┌──────────────────┐           │
  │  │  MQ（Kafka/RMQ） │  │  Consumer Worker │           │
  │  │  削峰平滑流量     │  │  非同步落庫      │           │
  │  └──────────────────┘  └──────────────────┘           │
  └───────────────────────────────────────────────────────┘
```

入口層、業務層、資料層、異步層缺一不可。

## 20.2 秒殺特性（對應 20.2.1~20.2.2）

<!-- subsection-diagram -->
### 本小節示意圖

```text
正常流量 vs 秒殺瞬間流量對比

  QPS
  (萬)
  100 │         ▐█▌
      │         ███
      │         ███
   50 │         ███
      │         ███
      │         ███
   10 │─────────███──────────────────────────────────── 正常基線
    1 │         ███████████████████████
      │         ████████████████████████████
    0 └─────────┼──────────────────────────────────────► 時間
              秒殺   ←── 持續約 5 分鐘 ───►  流量回落
              開始
              T0

  ┌─────────────────────────────────────────────────────────┐
  │  秒殺瞬間特性：                                          │
  │                                                         │
  │  ・流量是平時的 100x（10萬 QPS vs 正常 1000 QPS）       │
  │  ・熱點 key：少數 SKU 被高頻存取（Redis 熱點問題）      │
  │  ・超賣風險：多節點並發扣減同一庫存                     │
  │  ・重複下單：用戶多次點擊「搶購」按鈕                   │
  │  ・容錯窗口極短：5 分鐘內必須解決，無法慢慢修           │
  └─────────────────────────────────────────────────────────┘

  關鍵挑戰：
  ┌─────────────────┬────────────────────────────────────┐
  │  問題            │  應對策略                          │
  ├─────────────────┼────────────────────────────────────┤
  │  熱點 key        │  庫存分段（多個 Redis key 分散）   │
  │  超賣            │  Lua 原子扣減 + 回滾               │
  │  重複下單        │  SETNX 冪等 Token                  │
  │  DB 打爆         │  異步 MQ 削峰                      │
  └─────────────────┴────────────────────────────────────┘
```

高峰值、瞬時流量、熱點資料、低容錯窗口。

## 20.3 活動前中後（對應 20.3.1~20.3.2）

<!-- subsection-diagram -->
### 本小節示意圖

```text
秒殺活動生命週期時間軸

  ─── 活動前（T0 之前）───────────────────────────────────────

  T-24h    T-1h      T-10min   T0（秒殺開始）
    │         │           │         │
    ▼         ▼           ▼         ▼
  [庫存    [壓測       [暖機      [流量
   資料     模擬        Redis      湧入]
   預熱]    100x        庫存]
            流量]                ← 必須在 T0 前完成所有準備

  預熱快取：
  ・提前 SET stock:sku:001 1000（庫存寫入 Redis）
  ・提前載入商品詳情到快取（避免秒殺時打 DB）

  壓測：
  ・使用 wrk/JMeter 模擬 10萬 QPS
  ・確認系統瓶頸、調整連線池/執行緒池

  擴容：
  ・水平擴展應用層（K8s 預先 scale out）
  ・Redis 記憶體確認充裕

  ─── 秒殺進行中（T0 ~ T0+5min）──────────────────────────────

  T0              T0+1min         T0+5min
   │                 │                │
   ▼                 ▼                ▼
  [限流閘道]      [庫存售罄]      [流量回落]
  [MQ 緩衝]       [標記售罄標誌]  [等待 MQ 消化]
  [降級靜態頁]     [拒絕後續請求]

  ─── 活動後（T0+5min 之後）─────────────────────────────────

  T0+5min      T0+1h         T0+24h
      │            │               │
      ▼            ▼               ▼
  [Consumer   [對賬：         [縮容：
   消化 MQ]    Redis庫存      釋放多餘
  [落庫訂單]   vs DB庫存]    應用實例]
               [補償異常單]
```

- 前：預熱快取、壓測、擴容
- 中：限流、降級、削峰
- 後：對賬、補償、回放

## 20.4 同步與異步下單（對應 20.4.1~20.4.2）

<!-- subsection-diagram -->
### 本小節示意圖

```text
同步下單 vs 異步下單對比

  ─── 同步下單（直接寫 DB）───────────────────────────────────

  User ──► API Server ──► MySQL DB
                │             │
                │             │ 每次請求直接寫 DB
                │◄────────────┘ 響應 200ms~2s
                │
  問題：
  ・10 萬 QPS → DB 無法承受（通常 MySQL 上限 1000~5000 QPS）
  ・響應時間長 → 連線池耗盡 → 雪崩

  時間軸：
  Req1 ──► [API] ──────[DB寫]──► 回應
  Req2 ──► [API] ──────[DB寫]──► 回應
  ...
  Req1000 ──► [API] ──► DB 超載！逾時！

  ─── 異步下單（MQ 削峰）──────────────────────────────────────

  User ──► API Server ──► MQ (Kafka) ──► Consumer ──► MySQL DB
                │              │               │
                │              │ 毫秒級入隊    │ 按 DB 速率消費
                │◄─────────────┘               │ （平滑寫入）
                │ 立即返回「搶購成功，訂單處理中」

  時間軸：
  T=0:   User 請求 API → 入 MQ → 立即返回（< 10ms）
  T=1s:  Consumer 消費 MQ → 寫 DB（每秒 5000 條）
  T=20s: 所有訂單落庫完成

  ┌──────────────────────────────────────────────────────────┐
  │  比較                                                    │
  │  ┌──────────────┬────────────────┬────────────────────┐  │
  │  │              │  同步下單       │  異步下單           │  │
  │  ├──────────────┼────────────────┼────────────────────┤  │
  │  │  響應時間    │  200ms~2s      │  < 10ms             │  │
  │  │  DB 峰值壓力 │  = 用戶 QPS    │  Consumer 速率控制  │  │
  │  │  用戶體驗    │  等待結果      │  樂觀返回+通知      │  │
  │  │  複雜度      │  低            │  高（需 MQ+補償）   │  │
  │  └──────────────┴────────────────┴────────────────────┘  │
  └──────────────────────────────────────────────────────────┘
```

同步直寫簡單但容易打爆；異步用 MQ 平滑流量。

## 20.5 扣庫存策略（對應 20.5.1~20.5.5）

<!-- subsection-diagram -->
### 本小節示意圖

```text
三種扣庫存時機比較

  ─── 策略一：下單時扣庫存 ──────────────────────────────────

  用戶下單 ─► 扣減 stock ─► 建立訂單 ─► 等待支付 ─► 支付完成
                │
                └► 若超時未支付 → 需要定時任務歸還庫存

  優點：超賣風險低（下單即鎖定）
  缺點：惡意用戶可佔庫存不付款；持鎖時間長

  ─── 策略二：付款時扣庫存 ──────────────────────────────────

  用戶下單 ─► 建立訂單(不扣庫存) ─► 支付完成 ─► 扣減 stock
                                                   │
                                                   └► 可能已無庫存
                                                      → 超賣！

  優點：庫存利用率高
  缺點：超賣風險高（多人下單 → 同時支付 → 最後才扣庫存）

  ─── 策略三：預扣 + 支付確認（最安全）────────────────────

  用戶下單
       │
       ▼
  Redis 預扣：DECR stock:sku:001
       │
       ├── 成功（>= 0）─► 建立預訂單（鎖定庫存）
       │                   │
       │                   ▼
       │             用戶支付
       │                   │
       │             ┌─────┴──────┐
       │             │            │
       │          支付成功      支付失敗/超時
       │             │            │
       │          DB 落庫      補償：INCR stock 歸還
       │
       └── 失敗（< 0）─► INCR 回滾 ─► 返回售罄

  ┌──────────────────────────────────────────────────────────┐
  │  策略對比                                                │
  │  ┌──────────┬──────────┬──────────┬──────────────────┐  │
  │  │  策略    │  超賣風險 │  持鎖時間 │  補償複雜度      │  │
  │  ├──────────┼──────────┼──────────┼──────────────────┤  │
  │  │  下單扣  │  低       │  長       │  定時任務歸還    │  │
  │  │  付款扣  │  高       │  短       │  超賣後補        │  │
  │  │  預扣+確認│ 極低     │  中       │  INCR 補償       │  │
  │  └──────────┴──────────┴──────────┴──────────────────┘  │
  └──────────────────────────────────────────────────────────┘
```

下單扣、付款扣、預扣各有一致性風險。

## 20.6 Redis 庫存與防超賣（對應 20.6.1~20.6.4）

<!-- subsection-diagram -->
### 本小節示意圖

```text
Redis Lua 原子扣減防超賣 + SETNX 防重下單

  ─── Lua 原子扣減流程 ─────────────────────────────────────

  用戶請求
       │
       ▼
  ┌──────────────────────────────────────────────────────┐
  │  Lua 腳本（原子執行，不被中斷）                       │
  │                                                      │
  │  local stock = redis.call('DECR', KEYS[1])           │
  │                                                      │
  │  if stock >= 0 then                                  │
  │      return 1  -- 扣減成功                           │
  │  else                                                │
  │      redis.call('INCR', KEYS[1])  -- 回滾            │
  │      return 0  -- 售罄                               │
  │  end                                                 │
  └──────────────────────────────────────────────────────┘
       │ 返回 1 or 0
       │
       ├── 1（成功）──► 進入下單流程
       │
       └── 0（售罄）──► 返回「已售罄」頁面

  ─── SETNX 防重下單 ───────────────────────────────────────

  用戶 uid=1001 點擊搶購
       │
       ▼
  SETNX order:1001:sku:001 "1"  EX 300
       │
       ├── 成功（首次）──► 允許下單
       │
       └── 失敗（已有）──► 返回「您已下單，請勿重複」

  ─── 整體防超賣流程 ───────────────────────────────────────

  請求進入
       │
       ▼
  [限流檢查：令牌桶]
       │ 通過
       ▼
  [防重檢查：SETNX order:uid:sku]
       │ 非重複
       ▼
  [Lua 原子扣庫存：DECR stock:sku]
       │ stock >= 0
       ▼
  [入 MQ 異步落庫]
       │
       ▼
  [返回：「搶購成功」]
```

原子扣減 + 分段庫存 + 防重 + 風控。

## 20.7 系統與網路優化（對應 20.7.1~20.7.4）

<!-- subsection-diagram -->
### 本小節示意圖

```text
系統調優清單

  ┌──────────────────────────────────────────────────────────────┐
  │  OS 層優化                                                    │
  │                                                              │
  │  ・ulimit -n 65535   → 增大最大檔案/連線數                  │
  │  ・/proc/sys/net/core/somaxconn → 增大 listen backlog        │
  │  ・TCP_NODELAY → 關閉 Nagle 算法，降低延遲                  │
  │  ・vm.swappiness=1 → 減少 swap，避免延遲尖刺                │
  └──────────────────────────────────────────────────────────────┘

  ┌──────────────────────────────────────────────────────────────┐
  │  網路層優化                                                   │
  │                                                              │
  │  ・TCP keepalive → 複用連線，避免頻繁三次握手               │
  │  ・SO_REUSEPORT → 多個 worker 共用同一 port，核心分流       │
  │                                                              │
  │    ┌──────────┐  ┌──────────┐  ┌──────────┐                 │
  │    │ Worker 1 │  │ Worker 2 │  │ Worker 3 │                 │
  │    │  :8080   │  │  :8080   │  │  :8080   │                 │
  │    └──────────┘  └──────────┘  └──────────┘                 │
  │         ↑              ↑              ↑                      │
  │    核心按 CPU 親和性分發連線（SO_REUSEPORT）                 │
  └──────────────────────────────────────────────────────────────┘

  ┌──────────────────────────────────────────────────────────────┐
  │  連線池優化                                                   │
  │                                                              │
  │  DB 連線池：                                                  │
  │  ・pool_size = CPU核數 × 2（避免過多上下文切換）             │
  │  ・max_overflow = pool_size × 2                              │
  │  ・pool_timeout = 30s（避免無限等待）                        │
  │                                                              │
  │  Redis 連線池：                                               │
  │  ・每個應用節點保持 10~50 個長連線                           │
  │  ・避免頻繁 connect/disconnect                               │
  └──────────────────────────────────────────────────────────────┘

  ┌──────────────────────────────────────────────────────────────┐
  │  CDN 與靜態資源                                               │
  │                                                              │
  │  用戶 ──► CDN（命中） ──► 直接返回靜態頁（不過業務層）      │
  │       └── CDN（未命中）──► 回源 Nginx ──► 快取              │
  │                                                              │
  │  秒殺頁面應 100% 靜態化：                                    │
  │  ・商品詳情頁：提前生成 HTML                                 │
  │  ・圖片/JS/CSS：CDN 邊緣節點快取                            │
  │  ・倒計時：前端 JS 本地計算，不請求後端                     │
  └──────────────────────────────────────────────────────────────┘

  整體優化效益：

  項目          優化前      優化後
  ────────────────────────────────
  最大 QPS      1萬         20萬
  P99 延遲      500ms       20ms
  DB 壓力       100%        10%（MQ 削峰）
  CPU 使用率    90%（白旋） 60%（有效計算）
```

OS 參數、連線池、TCP 調優、機房拓樸都影響上限。

```text
User -> Gateway -> RateLimit -> MQ -> OrderSvc -> Stock(Redis/DB)
```

## 示意圖

```text
Client -> Gateway -> RateLimiter -> MQ -> OrderWorker -> RedisStock -> DB
高峰流量先削峰，再異步消化
```

## 跨語言完整範例

### C — 秒殺核心：原子庫存扣減 + 防重 + 令牌桶限流

```c
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <stdatomic.h>
#include <pthread.h>
#include <time.h>

#define MAX_USERS   100
#define INIT_STOCK  5

/* ── 令牌桶限流 ── */
typedef struct {
    atomic_int tokens;
    int capacity;
    pthread_mutex_t mu;
} TokenBucket;

void bucket_init(TokenBucket *b, int cap) {
    atomic_init(&b->tokens, cap);
    b->capacity = cap;
    pthread_mutex_init(&b->mu, NULL);
}

int bucket_take(TokenBucket *b) {
    int t = atomic_fetch_sub(&b->tokens, 1);
    return t > 0;
}

/* ── 防重（冪等）表 ── */
static int order_submitted[MAX_USERS];
static pthread_mutex_t idem_mu = PTHREAD_MUTEX_INITIALIZER;

int check_and_mark(int uid) {
    pthread_mutex_lock(&idem_mu);
    int dup = order_submitted[uid];
    if (!dup) order_submitted[uid] = 1;
    pthread_mutex_unlock(&idem_mu);
    return !dup;  /* 1: 首次, 0: 重複 */
}

/* ── 庫存原子扣減 ── */
static atomic_int stock = ATOMIC_VAR_INIT(INIT_STOCK);

int deduct_stock(void) {
    int cur = atomic_fetch_sub(&stock, 1);
    if (cur > 0) return 1;
    atomic_fetch_add(&stock, 1);  /* 回滾 */
    return 0;
}

/* ── 秒殺主流程 ── */
typedef struct { int uid; TokenBucket *bucket; int *results; } Task;

void *seckill(void *arg) {
    Task *t = (Task *)arg;
    int uid = t->uid;
    /* 限流 */
    if (!bucket_take(t->bucket)) { t->results[uid] = -1; return NULL; }
    /* 防重 */
    if (!check_and_mark(uid)) { t->results[uid] = -2; return NULL; }
    /* 扣庫存 */
    t->results[uid] = deduct_stock() ? 1 : 0;
    return NULL;
}

int main(void) {
    TokenBucket bucket;
    bucket_init(&bucket, 20);  /* 限流：每批最多 20 個請求 */

    int results[MAX_USERS] = {0};
    pthread_t tids[MAX_USERS];
    Task tasks[MAX_USERS];

    for (int i = 0; i < MAX_USERS; i++) {
        tasks[i] = (Task){i, &bucket, results};
        pthread_create(&tids[i], NULL, seckill, &tasks[i]);
    }
    for (int i = 0; i < MAX_USERS; i++) pthread_join(tids[i], NULL);

    int success = 0;
    for (int i = 0; i < MAX_USERS; i++) if (results[i] == 1) success++;
    printf("成功購買人數: %d (初始庫存 %d)\n", success, INIT_STOCK);
    printf("剩餘庫存: %d (應為 0)\n", atomic_load(&stock));
    return 0;
}
```

### C++ — 秒殺核心：原子庫存 + 防重 + 令牌桶

```cpp
#include <iostream>
#include <atomic>
#include <thread>
#include <mutex>
#include <unordered_set>
#include <vector>

class TokenBucket {
    std::atomic<int> tokens_;
public:
    TokenBucket(int cap) : tokens_(cap) {}
    bool take() {
        int t = tokens_.fetch_sub(1, std::memory_order_acq_rel);
        return t > 0;
    }
};

class IdempotentGuard {
    std::unordered_set<int> seen_;
    std::mutex mu_;
public:
    bool mark_first(int uid) {
        std::lock_guard<std::mutex> lk(mu_);
        return seen_.insert(uid).second;
    }
};

class StockManager {
    std::atomic<int> stock_;
public:
    StockManager(int init) : stock_(init) {}
    bool deduct() {
        int cur = stock_.fetch_sub(1, std::memory_order_acq_rel);
        if (cur > 0) return true;
        stock_.fetch_add(1, std::memory_order_acq_rel);  /* 回滾 */
        return false;
    }
    int remaining() const { return stock_.load(); }
};

int main() {
    const int USER_COUNT = 100;
    const int INIT_STOCK = 5;

    TokenBucket bucket(20);
    IdempotentGuard idem;
    StockManager stock(INIT_STOCK);
    std::atomic<int> success_count{0};

    auto seckill = [&](int uid) {
        if (!bucket.take()) return;          /* 限流 */
        if (!idem.mark_first(uid)) return;   /* 防重 */
        if (stock.deduct()) {
            success_count.fetch_add(1, std::memory_order_relaxed);
        }
    };

    std::vector<std::thread> threads;
    for (int i = 0; i < USER_COUNT; i++)
        threads.emplace_back(seckill, i);
    for (auto &t : threads) t.join();

    std::cout << "成功購買人數: " << success_count.load()
              << " (初始庫存 " << INIT_STOCK << ")\n";
    std::cout << "剩餘庫存: " << stock.remaining() << " (應為 0)\n";
}
```

### Rust — 秒殺核心：AtomicI32 原子庫存 + HashSet 防重

```rust
use std::collections::HashSet;
use std::sync::{Arc, Mutex, atomic::{AtomicI32, Ordering}};
use std::thread;

struct Seckill {
    stock: AtomicI32,
    seen: Mutex<HashSet<u32>>,
    tokens: AtomicI32,
}

impl Seckill {
    fn new(init_stock: i32, rate_limit: i32) -> Self {
        Seckill {
            stock: AtomicI32::new(init_stock),
            seen: Mutex::new(HashSet::new()),
            tokens: AtomicI32::new(rate_limit),
        }
    }
    fn try_buy(&self, uid: u32) -> &'static str {
        if self.tokens.fetch_sub(1, Ordering::AcqRel) <= 0 {
            self.tokens.fetch_add(1, Ordering::AcqRel);
            return "限流拒絕";
        }
        {
            let mut seen = self.seen.lock().unwrap();
            if !seen.insert(uid) { return "重複下單"; }
        }
        let cur = self.stock.fetch_sub(1, Ordering::AcqRel);
        if cur > 0 { "購買成功" } else {
            self.stock.fetch_add(1, Ordering::AcqRel);
            "售罄"
        }
    }
}

fn main() {
    let sk = Arc::new(Seckill::new(5, 20));
    let mut handles = vec![];
    for uid in 0..100u32 {
        let sk = Arc::clone(&sk);
        handles.push(thread::spawn(move || {
            let result = sk.try_buy(uid);
            if result == "購買成功" {
                println!("uid={} 購買成功", uid);
            }
        }));
    }
    for h in handles { h.join().unwrap(); }
    println!("剩餘庫存: {} (應為 0)", sk.stock.load(Ordering::SeqCst));
}
```

### Go — 秒殺核心：sync/atomic 庫存 + sync.Map 防重

```go
package main

import (
    "fmt"
    "sync"
    "sync/atomic"
)

var (
    stock      int64 = 5
    tokens     int64 = 20
    orderSeen  sync.Map
    successCnt int64
)

func rateLimitPass() bool {
    t := atomic.AddInt64(&tokens, -1)
    return t >= 0
}

func markFirst(uid int) bool {
    _, loaded := orderSeen.LoadOrStore(uid, struct{}{})
    return !loaded
}

func deductStock() bool {
    cur := atomic.AddInt64(&stock, -1)
    if cur >= 0 {
        return true
    }
    atomic.AddInt64(&stock, 1) // 回滾
    return false
}

func seckill(uid int, wg *sync.WaitGroup) {
    defer wg.Done()
    if !rateLimitPass() {
        return
    }
    if !markFirst(uid) {
        return
    }
    if deductStock() {
        atomic.AddInt64(&successCnt, 1)
    }
}

func main() {
    var wg sync.WaitGroup
    for i := 0; i < 100; i++ {
        wg.Add(1)
        go seckill(i, &wg)
    }
    wg.Wait()
    fmt.Printf("成功購買人數: %d (初始庫存 5)\n", atomic.LoadInt64(&successCnt))
    fmt.Printf("剩餘庫存: %d (應為 0)\n", atomic.LoadInt64(&stock))
}
```

### Python — 秒殺核心：MockRedis Lua 原子扣減 + SETNX 防重 + 限流

```python
"""Chapter 20: seckill core — atomic stock deduct + idempotent + rate limit."""
import threading
import time


class MockRedis:
    """模擬 Redis 的原子操作：DECR（Lua）與 SETNX。"""

    def __init__(self):
        self._data = {}
        self._mu = threading.Lock()

    def set(self, key: str, value):
        with self._mu:
            self._data[key] = value

    def setnx(self, key: str, value) -> bool:
        """SET key value NX → True: 首次設置成功"""
        with self._mu:
            if key in self._data:
                return False
            self._data[key] = value
            return True

    def lua_deduct_stock(self, key: str) -> bool:
        """原子：DECR key → if < 0: INCR (回滾) return False"""
        with self._mu:
            cur = self._data.get(key, 0)
            if cur <= 0:
                return False
            self._data[key] = cur - 1
            return True

    def get(self, key: str):
        with self._mu:
            return self._data.get(key)


class TokenBucket:
    def __init__(self, capacity: int, refill_per_sec: int):
        self._tokens = capacity
        self._capacity = capacity
        self._refill_rate = refill_per_sec
        self._last_refill = time.monotonic()
        self._mu = threading.Lock()

    def take(self) -> bool:
        with self._mu:
            now = time.monotonic()
            elapsed = now - self._last_refill
            self._tokens = min(
                self._capacity,
                self._tokens + int(elapsed * self._refill_rate)
            )
            self._last_refill = now
            if self._tokens > 0:
                self._tokens -= 1
                return True
            return False


def run_seckill(user_count: int = 100, init_stock: int = 5):
    redis = MockRedis()
    bucket = TokenBucket(capacity=20, refill_per_sec=10)

    redis.set("stock:sku:001", init_stock)

    results = {"success": 0, "sold_out": 0, "limited": 0, "dup": 0}
    results_lock = threading.Lock()

    def buyer(uid: int):
        # 步驟 1：限流
        if not bucket.take():
            with results_lock:
                results["limited"] += 1
            return

        # 步驟 2：防重下單（SETNX）
        order_key = f"order:{uid}:sku:001"
        if not redis.setnx(order_key, "1"):
            with results_lock:
                results["dup"] += 1
            return

        # 步驟 3：Lua 原子扣庫存
        if redis.lua_deduct_stock("stock:sku:001"):
            with results_lock:
                results["success"] += 1
        else:
            with results_lock:
                results["sold_out"] += 1

    threads = [threading.Thread(target=buyer, args=(uid,)) for uid in range(user_count)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()

    remaining = redis.get("stock:sku:001")
    print(f"初始庫存: {init_stock}")
    print(f"成功購買: {results['success']} (應 <= {init_stock})")
    print(f"售罄拒絕: {results['sold_out']}")
    print(f"限流拒絕: {results['limited']}")
    print(f"重複下單: {results['dup']}")
    print(f"剩餘庫存: {remaining} (應為 0 或正數，不能為負)")
    assert results["success"] <= init_stock, "超賣！"
    assert remaining >= 0, "庫存為負數！"
    print("通過：原子扣減防止超賣，SETNX 防止重複下單")


if __name__ == "__main__":
    run_seckill(user_count=100, init_stock=5)
```

## 完整專案級範例（Python）

檔案：`examples/python/ch20.py`

```bash
python3 examples/python/ch20.py
```

```python
"""Chapter 20: seckill pipeline demo."""
import queue
import threading

stock = 5
q: queue.Queue[str] = queue.Queue()
mu = threading.Lock()


def worker():
    global stock
    while True:
        user = q.get()
        if user == "STOP":
            return
        with mu:
            if stock > 0:
                stock -= 1
                print(user, "success, left", stock)
            else:
                print(user, "sold out")


if __name__ == "__main__":
    t = threading.Thread(target=worker)
    t.start()
    for i in range(10):
        q.put(f"u{i}")
    q.put("STOP")
    t.join()
```
