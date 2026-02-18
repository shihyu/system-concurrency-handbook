# 附錄：C/C++/Rust/Go/Python 對照速查

| 主題 | C/C++ | Rust | Go | Python |
|---|---|---|---|---|
| 執行單元 | pthread / std::thread | std::thread / tokio::spawn | goroutine | threading.Thread |
| 互斥鎖 | pthread_mutex / std::mutex | Mutex\<T\> | sync.Mutex | threading.Lock() |
| 讀寫鎖 | pthread_rwlock / std::shared_mutex | RwLock\<T\> | sync.RWMutex | threading.RLock() |
| 條件變數 | pthread_cond / condition_variable | Condvar | sync.Cond | threading.Condition |
| 原子操作 | stdatomic.h / std::atomic | Atomic\* (SeqCst/Acquire/Release) | sync/atomic | threading.Lock()(模擬) |
| 信號量 | sem_t / counting_semaphore | Mutex+Condvar / tokio::Semaphore | channel(buffered) | threading.Semaphore |
| 執行緒本地 | \_\_thread / thread\_local | thread\_local! | context.Context(顯式傳遞) | threading.local() |
| 執行緒池 | 自建 / OpenMP | rayon::ThreadPool / tokio | worker+channel 慣例 | ThreadPoolExecutor |
| 中斷/取消 | stop flag / std::stop_token | 無內建，用 channel | context.WithCancel | threading.Event |
| 記憶體順序 | memory\_order\_\* | Ordering::\* | sync/atomic (無細粒度) | GIL 保證(CPython) |
| 無鎖計數器 | atomic\_fetch\_add | fetch\_add(Ordering) | atomic.AddInt64 | 需 Lock(GIL 不保證) |
| 分散式鎖 | 不內建 | 不內建 | 不內建 | 不內建(需 Redis 等) |

## 一個跨語言都成立的原則

先保證正確性，再談吞吐。

```text
正確性(資料不錯) -> 可用性(不死鎖) -> 效能(夠快)
```

## 共同最小模板

```text
1) 先用 atomic 解決單變數競態
2) 需要複合一致性時改用 lock
3) 併發量大再加 queue/pool/backpressure
```

```c
// C: atomic -> mutex 升級路徑
#include <stdatomic.h>
#include <pthread.h>
atomic_int counter = 0;          // 單變數競態 → atomic
pthread_mutex_t mu;              // 複合操作 → mutex
```

```cpp
// C++: atomic -> mutex 升級路徑
#include <atomic>
#include <mutex>
std::atomic<int> counter{0};    // 單變數
std::mutex mu;                  // 複合操作
```

```rust
// Rust: Atomic* -> Mutex/RwLock
use std::sync::atomic::{AtomicI32, Ordering};
use std::sync::{Mutex, RwLock};
static COUNTER: AtomicI32 = AtomicI32::new(0);  // 單變數
let shared = Mutex::new(HashMap::new());         // 複合操作
```

```go
// Go: sync/atomic -> sync.Mutex/RWMutex
import "sync/atomic"
import "sync"
var counter atomic.Int64          // 單變數
var mu sync.Mutex                 // 複合操作
```

```python
# Python: Lock 保護複合操作（CPython GIL 不保證原子性）
import threading
lock = threading.Lock()
counter = 0                       # 不安全（GIL 不保證 counter += 1）
with lock:                        # 安全的複合操作
    counter += 1
```

## Python 特別說明

| 項目 | CPython 行為 | 注意事項 |
|------|-------------|---------|
| GIL（全域直譯器鎖） | 同一時刻只有一個執行緒跑 Python bytecode | I/O 密集可受益，CPU 密集用 multiprocessing |
| `counter += 1` | **不是原子**（3 條 bytecode：LOAD/BINARY\_ADD/STORE） | 需加 Lock |
| `threading.Lock` | OS mutex 封裝 | 可跨執行緒互斥 |
| `threading.RLock` | 可重入鎖 | 同執行緒可多次 acquire |
| 真正並行 | `multiprocessing` / `concurrent.futures.ProcessPoolExecutor` | 各自有獨立 GIL |
| 異步並發 | `asyncio`（單執行緒事件迴圈） | 適合 I/O 密集，非多核並行 |

## 選型快速決策

```text
需要多核 CPU 並行運算？
  ├─ 是 → C/C++/Rust/Go（Python 用 multiprocessing）
  └─ 否（I/O 密集）→ 各語言都行，Python asyncio 亦可

需要極低延遲無 GC？
  └─ C/C++/Rust

需要記憶體安全無 data race 編譯期保證？
  └─ Rust

需要最簡單的並發模型？
  └─ Go（goroutine + channel）

需要快速腳本/原型？
  └─ Python（注意 GIL 限制）
```
