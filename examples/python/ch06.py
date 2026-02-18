"""Chapter 06: ordering with condition variable."""
import threading

cv = threading.Condition()
ready = False
payload = 0


def producer():
    global ready, payload
    with cv:
        payload = 99
        ready = True
        cv.notify_all()


def consumer():
    with cv:
        while not ready:
            cv.wait()
        print("payload=", payload)


if __name__ == "__main__":
    t1 = threading.Thread(target=consumer)
    t2 = threading.Thread(target=producer)
    t1.start(); t2.start(); t1.join(); t2.join()
