"""Chapter 09: lock family (Lock/RLock/Condition)."""
import threading

rlock = threading.RLock()
cond = threading.Condition(rlock)
ready = False


def producer():
    global ready
    with rlock:
        ready = True
        cond.notify_all()


def consumer():
    with rlock:
        while not ready:
            cond.wait()
        print("consumer got signal")


if __name__ == "__main__":
    t1 = threading.Thread(target=consumer)
    t2 = threading.Thread(target=producer)
    t1.start(); t2.start(); t1.join(); t2.join()
