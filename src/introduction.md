# 前言：如何讀這本並發書

這本書雖然以 Java 展開，但大部分核心概念都不是 Java 專屬，而是所有高並發系統都要面對的通用問題。

## 三句話抓重點

1. 並發問題的根源是「多執行單元同時碰同一份資料」。
2. 解法分三層：語言層（原子/鎖）、執行時層（排程/執行緒池）、架構層（分散式鎖/削峰）。
3. 高吞吐不是只靠語法，而是整條鏈路一起優化。

## 統一心智模型

```text
請求 -> 任務切分 -> 排隊 -> 執行 -> 寫回資料
           |         |       |
         分工      背壓    一致性
```

## 語言對照最小表

| 通用概念 | Java | C/C++ | Rust | Go |
|---|---|---|---|---|
| 執行單元 | Thread | std::thread/pthread | std::thread | goroutine |
| 互斥 | synchronized/Lock | mutex | Mutex<T> | sync.Mutex |
| 原子 | Atomic* | std::atomic | Atomic* | sync/atomic |
| 可見性順序 | JMM | C++ memory model | 同 C++ 原子語義 | Go memory model |

## 閱讀建議

- 先讀第 1~6 章建立底層觀念。
- 再讀第 7~14 章看語言與框架實作。
- 最後讀第 15~20 章把概念落到工程。
