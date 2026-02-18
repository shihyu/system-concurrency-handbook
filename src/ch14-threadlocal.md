# 第14章 ThreadLocal

## 14.1~14.3 存取機制（對應 14.1~14.3.4）

<!-- subsection-diagram -->
### 本小節示意圖

```text
  ThreadLocal 存取機制：Thread 內部結構圖

  ┌─────────────────────────────────────────────────────────────────┐
  │  Thread A                                                       │
  │  ┌─────────────────────────────────────────────────────────┐   │
  │  │  threadLocals: ThreadLocalMap                           │   │
  │  │  ┌──────────────────────────────────────────────────┐  │   │
  │  │  │  Entry[]（開放定址雜湊表）                        │  │   │
  │  │  │  ┌────────────────────┬───────────────────────┐  │  │   │
  │  │  │  │ key = WeakRef(TL1) │ value = "user_42"    │  │  │   │
  │  │  │  ├────────────────────┼───────────────────────┤  │  │   │
  │  │  │  │ key = WeakRef(TL2) │ value = conn_obj_A   │  │  │   │
  │  │  │  ├────────────────────┼───────────────────────┤  │  │   │
  │  │  │  │      (空槽)         │                       │  │  │   │
  │  │  │  └────────────────────┴───────────────────────┘  │  │   │
  │  │  └──────────────────────────────────────────────────┘  │   │
  │  └─────────────────────────────────────────────────────────┘   │
  └─────────────────────────────────────────────────────────────────┘

  查找路徑：
  threadLocal.get()
       │
       ▼
  Thread.currentThread()          ← 取得當前執行緒
       │
       ▼
  thread.threadLocals             ← 取得 ThreadLocalMap
       │
       ▼
  map.get(this)                   ← this = ThreadLocal 實例，作為 key
       │
       ▼
  entry.value                     ← 返回使用者儲存的值

  ⚠️  記憶體洩漏風險：
  ┌─────────────────────────────────────────────────────────────────┐
  │  ThreadLocal 實例被 GC（key 變 null）                           │
  │  → Entry 的 key = null，但 value 仍被強引用                     │
  │  → value 無法被 GC 回收 ← 洩漏！                               │
  │                                                                 │
  │  防範：使用完畢後務必呼叫 threadLocal.remove()                  │
  └─────────────────────────────────────────────────────────────────┘
```

每個執行緒持有自己的本地變數副本，互不干擾。

ThreadLocal 的核心不是「一個全局變數有多份副本」，而是「每個 Thread 物件內部有一個 `ThreadLocalMap`」。`get()/set()` 實際上是在當前執行緒的 Map 中查找/寫入，以 ThreadLocal 實例本身作為 key。

關鍵細節：Map 中的 key 是弱引用（WeakReference），若 ThreadLocal 實例沒有外部強引用而被 GC 回收，key 就會變成 null，但 value 仍被 Entry 強引用，造成洩漏。執行緒池中的執行緒長期存活，此問題尤為危險。

## 14.4 不繼承性

<!-- subsection-diagram -->
### 本小節示意圖

```text
  父執行緒 vs 子執行緒的 ThreadLocal 隔離

  ┌─────────────────────────────────────────────────────────────────┐
  │  父執行緒（Parent Thread）                                       │
  │  threadLocals: { TL_user_id → 42, TL_request → "req-001" }    │
  └────────────────────────────┬────────────────────────────────────┘
                               │ new Thread(...)  或  pool.submit(...)
                               │ 建立子執行緒
                               ▼
  ┌─────────────────────────────────────────────────────────────────┐
  │  子執行緒（Child Thread）                                        │
  │  threadLocals: { }   ← 空 Map！                                 │
  │                                                                 │
  │  child.get(TL_user_id)  → null（或 initialValue()）            │
  │  child.get(TL_request)  → null（或 initialValue()）            │
  └─────────────────────────────────────────────────────────────────┘

  ⚠️  常見問題：
  父執行緒設定了 user_id=42（用於追蹤請求）
  提交任務到執行緒池後，子執行緒讀到 null
  → 日誌無法關聯到正確的請求 ID
  → 解決方案：改用 InheritableThreadLocal（見 14.5）
              或手動在 submit 時捕獲並傳遞值
```

子執行緒預設看不到父執行緒 ThreadLocal。

這個設計是有意的：ThreadLocal 的語義是「執行緒私有」，若自動繼承反而破壞隔離性。但在請求追蹤（Trace ID）等場景確實需要傳遞上下文，此時應使用 InheritableThreadLocal 或顯式傳遞。

## 14.5~14.6 可繼承變體

<!-- subsection-diagram -->
### 本小節示意圖

```text
  InheritableThreadLocal：建立子執行緒時複製快照

  ┌─────────────────────────────────────────────────────────────────┐
  │  父執行緒                                                        │
  │  inheritableThreadLocals: { ITL_user → 42, ITL_locale → "zh" } │
  └────────────────────────────┬────────────────────────────────────┘
                               │ new Thread() 時，JVM 自動複製快照
                               ▼
  ┌─────────────────────────────────────────────────────────────────┐
  │  子執行緒（建立時複製）                                          │
  │  inheritableThreadLocals: { ITL_user → 42, ITL_locale → "zh" } │
  │                           ↑ 獨立副本，修改互不影響               │
  └─────────────────────────────────────────────────────────────────┘

  child.set(ITL_user, 99)  → 只影響子執行緒，父執行緒仍是 42

  ⚠️  執行緒池問題：
  Pool 中的執行緒在建立時已複製，之後複用時不會再複製
  父執行緒後續修改的值，Pool Worker 看不到

  ─────────────────────────────────────────────────────────────────

  設計哲學對比：Java vs Go

  Java：隱式攜帶（InheritableThreadLocal）
  ┌──────────────────────────────────────────┐
  │ 上下文隱藏在執行緒內部                   │
  │ 優點：呼叫方不需要傳參                   │
  │ 缺點：隱式依賴，難以追蹤                 │
  └──────────────────────────────────────────┘

  Go：顯式傳遞（context.Context）
  ┌──────────────────────────────────────────┐
  │ func process(ctx context.Context) {      │
  │     userID := ctx.Value("user_id")       │
  │     child(ctx)  ← 顯式傳遞              │
  │ }                                        │
  │ 優點：資料流向清晰，易於測試             │
  │ 缺點：所有函式都需要加 ctx 參數          │
  └──────────────────────────────────────────┘
```

InheritableThreadLocal 可在建立子執行緒時複製上下文。

跨語言對比：
- C/C++: `thread_local` — 關鍵字宣告，編譯器自動為每個執行緒分配獨立儲存
- Rust: `thread_local!` — 宏定義，支援懶初始化
- Go: 常用 `context.Context` 顯式傳遞，不鼓勵隱式 thread local；這反映了 Go 「明確優於隱式」的設計哲學

```text
Thread A: user_id=42
Thread B: user_id=? (預設拿不到 A 的值)
```

## 跨語言完整範例

執行緒本地儲存：每個執行緒有自己的 user_id，互不干擾，演示隔離性。

### C

```c
/* 編譯: gcc -O2 -pthread -o ch14_c ch14.c && ./ch14_c */
#include <stdio.h>
#include <pthread.h>
#include <unistd.h>

/* thread_local 在 C11 中為 _Thread_local，gcc 支援 __thread */
static __thread int user_id = 0;

typedef struct { int set_id; const char *name; } Args;

void *thread_fn(void *arg) {
    Args *a = (Args *)arg;
    user_id = a->set_id;                  /* 只影響當前執行緒 */
    usleep(10000);                         /* 讓其他執行緒也設定自己的值 */
    printf("%-10s user_id=%d\n", a->name, user_id);
    return NULL;
}

int main(void) {
    Args args[] = {{42, "Thread-A"}, {7, "Thread-B"}, {100, "Thread-C"}};
    pthread_t threads[3];

    for (int i = 0; i < 3; i++)
        pthread_create(&threads[i], NULL, thread_fn, &args[i]);
    for (int i = 0; i < 3; i++)
        pthread_join(threads[i], NULL);

    printf("Main thread user_id=%d (never set, remains 0)\n", user_id);
    return 0;
}
```

### C++

```cpp
// 編譯: g++ -std=c++17 -O2 -pthread -o ch14_cpp ch14.cpp && ./ch14_cpp
#include <iostream>
#include <thread>
#include <vector>
#include <chrono>

thread_local int user_id = 0;          // 每個執行緒各自的 user_id
thread_local std::string request_id;   // 每個執行緒各自的 request_id

void handle_request(int uid, const std::string &rid) {
    user_id    = uid;
    request_id = rid;
    std::this_thread::sleep_for(std::chrono::milliseconds(10));

    // 讀回自己的值，不受其他執行緒影響
    std::cout << "Thread " << std::this_thread::get_id()
              << " user_id=" << user_id
              << " request_id=" << request_id << "\n";
}

int main() {
    std::vector<std::thread> threads;
    threads.emplace_back(handle_request, 42,  "req-001");
    threads.emplace_back(handle_request, 7,   "req-002");
    threads.emplace_back(handle_request, 100, "req-003");
    for (auto &t : threads) t.join();
    std::cout << "main thread: user_id=" << user_id
              << " (0，從未設定)\n";
    return 0;
}
```

### Rust

```rust
// 執行: cargo run 或 rustc ch14.rs -o ch14 && ./ch14
use std::cell::RefCell;
use std::thread;

thread_local! {
    static USER_ID:    RefCell<i32>     = RefCell::new(0);
    static REQUEST_ID: RefCell<String>  = RefCell::new(String::new());
}

fn handle_request(uid: i32, rid: &'static str) {
    USER_ID.with(|u| *u.borrow_mut() = uid);
    REQUEST_ID.with(|r| *r.borrow_mut() = rid.to_string());

    thread::sleep(std::time::Duration::from_millis(10));

    USER_ID.with(|u| {
        REQUEST_ID.with(|r| {
            println!("thread {:?}: user_id={}, request_id={}",
                     thread::current().id(), u.borrow(), r.borrow());
        });
    });
}

fn main() {
    let handles: Vec<_> = vec![
        (42,  "req-001"),
        (7,   "req-002"),
        (100, "req-003"),
    ].into_iter().map(|(uid, rid)| {
        thread::spawn(move || handle_request(uid, rid))
    }).collect();

    for h in handles { h.join().unwrap(); }
    USER_ID.with(|u| println!("main: user_id={} (0，從未設定)", u.borrow()));
}
```

### Go

```go
// 執行: go run ch14.go
// Go 不推薦隱式 thread-local，改用 context.Context 顯式傳遞
package main

import (
	"context"
	"fmt"
	"sync"
	"time"
)

type contextKey string

const keyUserID    contextKey = "user_id"
const keyRequestID contextKey = "request_id"

// handleRequest 接收 context，從中讀取執行緒「本地」資料
// 這是 Go 的慣用做法：顯式傳遞，不依賴隱式 goroutine-local
func handleRequest(ctx context.Context, wg *sync.WaitGroup) {
	defer wg.Done()
	time.Sleep(10 * time.Millisecond)

	uid := ctx.Value(keyUserID)
	rid := ctx.Value(keyRequestID)
	fmt.Printf("goroutine: user_id=%v, request_id=%v\n", uid, rid)
}

func main() {
	var wg sync.WaitGroup
	requests := []struct {
		userID    int
		requestID string
	}{
		{42, "req-001"},
		{7, "req-002"},
		{100, "req-003"},
	}

	for _, req := range requests {
		ctx := context.WithValue(context.Background(), keyUserID, req.userID)
		ctx = context.WithValue(ctx, keyRequestID, req.requestID)
		wg.Add(1)
		go handleRequest(ctx, &wg)
	}
	wg.Wait()
	fmt.Println("Done — Go 使用 context 顯式傳遞，語意清晰")
}
```

### Python

```python
# 執行: python3 ch14.py
import threading
import time


# threading.local() 為每個執行緒提供獨立的命名空間
local_storage = threading.local()


def handle_request(user_id: int, request_id: str):
    """每個執行緒設定自己的 local 變數，互不干擾。"""
    local_storage.user_id    = user_id
    local_storage.request_id = request_id
    time.sleep(0.01)   # 讓其他執行緒也在設定自己的值

    # 讀回自己設定的值
    print(f"{threading.current_thread().name}: "
          f"user_id={local_storage.user_id}, "
          f"request_id={local_storage.request_id}")


if __name__ == "__main__":
    requests = [(42, "req-001"), (7, "req-002"), (100, "req-003")]
    threads = [
        threading.Thread(target=handle_request, args=(uid, rid),
                         name=f"Thread-{i}")
        for i, (uid, rid) in enumerate(requests)
    ]
    for t in threads: t.start()
    for t in threads: t.join()

    # 主執行緒從未設定，讀取會拋出 AttributeError
    try:
        print(f"main: user_id={local_storage.user_id}")
    except AttributeError:
        print("main: user_id 未設定（符合預期，各執行緒隔離）")
```

## 完整專案級範例（Python）

檔案：`examples/python/ch14.py`

```bash
python3 examples/python/ch14.py
```

```python
"""Chapter 14: thread local — 執行緒本地儲存，每個執行緒持有獨立副本。"""
import threading

local = threading.local()


def run(name: str, uid: int):
    """設定執行緒本地的 user_id，讀回時只看到自己設定的值。"""
    local.user_id = uid
    # 即使其他執行緒同時修改各自的 user_id，這裡讀到的仍是自己的值
    print(f"{name} user_id={local.user_id}")


if __name__ == "__main__":
    t1 = threading.Thread(target=run, args=("T1", 42))
    t2 = threading.Thread(target=run, args=("T2", 7))
    t1.start(); t2.start(); t1.join(); t2.join()
    # 主執行緒從未設定，驗證隔離性
    try:
        print(f"main user_id={local.user_id}")
    except AttributeError:
        print("main: user_id 不存在（各執行緒完全隔離）")
```
