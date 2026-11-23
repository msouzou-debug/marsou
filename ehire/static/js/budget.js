/* The eFinance budget panel on the step 2 and step 4 cards. Help only: the server works out the warning again when
   the card is sent, and builds the stored figures from its own copy of eFinance's answer. */
(function () {
  "use strict";
  Array.prototype.forEach.call(document.querySelectorAll("[data-ehire-budget]"), function (panel) {
    var form = panel.closest("form");
    var fill = panel.getAttribute("data-ehire-budget-fill");
    var article = fill ? document.getElementById(fill) : null;
    var yes = document.getElementById(panel.getAttribute("data-ehire-budget-yes"));
    var radios = panel.querySelectorAll("input[name=budget_article]");
    var boxes = panel.querySelectorAll("[data-ehire-budget-warning]");
    // A warning that does not depend on the line (no budget, unknown cost centre) is drawn by the server and stays.
    var fixed = Array.prototype.filter.call(boxes, function (box) {
      var code = box.getAttribute("data-ehire-budget-warning");
      return (code === "no_lines" || code === "unknown_cost_centre") && !box.hidden;
    });
    var previous = article ? article.value : "";

    function update(fromChange) {
      var picked = form ? form.querySelector("input[name=budget_article]:checked") : null;
      var codes = picked ? (picked.getAttribute("data-ehire-budget-warn") || "").split(" ").filter(Boolean) : [];
      Array.prototype.forEach.call(boxes, function (box) {
        if (fixed.indexOf(box) >= 0) { return; }
        box.hidden = codes.indexOf(box.getAttribute("data-ehire-budget-warning")) < 0;
      });
      Array.prototype.forEach.call(radios, function (r) {
        var row = r.closest("[data-ehire-budget-line]");
        if (row) { row.classList.toggle("is-selected", r.checked); }
      });
      // A "yes" against a warning needs a comment, as a "no" does (cards.js reads this mark).
      if (yes) {
        if (codes.length || fixed.length) { yes.setAttribute("data-ehire-negative", ""); }
        else { yes.removeAttribute("data-ehire-negative"); }
      }
      // Step 4: the picked line fills the commitment article, unless the person typed something else meanwhile.
      if (fromChange && article && picked && (article.value === "" || article.value === previous)) {
        article.value = picked.value;
        previous = picked.value;
      }
    }
    Array.prototype.forEach.call(radios, function (r) {
      r.addEventListener("change", function () { update(true); });
      // The whole row picks the line (a bigger touch target than the radio itself).
      var row = r.closest("[data-ehire-budget-line]");
      if (row) {
        row.addEventListener("click", function (ev) {
          if (ev.target === r || ev.target.closest("label")) { return; }
          if (!r.checked) { r.checked = true; r.dispatchEvent(new Event("change", { bubbles: true })); }
        });
      }
    });
    update(false);
  });
})();
