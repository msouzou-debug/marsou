/* ---------- derived helpers over the parsed stats blocks ---------- */
import { state } from '../state.js';

export function yoy(k){const x=state.stats.kpi[k];if(!x||x.cur==null||!x.prev)return null;return 100*(x.cur-x.prev)/x.prev;}

export function sumBlocksMonthly(bk,y){
  const bl=state.stats.blocks[bk]; if(!bl||!bl.length) return null;
  const m={};let any=false;
  for(const b of bl){const ym=b.years[y];if(!ym)continue;for(const [mi,v] of Object.entries(ym)){m[mi]=(m[mi]||0)+v;any=true;}}
  return any?m:null;
}
