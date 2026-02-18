"""Chapter 07: synchronized equivalent in Python."""
import threading

lock = threading.Lock()
total = 0


def add():
    global total
    for _ in range(10000):
        with lock:
            total += 1


if __name__ == "__main__":
    ts = [threading.Thread(target=add) for _ in range(4)]
    for t in ts: t.start()
    for t in ts: t.join()
    print("total=", total)
