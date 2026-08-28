/* ---------- tiny SVG chart lib (brand-compliant) ----------
   Pure string builders: no DOM, no dependencies, so the same components can be
   rasterised to PNG for the PPTX/DOCX exports. */
import { U } from '../util.js';

export const C={y0:'#1B75BB',y1:'#069FEC',old:'#C7C8CA',green:'#8BC53F',neg:'#C0392B'};

export function sparkline(vals,w=86,h=30){
  const v=vals.filter(x=>x!=null); if(v.length<2) return '';
  const mn=Math.min(...v),mx=Math.max(...v),sp=mx-mn||1;
  const pts=vals.map((x,i)=>x==null?null:[(i/(vals.length-1))*w,h-3-((x-mn)/sp)*(h-6)]).filter(Boolean);
  const d=pts.map((p,i)=>(i?'L':'M')+p[0].toFixed(1)+','+p[1].toFixed(1)).join(' ');
  const last=pts[pts.length-1];
  return `<svg width="${w}" height="${h}"><path d="${d}" fill="none" stroke="${C.y1}" stroke-width="2"/><circle cx="${last[0]}" cy="${last[1]}" r="2.6" fill="${C.y0}"/></svg>`;
}

export function lineChart(series,labels,h=190){
  // series: [{name,color,vals[],dash?}]
  const w=380,padL=44,padB=22,padT=10,padR=8;
  const all=series.flatMap(s=>s.vals).filter(v=>v!=null);
  if(!all.length) return '';
  let mn=Math.min(...all),mx=Math.max(...all); const sp=(mx-mn)||1; mn-=sp*.08; mx+=sp*.08;
  const X=i=>padL+(i/(labels.length-1))*(w-padL-padR);
  const Y=v=>padT+(1-(v-mn)/(mx-mn))*(h-padT-padB);
  let out=`<svg viewBox="0 0 ${w} ${h}" style="width:100%">`;
  for(let t=0;t<4;t++){const v=mn+(mx-mn)*t/3,y=Y(v);
    out+=`<line x1="${padL}" y1="${y}" x2="${w-padR}" y2="${y}" stroke="#EAEAEA"/><text x="${padL-5}" y="${y+3.5}" font-size="9.5" fill="#8a8b8d" text-anchor="end">${U.fmt(v)}</text>`;}
  labels.forEach((l,i)=>{ if(labels.length<=12||i%2===0) out+=`<text x="${X(i)}" y="${h-6}" font-size="9.5" fill="#8a8b8d" text-anchor="middle">${l}</text>`;});
  for(const s of series){
    const pts=s.vals.map((v,i)=>v==null?null:[X(i),Y(v)]);
    let d='',pen=false;
    pts.forEach(p=>{ if(!p){pen=false;return;} d+=(pen?'L':'M')+p[0].toFixed(1)+','+p[1].toFixed(1);pen=true;});
    out+=`<path d="${d}" fill="none" stroke="${s.color}" stroke-width="${s.w||2.2}" ${s.dash?'stroke-dasharray="4 3"':''}/>`;
  }
  out+='</svg>';
  return out;
}

/* Multi-year column chart — the «διαχρονικά» view of one indicator for one
   clinic. The current year is the deep-blue column; earlier years are muted, so
   the eye reads the direction of travel first and the values second. */
export function barChartYears(items,{dec=0,unit='',h=150}={}){
  const w=380,padL=8,padR=8,padT=16,padB=20;
  const vals=items.map(i=>i.val).filter(v=>v!=null);
  if(vals.length<2) return '';
  const mx=Math.max(...vals,0), mn=Math.min(...vals,0);
  const span=(mx-mn)||1;
  const bw=(w-padL-padR)/items.length;
  const Y=v=>padT+(1-(v-mn)/span)*(h-padT-padB);
  let out=`<svg viewBox="0 0 ${w} ${h}" style="width:100%">`;
  out+=`<line x1="${padL}" y1="${Y(mn)}" x2="${w-padR}" y2="${Y(mn)}" stroke="#EAEAEA"/>`;
  items.forEach((it,i)=>{
    const x=padL+i*bw+bw*0.18, bar=bw*0.64;
    if(it.val==null){
      out+=`<text x="${x+bar/2}" y="${h-6}" font-size="9.5" fill="#8a8b8d" text-anchor="middle">${it.label}</text>`;
      return;
    }
    const y=Y(it.val), base=Y(mn);
    out+=`<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${bar.toFixed(1)}" height="${Math.max(base-y,1).toFixed(1)}" rx="2" fill="${it.current?C.y0:C.old}"/>`;
    out+=`<text x="${(x+bar/2).toFixed(1)}" y="${(y-4).toFixed(1)}" font-size="9.5" fill="${it.current?C.y0:'#8a8b8d'}" font-weight="${it.current?700:400}" text-anchor="middle">${U.fmt(it.val,dec)}${unit}</text>`;
    out+=`<text x="${(x+bar/2).toFixed(1)}" y="${h-6}" font-size="9.5" fill="#8a8b8d" text-anchor="middle">${it.label}</text>`;
  });
  return out+'</svg>';
}

/* Two periods side by side per category — the ΟΑΥ revenue streams of a clinic,
   this period against the same period last year. */
export function barChartPaired(items,{curLabel,prevLabel,h=160,money=true}={}){
  const w=380,padL=8,padR=8,padT=16,padB=34;
  const vals=items.flatMap(i=>[i.cur,i.prev]).filter(v=>v!=null);
  if(!vals.length) return '';
  const mx=Math.max(...vals,0)||1;
  const slot=(w-padL-padR)/items.length;
  const bar=Math.min(slot*0.32,34);
  const Y=v=>padT+(1-v/mx)*(h-padT-padB);
  const base=h-padB;
  const fmt=v=>money?U.fmt(v,0)+' €':U.fmt(v);
  let out=`<svg viewBox="0 0 ${w} ${h}" style="width:100%">`;
  out+=`<line x1="${padL}" y1="${base}" x2="${w-padR}" y2="${base}" stroke="#EAEAEA"/>`;
  items.forEach((it,i)=>{
    const mid=padL+slot*i+slot/2;
    [['prev',it.prev,C.old],['cur',it.cur,C.y0]].forEach(([which,v,fill],j)=>{
      if(v==null) return;
      const x=mid+(j?2:-bar-2), y=Y(Math.max(v,0));
      out+=`<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${bar.toFixed(1)}" height="${Math.max(base-y,1).toFixed(1)}" rx="2" fill="${fill}"/>`;
    });
    out+=`<text x="${mid}" y="${h-14}" font-size="9.5" fill="#58595B" text-anchor="middle">${U.esc(it.name)}</text>`;
    if(it.cur!=null) out+=`<text x="${mid}" y="${h-3}" font-size="9.5" fill="#8a8b8d" text-anchor="middle">${fmt(it.cur)}</text>`;
  });
  out+=`<text x="${padL}" y="10" font-size="9.5" fill="#8a8b8d">▪ ${U.esc(prevLabel)}</text>`;
  out+=`<text x="${padL+70}" y="10" font-size="9.5" fill="${C.y0}">▪ ${U.esc(curLabel)}</text>`;
  return out+'</svg>';
}

export function barChartSigned(items,h){
  // items: [{name,val}] val = % change
  const w=380,rowH=22; h=h||items.length*rowH+8;
  const mx=Math.max(...items.map(i=>Math.abs(i.val)),1);
  const mid=w*0.56,span=w*0.24;
  let out=`<svg viewBox="0 0 ${w} ${h}" style="width:100%">`;
  items.forEach((it,i)=>{
    const y=i*rowH+6,bw=Math.abs(it.val)/mx*span,x=it.val<0?mid-bw:mid;
    out+=`<text x="6" y="${y+11}" font-size="10.5" fill="#58595B" text-anchor="start">${U.esc(it.name.slice(0,20))}</text>`;
    out+=`<rect x="${x}" y="${y}" width="${Math.max(bw,1)}" height="14" rx="2" fill="${it.val<0?C.neg:C.green}"/>`;
    out+=`<text x="${it.val<0?mid+4:x+bw+4}" y="${y+11}" font-size="10" fill="#58595B" text-anchor="start">${U.pct(it.val)}</text>`;
  });
  out+=`<line x1="${mid}" y1="0" x2="${mid}" y2="${h}" stroke="#B9BBBE"/>`;
  return out+'</svg>';
}
