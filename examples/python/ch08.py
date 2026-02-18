"""Chapter 08: queue synchronizer flavor via semaphore."""
import threading
import time

sem = threading.Semaphore(2)


def task(i: int):
    with sem:
        print(f"task {i} enter")
        time.sleep(0.05)
        print(f"task {i} leave")


if __name__ == "__main__":
    ts = [threading.Thread(target=task, args=(i,)) for i in range(5)]
    for t in ts: t.start()
    for t in ts: t.join()
