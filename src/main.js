/* ============================================================
   OKYPY Hospital KPI Dashboard — entry point.
   Bundled by build.mjs into one self-contained HTML file: hospital PCs run it
   from disk with no server and no network. The public surface stays
   window.OKYPY = {state, handleFiles, parseStats, parseIS, computeHIO, U} —
   the headless test harness drives the app through it.
   ============================================================ */
import { U } from './util.js';
import { state } from './state.js';
import { parseStats } from './parsers/stats.js';
import { parseIS } from './parsers/is.js';
import { computeHIO } from './model/hio.js';
import { handleFiles } from './intake.js';
import { el } from './render/dom.js';

/* ---------- wiring ---------- */
function init(){
  el('fDate').textContent=new Date().toLocaleDateString('el-GR');
  const drop=el('drop'),inp=el('fileInput');
  drop.addEventListener('click',()=>inp.click());
  inp.addEventListener('change',()=>handleFiles([...inp.files]));
  ['dragover','dragenter'].forEach(ev=>drop.addEventListener(ev,e=>{e.preventDefault();drop.classList.add('over');}));
  ['dragleave','drop'].forEach(ev=>drop.addEventListener(ev,e=>{e.preventDefault();drop.classList.remove('over');}));
  drop.addEventListener('drop',e=>handleFiles([...e.dataTransfer.files]));
}
document.addEventListener('DOMContentLoaded',init);

window.OKYPY={state,handleFiles,parseStats,parseIS,computeHIO,U};
