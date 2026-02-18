(function () {
  function currentTheme() {
    var root = document.documentElement;
    var darkThemes = ["navy", "coal", "ayu"];
    for (var i = 0; i < darkThemes.length; i++) {
      if (root.classList.contains(darkThemes[i])) {
        return "tokyo-night";
      }
    }
    return "github-light";
  }

  function loadBeautifulMermaid() {
    if (window.beautifulMermaid && typeof window.beautifulMermaid.renderMermaid === "function") {
      return Promise.resolve(window.beautifulMermaid);
    }

    return new Promise(function (resolve, reject) {
      var script = document.createElement("script");
      script.src = "https://cdn.jsdelivr.net/npm/beautiful-mermaid/dist/beautiful-mermaid.browser.global.js";
      script.async = true;
      script.onload = function () {
        if (window.beautifulMermaid) {
          resolve(window.beautifulMermaid);
          return;
        }
        reject(new Error("beautiful-mermaid not available on window"));
      };
      script.onerror = reject;
      document.head.appendChild(script);
    });
  }

  function diagramContainers() {
    return Array.prototype.slice.call(document.querySelectorAll("div.bm-diagram"));
  }

  function codeBlocks() {
    return Array.prototype.slice.call(document.querySelectorAll("pre code.language-mermaid"));
  }

  function materializeContainers() {
    var blocks = codeBlocks();
    for (var i = 0; i < blocks.length; i++) {
      var code = blocks[i];
      var pre = code.closest("pre");
      if (!pre) {
        continue;
      }
      var source = code.textContent || "";
      var container = document.createElement("div");
      container.className = "bm-diagram";
      container.dataset.mermaidSource = source;
      pre.replaceWith(container);
    }
  }

  function renderAll() {
    loadBeautifulMermaid()
      .then(function (bm) {
        var containers = diagramContainers();
        var themeName = currentTheme();
        var theme = (bm.THEMES && bm.THEMES[themeName]) || bm.DEFAULTS || {};
        var jobs = containers.map(function (container) {
          var source = container.dataset.mermaidSource || "";
          return bm
            .renderMermaid(source, theme)
            .then(function (svg) {
              container.innerHTML = svg;
              container.classList.add("bm-ready");
            })
            .catch(function (err) {
              container.textContent = "beautiful-mermaid render error: " + err;
              container.classList.add("bm-error");
            });
        });
        return Promise.all(jobs);
      })
      .catch(function () {
        return undefined;
      });
  }

  var rerenderTimer = null;
  function scheduleRerender() {
    if (rerenderTimer) {
      window.clearTimeout(rerenderTimer);
    }
    rerenderTimer = window.setTimeout(function () {
      renderAll();
    }, 100);
  }

  function init() {
    materializeContainers();
    renderAll();
    var html = document.documentElement;
    var observer = new MutationObserver(scheduleRerender);
    observer.observe(html, { attributes: true, attributeFilter: ["class"] });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
