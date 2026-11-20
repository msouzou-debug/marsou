/* Password fields: a show/hide button, and a line that says whether Caps Lock is on and whether the keyboard is
   typing Greek or English. Works on every page with a password field. Texts come from data attributes on <body>.
   Nothing here reads or sends the password; the keyboard check looks only at the key just pressed. */
(function () {
  'use strict';
  var text = document.body.dataset;
  var fields = document.querySelectorAll('input[type="password"]');
  if (!fields.length) { return; }
  var GREEK = /[Ͱ-Ͽἀ-῿]/;
  var LATIN = /[A-Za-z]/;

  function pill(cls, icon, label) {
    return '<span class="ehire-pw__pill ' + cls + '"><i class="bi ' + icon + '" aria-hidden="true"></i>' + label + '</span>';
  }

  Array.prototype.forEach.call(fields, function (input) {
    var group = document.createElement('div');
    group.className = 'input-group ehire-pw';
    input.parentNode.insertBefore(group, input);
    group.appendChild(input);

    var eye = document.createElement('button');
    eye.type = 'button';
    eye.className = 'btn btn-outline-secondary ehire-pw__eye';
    eye.setAttribute('aria-pressed', 'false');
    eye.setAttribute('aria-label', text.pwShow);
    eye.title = text.pwShow;
    eye.innerHTML = '<i class="bi bi-eye" aria-hidden="true"></i>';
    group.appendChild(eye);

    var status = document.createElement('div');
    status.className = 'ehire-pw__status';
    status.setAttribute('aria-live', 'polite');
    group.parentNode.insertBefore(status, group.nextSibling);

    var caps = null;   // true, false, or null while unknown
    var kbd = null;    // 'el', 'en', or null while unknown

    function draw() {
      var out = '';
      if (kbd === 'el') { out += pill('ehire-pw__pill--warn', 'bi-keyboard', text.pwKbdEl); }
      if (kbd === 'en') { out += pill('', 'bi-keyboard', text.pwKbdEn); }
      if (caps === true) { out += pill('ehire-pw__pill--warn', 'bi-capslock-fill', text.pwCapsOn); }
      if (caps === false) { out += pill('', 'bi-capslock', text.pwCapsOff); }
      status.innerHTML = out;
    }

    function onKey(ev) {
      if (typeof ev.getModifierState === 'function') { caps = ev.getModifierState('CapsLock'); }
      if (ev.key && ev.key.length === 1 && !ev.ctrlKey && !ev.metaKey && !ev.altKey) {
        if (GREEK.test(ev.key)) { kbd = 'el'; } else if (LATIN.test(ev.key)) { kbd = 'en'; }
      }
      draw();
    }
    function onInput(ev) {   // phones and input methods send no usable key event; the inserted text says the same
      var ch = ev.data ? ev.data.charAt(ev.data.length - 1) : '';
      if (GREEK.test(ch)) { kbd = 'el'; draw(); } else if (LATIN.test(ch)) { kbd = 'en'; draw(); }
    }
    input.addEventListener('input', onInput);
    input.addEventListener('keydown', onKey);
    input.addEventListener('keyup', onKey);
    input.addEventListener('click', function (ev) {
      if (typeof ev.getModifierState === 'function') { caps = ev.getModifierState('CapsLock'); draw(); }
    });

    eye.addEventListener('click', function () {
      var show = input.type === 'password';
      input.type = show ? 'text' : 'password';
      eye.setAttribute('aria-pressed', show ? 'true' : 'false');
      eye.setAttribute('aria-label', show ? text.pwHide : text.pwShow);
      eye.title = show ? text.pwHide : text.pwShow;
      eye.innerHTML = '<i class="bi ' + (show ? 'bi-eye-slash' : 'bi-eye') + '" aria-hidden="true"></i>';
      input.focus();
    });
    // Never leave a password visible when the form is sent or the page is left.
    if (input.form) { input.form.addEventListener('submit', function () { input.type = 'password'; }); }
  });
})();
