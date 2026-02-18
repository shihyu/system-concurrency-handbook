# 第12章 鎖優化

## 12.1~12.3 縮小鎖粒度

<!-- subsection-diagram -->
### 本小節示意圖（ASCII）

```text
  縮小鎖粒度：粗鎖 vs 細鎖

  ╔══════════════════════════════════════════════════════════════╗
  ║  BEFORE：一把大鎖保護整個 Map                                ║
  ╚══════════════════════════════════════════════════════════════╝

  Thread A (讀 k1)  ──┐
  Thread B (寫 k7)  ──┤──► 爭搶同一把 GlobalLock ──► Map
  Thread C (讀 k3)  ──┤
  Thread D (寫 k9)  ──┘
         │
         ▼
  衝突概率 = P(任意兩個操作重疊) ≈ 很高
  同一時刻只有 1 個執行緒能進入 Map

  ╔══════════════════════════════════════════════════════════════╗
  ║  AFTER：每個 bucket 一把鎖                                   ║
  ╚══════════════════════════════════════════════════════════════╝

  Thread A (讀 k1) ──► Lock[bucket_0] ──► bucket[0]: {k1,k2,...}
  Thread B (寫 k7) ──► Lock[bucket_1] ──► bucket[1]: {k7,k8,...}
  Thread C (讀 k3) ──► Lock[bucket_0] ──► bucket[0]: {k3,...}
  Thread D (寫 k9) ──► Lock[bucket_2] ──► bucket[2]: {k9,...}
         │
         ▼
  A 和 C 競爭 bucket_0（才衝突）
  B 和 D 各用不同 bucket（完全並行）

  衝突概率 = P(兩操作落在同一 bucket) ≈ 1/N（N 為 bucket 數）
  並發度從 1 提升到接近 bucket 數量
```

粗鎖改細鎖，減少不必要互斥。

鎖粒度（Lock Granularity）指的是一把鎖所保護的資料範圍。粗粒度鎖（如保護整個 Map）易於實作但並發度低；細粒度鎖（如每個 bucket 一把鎖）提升並發，但設計複雜度也上升。核心原則：**只鎖真正需要保護的最小資料範圍**。

## 12.4~12.6 分段與分離

<!-- subsection-diagram -->
### 本小節示意圖（ASCII）

```text
  分段鎖（Sharded Lock）：key hash % 16 → shard[i]

  ┌─────────────────────────────────────────────────────────────┐
  │                    Sharded Map（16 個分片）                  │
  ├─────────────────────────────────────────────────────────────┤
  │                                                             │
  │  key ──► hash(key) % 16 ──► 選擇分片                       │
  │                                                             │
  │   Shard[0]  ┌──────────┐  Lock[0]  ← Thread A              │
  │             │ {k0,...} │                                    │
  │   Shard[1]  ├──────────┤  Lock[1]  ← Thread B (同時並行)   │
  │             │ {k1,...} │                                    │
  │   Shard[2]  ├──────────┤  Lock[2]  ← Thread C (同時並行)   │
  │             │ {k2,...} │                                    │
  │      ⋮      │    ⋮     │    ⋮                              │
  │   Shard[15] ├──────────┤  Lock[15] ← Thread P (同時並行)   │
  │             │ {k15,..} │                                    │
  │             └──────────┘                                    │
  │                                                             │
  │  並發度：最多 16 個執行緒同時操作不同分片（互不阻塞）         │
  │  衝突只發生在：兩個 key 的 hash%16 值相同時                  │
  │                                                             │
  │  對比單一全域鎖：並發度提升 ≈ 16 倍（理論上限）              │
  └─────────────────────────────────────────────────────────────┘

  白話例子：
  超商單一結帳櫃台 → 16 個自助結帳機
  顧客分散到不同機台，排隊時間大幅縮短
```

把一把全域鎖拆成多段（striped/sharded lock）。

分段鎖是縮小鎖粒度的極致應用：將資料結構按某種規則（通常是 key 的 hash 值）切分為多個 shard，每個 shard 有獨立的鎖。操作時只鎖對應的 shard，其他 shard 的操作完全不受影響，理論並發度為 shard 數量。

## 12.7~12.9 其他策略

<!-- subsection-diagram -->
### 本小節示意圖（ASCII）

```text
  鎖策略決策樹

  開始評估並發策略
         │
         ▼
  讀操作遠多於寫操作？
  ├── 是 ──► 使用讀寫鎖（RWLock / shared_mutex）
  │          多個讀者同時進入，只有寫者互斥
  │          適用：配置讀取、快取查詢
  │
  └── 否 ──► 操作是否無衝突（CAS 能完成）？
             ├── 是 ──► 樂觀鎖 / 原子 CAS（lock-free）
             │          適用：計數器、狀態機、無競爭更新
             │
             └── 否 ──► 高吞吐量場景？
                        ├── 是 ──► 分段鎖（Sharded Lock）
                        │          適用：並發 Map、並發計數器
                        │
                        └── 否 ──► 需要公平性（FIFO 順序）？
                                   ├── 是 ──► 公平鎖（Fair Lock）
                                   │          避免飢餓，代價：吞吐略低
                                   │
                                   └── 否 ──► 執行緒本地資料夠用？
                                              ├── 是 ──► ThreadLocal
                                              │          完全消除鎖競爭
                                              └── 否 ──► 普通互斥鎖
                                                         + 縮小持鎖範圍
```

其他常見鎖優化策略：

- **降低持鎖時間**：將 I/O、複雜計算移到臨界區外，只在真正需要保護的最小程式碼段持鎖
- **熱點隔離**：高頻訪問的共享計數器可用 per-CPU 計數器或 LongAdder 模式，最後再匯總
- **讀寫分離**：讀多寫少場景用 `RWMutex`，允許多個讀者並行，只有寫者獨佔
- **優先無鎖結構**：原子操作（CAS）、無鎖佇列在低競爭場景下比鎖更快

白話例子：超商單一結帳櫃台改 16 個櫃台，隊伍自然變短。

## 跨語言完整範例

分段鎖 Map：SHARDS=8，按 key hash 選鎖，多執行緒並發寫入，對比全域鎖展示吞吐量差異。

### C

```c
/* 編譯: gcc -O2 -pthread -o ch12_c ch12.c && ./ch12_c */
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <pthread.h>
#include <time.h>

#define SHARDS   8
#define ITERS    100000
#define THREADS  4

typedef struct { long count; pthread_mutex_t mu; } Shard;

Shard shards[SHARDS];

static unsigned int hash_key(int key) {
    return (unsigned int)key * 2654435761u;
}

void shard_inc(int key) {
    int idx = hash_key(key) % SHARDS;
    pthread_mutex_lock(&shards[idx].mu);
    shards[idx].count++;
    pthread_mutex_unlock(&shards[idx].mu);
}

void *worker(void *arg) {
    int base = *(int *)arg;
    for (int i = 0; i < ITERS; i++)
        shard_inc(base * ITERS + i);
    return NULL;
}

int main(void) {
    for (int i = 0; i < SHARDS; i++)
        pthread_mutex_init(&shards[i].mu, NULL);

    pthread_t ts[THREADS];
    int ids[THREADS];
    struct timespec t0, t1;
    clock_gettime(CLOCK_MONOTONIC, &t0);

    for (int i = 0; i < THREADS; i++) {
        ids[i] = i;
        pthread_create(&ts[i], NULL, worker, &ids[i]);
    }
    for (int i = 0; i < THREADS; i++) pthread_join(ts[i], NULL);

    clock_gettime(CLOCK_MONOTONIC, &t1);
    long total = 0;
    for (int i = 0; i < SHARDS; i++) total += shards[i].count;

    long ms = (t1.tv_sec - t0.tv_sec) * 1000 +
              (t1.tv_nsec - t0.tv_nsec) / 1000000;
    printf("total=%ld (expected %d), elapsed=%ldms\n",
           total, THREADS * ITERS, ms);
    return 0;
}
```

### C++

```cpp
// 編譯: g++ -std=c++17 -O2 -pthread -o ch12_cpp ch12.cpp && ./ch12_cpp
#include <iostream>
#include <mutex>
#include <thread>
#include <vector>
#include <functional>

constexpr int SHARDS  = 8;
constexpr int ITERS   = 100000;
constexpr int THREADS = 4;

struct Shard {
    long count = 0;
    std::mutex mu;
};

Shard shards[SHARDS];

void shard_inc(int key) {
    int idx = std::hash<int>{}(key) % SHARDS;
    std::lock_guard lk(shards[idx].mu);
    shards[idx].count++;
}

int main() {
    std::vector<std::thread> ts;
    for (int i = 0; i < THREADS; i++) {
        ts.emplace_back([i] {
            for (int j = 0; j < ITERS; j++)
                shard_inc(i * ITERS + j);
        });
    }
    for (auto &t : ts) t.join();

    long total = 0;
    for (auto &s : shards) total += s.count;
    std::cout << "total=" << total
              << " (expected=" << THREADS * ITERS << ")\n";
    return 0;
}
```

### Rust

```rust
// 執行: cargo run 或 rustc ch12.rs -o ch12 && ./ch12
use std::sync::{Arc, Mutex};
use std::thread;
use std::collections::hash_map::DefaultHasher;
use std::hash::{Hash, Hasher};

const SHARDS: usize = 8;
const ITERS: usize = 25000;
const THREADS: usize = 4;

fn hash_shard(key: i32) -> usize {
    let mut h = DefaultHasher::new();
    key.hash(&mut h);
    (h.finish() as usize) % SHARDS
}

fn main() {
    // Arc<Vec<Mutex<i64>>>：共享的分段計數器
    let shards: Arc<Vec<Mutex<i64>>> =
        Arc::new((0..SHARDS).map(|_| Mutex::new(0)).collect());

    let handles: Vec<_> = (0..THREADS).map(|i| {
        let shards = Arc::clone(&shards);
        thread::spawn(move || {
            for j in 0..ITERS {
                let key = (i * ITERS + j) as i32;
                let idx = hash_shard(key);
                *shards[idx].lock().unwrap() += 1;
            }
        })
    }).collect();

    for h in handles { h.join().unwrap(); }

    let total: i64 = shards.iter().map(|s| *s.lock().unwrap()).sum();
    println!("total={} (expected={})", total, THREADS * ITERS);
}
```

### Go

```go
// 執行: go run ch12.go
package main

import (
	"fmt"
	"hash/fnv"
	"sync"
	"sync/atomic"
)

const shards = 8
const iters = 25000
const workers = 4

type Shard struct {
	mu    sync.Mutex
	count int64
}

var shardMap [shards]Shard

func hashShard(key int) int {
	h := fnv.New32a()
	b := [4]byte{byte(key), byte(key >> 8), byte(key >> 16), byte(key >> 24)}
	h.Write(b[:])
	return int(h.Sum32()) % shards
}

func shardInc(key int) {
	idx := hashShard(key)
	shardMap[idx].mu.Lock()
	shardMap[idx].count++
	shardMap[idx].mu.Unlock()
}

func main() {
	var wg sync.WaitGroup
	for i := 0; i < workers; i++ {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			for j := 0; j < iters; j++ {
				shardInc(i*iters + j)
			}
		}(i)
	}
	wg.Wait()

	var total int64
	for i := range shardMap {
		total += atomic.LoadInt64(&shardMap[i].count)
	}
	fmt.Printf("total=%d (expected=%d)\n", total, workers*iters)
}
```

### Python

```python
# 執行: python3 ch12.py
import threading
import hashlib

SHARDS  = 8
ITERS   = 10000
WORKERS = 4


class ShardedCounter:
    def __init__(self, n_shards: int):
        self.counts = [0] * n_shards
        self.locks  = [threading.Lock() for _ in range(n_shards)]
        self.n      = n_shards

    def increment(self, key: int):
        idx = key % self.n          # 簡單取模作為 hash 函數
        with self.locks[idx]:
            self.counts[idx] += 1

    def total(self) -> int:
        return sum(self.counts)


counter = ShardedCounter(SHARDS)


def worker(worker_id: int):
    for j in range(ITERS):
        counter.increment(worker_id * ITERS + j)


if __name__ == "__main__":
    threads = [threading.Thread(target=worker, args=(i,)) for i in range(WORKERS)]
    for t in threads: t.start()
    for t in threads: t.join()
    print(f"total={counter.total()} (expected={WORKERS * ITERS})")
    print(f"分片分佈: {counter.counts}")
```

## 完整專案級範例（Python）

檔案：`examples/python/ch12.py`

```bash
python3 examples/python/ch12.py
```

```python
"""Chapter 12: lock sharding — 分段鎖實作與對比。"""
import threading
import time

SHARDS = 8
locks = [threading.Lock() for _ in range(SHARDS)]
data = [0] * SHARDS


def update(key: int):
    """按 key % SHARDS 選擇對應分片的鎖，只鎖該分片。"""
    idx = key % SHARDS
    with locks[idx]:
        data[idx] += 1


if __name__ == "__main__":
    start = time.time()
    ts = [threading.Thread(target=update, args=(i,)) for i in range(10_000)]
    for t in ts: t.start()
    for t in ts: t.join()
    elapsed = time.time() - start
    print(f"sum={sum(data)}, elapsed={elapsed:.3f}s")
    print(f"分片分佈: {data}")
```
