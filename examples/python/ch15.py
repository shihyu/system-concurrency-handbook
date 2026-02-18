"""Chapter 15: custom thread pool."""
import queue
import threading

q = queue.Queue()
stop = object()


def worker():
    while True:
        task = q.get()
        if task is stop:
            return
        task()


if __name__ == "__main__":
    workers = [threading.Thread(target=worker) for _ in range(3)]
    for w in workers: w.start()
    for i in range(5):
        q.put(lambda i=i: print("task", i))
    for _ in workers: q.put(stop)
    for w in workers: w.join()
