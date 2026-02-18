(function () {
  function closestWrap(node) {
    var cur = node;
    while (cur) {
      if (cur.nodeType === 1 && cur.classList && cur.classList.contains("ascii-svg-wrap")) {
        return cur;
      }
      cur = cur.parentNode;
    }
    return null;
  }

  function decodeB64Utf8(b64) {
    var bin = atob(b64);
    var bytes = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) {
      bytes[i] = bin.charCodeAt(i);
    }
    return new TextDecoder("utf-8").decode(bytes);
  }

  document.addEventListener("copy", function (event) {
    var sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) {
      return;
    }

    var range = sel.getRangeAt(0);
    var startWrap = closestWrap(range.startContainer);
    var endWrap = closestWrap(range.endContainer);
    var wrap = null;

    if (startWrap && startWrap === endWrap) {
      wrap = startWrap;
    } else if (startWrap && !endWrap) {
      wrap = startWrap;
    } else if (!startWrap && endWrap) {
      wrap = endWrap;
    }

    if (!wrap) {
      return;
    }

    var b64 = wrap.getAttribute("data-ascii-b64");
    if (!b64) {
      return;
    }

    try {
      var raw = decodeB64Utf8(b64);
      event.clipboardData.setData("text/plain", raw);
      event.preventDefault();
    } catch (e) {
      // fall back to browser default copy behavior
    }
  });
})();
