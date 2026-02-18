"""Chapter 01: OS scheduling and threads."""
import os
import threading
import time


def work(name: str):
    for i in range(3):
        print(f"{name} tick {i}")
        time.sleep(0.05)


if __name__ == "__main__":
    print("cpu_count=", os.cpu_count())
    t1 = threading.Thread(target=work, args=("T1",))
    t2 = threading.Thread(target=work, args=("T2",))
    t1.start(); t2.start()
    t1.join(); t2.join()
