/* OAY figures on the accountant card: the refresh button loads them in place. Help only: without JS the button
   posts the card and the page comes back with the figures. The server holds the figures and checks every post. */
(function () {
  "use strict";
  if (!window.fetch || !window.DOMParser) { return; }

  function apply(form, doc) {
    var fresh = doc.querySelector("[data-ehr-card-form] [data-ehr-fin-status]");
    var status = form.querySelector("[data-ehr-fin-status]");
    if (!fresh || !status) { return false; }
    status.innerHTML = fresh.innerHTML;
    Array.prototype.forEach.call(form.querySelectorAll("[data-ehr-fin-line]"), function (input) {
      var key = input.getAttribute("data-ehr-fin-line");
      var next = doc.querySelector('[data-ehr-card-form] [data-ehr-fin-line="' + key + '"]');
      if (!next) { return; }
      if (key === "payroll_to_month") {
        if (!input.value.trim()) { input.value = next.value; }
        return;
      }
      if (next.hasAttribute("readonly") || input.hasAttribute("readonly")) { input.value = next.value; }
      input.readOnly = next.hasAttribute("readonly");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    return true;
  }

  Array.prototype.forEach.call(document.querySelectorAll("[data-ehr-refresh]"), function (button) {
    button.addEventListener("click", function (ev) {
      var form = button.form;
      if (!form) { return; }
      ev.preventDefault();
      var data = new FormData(form);
      data.set("refresh", "1");
      button.disabled = true;
      button.setAttribute("aria-busy", "true");
      fetch(form.action, { method: "POST", body: data, credentials: "same-origin" })
        .then(function (r) { if (!r.ok) { throw new Error("status"); } return r.text(); })
        .then(function (html) {
          if (!apply(form, new DOMParser().parseFromString(html, "text/html"))) { throw new Error("shape"); }
          button.disabled = false;
          button.removeAttribute("aria-busy");
        })
        .catch(function () {
          button.disabled = false;
          button.removeAttribute("aria-busy");
          if (form.requestSubmit) { form.requestSubmit(button); } else { form.submit(); }
        });
    });
  });
})();
