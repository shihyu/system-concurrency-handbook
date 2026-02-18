# 附錄：Java/C++/Rust/Go 對照速查

| 主題 | Java | C/C++ | Rust | Go |
|---|---|---|---|---|
| 線程 | Thread | std::thread/pthread | std::thread | goroutine |
| 互斥鎖 | synchronized/ReentrantLock | std::mutex | Mutex<T> | sync.Mutex |
| 讀寫鎖 | ReadWriteLock/StampedLock | std::shared_mutex | RwLock<T> | sync.RWMutex |
| 條件變數 | wait/notify/Condition | condition_variable | Condvar | sync.Cond |
| 原子 | Atomic* | std::atomic | Atomic* | sync/atomic |
| 中斷/取消 | interrupt | stop flag/token | cancellation token | context.WithCancel |
| 線程池 | ThreadPoolExecutor | 自建/TBB | rayon/tokio | worker pool 慣例 |

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

```java
// atomic -> lock 的常見升級路徑
```

```cpp
// std::atomic -> std::mutex
```

```rust
// Atomic* -> Mutex/RwLock
```

```go
// sync/atomic -> sync.Mutex/RWMutex
```
