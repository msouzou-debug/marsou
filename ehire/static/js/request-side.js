/* Request page, status panel. Vanilla JS; the page works without it.
   1. The route is open on wide screens (the panel is a side column) and folded behind a button on a phone.
   2. The sticky panel stays under the top of the window; if it is taller than the window it scrolls with the page
      until its bottom shows, then sticks there. */
(function () {
  "use strict";
  var wide = window.matchMedia("(min-width: 992px)");
  var details = document.querySelector("[data-ehire-route]");
  var panel = document.querySelector("[data-ehire-sticky]");

  function route() {
    if (!details) { return; }
    details.open = wide.matches;
  }
  function sticky() {
    if (!panel) { return; }
    var gap = 16;
    panel.style.top = wide.matches ? Math.min(gap, window.innerHeight - panel.offsetHeight - gap) + "px" : "";
  }
  route();
  sticky();
  var onChange = function () { route(); sticky(); };
  if (wide.addEventListener) { wide.addEventListener("change", onChange); } else if (wide.addListener) { wide.addListener(onChange); }
  window.addEventListener("resize", sticky);
  if (details) { details.addEventListener("toggle", sticky); }
})();
