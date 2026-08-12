/* ---------- file intake ---------- */
/* global XLSX */
import { U } from './util.js';
import { state } from './state.js';
import { classify } from './parsers/classify.js';
import { parseStats } from './parsers/stats.js';
import { parseIS } from './parsers/is.js';
import { parseOS } from './parsers/os.js';
import { parseALLAE } from './parsers/allae.js';
import { render } from './render/dashboard.js';
import { el } from './render/dom.js';

export async function handleFiles(files){
  for(const f of files){
    try{
      const ab=await f.arrayBuffer();
      const wb=XLSX.read(ab,{type:'array'});
      const cls=classify(wb);
      if(cls==='stats'){ state.stats=parseStats(wb); addChip(f.name,'stats'); }
      else if(cls==='is'){
        if(state.isFiles.has(f.name)){ addChip(f.name+' (ήδη φορτωμένο)','bad'); continue; }
        const rows=parseIS(wb,f.name);
        if(rows){ state.isRows.push(...rows); state.isFiles.add(f.name); addChip(f.name,'is'); }
        else addChip(f.name+' — άγνωστη δομή','bad');
      }
      else if(cls==='os'){
        if(state.osFiles.has(f.name)){ addChip(f.name+' (ήδη φορτωμένο)','bad'); continue; }
        const rows=parseOS(wb,f.name);
        if(rows){ for(const r of rows){ if(!state.osClaims.has(r.claim)) state.osClaims.set(r.claim,r); if(r.code) state.osCodes.add(r.code); }
          state.osFiles.add(f.name); addChip(f.name,'is'); }
        else addChip(f.name+' — άγνωστη δομή','bad');
      }
      else if(cls==='allae'){
        if(state.aeFiles.has(f.name)){ addChip(f.name+' (ήδη φορτωμένο)','bad'); continue; }
        const rec=parseALLAE(wb,f.name);
        if(rec&&rec.month){ state.allae.push(rec); state.aeFiles.add(f.name); addChip(f.name,'is'); }
        else addChip(f.name+' — άγνωστη δομή ALL and AE','bad');
      }
      else addChip(f.name+' — δεν αναγνωρίστηκε ο τύπος αρχείου (υποστηρίζονται: στατιστικά νοσοκομείου, IS Auditor, ALL and AE, Πληρωμένες Απαιτήσεις OS)','bad');
    }catch(e){ addChip(f.name+' — σφάλμα ανάγνωσης','bad'); console.error(e); }
  }
  try{ render(); }catch(e){ window.__renderError=e.stack||e.message; console.error('render failed',e); }
}

function addChip(name,cls){
  el('chips').insertAdjacentHTML('beforeend',`<div class="chip ${cls==='is'?'is':cls==='bad'?'bad':''}">${U.esc(name)}</div>`);
}
