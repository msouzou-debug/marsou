/* ---------- HIO cross-check model ---------- */
import { hospOf } from '../domain.js';

export function computeHIO(isRows,S){
  const y=S.year,mN=S.mN,hosp=S.hospital;
  const inPeriod=d=>d&&d.getFullYear()===y&&d.getMonth()<mN;
  const R=isRows.filter(r=>hospOf(r.prov)===hosp);
  const seen=new Set(); // guard against re-added files
  let cwSum=0,cwN=0,alosSum=0,alosN=0,emerg=0,revRows=0,revAmt=0,dcCount=0,dialSum=0;
  const byMonth=Array(mN).fill(0);
  const ffByCase=new Map(), negCases=new Set();
  for(const r of R){
    const daycare=r.ht.startsWith('3');
    if(r.ff<0){revRows++;revAmt+=r.ff;if(r.caseNbr)negCases.add(r.caseNbr);}
    if(r.caseNbr&&r.ff)ffByCase.set(r.caseNbr,(ffByCase.get(r.caseNbr)||0)+r.ff);
    if(!inPeriod(r.dd)) continue;
    if(r.drg&&!daycare){
      byMonth[r.dd.getMonth()]++;
      alosSum+=r.alos;alosN++;
      if(r.acw>0){cwSum+=r.acw;cwN++;}
      if(r.at.startsWith('E'))emerg++;
    }
    if(daycare)dcCount++;
    if(r.pid.includes('ZF-041'))dialSum+=r.qty;
  }
  const inpTot=byMonth.reduce((a,b)=>a+b,0);
  // tail-lag detection: last month clearly below the average of the earlier ones
  const avgPrev=byMonth.slice(0,-1).reduce((a,b)=>a+b,0)/Math.max(mN-1,1);
  const tailLag=byMonth[mN-1]<0.85*avgPrev;
  // reversal recovery: a reversed case whose claims still net negative = open (not yet resubmitted / permanently credited)
  let openCases=0, openAmt=0;
  for(const c of negCases){ const n=ffByCase.get(c)||0; if(n<-1){openCases++; openAmt+=n;} }
  return {inpTot,byMonth,dcCount,dialSum,cmi:cwN?cwSum/cwN:null,alos:alosN?alosSum/alosN:null,
          emergPct:inpTot?100*emerg/inpTot:null,revRows,revAmt,revOpenCases:openCases,revOpenAmt:openAmt,tailLag,nRows:R.length};
}
