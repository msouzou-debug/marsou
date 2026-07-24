"""OKYπY — Συμφωνία Πληρωμών ΟΑΥ (HIO payment reconciliation).

Thin UI: all logic lives in recon/.  Stateless — files live in the browser
session only, the workbook is built in memory (BytesIO), nothing touches disk.

Run:  streamlit run app.py
"""
from __future__ import annotations

import io

import streamlit as st

from recon.build_xlsx import build_workbook, verify_workbook
from recon.checks import (ReconBundle, conditional_requirements,
                          gate4_internal_asserts, run_reconciliation,
                          validate_batch)
from recon.extract import (ExtractionError, extract, merge_sras,
                           parse_sra_text)
from recon.identify import identify
from recon.models import (HOSPITALS, IdentifiedFile, MONTH_ABBR,
                          MONTH_NAMES_EL, REPORT_LABELS, REQUIRED_TYPES,
                          ReportType)
from recon.numbers import format_eur

st.set_page_config(page_title="OKYπY — Συμφωνία ΟΑΥ", page_icon="🏥", layout="wide")

st.title("OKYπY — Συμφωνία Πληρωμών ΟΑΥ")
st.caption("Μηνιαία συμφωνία πληρωμών ΟΑΥ ανά νοσοκομείο "
           "(monthly HIO payment reconciliation per hospital). "
           "Stateless — δεν αποθηκεύεται τίποτα (nothing is stored).")

REPORT_GUIDE_MD = """
**Απαραίτητα (required):**

1. **SRA / Κατάσταση Πληρωμής** (Remittance Advice) — η επιταγή, πάντα PDF
2. **Ενδ. Πληρωμένες Απαιτήσεις** (Inpatient summary) — Excel με ΣΥΝΟΠΤΙΚΟ ΠΙΝΑΚΑ
3. **Πληρωμένες Απαιτήσεις «all»** (Paid HCP claims) — Excel με στήλη DR SEGMENT
   *(η ΟΑΥ συχνά το ονομάζει «..._OS_...» — αναγνωρίζεται από το περιεχόμενο)*
4. **Πληρωμένες Απαιτήσεις ΦΑΡΜΑΚΑ** (Pharma claims) — Excel με στήλη TYPE (Drugs/Consumables)
5. **Αμοιβή Φαρμακοποιού** (Pharmacist fee) — PDF, συσκευασίες × 1,60 €

**Υπό προϋπόθεση (conditional — μόνο όταν το SRA έχει αντίστοιχη γραμμή):**
Capitation Report (κατά κεφαλήν) · Ποιοτικά Κριτήρια (PD-KPIs, MRI/CT) · Αιμοκάθαρση (HEMO)

**Προαιρετικά (optional cross-checks — δεκτά αν ανέβουν, δεν μπλοκάρουν):**
XML activity export · OKYPY ALL GL extract · IS Auditor Report

*Δεκτές μορφές: PDF, Excel (xlsx/xls), XML — η αναγνώριση γίνεται από το περιεχόμενο,
όχι από το όνομα αρχείου. Ένα νοσοκομείο και ένας μήνας ανά εκτέλεση. Το SRA φέρει
**πάντα** ημερομηνία του επόμενου μήνα (η ΟΑΥ πληρώνει με καθυστέρηση) — ο μήνας
υπηρεσιών προκύπτει αυτόματα (ημερομηνία − 1 μήνας). Λάθος SRA για τον μήνα δεν θα
δέσει — οι έλεγχοι θα δείξουν τη διαφορά.*
"""

with st.expander("📋 Τι να ανεβάσετε — Αναφορές ΟΑΥ (which ΟΑΥ reports to upload)",
                 expanded=not st.session_state.get("uploads")):
    st.markdown(REPORT_GUIDE_MD)

uploads = st.file_uploader(
    "Αρχεία αναφορών ΟΑΥ για έναν μήνα (HIO report files for one month)",
    type=["xlsx", "xls", "xml", "pdf"],
    accept_multiple_files=True,
    key="uploads",
)

crosscheck_mode = st.checkbox(
    "Λειτουργία διασταύρωσης — χωρίς SRA (cross-check mode, no SRA)")


@st.cache_data(show_spinner=False)
def _identify_cached(name: str, data: bytes):
    return identify(name, data)


def _checklist(files: list[IdentifiedFile]) -> None:
    by_type = {f.report_type: f for f in files if f.report_type}
    rows = []
    listed = list(REQUIRED_TYPES) + [t for t in ReportType
                                     if t not in REQUIRED_TYPES and t in by_type]
    for t in listed:
        f = by_type.get(t)
        required = t in REQUIRED_TYPES and not (crosscheck_mode and t == ReportType.SRA)
        rows.append({
            "Αναφορά (Report)": REPORT_LABELS[t] + (" *" if required else ""),
            "Αρχείο (Detected file)": f.filename if f else "—",
            "Νοσοκομείο (Hospital)": (f"{f.hospital_code} ({HOSPITALS[f.hospital_code][1]})"
                                      if f and f.hospital_code else "—") if f else "—",
            "Μήνας (Month)": (f"{MONTH_NAMES_EL[f.month]} {f.year}"
                              if f and f.month and f.year else "—") if f else "—",
            "OK": "✔" if f else ("✖" if required else "·"),
        })
    for f in files:
        if f.report_type is None:
            rows.append({"Αναφορά (Report)": "Άγνωστο (unrecognised)",
                         "Αρχείο (Detected file)": f.filename,
                         "Νοσοκομείο (Hospital)": "—", "Μήνας (Month)": "—", "OK": "✖"})
    st.dataframe(rows, use_container_width=True, hide_index=True)


if not uploads:
    st.info("Σύρετε εδώ όλα τα αρχεία του μήνα (drop the month's full ΟΑΥ set above).")
    st.stop()

files = [_identify_cached(u.name, u.getvalue()) for u in uploads]

# manual fallback: fill hospital/month only where detection found nothing
with st.expander("🛠 Χειροκίνητη επιλογή (manual fallback — αν κάτι δεν εντοπίζεται)"):
    hosp_options = ["— αυτόματο (auto) —"] + [
        f"{c} — {gr} ({en})" for c, (gr, en) in HOSPITALS.items()]
    ov_hospital = st.selectbox("Νοσοκομείο (hospital)", hosp_options)
    col_m, col_y = st.columns(2)
    ov_month = col_m.selectbox("Μήνας υπηρεσιών (service month)",
                               ["— αυτόματο —"] + [f"{m:02d} — {MONTH_NAMES_EL[m]}"
                                                   for m in range(1, 13)])
    ov_year = col_y.number_input("Έτος (year, 0 = αυτόματο)", min_value=0,
                                 max_value=2040, value=0)
if ov_hospital != hosp_options[0] or (ov_month != "— αυτόματο —" and ov_year):
    from dataclasses import replace as _dc_replace
    code = ov_hospital.split(" — ")[0] if ov_hospital != hosp_options[0] else None
    month_ov = int(ov_month.split(" — ")[0]) if ov_month != "— αυτόματο —" else None
    patched = []
    for f in files:
        kw = {}
        if code and not f.hospital_code:
            kw["hospital_code"] = code
        if month_ov and ov_year and not f.year:
            kw["year"], kw["month"] = int(ov_year), month_ov
        patched.append(_dc_replace(f, **kw) if kw else f)
    files = patched

with st.expander("🔍 Διαγνωστικά αρχείων (file diagnostics — τι διάβασε η εφαρμογή)"):
    diag_lines = []
    for f in files:
        label = REPORT_LABELS[f.report_type] if f.report_type else "ΔΕΝ ΑΝΑΓΝΩΡΙΣΤΗΚΕ (unrecognised)"
        st.markdown(f"**{f.filename}** → {label}"
                    + (f" — :red[{f.error}]" if f.error else ""))
        if f.probe:
            st.code(f.probe)
        diag_lines += [f"=== {f.filename} → {label}", f.error or "", f.probe or "", ""]
    st.download_button("⬇ Λήψη αναφοράς διαγνωστικών (download diagnostics report)",
                       data="\n".join(diag_lines), file_name="okypy-diagnostics.txt")

for f in files:
    for w in f.warnings:
        st.warning(f"{f.filename}: {w}")

# OCR correction: never guess an amount — scanned SRAs are shown for review
sra_text_override: dict[str, str] = {}
for f in files:
    if f.report_type == ReportType.SRA and f.ocr_used:
        st.subheader("Έλεγχος OCR (OCR review) — SRA")
        st.write("Σαρωμένο PDF: ελέγξτε/διορθώστε τις γραμμές πριν την εκτέλεση "
                 "(scanned PDF — correct the extracted lines before running).")
        sra_text_override[f.filename] = st.text_area(
            f"Κείμενο SRA ({f.filename})", value=f.raw_text or "", height=300)

gates, hospital, period, batch_notes = validate_batch(files, crosscheck_mode)
_checklist(files)

failed = [g for g in gates if not g.passed]
if failed:
    for g in failed:
        st.error(f"Πύλη {g.number} — {g.name}\n\n{g.message}")
    st.stop()

for note in batch_notes:
    st.info(note)

hosp_gr, hosp_en = HOSPITALS[hospital]
year, month = period
st.success(f"Πλήρες σετ: {hosp_gr} ({hosp_en}) — "
           f"{MONTH_NAMES_EL[month] if month else '—'} {year or ''}")

if not st.button("▶ Εκτέλεση συμφωνίας (Run reconciliation)", type="primary"):
    st.stop()

# ---------------------------------------------------------------- extraction
bundle = ReconBundle(hospital_code=hospital, year=year or 0, month=month or 0)
slot = {
    ReportType.SRA: "sra", ReportType.INPATIENT_SUMMARY: "inpatient",
    ReportType.CLAIMS_ALL: "claims", ReportType.PHARMA_CLAIMS: "pharma",
    ReportType.PHARMACIST_FEE: "phfee", ReportType.CAPITATION: "capitation",
    ReportType.QUALITY_CRITERIA: "quality", ReportType.HEMODIALYSIS: "hemo",
    ReportType.GL_EXTRACT: "gl", ReportType.IS_AUDITOR: "isaud",
    ReportType.XML_ACTIVITY: "xml_activity",
}
try:
    sras = []
    for f in files:
        if f.report_type is None:
            continue  # unrecognised file — warned in gate 1, ignored
        raw_text = sra_text_override.get(f.filename, f.raw_text)
        if f.report_type == ReportType.SRA:
            # a month can be settled by several cheques — collect and merge
            sras.append(parse_sra_text(raw_text) if f.filename in sra_text_override
                        else extract(f.report_type, f.data, hospital_code=hospital,
                                     raw_text=raw_text))
        else:
            setattr(bundle, slot[f.report_type],
                    extract(f.report_type, f.data, hospital_code=hospital, raw_text=raw_text))
    if sras:
        bundle.sra = merge_sras(sras, hospital)
        if len(sras) > 1:
            st.info(f"Συγχωνεύθηκαν {len(sras)} SRA (επιταγές: "
                    + ", ".join(f"#{c}" for c, _, _ in bundle.sra.parts)
                    + f") — συνολικό ποσό {format_eur(bundle.sra.stated_total)}.")
except ExtractionError as e:
    st.error(f"Σφάλμα εξαγωγής (extraction failed): {e}")
    st.stop()

if bundle.sra:
    have = {f.report_type for f in files}
    missing_cond = [t for t in conditional_requirements(bundle.sra) if t not in have]
    if missing_cond:
        # warning, not a stop: the run proceeds, but the matching SRA amounts
        # are not vouched by a report and stay visible in the cross-checks
        st.warning("Το SRA περιέχει γραμμές που αντιστοιχούν σε αναφορές που δεν "
                   "ανέβηκαν (SRA lines whose supporting reports were not uploaded):\n\n· "
                   + "\n· ".join(REPORT_LABELS[t] for t in missing_cond)
                   + "\n\nΗ εκτέλεση συνεχίζεται — τα σχετικά ποσά δεν επαληθεύονται "
                     "από αναφορά (amounts not vouched by a report).")

for g in gate4_internal_asserts(bundle):
    if not g.passed:
        # findings, not stops: the run proceeds, the diffs are documented as
        # red rows in Source_crosscheck and shown here
        st.warning(f"Πύλη {g.number} — {g.name} — ΕΥΡΗΜΑ (finding, run continues):"
                   f"\n\n{g.message}")

result = run_reconciliation(bundle, crosscheck_mode=crosscheck_mode or bundle.sra is None)
workbook_bytes = build_workbook(result)

# Gate 5: reopen and recompute every zero-check; a documented SRA parsing
# residual (shown as a red Source_crosscheck row) is tolerated, never hidden
zero_failures = verify_workbook(workbook_bytes,
                                documented_residual=result.sra_residual)
if zero_failures:
    st.error("Πύλη 5 — Zero-checks: κάποια κελιά ελέγχου δεν είναι 0 "
             "(some zero-check cells are not 0):\n\n· "
             + "\n· ".join(f"{s}!{c} = {format_eur(v)}" for s, c, v in zero_failures))
    st.stop()
if abs(result.sra_residual) > 0.011:
    st.warning("Τα zero-checks διαβάζουν την τεκμηριωμένη διαφορά "
               f"{format_eur(result.sra_residual)} (SRA γραμμές − δηλωμένο σύνολο) — "
               "βλ. κόκκινη γραμμή στο Source_crosscheck.")

# ------------------------------------------------------------------ summary
st.header("Αποτέλεσμα (Result)")
if result.cheque_total is not None:
    cols = st.columns(5)
    cols[0].metric("Επιταγή (Cheque)", format_eur(result.cheque_total))
    for c, (bucket, amount) in zip(cols[1:], result.buckets.items()):
        c.metric(bucket.value, format_eur(amount))
    st.success("Zero-checks: όλα 0 ✔ (all zero-checks pass)")
else:
    st.info("Cross-check mode: χωρίς έλεγχο επιταγής (no cheque tie-out).")
    st.dataframe(
        [{"Ροή (Stream)": r["stream"],
          **{k: (format_eur(v) if v is not None else "—") for k, v in r["values"].items()},
          "Range": format_eur(r["range"]) if r["range"] is not None else "—"}
         for r in result.matrix],
        use_container_width=True, hide_index=True)

open_var = result.open_variances
if open_var:
    st.subheader("Ανοιχτές αποκλίσεις (Open variances)")
    st.dataframe(
        [{"Έλεγχος (Check)": c.name, "Πηγή (Source)": format_eur(c.source_total),
          "SRA": format_eur(c.sra_side) if c.sra_side is not None else "—",
          "Διαφορά (Diff)": format_eur(c.diff) if c.diff is not None else "—",
          "Σημείωση (Note)": c.note} for c in open_var],
        use_container_width=True, hide_index=True)
else:
    st.write("Καμία ανοιχτή απόκλιση (no open variances).")

fname = (f"OKYPY_HIO_{hospital}_{MONTH_ABBR[month] if month else 'XX'}"
         f"{year or ''}_Reconciliation.xlsx")
st.download_button(
    "⬇ Λήψη Excel (Download Excel workbook)",
    data=io.BytesIO(workbook_bytes),
    file_name=fname,
    mime="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    type="primary",
)
