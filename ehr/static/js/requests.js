/* Request form helpers. Vanilla JS. Without it the form still works: every change can be posted
   with the "refresh" button and the server draws the form again. */
(function () {
  "use strict";
  var form = document.getElementById("ehr-request-form");
  if (!form) { return; }

  // The refresh button is for browsers without scripts.
  Array.prototype.forEach.call(form.querySelectorAll("[data-ehr-nojs]"), function (el) { el.classList.add("d-none"); });

  var previewBox = document.getElementById("ehr-route-preview");
  var fields = {
    directorate: form.querySelector("#f-directorate_id"),
    facility: form.querySelector("#f-facility_id"),
    category: form.querySelector("#f-category"),
    position: form.querySelector("#f-position_id"),
    reason: form.querySelector("#f-reason")
  };

  function fillSelect(select, options) {
    var keep = select.value;
    var first = select.options[0].cloneNode(true);
    select.innerHTML = "";
    select.appendChild(first);
    options.forEach(function (o) {
      var opt = document.createElement("option");
      opt.value = String(o.id);
      opt.textContent = o.label;
      if (String(o.id) === keep) { opt.selected = true; }
      select.appendChild(opt);
    });
  }

  function loadOptions(select, params) {
    var url = form.dataset.optionsUrl + "?" + new URLSearchParams(params).toString();
    fetch(url, { credentials: "same-origin", headers: { "Accept": "application/json" } })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (data) { if (data) { fillSelect(select, data.options); } })
      .catch(function () { /* the full lists stay as the server drew them */ });
  }

  function loadPreview() {
    if (!previewBox || !fields.directorate || !fields.category) { return; }
    var params = new URLSearchParams({ directorate_id: fields.directorate.value, category: fields.category.value });
    fetch(form.dataset.previewUrl + "?" + params.toString(), { credentials: "same-origin" })
      .then(function (r) { return r.ok ? r.text() : null; })
      .then(function (html) { if (html !== null) { previewBox.innerHTML = html; } })
      .catch(function () {});
  }

  // Dependent sections are drawn by the server (the only place the rules live). The form is posted
  // with intent=refresh and the returned sections replace the current ones. Hidden fields never exist.
  function redraw(intent, focusSelector) {
    var data = new FormData(form);
    data.set("intent", intent);
    fetch(form.action, { method: "POST", body: data, credentials: "same-origin" })
      .then(function (r) { if (!r.ok) { throw new Error("redraw"); } return r.text(); })
      .then(function (html) {
        var doc = new DOMParser().parseFromString(html, "text/html");
        Array.prototype.forEach.call(form.querySelectorAll("[data-ehr-dep]"), function (box) {
          if (box === previewBox) { return; }
          var fresh = doc.querySelector('[data-ehr-dep="' + box.dataset.ehrDep + '"]');
          if (fresh) { box.innerHTML = fresh.innerHTML; }
        });
        if (focusSelector) {
          var target = form.querySelector(focusSelector);
          if (target) { target.focus(); }
        }
      })
      .catch(function () { form.requestSubmit(form.querySelector('[name="intent"][value="refresh"]')); });
  }

  if (fields.directorate) {
    fields.directorate.addEventListener("change", function () {
      if (fields.facility) { loadOptions(fields.facility, { list: "facility", directorate_id: fields.directorate.value }); }
      loadPreview();
    });
  }
  if (fields.category) {
    fields.category.addEventListener("change", function () {
      if (fields.position) { loadOptions(fields.position, { list: "position", category: fields.category.value }); }
      loadPreview();
      redraw("refresh");
    });
  }
  if (fields.reason) { fields.reason.addEventListener("change", function () { redraw("refresh"); }); }

  // Yes/no questions that open a text field.
  form.addEventListener("change", function (ev) {
    var n = ev.target && ev.target.name;
    if (n === "absence_flag" || n === "external_funding_flag") { redraw("refresh"); }
  });

  // Add and remove leavers without leaving the page.
  form.addEventListener("click", function (ev) {
    var btn = ev.target.closest ? ev.target.closest("button[name=intent]") : null;
    if (!btn) { return; }
    var v = btn.value;
    if (v === "add_leaver") {
      ev.preventDefault();
      var count = form.querySelectorAll("[data-ehr-leaver]").length;
      redraw(v, '[name="leavers[' + count + '].name"]');
    } else if (v.indexOf("remove_leaver:") === 0) {
      ev.preventDefault();
      redraw(v, "[data-ehr-add-leaver]");
    }
  });

  var summary = document.getElementById("ehr-error-summary");
  if (summary) { summary.focus(); }
})();
