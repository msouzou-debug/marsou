/* Documents on the request form: show the chosen files and their sizes before sending. Without this script the
   picker and the upload button still work as a plain form post. The server decides what is accepted. */
(function () {
  "use strict";
  var box = document.getElementById("ehr-docs-add");
  var input = document.getElementById("ehr-docs-input");
  var list = document.getElementById("ehr-docs-chosen");
  var send = document.getElementById("ehr-docs-send");
  if (!box || !input || !list) { return; }
  var limitMb = parseInt(box.getAttribute("data-limit-mb"), 10) || 20;
  var tooLarge = box.getAttribute("data-too-large") || "";
  var greek = (document.documentElement.lang || "") === "el";

  function sizeText(n) {
    var text;
    if (n < 1024) { text = n + " B"; }
    else if (n < 1048576) { text = Math.round(n / 1024) + " KB"; }
    else { text = (n / 1048576).toFixed(1) + " MB"; }
    return greek ? text.replace(".", ",") : text;
  }

  function show() {
    list.innerHTML = "";
    var files = input.files || [];
    Array.prototype.forEach.call(files, function (f) {
      var li = document.createElement("li");
      if (f.size > limitMb * 1048576) {
        li.className = "ehr-too-large";
        li.textContent = tooLarge.replace("{name}", f.name).replace("{n}", String(limitMb));
      } else {
        li.textContent = f.name + " · " + sizeText(f.size);
      }
      list.appendChild(li);
    });
    if (send) { send.disabled = files.length === 0; }
  }

  input.addEventListener("change", show);
  show();
})();
