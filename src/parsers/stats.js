/* ---------- STATS workbook parser ---------- */
import { U } from '../util.js';
import { grid, findSheet, parseBlocks, parseAnnualTable } from '../workbook.js';
import { KPI_DEFS, HOSP_KEYS } from '../domain.js';

export function parseStats(wb){
  const S={kpi:{},dq:[],title:'',hospital:null,hospitalGr:'',year:null,mN:null};
  const wsT=findSheet(wb,/ΣΤΟΧΟΣ/i); if(!wsT) return null;
  const gT=grid(wsT);
  // title + period
  for(const row of gT.slice(0,5)){ for(const v of row||[]){
    if(typeof v==='string'&&/ΣΤΑΤΙΣΤΙΚΑ/.test(v)){ S.title=v.replace(/\s+/g,' ').trim(); }
  }}
  for(const [k,h] of HOSP_KEYS) if(S.title.includes(k)){S.hospital=h;S.hospitalGr=k;break;}
  const pm=S.title.match(/([Α-ΩΪΫ]+)\s*-\s*([Α-ΩΪΫ]+)\s+(20\d\d)/);
  if(pm){ S.mN=U.GEN2NUM[pm[2]]||null; S.year=+pm[3]; }
  // KPI table: label col, then target / current / % / prev
  for(let r=0;r<gT.length;r++){
    const row=gT[r]||[];
    const lab=row.find(v=>typeof v==='string'&&v.trim().length>5);
    if(!lab) continue;
    const def=KPI_DEFS.find(d=>d.re.test(lab)&&!S.kpi[d.key]);
    if(!def) continue;
    const nums=[]; row.forEach((v,c)=>{const n=U.numRaw(v); if(n!=null&&c>row.indexOf(lab)) nums.push({c,n});});
    // layout: target(C) cur(D) %(E) prev(F) %(G) — take by header positions if possible
    let target=null,cur=null,prev=null;
    if(nums.length>=2){
      // find columns from the header row that says Στοχος / 2026 / 2025
      cur = nums.find(x=>Number.isInteger(x.n)||x.n>10)?.n ?? null;
      // robust: assume order target,cur,%,prev when 4+ numbers present
      if(nums.length>=4){ target=nums[0].n; cur=nums[1].n; prev=nums[3].n; }
      else if(nums.length===3){ target=nums[0].n; cur=nums[1].n; prev=nums[2].n; }
      else { cur=nums[0].n; prev=nums[1].n; }
    }
    // sanity: % columns may pollute → if prev looks like a % of cur ignore later during render
    const tv=row.find(v=>typeof v==='string'&&/#REF|!/.test(String(v)));
    if(tv) S.dq.push('Ο στόχος του δείκτη «'+lab.trim()+'» έχει σφάλμα αναφοράς (#REF!) στο φύλλο ΣΤΟΧΟΣ.');
    if(typeof row[2]==='string'&&row[2].trim()&&U.numRaw(row[2])==null)
      S.dq.push('Στη γραμμή «'+lab.trim()+'» η στήλη στόχου περιέχει κείμενο αντί για αριθμό.');
    S.kpi[def.key]={label:def.label,target,cur,prev,raw:lab.trim()};
  }
  // KPI-specific fixes using header positions (col letters are stable in this template)
  const hdr=gT.find(r=>r&&r.some(v=>String(v).includes('Στοχος')||String(v).includes('Στόχος')));
  if(hdr){
    const cT=hdr.findIndex(v=>/Στ[οό]χος/.test(String(v)));
    const cCur=hdr.findIndex((v,i)=>i>cT&&U.numRaw(v)!=null);
    // re-read strictly by columns
    for(let r=0;r<gT.length;r++){
      const row=gT[r]||[]; const lab=row.find(v=>typeof v==='string'&&v.trim().length>5);
      if(!lab) continue; const def=KPI_DEFS.find(d=>d.re.test(lab)); if(!def) continue;
      const k=S.kpi[def.key]; if(!k) continue;
      const t=U.numRaw(row[cT]); const cu=U.numRaw(row[cCur]); const pv=U.numRaw(row[cCur+2]);
      if(cu!=null){k.cur=cu;} if(pv!=null){k.prev=pv;} k.target=t;
    }
  }
  // monthly blocks from key sheets
  const sheets={
    adm:findSheet(wb,/Νοσηλευθ/i), occ:findSheet(wb,/πληρότητ/i), alos:findSheet(wb,/διάρκεια/i),
    taep:findSheet(wb,/^ΤΑΕΠ$|ΤΑΕΠ/i), dcm:findSheet(wb,/ΗΜΕΡΗΣΙΑ/i), out:findSheet(wb,/εξωτερικοί/i),
    surg:findSheet(wb,/χειρουργικές επεμβάσεις/i)
  };
  S.blocks={};
  for(const [k,ws] of Object.entries(sheets)) if(ws) S.blocks[k]=parseBlocks(grid(ws));
  S.annual={};
  if(sheets.adm) S.annual.adm=parseAnnualTable(grid(sheets.adm));
  if(sheets.out) S.annual.out=parseAnnualTable(grid(sheets.out));
  if(sheets.surg) S.annual.surg=parseAnnualTable(grid(sheets.surg));
  // months elapsed fallback: TAEP adults 2026 months present
  if(!S.mN&&S.blocks.taep){
    const ad=S.blocks.taep.find(b=>/Ενηλίκων/i.test(b.name));
    const yr=S.year||new Date().getFullYear();
    if(ad&&ad.years[yr]) S.mN=Object.keys(ad.years[yr]).length;
  }
  if(!S.year) S.year=new Date().getFullYear();
  if(!S.mN) S.mN=12;
  // the sheets keep 0 for future months of the current year — drop them so
  // averages, sparklines and trends only see the reporting period
  for(const bl of Object.values(S.blocks)) for(const b of bl){
    const m=b.years[S.year]; if(!m) continue;
    for(const k of Object.keys(m)) if(+k>=S.mN) delete m[k];
  }
  return S;
}
