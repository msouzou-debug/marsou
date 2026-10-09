/* ---------- file-type detection (by content, never by filename) ---------- */
/* global XLSX */
import { findKpiSheet } from '../workbook.js';

export function classify(wb){
  /* the KPI sheet is matched on its header, not its name: it was «ΣΤΟΧΟΣ» up
     to 03.2026 and «ΣΥΝΟΨΗ» from 06.2026, and a file that is not recognised
     looks to the user like a file the tool cannot read at all */
  if(findKpiSheet(wb)&&wb.SheetNames.some(s=>/Νοσηλευθ/i.test(s))) return 'stats';
  if(wb.SheetNames.some(s=>/A\s*&\s*E/i.test(s))&&wb.SheetNames.some(s=>/^ALL/i.test(s.trim()))) return 'allae';
  const sh=wb.SheetNames.filter(s=>s.trim().toLowerCase()!=='lists')[0];
  const g=(XLSX.utils.sheet_to_json(wb.Sheets[sh],{header:1,range:0,raw:true})[0]||[]).map(v=>String(v??'').trim());
  if(g.includes('DRG Id')&&g.includes('Billing Provider Name')) return 'is';
  if(g.includes('CLAIM ID')&&g.includes('VISIT ID')&&g.includes('DR SEGMENT')) return 'os';
  return 'unknown';
}
