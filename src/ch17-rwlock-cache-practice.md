# 第17章 讀寫鎖快取實戰

## 17.1 場景

<!-- subsection-diagram -->
### 本小節示意圖

```text
讀寫比例與並發度對比

  典型快取存取分布：
  ┌─────────────────────────────────────────────────────┐
  │  操作比例                                            │
  │                                                     │
  │  Read  ████████████████████████████████████░  95%  │
  │  Write ██░                                    5%   │
  │                                                     │
  └─────────────────────────────────────────────────────┘

  ─── 使用 Mutex（排他鎖）─────────────────────────────────────

  時間 ──────────────────────────────────────────────────────►
  R1   [讀─]
  R2       [等][讀─]
  R3             [等──][讀─]
  R4                       [等─────][讀─]
       ↑每次只有一個讀操作，其餘全部等待，嚴重浪費

  並發度：1 個同時（無論讀寫）

  ─── 使用 RWMutex（讀寫鎖）──────────────────────────────────

  時間 ──────────────────────────────────────────────────────►
  R1   [讀────────────────]
  R2   [讀────────────────]  ← 多個讀可以同時進行
  R3   [讀────────────────]
  R4   [讀────────────────]
  W1                      [等─][寫─][寫完，讀者可再進]

  並發度：讀者無限並發，寫者獨占

  ┌───────────────────────────────────────────────────────┐
  │  RWMutex 帶來的效益（95% 讀場景）：                    │
  │  ・讀吞吐量提升 ~20x（從串行讀 → 並發讀）             │
  │  ・寫操作仍然安全（獨占）                             │
  │  ・適合：設定快取、查詢快取、計算結果快取等           │
  └───────────────────────────────────────────────────────┘
```

讀多寫少的快取查詢。

## 17.2 基本模式

<!-- subsection-diagram -->
### 本小節示意圖

```text
Cache 查找完整流程（含雙重檢查）

  客戶端請求 key
       │
       ▼
  ┌───────────────┐
  │  read_lock()  │  ← 允許多個讀者同時進入
  └───────┬───────┘
          │
          ▼
  ┌───────────────┐    命中
  │  cache[key]   │ ──────────────────────────────────►  return value
  │  存在？       │
  └───────┬───────┘
          │ 未命中（miss）
          ▼
  ┌─────────────────┐
  │  read_unlock()  │  ← 必須先釋放讀鎖，否則無法升級為寫鎖
  └───────┬─────────┘
          │
          ▼
  ┌───────────────┐
  │  write_lock() │  ← 等待所有讀者退出，獲得排他鎖
  └───────┬───────┘
          │
          ▼
  ┌────────────────────────────────────┐
  │  Double-Check: cache[key] 存在？   │  ← 二次確認！
  │                                    │    防止並發 miss 重複載入
  └───────┬────────────────────────────┘
          │                    │
          │ 已有（其他執行緒   │ 仍無
          │ 搶先載入了）       │
          ▼                    ▼
     return value        ┌──────────────┐
                         │  load from   │
                         │  DB / Source │
                         └──────┬───────┘
                                │
                                ▼
                         ┌──────────────┐
                         │  cache[key]  │
                         │    = value   │
                         └──────┬───────┘
                                │
                                ▼
                         ┌─────────────────┐
                         │  write_unlock() │
                         └──────┬──────────┘
                                │
                                ▼
                            return value

  ┌──────────────────────────────────────────────────────────┐
  │  為何需要雙重檢查（Double-Check）？                       │
  │                                                          │
  │  T1: miss → 釋放讀鎖 ─────────────────► 拿寫鎖 → load  │
  │  T2: miss → 釋放讀鎖 → 等待寫鎖 ─────► 拿寫鎖 → ???   │
  │                                                          │
  │  若無二次檢查：T1 load 後 T2 又 load → 重複查 DB！      │
  │  加上二次檢查：T2 拿到鎖後發現已有 → 直接返回 ✓        │
  └──────────────────────────────────────────────────────────┘
```

- 讀：拿讀鎖
- 未命中：升級流程（通常先釋放讀鎖，再拿寫鎖）
- 寫：更新後釋放寫鎖

## 17.3 結構設計（對應 17.3.1~17.3.2）

<!-- subsection-diagram -->
### 本小節示意圖

```text
Cache 結構設計與 RWMutex 保護範圍

  ┌─────────────────────────────────────────────────────────┐
  │                   Cache 結構體                           │
  │                                                         │
  │  ┌─────────────────┐   ┌─────────────────────────────┐ │
  │  │  data: HashMap  │   │  RWMutex                    │ │
  │  │                 │   │                             │ │
  │  │  "user:1" → 42  │   │  RLock() / RUnlock()        │ │
  │  │  "user:2" → 18  │   │  ↑ 保護 data 的讀操作       │ │
  │  │  "user:3" → 99  │   │                             │ │
  │  │  ...            │   │  Lock() / Unlock()           │ │
  │  └─────────────────┘   │  ↑ 保護 data 的寫操作       │ │
  │                         └─────────────────────────────┘ │
  │  ┌─────────────────────────────────────────────────────┐│
  │  │  loader: fn(key) → value                            ││
  │  │  ↑ 當 cache miss 時，呼叫此函式載入資料             ││
  │  └─────────────────────────────────────────────────────┘│
  └─────────────────────────────────────────────────────────┘

  操作與鎖的對應關係：

  ┌──────────────────┬──────────────────┬──────────────────┐
  │     操作         │    使用的鎖      │     說明         │
  ├──────────────────┼──────────────────┼──────────────────┤
  │  Get (hit)       │  RLock/RUnlock   │  多讀者並發安全  │
  │  Get (miss)      │  先 RUnlock      │  釋放讀鎖後      │
  │                  │  再 Lock/Unlock  │  以寫鎖載入      │
  │  Set / Evict     │  Lock/Unlock     │  寫者獨占        │
  │  Len / Keys      │  RLock/RUnlock   │  只讀統計資訊    │
  └──────────────────┴──────────────────┴──────────────────┘

  多讀者並發示意：

  Reader1 ──[RLock]──[讀 data]──[RUnlock]──
  Reader2 ──[RLock]──[讀 data]──[RUnlock]──   ← 同時執行
  Reader3 ──[RLock]──[讀 data]──[RUnlock]──
                                          │
                                          ▼
  Writer  ──────────────────────[Lock]──[寫 data]──[Unlock]──
                                 ↑
                           等所有 Reader 退出後才能進入
```

快取容器 + 讀寫鎖 + 載入函式。

## 17.4 常見坑

<!-- subsection-diagram -->
### 本小節示意圖

```text
坑一：鎖升級死鎖

  ┌──────────────────────────────────────────────────────────┐
  │                    死鎖場景                               │
  │                                                          │
  │  Thread A                   RWMutex                      │
  │  ─────────────────────────────────────────────────────   │
  │  RLock() ─────────────────► 讀鎖已獲得（readers=1）      │
  │  ... 處理中 ...                                          │
  │  Lock() ──────────────────► 等待！因為讀鎖還在           │
  │                             等所有讀者退出               │
  │          ↑                         ↓                     │
  │          └──── A 持有讀鎖 ─────── A 等寫鎖 ────► 死鎖！  │
  │                                                          │
  │  正確做法：                                               │
  │  RLock()  ─► 讀 ─► RUnlock() ─► Lock() ─► 寫 ─► Unlock()│
  │              ↑必須先釋放讀鎖，才能升級為寫鎖              │
  └──────────────────────────────────────────────────────────┘

坑二：缺少二次檢查 → 重複載入 DB

  ┌──────────────────────────────────────────────────────────┐
  │                 並發 Miss 場景                            │
  │                                                          │
  │  時間 ──────────────────────────────────────────────────►│
  │                                                          │
  │  T1: [RLock][miss][RUnlock]         [Lock][load DB!][Unlock]│
  │  T2: [RLock][miss][RUnlock][等Lock─────────][load DB!][Unlock]│
  │  T3: [RLock][miss][RUnlock][等等Lock──────────────][load DB!]│
  │                                                          │
  │  ↑ 沒有二次檢查 → 3 個執行緒都去 load DB → N 倍壓力！   │
  │                                                          │
  │  ─────────────────────────────────────────────────────── │
  │                                                          │
  │  T1: [RLock][miss][RUnlock]         [Lock][load DB][Unlock]│
  │  T2: [RLock][miss][RUnlock][等Lock─────][二次檢查 hit! ][Unlock]│
  │  T3: [RLock][miss][RUnlock][等等Lock──────][二次檢查 hit!][Unlock]│
  │                                                          │
  │  ↑ 有二次檢查 → 只有 T1 load DB，T2/T3 直接命中 ✓      │
  └──────────────────────────────────────────────────────────┘
```

- 鎖升級死鎖
- 雙重檢查缺失造成重複載入

```text
read lock -> miss -> unlock read -> lock write
          -> check again -> load -> write -> unlock
```

## 示意圖

```text
read lock -> hit -> return
read lock -> miss -> unlock read -> write lock -> load -> write -> unlock
```

## 跨語言完整範例

### C — pthread 讀寫鎖保護 map 快取

```c
#include <stdio.h>
#include <string.h>
#include <pthread.h>

#define CACHE_SIZE 64

typedef struct { char key[32]; int value; int used; } Entry;

static Entry cache[CACHE_SIZE];
static pthread_rwlock_t rwlock = PTHREAD_RWLOCK_INITIALIZER;

static int db_load(const char *key) {
    return (int)strlen(key) * 7;  /* 模擬資料庫查詢 */
}

int get_or_load(const char *key) {
    pthread_rwlock_rdlock(&rwlock);
    for (int i = 0; i < CACHE_SIZE; i++) {
        if (cache[i].used && strcmp(cache[i].key, key) == 0) {
            int v = cache[i].value;
            pthread_rwlock_unlock(&rwlock);
            return v;
        }
    }
    pthread_rwlock_unlock(&rwlock);

    pthread_rwlock_wrlock(&rwlock);
    /* 雙重檢查 */
    for (int i = 0; i < CACHE_SIZE; i++) {
        if (cache[i].used && strcmp(cache[i].key, key) == 0) {
            int v = cache[i].value;
            pthread_rwlock_unlock(&rwlock);
            return v;
        }
    }
    int val = db_load(key);
    for (int i = 0; i < CACHE_SIZE; i++) {
        if (!cache[i].used) {
            strncpy(cache[i].key, key, 31);
            cache[i].value = val;
            cache[i].used = 1;
            break;
        }
    }
    pthread_rwlock_unlock(&rwlock);
    return val;
}

int main(void) {
    printf("alpha = %d\n", get_or_load("alpha"));
    printf("alpha = %d (cached)\n", get_or_load("alpha"));
    printf("beta  = %d\n", get_or_load("beta"));
    return 0;
}
```

### C++ — shared_mutex 讀寫鎖快取

```cpp
#include <iostream>
#include <unordered_map>
#include <shared_mutex>
#include <string>
#include <thread>
#include <vector>

class RWCache {
    std::unordered_map<std::string, int> data_;
    mutable std::shared_mutex mu_;

    int load_from_db(const std::string &key) {
        return static_cast<int>(key.size()) * 7;
    }
public:
    int get(const std::string &key) {
        {
            std::shared_lock r(mu_);
            auto it = data_.find(key);
            if (it != data_.end()) return it->second;
        }
        std::unique_lock w(mu_);
        auto it = data_.find(key);  /* double-check */
        if (it != data_.end()) return it->second;
        int val = load_from_db(key);
        data_[key] = val;
        return val;
    }
};

int main() {
    RWCache cache;
    std::vector<std::thread> threads;
    for (int i = 0; i < 4; i++) {
        threads.emplace_back([&cache, i]() {
            std::string key = "key" + std::to_string(i % 2);
            for (int j = 0; j < 100; j++) {
                int v = cache.get(key);
                (void)v;
            }
        });
    }
    for (auto &t : threads) t.join();
    std::cout << "alpha=" << cache.get("alpha") << "\n";
    std::cout << "完成：多讀者並發無競態\n";
}
```

### Rust — RwLock<HashMap> 讀寫快取

```rust
use std::collections::HashMap;
use std::sync::{Arc, RwLock};
use std::thread;

struct RwCache {
    data: RwLock<HashMap<String, i32>>,
}

impl RwCache {
    fn new() -> Self {
        RwCache { data: RwLock::new(HashMap::new()) }
    }
    fn get_or_load(&self, key: &str) -> i32 {
        {
            let r = self.data.read().unwrap();
            if let Some(&v) = r.get(key) { return v; }
        }
        let mut w = self.data.write().unwrap();
        if let Some(&v) = w.get(key) { return v; }  /* double-check */
        let val = key.len() as i32 * 7;
        w.insert(key.to_string(), val);
        val
    }
}

fn main() {
    let cache = Arc::new(RwCache::new());
    let mut handles = vec![];
    for i in 0..4 {
        let c = Arc::clone(&cache);
        handles.push(thread::spawn(move || {
            let key = format!("key{}", i % 2);
            for _ in 0..100 {
                let _ = c.get_or_load(&key);
            }
        }));
    }
    for h in handles { h.join().unwrap(); }
    println!("alpha={}", cache.get_or_load("alpha"));
    println!("完成：Rust RwLock 快取正確");
}
```

### Go — sync.RWMutex 讀寫快取

```go
package main

import (
    "fmt"
    "sync"
)

type RWCache struct {
    mu   sync.RWMutex
    data map[string]int
}

func NewRWCache() *RWCache {
    return &RWCache{data: make(map[string]int)}
}

func (c *RWCache) GetOrLoad(key string) int {
    c.mu.RLock()
    if v, ok := c.data[key]; ok {
        c.mu.RUnlock()
        return v
    }
    c.mu.RUnlock()

    c.mu.Lock()
    defer c.mu.Unlock()
    if v, ok := c.data[key]; ok { // double-check
        return v
    }
    val := len(key) * 7
    c.data[key] = val
    return val
}

func main() {
    cache := NewRWCache()
    var wg sync.WaitGroup
    for i := 0; i < 4; i++ {
        wg.Add(1)
        go func(id int) {
            defer wg.Done()
            key := fmt.Sprintf("key%d", id%2)
            for j := 0; j < 100; j++ {
                cache.GetOrLoad(key)
            }
        }(i)
    }
    wg.Wait()
    fmt.Printf("alpha=%d\n", cache.GetOrLoad("alpha"))
    fmt.Println("完成：Go RWMutex 快取正確")
}
```

### Python — threading.RLock 讀寫快取模擬

```python
"""Chapter 17: RW-lock cache — multi-reader concurrent, miss loads once."""
import threading
import time


class RWCache:
    def __init__(self, loader):
        self._data = {}
        self._lock = threading.Lock()
        self._readers = 0
        self._read_lock = threading.Lock()
        self._write_lock = threading.Lock()
        self._loader = loader

    def _rlock(self):
        with self._read_lock:
            self._readers += 1
            if self._readers == 1:
                self._write_lock.acquire()

    def _runlock(self):
        with self._read_lock:
            self._readers -= 1
            if self._readers == 0:
                self._write_lock.release()

    def get(self, key):
        self._rlock()
        val = self._data.get(key)
        self._runlock()
        if val is not None:
            return val
        with self._write_lock:
            if key in self._data:       # double-check
                return self._data[key]
            val = self._loader(key)
            self._data[key] = val
            return val


def main():
    load_count = [0]

    def db_load(key):
        load_count[0] += 1
        time.sleep(0.01)               # 模擬 DB 延遲
        return len(key) * 7

    cache = RWCache(db_load)
    results = []
    lock = threading.Lock()

    def reader(key):
        v = cache.get(key)
        with lock:
            results.append(v)

    threads = [threading.Thread(target=reader, args=("alpha",)) for _ in range(8)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()

    print(f"alpha 值: {results[0]}, 所有結果一致: {len(set(results)) == 1}")
    print(f"DB 實際載入次數: {load_count[0]} (應為 1，雙重檢查生效)")


if __name__ == "__main__":
    main()
```

## 完整專案級範例（Python）

檔案：`examples/python/ch17.py`

```bash
python3 examples/python/ch17.py
```

```python
"""Chapter 17: rw-lock cache (simple)."""
import threading

cache = {}
lock = threading.RLock()


def get_or_load(k: str) -> int:
    with lock:
        if k in cache:
            return cache[k]
    with lock:
        if k not in cache:
            cache[k] = len(k)
        return cache[k]


if __name__ == "__main__":
    print(get_or_load("alpha"))
    print(get_or_load("alpha"))
```
