"""Chapter 18: reentrant lock."""
import threading

r = threading.RLock()


def outer():
    with r:
        inner()


def inner():
    with r:
        print("reentered")


if __name__ == "__main__":
    outer()
