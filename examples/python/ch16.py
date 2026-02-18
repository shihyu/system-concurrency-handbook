"""Chapter 16: spin lock."""
import threading
import time


class SpinLock:
    def __init__(self):
        self._flag = False
        self._guard = threading.Lock()

    def lock(self):
        while True:
            with self._guard:
                if not self._flag:
                    self._flag = True
                    return
            time.sleep(0)

    def unlock(self):
        with self._guard:
            self._flag = False


if __name__ == "__main__":
    l = SpinLock()
    state = {"x": 0}

    def work():
        for _ in range(5000):
            l.lock()
            state["x"] += 1
            l.unlock()

    ts = [threading.Thread(target=work) for _ in range(4)]
    for t in ts: t.start()
    for t in ts: t.join()
    print("x=", state["x"])
