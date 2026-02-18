"""Chapter 13: thread pool."""
from concurrent.futures import ThreadPoolExecutor


def square(x: int) -> int:
    return x * x


if __name__ == "__main__":
    with ThreadPoolExecutor(max_workers=4) as ex:
        out = list(ex.map(square, range(8)))
    print(out)
