"""Chapter 02: race risk and lock."""
import threading

counter = 0
lock = threading.Lock()


def inc(n: int):
    global counter
    for _ in range(n):
        with lock:
            counter += 1


if __name__ == "__main__":
    threads = [threading.Thread(target=inc, args=(50_000,)) for _ in range(4)]
    for t in threads: t.start()
    for t in threads: t.join()
    print("counter=", counter)
