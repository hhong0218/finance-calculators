/*
 * QuieTools analytics helpers (calc.quietools.com)
 * - qtEvent(name, params): thin gtag('event') wrapper, safe if gtag missing
 * - Copy-result button: auto-injected into #resultsPanel[data-tool], fires copy_result
 * - tool_nav: delegated click listener on internal tool/calculator cards
 * Loaded via <script src="/assets/analytics.js" defer></script> after gtag.
 */
(function () {
  "use strict";

  function qtEvent(name, params) {
    if (typeof window.gtag === "function") {
      try { window.gtag("event", name, params || {}); } catch (e) { /* no-op */ }
    }
  }
  window.qtEvent = qtEvent;

  function copyResult(tool, btn) {
    var panel = document.getElementById("resultsPanel");
    if (!panel) return;
    var text = (panel.innerText || panel.textContent || "").trim().replace(/\n{3,}/g, "\n\n");
    function done(ok) {
      qtEvent("copy_result", { tool: tool, ok: ok });
      if (btn) {
        var prev = btn.textContent;
        btn.textContent = ok ? "✓ Copied" : "Copy failed";
        setTimeout(function () { btn.textContent = prev; }, 1600);
      }
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(function () { done(true); }, function () { done(false); });
    } else {
      try {
        var ta = document.createElement("textarea");
        ta.value = text;
        ta.setAttribute("readonly", "");
        ta.style.position = "absolute";
        ta.style.left = "-9999px";
        document.body.appendChild(ta);
        ta.select();
        document.execCommand("copy");
        ta.remove();
        done(true);
      } catch (e) { done(false); }
    }
  }
  window.qtCopyResult = copyResult;

  // Auto-inject a "Copy result" button into a tagged results panel.
  function injectCopyButton() {
    var panel = document.getElementById("resultsPanel");
    if (!panel) return;
    var tool = panel.getAttribute("data-tool");
    if (!tool || panel.querySelector(".qt-copy-btn")) return;

    var bar = document.createElement("div");
    bar.style.cssText = "display:flex;justify-content:flex-end;margin-bottom:.6rem";

    var btn = document.createElement("button");
    btn.type = "button";
    btn.className = "qt-copy-btn";
    btn.textContent = "📋 Copy result";
    btn.style.cssText =
      "font:inherit;font-size:.85rem;font-weight:600;cursor:pointer;" +
      "color:var(--accent,#1d6f5c);background:var(--panel,#fff);" +
      "border:1px solid var(--border,#dee7e4);border-radius:8px;padding:.4rem .7rem;";
    btn.addEventListener("click", function () { copyResult(tool, btn); });

    bar.appendChild(btn);
    panel.insertBefore(bar, panel.firstChild);
  }

  // tool_nav: fire when a user clicks a tool/calculator card or a tagged nav link.
  function onDocClick(e) {
    var a = e.target && e.target.closest ? e.target.closest("a[href]") : null;
    if (!a) return;
    if (a.classList.contains("card") || a.hasAttribute("data-nav")) {
      qtEvent("tool_nav", { to: a.getAttribute("href") || "" });
    }
  }

  function init() {
    injectCopyButton();
    document.addEventListener("click", onDocClick, true);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
