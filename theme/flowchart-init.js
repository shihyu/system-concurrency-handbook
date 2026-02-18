(() => {
  const LIBS = [
    "https://cdnjs.cloudflare.com/ajax/libs/raphael/2.3.0/raphael.min.js",
    "https://cdnjs.cloudflare.com/ajax/libs/flowchart/1.17.1/flowchart.min.js",
  ];

  const SELECTOR = [
    "pre code.language-flowchart",
    "pre code.language-flow",
    "pre code.lang-flowchart",
    "pre code.lang-flow",
  ].join(",");

  function loadScript(src) {
    return new Promise((resolve, reject) => {
      const tag = document.createElement("script");
      tag.src = src;
      tag.async = false;
      tag.onload = () => resolve();
      tag.onerror = () => reject(new Error(`load failed: ${src}`));
      document.head.appendChild(tag);
    });
  }

  async function ensureDeps() {
    if (window.flowchart && window.Raphael) return;
    for (const src of LIBS) {
      await loadScript(src);
    }
  }

  function renderFlowcharts() {
    const blocks = Array.from(document.querySelectorAll(SELECTOR));
    blocks.forEach((code, i) => {
      if (code.dataset.flowchartRendered === "1") return;

      const source = code.textContent.trim();
      if (!source) return;

      const pre = code.closest("pre");
      if (!pre || pre.dataset.flowchartRendered === "1") return;

      const host = document.createElement("div");
      host.className = "flowchart-diagram";
      host.id = `flowchart-${Date.now()}-${i}`;
      pre.insertAdjacentElement("afterend", host);

      try {
        const chart = window.flowchart.parse(source);
        chart.drawSVG(host.id, {
          lineWidth: 2,
          lineLength: 42,
          textMargin: 10,
          fontSize: 14,
          fontFamily: "monospace",
          yesText: "Yes",
          noText: "No",
          arrowEnd: "block",
        });
        pre.style.display = "none";
        pre.dataset.flowchartRendered = "1";
        code.dataset.flowchartRendered = "1";
      } catch (err) {
        host.classList.add("flowchart-error");
        host.textContent = `Flowchart parse error: ${err.message}`;
      }
    });
  }

  async function boot() {
    try {
      await ensureDeps();
      renderFlowcharts();
    } catch (err) {
      console.error("[flowchart] init failed:", err);
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot, { once: true });
  } else {
    boot();
  }
})();
