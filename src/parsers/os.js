/* ---------- Paid-claims "OS" parser (one row per paid claim; has visit counts) ----------
   These files contain patient names — they are read in the browser and never
   leave the machine. */
/* global XLSX */
import { U } from '../util.js';

export function parseOS(wb,fname){
  const sh=wb.SheetNames[0];
  const rows=XLSX.utils.sheet_to_json(wb.Sheets[sh],{raw:true,defval:null});
  if(!rows.length) return null;
  const keys=Object.keys(rows[0]).map(k=>k.trim());
  if(!keys.includes('CLAIM ID')||!keys.includes('VISIT ID')||!keys.includes('DR SEGMENT')) return null;
  const code=(fname.match(/F1\d{3}/)||[null])[0];
  const out=[];
  for(const r of rows){
    const get=n=>{ for(const k of Object.keys(r)) if(k.trim()===n) return r[k]; return null; };
    const d=get('INVOICE DATE');
    let dt=null;
    if(typeof d==='number'){ const p=XLSX.SSF.parse_date_code(d); if(p) dt=new Date(p.y,p.m-1,p.d); }
    else if(d){ const m=String(d).match(/(\d{4})-(\d{1,2})/); if(m) dt=new Date(+m[1],+m[2]-1,1);
      else { const m2=String(d).match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/); if(m2) dt=new Date(+m2[3],+m2[2]-1,+m2[1]); } }
    out.push({claim:String(get('CLAIM ID')),visit:String(get('VISIT ID')),seg:String(get('DR SEGMENT')||''),
      spec:String(get('DR SPECIALITY')||'').toUpperCase().trim(),dt,code,
      reimb:U.numRaw(get('HIO REIMB.'))||0});
  }
  return out;
}
