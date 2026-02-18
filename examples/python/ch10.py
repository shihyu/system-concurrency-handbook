"""Chapter 10: CAS increment loop."""
import threading


class AtomicInt:
    def __init__(self):
        self.v = 0
        self.m = threading.Lock()

    def cas(self, expect: int, new: int) -> bool:
        with self.m:
            if self.v == expect:
                self.v = new
                return True
            return False


if __name__ == "__main__":
    a = AtomicInt()
    for _ in range(5):
        while True:
            old = a.v
            if a.cas(old, old + 1):
                break
    print("value=", a.v)
