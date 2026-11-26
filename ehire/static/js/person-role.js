/* Person page, "Add a role": show the Directorate and substitute fields only for the roles that use them, and offer
   Scientific Director only for Directorates that have one. The server checks all of this again. */
(function () {
  'use strict';
  var role = document.getElementById('add-role');
  if (!role) { return; }
  var dirWrap = document.getElementById('add-dir-wrap');
  var dir = document.getElementById('add-dir');
  var subWrap = document.getElementById('add-sub-wrap');
  var replaceWrap = document.getElementById('add-replace-wrap');

  function refresh() {
    var option = role.options[role.selectedIndex];
    var needsDir = option && option.dataset.dir === '1';
    var single = option && option.dataset.single === '1';
    dirWrap.hidden = !needsDir;
    dir.required = !!needsDir;
    subWrap.hidden = !single;
    replaceWrap.hidden = !single;
    var sci = option && option.value === 'sci_director';
    Array.prototype.forEach.call(dir.options, function (o) {
      o.disabled = !!(sci && o.value && o.dataset.sci !== '1');
    });
    if (dir.options[dir.selectedIndex] && dir.options[dir.selectedIndex].disabled) { dir.value = ''; }
  }

  role.addEventListener('change', refresh);
  refresh();
}());
