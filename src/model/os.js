/* ---------- OS paid-claims model ----------
   Unique VISIT IDs per invoice month; claims are deduped by CLAIM ID across
   files as they are loaded (see intake.js). */
import { state } from '../state.js';
import { OS_LAB } from '../domain.js';

export function computeOS(S){
  const y=S.year,mN=S.mN;
  const byClaim=state.osClaims;               // Map claim→row (dedup across files)
  const aeV=Array.from({length:mN},()=>new Set());
  const opV=Array.from({length:mN},()=>new Set());
  let maxM=-1;
  for(const r of byClaim.values()){
    if(!r.dt||r.dt.getFullYear()!==y) continue;
    const mi=r.dt.getMonth(); if(mi>maxM) maxM=mi;
    if(mi>=mN) continue;
    if(r.seg.startsWith('Accident')) aeV[mi].add(r.visit);
    else if(r.seg.startsWith('Outpatient')&&!OS_LAB.includes(r.spec)) opV[mi].add(r.visit);
  }
  return {ae:aeV.map(s=>s.size),op:opV.map(s=>s.size),maxM};
}
