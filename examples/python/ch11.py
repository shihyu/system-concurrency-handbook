"""Chapter 11: deadlock avoidance via timeout."""
import threading
import time

A = threading.Lock()
B = threading.Lock()


def worker1():
    with A:
        time.sleep(0.05)
        if B.acquire(timeout=0.1):
            print("w1 got B")
            B.release()
        else:
            print("w1 timeout on B")


def worker2():
    with B:
        time.sleep(0.05)
        if A.acquire(timeout=0.1):
            print("w2 got A")
            A.release()
        else:
            print("w2 timeout on A")


if __name__ == "__main__":
    t1 = threading.Thread(target=worker1)
    t2 = threading.Thread(target=worker2)
    t1.start(); t2.start(); t1.join(); t2.join()
