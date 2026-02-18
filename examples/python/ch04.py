"""Chapter 04: visibility/order via event."""
import threading
import time

ready = threading.Event()
data = {"value": None}


def writer():
    data["value"] = 42
    ready.set()


def reader():
    ready.wait()
    print("read value=", data["value"])


if __name__ == "__main__":
    t1 = threading.Thread(target=writer)
    t2 = threading.Thread(target=reader)
    t2.start(); time.sleep(0.02); t1.start()
    t1.join(); t2.join()
