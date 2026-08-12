/* ---------- utilities ----------
   Formatting and Greek-locale helpers. Every number that reaches the UI or an
   export goes through U.fmt / U.pct so the Greek format (1.234.567 / 12,5%)
   stays consistent. */
export const U = {
  deacc: s => String(s).normalize('NFD').replace(/[̀-ͯ]/g,''),
  monthIdx(s){
    if(typeof s!=='string') return -1;
    const t = U.deacc(s).toLowerCase().replace(/[.\s]/g,'');
    const pre = ['ιαν','φεβ','μαρ','απρ','μαι','ιουν','ιουλ','αυγ','σεπ','οκτ','νοε','δεκ'];
    for(let i=0;i<12;i++) if(t.startsWith(pre[i])) return i;
    if(t.startsWith('μαϊ')) return 4;
    return -1;
  },
  num(v){ if(v==null||v==='') return null;
    if(typeof v==='number') return isFinite(v)?v:null;
    const n = Number(String(v).replace(/\./g,'').replace(',','.'));
    return isFinite(n)?n:null; },
  numRaw(v){ if(typeof v==='number') return isFinite(v)?v:null;
    const n=Number(v); return isFinite(n)?n:null; },
  fmt(n,dec=0){ if(n==null||!isFinite(n)) return '—';
    return n.toLocaleString('el-GR',{minimumFractionDigits:dec,maximumFractionDigits:dec}); },
  pct(n,dec=1){ return n==null?'—':(n>0?'+':'')+n.toLocaleString('el-GR',{minimumFractionDigits:dec,maximumFractionDigits:dec})+'%'; },
  esc: s => String(s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c])),
  MONTHS_EL:['Ιαν','Φεβ','Μαρ','Απρ','Μάι','Ιουν','Ιουλ','Αυγ','Σεπ','Οκτ','Νοε','Δεκ'],
  GEN2NUM:{'ΙΑΝΟΥΑΡΙΟΥ':1,'ΦΕΒΡΟΥΑΡΙΟΥ':2,'ΜΑΡΤΙΟΥ':3,'ΑΠΡΙΛΙΟΥ':4,'ΜΑΙΟΥ':5,'ΙΟΥΝΙΟΥ':6,'ΙΟΥΛΙΟΥ':7,'ΑΥΓΟΥΣΤΟΥ':8,'ΣΕΠΤΕΜΒΡΙΟΥ':9,'ΟΚΤΩΒΡΙΟΥ':10,'ΝΟΕΜΒΡΙΟΥ':11,'ΔΕΚΕΜΒΡΙΟΥ':12}
};
