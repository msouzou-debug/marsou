/* ---------- ALL and AE parser (HIO payment file — € amounts, no visit counts) ---------- */
/* global XLSX */
import { OP_EXCLUDE } from '../domain.js';

export function parseALLAE(wb,fname){
  const aeName=wb.SheetNames.find(s=>/A\s*&\s*E/i.test(s));
  const allName=wb.SheetNames.find(s=>/^ALL/i.test(s.trim()));
  if(!aeName||!allName) return null;
  // period from sheet name e.g. "A&E 01.2026"
  const pm=(aeName+' '+allName).match(/(\d{1,2})\.(\d{4})/);
  const month=pm?+pm[1]:null, year=pm?+pm[2]:null;
  // code → hospital tag from ALL tab vendor names ("...INCOME-NGH-F1054")
  const allRows=XLSX.utils.sheet_to_json(wb.Sheets[allName],{header:1,raw:true,defval:null});
  const tag={}, opFFS={};   // opFFS per hospital tag (clinical FFS €, excl. pharma/tests/inpatient/A&E)
  for(const r of allRows){
    const code=String(r[0]||'');
    if(!/^F1\d{3}$/.test(code)) continue;
    const name=String(r[1]||'');
    const m=name.match(/[-\s](NGH|LIM|LARN|PAR|PAF|POL|KYP|NAM)\b/);
    if(m) tag[code]=m[1];
    const cc=String(r[4]||''), acct=String(r[6]||''), amt=(typeof r[7]==='number')?r[7]:null;
    if(amt==null) continue;
    if(!(acct.startsWith('Fee for Service')||acct.startsWith('House visits')||acct.startsWith('Fee per diem'))) continue;
    if(OP_EXCLUDE.some(x=>cc.includes(x))) continue;
    if(m) opFFS[m[1]]=(opFFS[m[1]]||0)+amt;
  }
  // A&E tab: detail block rows — code / ... / account name / amount
  const aeRows=XLSX.utils.sheet_to_json(wb.Sheets[aeName],{header:1,raw:true,defval:null});
  const aeClaims={};
  for(const r of aeRows){
    const code=String(r[0]||'');
    if(!/^F1\d{3}$/.test(code)) continue;
    const rowTxt=r.map(v=>String(v??'')).join('|');
    const amt=[...r].reverse().find(v=>typeof v==='number');
    if(/Fee for service/i.test(rowTxt)&&typeof amt==='number') aeClaims[code]=(aeClaims[code]||0)+amt;
  }
  return {file:fname,month,year,tag,opFFS,aeClaims};
}
