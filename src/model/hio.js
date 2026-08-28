/* ---------- HIO cross-check model ---------- */
import { hospOf } from '../domain.js';

export function computeHIO(isRows,S){
  const y=S.year,mN=S.mN,hosp=S.hospital;
  const inPeriod=d=>d&&d.getFullYear()===y&&d.getMonth()<mN;
  const R=isRows.filter(r=>hospOf(r.prov)===hosp);
  const seen=new Set(); // guard against re-added files
  let cwSum=0,cwN=0,alosSum=0,alosN=0,emerg=0,revRows=0,revAmt=0,dcCount=0,dialSum=0;
  const byMonth=Array(mN).fill(0), dcByMonth=Array(mN).fill(0), dialByMonth=Array(mN).fill(0);
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
    if(daycare){dcCount++;dcByMonth[r.dd.getMonth()]++;}
    if(r.pid.includes('ZF-041')){dialSum+=r.qty;dialByMonth[r.dd.getMonth()]+=r.qty;}
  }
  const inpTot=byMonth.reduce((a,b)=>a+b,0);
  // tail-lag detection: last month clearly below the average of the earlier ones
  const avgPrev=byMonth.slice(0,-1).reduce((a,b)=>a+b,0)/Math.max(mN-1,1);
  const tailLag=byMonth[mN-1]<0.85*avgPrev;
  // reversal recovery: a reversed case whose claims still net negative = open (not yet resubmitted / permanently credited)
  let openCases=0, openAmt=0;
  for(const c of negCases){ const n=ffByCase.get(c)||0; if(n<-1){openCases++; openAmt+=n;} }
  /* what is safe to compare: the months whose claims have finished arriving */
  const M=maturity(isRows,S);
  const onMature=(arr)=>arr.reduce((a,b,i)=>a+(M.mature[i]?b:0),0);
  const matureTot=onMature(byMonth);
  const matureCount=M.mature.filter(Boolean).length;
  return {inpTot,byMonth,dcCount,dialSum,cmi:cwN?cwSum/cwN:null,alos:alosN?alosSum/alosN:null,
          emergPct:inpTot?100*emerg/inpTot:null,revRows,revAmt,revOpenCases:openCases,revOpenAmt:openAmt,tailLag,nRows:R.length,
          dcByMonth,dialByMonth,
          maturity:M,matureTot,matureCount,
          matureDc:onMature(dcByMonth),matureDial:onMature(dialByMonth)};
}

/* ---------- submission maturity ----------
   The ΟΑΥ settles over a three-month window: a month's discharges reach it in
   that month's run and the two that follow. In the real ΓΝ Λευκωσίας files,
   January's inpatient discharges arrived as 91 claims in the January run, 996
   in February and a further 349 in March — so a month is only worth comparing
   once those three runs are in hand.

   The submission month of a file is the month most of its claims were filed in,
   taken from `Submission Date`: a handful of stragglers years old must not be
   mistaken for the run's own month. */
const MATURITY_LAG = 2;

export function submissionMonths(isRows) {
  const perFile = new Map();
  for (const r of isRows) {
    if (!r.subm) continue;
    const key = r.subm.getFullYear() * 12 + r.subm.getMonth();
    const counts = perFile.get(r.file) || perFile.set(r.file, new Map()).get(r.file);
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  const files = [];
  for (const [file, counts] of perFile) {
    let best = null, bestN = 0;
    for (const [key, n] of counts) if (n > bestN) { best = key; bestN = n; }
    if (best != null) files.push({ file, month: best, claims: bestN });
  }
  files.sort((a, b) => a.month - b.month);
  return { files, last: files.length ? files[files.length - 1].month : null };
}

/* Which months of the reporting period have finished arriving, given the
   submission runs actually loaded. */
export function maturity(isRows, S) {
  const { files, last } = submissionMonths(isRows);
  const mature = [];
  for (let i = 0; i < S.mN; i++) {
    const dischargeMonth = S.year * 12 + i;
    mature.push(last != null && last >= dischargeMonth + MATURITY_LAG);
  }
  return {
    mature,
    lastSubmission: last,
    runs: files,
    /* the runs a director would have to add for the period to be complete */
    missingRuns: last == null ? [] : Array.from(
      { length: Math.max(0, (S.year * 12 + S.mN - 1 + MATURITY_LAG) - last) },
      (_, k) => last + 1 + k,
    ),
    lag: MATURITY_LAG,
  };
}
