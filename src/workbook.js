/* ---------- workbook helpers (SheetJS) ----------
   XLSX is a global: the library is inlined as a separate <script> ahead of the
   app bundle so the built page works from disk with no network. Tests set
   globalThis.XLSX from src/vendor/xlsx.full.min.js before calling in. */
/* global XLSX */
import { U } from './util.js';

export function grid(ws){ // 2D array, 1-indexed via [r-1][c-1]
  return XLSX.utils.sheet_to_json(ws,{header:1,raw:true,defval:null});
}
export function findSheet(wb,re){ const n=wb.SheetNames.find(s=>re.test(s)); return n?wb.Sheets[n]:null; }

/* ---------- generic monthly-block parser ----------
   Blocks look like:      [title row]  Παθολογία ...        Καρδιολογία ...
                          [year row ]  (Μήνας) 2019 … 2026  2019 … 2026
                          [month rows] Ιαν. v v v …
   Anchored on runs of month names in column A.               */
export function parseBlocks(g){
  const blocks=[];
  let r=0;
  while(r<g.length){
    if(U.monthIdx(g[r]?.[0])===0){                 // run starts at Ιαν
      let end=r; while(end<g.length && U.monthIdx(g[end]?.[0])>=0) end++;
      // year header row: the row above the run that has >=2 year cells
      let yr=-1;
      for(let k=r-1;k>=Math.max(0,r-3);k--){
        const ys=(g[k]||[]).filter(v=>{const n=U.numRaw(v);return n>=2015&&n<=2035;});
        if(ys.length>=2){yr=k;break;}
      }
      if(yr>=0){
        const yrow=g[yr]||[];
        // title cells on row above the year row
        const trow=g[yr-1]||[];
        let titles=[];
        trow.forEach((v,c)=>{ if(typeof v==='string'&&v.trim()&&U.monthIdx(v)<0&&!/^20\d\d/.test(v.trim())) titles.push({c,name:v.trim()}); });
        if(!titles.length) titles=[{c:0,name:'Σύνολο'}];
        titles.forEach((t,i)=>{
          const cEnd = i+1<titles.length ? titles[i+1].c-1 : yrow.length-1;
          const cStart = Math.max(t.c,1);
          const years={};
          for(let c=cStart;c<=cEnd;c++){
            const y=U.numRaw(String(yrow[c]).replace(/[^\d]/g,''));
            if(y>=2015&&y<=2035){
              const m={};
              for(let rr=r;rr<end;rr++){
                const mi=U.monthIdx(g[rr][0]); const v=U.numRaw(g[rr][c]);
                if(mi>=0&&v!=null) m[mi]=v;
              }
              years[y]=m;
            }
          }
          if(Object.keys(years).length) blocks.push({name:t.name,years});
        });
      }
      r=end;
    } else r++;
  }
  return blocks;
}

/* ---------- annual per-clinic table parser (top of sheets 2/6/7) ---------- */
export function parseAnnualTable(g){
  for(let r=0;r<Math.min(g.length,12);r++){
    const yrs=[]; (g[r]||[]).forEach((v,c)=>{const n=U.numRaw(String(v).replace(/[^\d]/g,''));if(n>=2015&&n<=2035)yrs.push({c,y:n});});
    if(yrs.length>=5){
      const rows=[]; let total=null;
      for(let rr=r+1;rr<g.length&&rr<r+45;rr++){
        const lab=g[rr]?.[0];
        if(typeof lab!=='string'||!lab.trim()) continue;
        if(U.monthIdx(lab)>=0) break;
        const vals={}; yrs.forEach(({c,y})=>{const v=U.numRaw(g[rr][c]); if(v!=null)vals[y]=v;});
        if(!Object.keys(vals).length) continue;
        const row={name:lab.trim(),vals};
        if(/ΣΥΝΟΛ/i.test(U.deacc(lab))) {total=row; break;}
        rows.push(row);
      }
      return {rows,total};
    }
  }
  return {rows:[],total:null};
}

export function parseDMY(v){
  if(v==null) return null;
  if(typeof v==='number'){ const d=XLSX.SSF.parse_date_code(v); return d?new Date(d.y,d.m-1,d.d):null; }
  const m=String(v).match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  return m?new Date(+m[3],+m[2]-1,+m[1]):null;
}
