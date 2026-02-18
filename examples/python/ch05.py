"""Chapter 05: atomicity with CAS-like primitive."""
import threading


class AtomicInt:
    def __init__(self, value: int = 0):
        self._v = value
        self._m = threading.Lock()

    def compare_and_swap(self, expect: int, new: int) -> bool:
        with self._m:
            if self._v == expect:
                self._v = new
                return True
            return False

    def get(self) -> int:
        with self._m:
            return self._v


if __name__ == "__main__":
    a = AtomicInt(10)
    print("cas 10->11", a.compare_and_swap(10, 11), "now", a.get())
