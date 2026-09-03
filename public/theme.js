/*
 * Light/dark theme runtime. Served from public/ and loaded as a plain
 * render-blocking <script src> at the top of <body> in the root layout.
 *
 * Why a separate file rather than an inline script in the layout: the app
 * ships a strict `script-src 'self'` CSP (src/proxy.ts) with no nonce and no
 * 'unsafe-inline', so an inline <script> is refused by the browser. A
 * same-origin file satisfies 'self' as-is, which keeps the theme toggle
 * working without loosening the CSP.
 *
 * Why the click handling lives here rather than in a React client component:
 * this file runs on its own, with no dependency on hydration, which suits an
 * app whose pages are deliberately server-rendered with no client JS.
 *
 * Two jobs, in order:
 *   1. Before first paint, apply a stored preference to <html> so a user who
 *      chose the theme that isn't their OS default never sees a flash of the
 *      other one. Nothing is written when no preference is stored -- CSS
 *      (`color-scheme: light dark` in globals.css) then follows the OS, and
 *      keeps following it live.
 *   2. Register one delegated click listener for the header toggle.
 */
(function () {
  var STORAGE_KEY = "lcc-theme";
  var root = document.documentElement;

  function stored() {
    try {
      var value = localStorage.getItem(STORAGE_KEY);
      return value === "light" || value === "dark" ? value : null;
    } catch {
      // Storage unavailable (private mode, cookies blocked): fall through to
      // the OS preference rather than throwing before the page renders.
      return null;
    }
  }

  var preference = stored();
  if (preference) root.dataset.theme = preference;

  document.addEventListener("click", function (event) {
    var target = event.target;
    if (!target || !target.closest) return;
    if (!target.closest("[data-theme-toggle]")) return;

    // No attribute yet means "following the OS", so read the OS to work out
    // which theme the user is actually looking at before flipping away from it.
    var current =
      root.dataset.theme === "dark" || root.dataset.theme === "light"
        ? root.dataset.theme
        : window.matchMedia("(prefers-color-scheme: dark)").matches
          ? "dark"
          : "light";
    var next = current === "dark" ? "light" : "dark";

    root.dataset.theme = next;
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // The theme still applies for this page view, it just isn't remembered.
    }
  });
})();
