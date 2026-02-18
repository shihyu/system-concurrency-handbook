"""Chapter 14: thread local."""
import threading

local = threading.local()


def run(name: str, uid: int):
    local.user_id = uid
    print(name, local.user_id)


if __name__ == "__main__":
    t1 = threading.Thread(target=run, args=("T1", 42))
    t2 = threading.Thread(target=run, args=("T2", 7))
    t1.start(); t2.start(); t1.join(); t2.join()
