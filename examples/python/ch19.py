"""Chapter 19: distributed lock protocol (mocked redis)."""
import time


class MockRedis:
    def __init__(self):
        self.store = {}

    def set_nx_px(self, key: str, val: str, ttl_ms: int) -> bool:
        now = time.time() * 1000
        cur = self.store.get(key)
        if cur and cur[1] > now:
            return False
        self.store[key] = (val, now + ttl_ms)
        return True

    def unlock_if_value(self, key: str, val: str) -> bool:
        cur = self.store.get(key)
        if cur and cur[0] == val:
            del self.store[key]
            return True
        return False


if __name__ == "__main__":
    r = MockRedis()
    owner = "uuid-a"
    ok = r.set_nx_px("lock:order", owner, 3000)
    print("lock acquired", ok)
    print("unlock", r.unlock_if_value("lock:order", owner))
