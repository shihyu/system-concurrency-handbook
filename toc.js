// Populate the sidebar
//
// This is a script, and not included directly in the page, to control the total size of the book.
// The TOC contains an entry for each page, so if each page includes a copy of the TOC,
// the total size of the page becomes O(n**2).
class MDBookSidebarScrollbox extends HTMLElement {
    constructor() {
        super();
    }
    connectedCallback() {
        this.innerHTML = '<ol class="chapter"><li class="chapter-item expanded "><a href="introduction.html"><strong aria-hidden="true">1.</strong> 前言：如何讀這本並發書</a></li><li class="chapter-item expanded "><a href="ch01-os-scheduling.html"><strong aria-hidden="true">2.</strong> 第1章 作業系統與線程調度</a></li><li class="chapter-item expanded "><a href="ch02-basics-risks.html"><strong aria-hidden="true">3.</strong> 第2章 並發基礎概念與風險</a></li><li class="chapter-item expanded "><a href="ch03-core-problems.html"><strong aria-hidden="true">4.</strong> 第3章 三大核心問題：分工、同步、互斥</a></li><li class="chapter-item expanded "><a href="ch04-atomic-visibility-order.html"><strong aria-hidden="true">5.</strong> 第4章 本質問題：原子性、可見性、有序性</a></li><li class="chapter-item expanded "><a href="ch05-atomic-foundation.html"><strong aria-hidden="true">6.</strong> 第5章 原子性底層</a></li><li class="chapter-item expanded "><a href="ch06-visibility-order-foundation.html"><strong aria-hidden="true">7.</strong> 第6章 可見性與有序性底層</a></li><li class="chapter-item expanded "><a href="ch07-synchronized-jvm-lock.html"><strong aria-hidden="true">8.</strong> 第7章 synchronized 與 JVM 鎖實作</a></li><li class="chapter-item expanded "><a href="ch08-aqs.html"><strong aria-hidden="true">9.</strong> 第8章 AQS 佇列同步器</a></li><li class="chapter-item expanded "><a href="ch09-lock-family.html"><strong aria-hidden="true">10.</strong> 第9章 Lock 家族</a></li><li class="chapter-item expanded "><a href="ch10-cas.html"><strong aria-hidden="true">11.</strong> 第10章 CAS</a></li><li class="chapter-item expanded "><a href="ch11-deadlock.html"><strong aria-hidden="true">12.</strong> 第11章 死鎖</a></li><li class="chapter-item expanded "><a href="ch12-lock-optimization.html"><strong aria-hidden="true">13.</strong> 第12章 鎖優化</a></li><li class="chapter-item expanded "><a href="ch13-threadpool.html"><strong aria-hidden="true">14.</strong> 第13章 線程池</a></li><li class="chapter-item expanded "><a href="ch14-threadlocal.html"><strong aria-hidden="true">15.</strong> 第14章 ThreadLocal</a></li><li class="chapter-item expanded "><a href="ch15-threadpool-practice.html"><strong aria-hidden="true">16.</strong> 第15章 手寫線程池實戰</a></li><li class="chapter-item expanded "><a href="ch16-cas-spinlock-practice.html"><strong aria-hidden="true">17.</strong> 第16章 CAS 自旋鎖實戰</a></li><li class="chapter-item expanded "><a href="ch17-rwlock-cache-practice.html"><strong aria-hidden="true">18.</strong> 第17章 讀寫鎖快取實戰</a></li><li class="chapter-item expanded "><a href="ch18-aqs-reentrant-practice.html"><strong aria-hidden="true">19.</strong> 第18章 AQS 可重入鎖實戰</a></li><li class="chapter-item expanded "><a href="ch19-distributed-lock.html"><strong aria-hidden="true">20.</strong> 第19章 分散式鎖架構</a></li><li class="chapter-item expanded "><a href="ch20-seckill-architecture.html"><strong aria-hidden="true">21.</strong> 第20章 秒殺系統架構</a></li><li class="chapter-item expanded "><a href="appendix-language-map.html"><strong aria-hidden="true">22.</strong> 附錄：Java/C++/Rust/Go 對照速查</a></li></ol>';
        // Set the current, active page, and reveal it if it's hidden
        let current_page = document.location.href.toString().split("#")[0].split("?")[0];
        if (current_page.endsWith("/")) {
            current_page += "index.html";
        }
        var links = Array.prototype.slice.call(this.querySelectorAll("a"));
        var l = links.length;
        for (var i = 0; i < l; ++i) {
            var link = links[i];
            var href = link.getAttribute("href");
            if (href && !href.startsWith("#") && !/^(?:[a-z+]+:)?\/\//.test(href)) {
                link.href = path_to_root + href;
            }
            // The "index" page is supposed to alias the first chapter in the book.
            if (link.href === current_page || (i === 0 && path_to_root === "" && current_page.endsWith("/index.html"))) {
                link.classList.add("active");
                var parent = link.parentElement;
                if (parent && parent.classList.contains("chapter-item")) {
                    parent.classList.add("expanded");
                }
                while (parent) {
                    if (parent.tagName === "LI" && parent.previousElementSibling) {
                        if (parent.previousElementSibling.classList.contains("chapter-item")) {
                            parent.previousElementSibling.classList.add("expanded");
                        }
                    }
                    parent = parent.parentElement;
                }
            }
        }
        // Track and set sidebar scroll position
        this.addEventListener('click', function(e) {
            if (e.target.tagName === 'A') {
                sessionStorage.setItem('sidebar-scroll', this.scrollTop);
            }
        }, { passive: true });
        var sidebarScrollTop = sessionStorage.getItem('sidebar-scroll');
        sessionStorage.removeItem('sidebar-scroll');
        if (sidebarScrollTop) {
            // preserve sidebar scroll position when navigating via links within sidebar
            this.scrollTop = sidebarScrollTop;
        } else {
            // scroll sidebar to current active section when navigating via "next/previous chapter" buttons
            var activeSection = document.querySelector('#sidebar .active');
            if (activeSection) {
                activeSection.scrollIntoView({ block: 'center' });
            }
        }
        // Toggle buttons
        var sidebarAnchorToggles = document.querySelectorAll('#sidebar a.toggle');
        function toggleSection(ev) {
            ev.currentTarget.parentElement.classList.toggle('expanded');
        }
        Array.from(sidebarAnchorToggles).forEach(function (el) {
            el.addEventListener('click', toggleSection);
        });
    }
}
window.customElements.define("mdbook-sidebar-scrollbox", MDBookSidebarScrollbox);
