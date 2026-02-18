"""Chapter 17: rw-lock cache (simple)."""
import threading

cache = {}
lock = threading.RLock()


def get_or_load(k: str) -> int:
    with lock:
        if k in cache:
            return cache[k]
    with lock:
        if k not in cache:
            cache[k] = len(k)
        return cache[k]


if __name__ == "__main__":
    print(get_or_load("alpha"))
    print(get_or_load("alpha"))
