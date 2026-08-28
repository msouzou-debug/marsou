/* ---------- IS Auditor parser (port of the validated python engine) ----------
   The monthly file is the SUBMISSION month; activity is counted later by
   Discharge Date, so the January file is mostly prior-year discharges. */
/* global XLSX */
import { U } from '../util.js';
import { parseDMY } from '../workbook.js';

export function parseIS(wb,fname){
  const shn=wb.SheetNames.filter(s=>s.trim().toLowerCase()!=='lists')[0];
  const rows=XLSX.utils.sheet_to_json(wb.Sheets[shn],{raw:true,defval:null});
  if(!rows.length||!('DRG Id' in rows[0])||!('Billing Provider Name' in rows[0])) return null;
  return rows.map(r=>({
    prov:r['Billing Provider Name'],
    caseNbr:String(r['Case Nbr']??''),
    drg:(()=>{const v=r['DRG Id'];return v!=null&&String(v).trim()!==''&&String(v).toLowerCase()!=='nan';})(),
    pid:String(r['Procedure Id']||''),
    ht:String(r['Hospitalisation Type']||''),
    at:String(r['Admission Type']||''),
    dt:String(r['Discharge Type']||''),
    qty:U.numRaw(r['Quantity'])||0,
    acw:U.numRaw(r['Adjusted Cost Weight'])||0,
    alos:U.numRaw(r['Actual Length Of Stay'])||0,
    ff:U.numRaw(r['DRG/FF Total Amount(Hospital + Total Doctor)'])||0,
    /* per-clinic view: the specialty the claim was filed under, and the
       procedures amount that completes the billed total (DRG/FFS + procedures) */
    spec:String(r['Claim Speciality']??'').trim(),
    proc:U.numRaw(r['Procedures Total Amount'])||0,
    dd:parseDMY(r['Discharge Date']),
    /* when the claim reached the ΟΑΥ — this is what says whether a discharge
       month has finished arriving or is still filling up */
    subm:parseDMY(r['Submission Date']),
    file:fname
  }));
}
