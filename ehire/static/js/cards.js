/* Action cards on the request page. Vanilla JS. Everything here is help: the server decides and checks every answer. */
(function () {
  "use strict";

  // 1. ?do=review (the email button) and a failed post bring the card into view and focus it.
  var params = new URLSearchParams(window.location.search);
  var focusTarget = document.querySelector("[data-ehire-card][data-ehire-focus]");
  if (!focusTarget && params.get("do") === "review") { focusTarget = document.querySelector("[data-ehire-card]"); }
  if (focusTarget) {
    var inner = focusTarget.querySelector("[data-ehire-card-errors]");
    var reduce = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    focusTarget.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "start" });
    (inner || focusTarget).focus({ preventScroll: true });
    // A failed post: take the person to the first field with a problem, so the message sits next to it.
    var bad = inner ? focusTarget.querySelector(".is-invalid, [aria-invalid='true']") : null;
    if (bad) {
      var lesser = bad.closest("details");
      if (lesser) { lesser.open = true; }
      bad.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "center" });
      bad.focus({ preventScroll: true });
    }
  }

  // 2. A comment is needed before sending a negative answer, a rejection or a return. The server enforces it.
  Array.prototype.forEach.call(document.querySelectorAll("[data-ehire-card-form]"), function (form) {
    var box = form.querySelector("[data-ehire-comment]");
    var message = form.querySelector("[data-ehire-comment-error]");
    if (!box || !message) { return; }

    function show(on) {
      message.hidden = !on;
      message.classList.toggle("d-block", on);
      box.classList.toggle("is-invalid", on);
      if (on) { box.setAttribute("aria-invalid", "true"); } else { box.removeAttribute("aria-invalid"); }
    }
    box.addEventListener("input", function () { if (box.value.trim()) { show(false); } });

    form.addEventListener("submit", function (ev) {
      var submitter = ev.submitter;
      var needs = (submitter && submitter.hasAttribute("data-ehire-needs-comment")) ||
        !!form.querySelector("[data-ehire-negative]:checked");
      if (needs && !box.value.trim()) {
        ev.preventDefault();
        show(true);
        box.focus({ preventScroll: true });
        box.scrollIntoView({ behavior: "auto", block: "center" });
        return;
      }
      // Double submit: block the second click after the browser has read the form.
      var buttons = form.querySelectorAll("button[type=submit]");
      window.setTimeout(function () {
        Array.prototype.forEach.call(buttons, function (b) { b.disabled = true; });
      }, 0);
    });
  });

  // 3. Revenue per 1 of payroll, worked out while typing. Amounts are typed as 1.234,56. Nothing is stored.
  function amount(text) {
    var v = (text || "").trim().replace(/\s/g, "");
    if (!/^(\d{1,3}(\.\d{3})+|\d+)(,\d{1,2})?$/.test(v)) { return null; }
    return parseFloat(v.replace(/\./g, "").replace(",", "."));
  }
  function format(n) {
    var parts = n.toFixed(2).split(".");
    parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ".");
    return parts.join(",");
  }
  Array.prototype.forEach.call(document.querySelectorAll("[data-ehire-ratio]"), function (out) {
    var period = out.getAttribute("data-ehire-ratio");
    var revenue = document.querySelector('[data-ehire-fin="' + period + '.revenue"]');
    var payroll = document.querySelector('[data-ehire-fin="' + period + '.payroll_cost"]');
    if (!revenue || !payroll) { return; }
    function update() {
      var r = amount(revenue.value), p = amount(payroll.value);
      out.textContent = (r !== null && p !== null && p !== 0) ? format(r / p) : "";
    }
    revenue.addEventListener("input", update);
    payroll.addEventListener("input", update);
  });
})();
