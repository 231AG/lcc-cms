/*
 * Progressive enhancements for the server-rendered screens.
 *
 * Loaded with `defer` by the pages that need it. Like public/theme.js this is a
 * same-origin file rather than an inline script, because the app's CSP is
 * `script-src 'self'` with no nonce (src/proxy.ts) -- and, like theme.js, it
 * deliberately does not depend on React hydration, so it keeps working on
 * pages the app renders with no client bundle at all.
 *
 * Everything here is additive. Setting `data-enhanced` on <html> is what
 * reveals the `.enhance-only` controls (see globals.css): if this file never
 * runs, those controls stay hidden instead of sitting on the page doing
 * nothing, and every screen still works as plain HTML.
 */
(function () {
  var root = document.documentElement;
  root.dataset.enhanced = "";

  document.addEventListener("click", function (event) {
    var target = event.target;
    if (!target || !target.closest) return;

    // --- Show/hide password ------------------------------------------------
    var toggle = target.closest("[data-password-toggle]");
    if (toggle) {
      var field = document.getElementById(toggle.getAttribute("data-password-toggle"));
      if (!field) return;
      var show = field.type === "password";
      field.type = show ? "text" : "password";
      toggle.setAttribute("aria-pressed", show ? "true" : "false");
      toggle.setAttribute("aria-label", show ? "Hide password" : "Show password");
      // Which icon shows is driven off aria-pressed in globals.css.

      // Keep the caret where the user left it rather than jumping to the end.
      var caret = field.selectionStart;
      field.focus();
      if (caret !== null) {
        try {
          field.setSelectionRange(caret, caret);
        } catch {
          /* setSelectionRange isn't supported on every input type; harmless. */
        }
      }
      return;
    }

    // --- Go back -----------------------------------------------------------
    if (target.closest("[data-history-back]")) {
      if (history.length > 1) history.back();
      return;
    }
  });

  // --- Auto-submitting filters -----------------------------------------------
  // A filter <select> marked `data-auto-submit` applies as soon as you choose
  // a value, instead of making you find an Apply button afterwards. The button
  // is still rendered and still works -- it is what the free-text fields use,
  // and it is the whole control when scripts are blocked -- so this is purely
  // additive, exactly like everything else in this file.
  document.addEventListener("change", function (event) {
    var control = event.target;
    if (!control || !control.matches || !control.matches("[data-auto-submit]")) return;
    var form = control.form;
    if (!form) return;
    // requestSubmit() runs the form's own validation and fires `submit`, so a
    // required field still blocks and the submit-feedback handler below still
    // sees it; form.submit() would skip both.
    if (typeof form.requestSubmit === "function") form.requestSubmit();
    else form.submit();
  });

  // --- Submit feedback -------------------------------------------------------
  // Marks the form as in flight so the button can show a spinner. The button is
  // disabled on a later tick, never synchronously: disabling it inside the
  // submit handler can cancel the submission itself in some browsers.
  document.addEventListener("submit", function (event) {
    var form = event.target;
    if (!form || !form.hasAttribute || !form.hasAttribute("data-submit-feedback")) return;
    if (form.dataset.submitting === "") return;

    form.dataset.submitting = "";
    setTimeout(function () {
      var button = form.querySelector('button[type="submit"]');
      if (button) {
        button.disabled = true;
        button.setAttribute("aria-busy", "true");
      }
    }, 0);
  });
})();
