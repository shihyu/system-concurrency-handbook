"""Chapter 20: seckill pipeline demo."""
import queue
import threading

stock = 5
q: queue.Queue[str] = queue.Queue()
mu = threading.Lock()


def worker():
    global stock
    while True:
        user = q.get()
        if user == "STOP":
            return
        with mu:
            if stock > 0:
                stock -= 1
                print(user, "success, left", stock)
            else:
                print(user, "sold out")


if __name__ == "__main__":
    t = threading.Thread(target=worker)
    t.start()
    for i in range(10):
        q.put(f"u{i}")
    q.put("STOP")
    t.join()
