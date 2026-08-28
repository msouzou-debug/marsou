/* ---------- the scope bar ----------
   Two questions decide what a reader wants to see, and they are asked once, at
   the top of the page: the whole hospital, or one clinic? A clinic director
   picks their own from the list and never scrolls past figures that are not
   theirs; a manager stays on «Σύνολο νοσοκομείου».

   The bar owns the selection so that nothing else has to: the clinic view, the
   summary table and the exports all read `currentClinic()`. */
import { U } from '../util.js';
import { el } from './dom.js';

const HOSPITAL = 'hosp', CLINIC = 'clinic';

let scope = HOSPITAL;
let selected = null;
let options = [];                   // [{key, label}]
const listeners = [];

export const currentScope = () => scope;
export const currentClinic = () => selected;
/* the clinic view registers here; the bar itself knows nothing about rendering */
export const onClinicChange = (fn) => listeners.push(fn);

function apply({ notify = true } = {}) {
  const dash = el('dash');
  if (dash) {
    dash.classList.toggle('scope-clinic', scope === CLINIC);
    dash.classList.toggle('scope-hosp', scope === HOSPITAL);
  }
  el('btnScopeHosp')?.classList.toggle('on', scope === HOSPITAL);
  el('btnScopeClinic')?.classList.toggle('on', scope === CLINIC);
  const sel = el('clinicSelect');
  if (sel && selected != null && sel.value !== selected) sel.value = selected;
  if (notify) for (const fn of listeners) fn(selected);
}

export function setScope(next) {
  if (next === scope) return;
  scope = next;
  apply({ notify: false });
  /* a switch to the clinic view should land on the clinic, not on the header */
  if (scope === CLINIC) el('secClinics')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

export function setClinic(key, { focus = true } = {}) {
  if (!options.some(o => o.key === key)) return;
  selected = key;
  apply();
  if (focus) setScope(CLINIC);
}

/* Called on every render: the clinic list grows as more files are loaded, and
   the reader's choice has to survive that. */
export function syncClinics(list) {
  options = list.map(c => ({ key: c.key, label: c.label }));
  /* the switch and the list appear only when there is something to switch to;
     the bar itself stays, because the export buttons live in it */
  el('scopeswitch')?.classList.toggle('hidden', !options.length);
  el('clinicPick')?.classList.toggle('hidden', !options.length);
  if (!options.length) { selected = null; scope = HOSPITAL; apply({ notify: false }); return; }
  if (!options.some(o => o.key === selected)) selected = options[0].key;

  const sel = el('clinicSelect');
  if (sel) {
    sel.innerHTML = options.map(o =>
      `<option value="${U.esc(o.key)}">${U.esc(o.label)}</option>`).join('');
    sel.value = selected;
  }
  apply({ notify: false });
}

export function initScope() {
  el('btnScopeHosp')?.addEventListener('click', () => setScope(HOSPITAL));
  el('btnScopeClinic')?.addEventListener('click', () => setScope(CLINIC));
  el('clinicSelect')?.addEventListener('change', (e) => setClinic(e.target.value));
  apply({ notify: false });
}
