/* ---------- «Έκθεση Στατιστικών» (.docx) ----------
   The quarterly letter to clinic directors. The numbers in it come from the
   same workbook, so nothing is recomputed from here — what the report uniquely
   carries is the administration's own commentary, and that is what gets shown
   next to each clinic.

   The file is read as text only. Nothing is executed, no styling is applied. */
import { zipIndex, zipReadText } from '../zip.js';
import { U } from '../util.js';

const stripTags = (s) => s.replace(/<[^>]*>/g, '');
const unescapeXml = (s) => s
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
  .replace(/&apos;/g, "'").replace(/&#(\d+);/g, (_, d) => String.fromCharCode(+d))
  .replace(/&amp;/g, '&');

/* a paragraph is <w:p>…</w:p>; its text is the concatenation of the <w:t> runs */
function paragraphs(xml) {
  const out = [];
  for (const block of xml.split('</w:p>')) {
    const runs = [...block.matchAll(/<w:t[^>]*>([\s\S]*?)<\/w:t>/g)].map(m => unescapeXml(stripTags(m[1])));
    const text = runs.join('').replace(/\s+/g, ' ').trim();
    if (text) out.push(text);
  }
  return out;
}

/* The report's section headings either carry the slide reference
   («Επισκέψεις Εξωτερικών Ιατρείων (Διαφάνεια 6)») or are set in capitals
   («ΑΝΑΛΥΣΗ ΣΤΑΤΙΣΤΙΚΩΝ ΔΕΔΟΜΕΝΩΝ»). Nothing else counts: the body is full of
   bare clinic names on their own line, and treating those as headings would
   file a clinic's figures under a neighbouring clinic's title. */
const isHeading = (t) =>
  t.length <= 120 && !/→/.test(t) &&
  (/\(Διαφάνει/.test(t) || (t.length > 12 && t === t.toUpperCase() && /[Α-ΩΪΫ]/.test(t)));

export async function parseReport(bytes, fname) {
  const index = zipIndex(bytes);
  if (!index?.has('word/document.xml')) return null;
  const xml = await zipReadText(bytes, 'word/document.xml', index);
  if (!xml) return null;
  const paras = paragraphs(xml);
  if (!paras.length) return null;

  const sections = [];
  let current = { title: 'Εισαγωγή', paras: [] };
  for (const p of paras) {
    if (isHeading(p) && current.paras.length) { sections.push(current); current = { title: p, paras: [] }; }
    else if (isHeading(p)) current.title = p;
    else current.paras.push(p);
  }
  if (current.paras.length) sections.push(current);

  /* period, so the panel can say which report the commentary comes from */
  const head = paras.slice(0, 8).join(' ');
  const pm = head.match(/([Α-ΩΪΫα-ωίϊΐόάέύϋΰήώ]+)\s*[-–]\s*([Α-ΩΪΫα-ωίϊΐόάέύϋΰήώ]+)\s+(20\d\d)/);

  return { file: fname, paras, sections, period: pm ? pm[0] : null, paraCount: paras.length };
}

/* Paragraphs that talk about one clinic. A section heading is kept with them so
   the reader knows whether a line is about visits, admissions or revenue. */
export function reportNotesFor(report, names) {
  if (!report) return [];
  const needles = [...new Set(names.filter(Boolean).map(n => U.deacc(String(n)).toUpperCase()))]
    .filter(n => n.length >= 4);
  if (!needles.length) return [];
  const out = [];
  for (const section of report.sections) {
    for (let i = 0; i < section.paras.length; i++) {
      const hay = U.deacc(section.paras[i]).toUpperCase();
      if (!needles.some(n => hay.includes(n))) continue;
      /* the report writes a clinic name then its figures on the next lines */
      const figures = [];
      for (let j = i + 1; j < section.paras.length && j <= i + 8; j++) {
        if (!/→/.test(section.paras[j])) break;
        figures.push(section.paras[j]);
      }
      out.push({ section: section.title, text: section.paras[i], figures });
      i += figures.length;
    }
  }
  return out;
}
