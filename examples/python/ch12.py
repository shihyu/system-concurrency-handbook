"""Chapter 12: lock sharding."""
import threading

SHARDS = 8
locks = [threading.Lock() for _ in range(SHARDS)]
data = [0] * SHARDS


def update(key: int):
    idx = key % SHARDS
    with locks[idx]:
        data[idx] += 1


if __name__ == "__main__":
    ts = [threading.Thread(target=update, args=(i,)) for i in range(10_000)]
    for t in ts: t.start()
    for t in ts: t.join()
    print("sum=", sum(data))
