"""Chapter 03: split work + sync."""
import queue
import threading

q: queue.Queue[int] = queue.Queue()
barrier = threading.Barrier(3)


def worker(name: str):
    s = 0
    while True:
        try:
            s += q.get_nowait()
        except queue.Empty:
            break
    print(name, "partial=", s)
    barrier.wait()


if __name__ == "__main__":
    for i in range(1, 11): q.put(i)
    ts = [threading.Thread(target=worker, args=(f"W{i}",)) for i in (1, 2)]
    for t in ts: t.start()
    barrier.wait()
    print("all workers reached sync point")
    for t in ts: t.join()
