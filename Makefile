.DEFAULT_GOAL := help

BOOK_DIR := .
BOOK_OUT := book

.PHONY: help build serve clean github

help:
	@echo "可用目標："
	@echo "  make build   - 編譯 mdBook"
	@echo "  make serve   - 啟動本地預覽"
	@echo "  make clean   - 清除編譯輸出"
	@echo "  make github  - 發佈到 GitHub Pages"

build:
	@mdbook build $(BOOK_DIR)
	@echo "建置完成：$(BOOK_OUT)/index.html"

serve:
	@mdbook serve $(BOOK_DIR)

clean:
	@rm -rf $(BOOK_OUT)

github:
	@ghp-import $(BOOK_OUT) -p -n
