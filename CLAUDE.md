# Build brief — OKYπY HIO Reconciliation App

Paste this whole file into Claude Code as the opening prompt. Keep it in the repo as `CLAUDE.md`.

---

## What to build

A single-page internal Streamlit app that reconciles ΟΑΥ (HIO) payments for any of the 8 OKYπY hospitals, one month at a time. The user drops the month's ΟΑΥ report files into one upload zone, the app checks the set is complete, runs the reconciliation, and returns one Excel workbook per run: SRA breakdown, 4-bucket cash settlement, source cross-checks, and a by-clinic revenue split that finance uses to post to SAP.

Stateless. Nothing is stored after the browser session ends. No database, no login. Runs on-prem on a single server (`streamlit run app.py`), users reach it over the LAN.

The model output is the attached reference workbook `OKYPY_HIO_F1049_MAR2026_Reconciliation.xlsx`. Reproduce its structure exactly. Put it in `fixtures/` and treat it as the spec.

---

## The hospitals

| Code | Hospital |
|------|----------|
| F1054 | ΓΕΝΙΚΟ ΝΟΣΟΚΟΜΕΙΟ ΛΕΥΚΩΣΙΑΣ (Nicosia) |
| F1050 | ΜΑΚΑΡΕΙΟ ΝΟΣΟΚΟΜΕΙΟ (Makarios) |
| F1047 | ΓΝ ΛΕΜΕΣΟΥ (Limassol) |
| F1048 | ΓΝ ΛΑΡΝΑΚΑΣ (Larnaca) |
| F1049 | ΓΝ ΑΜΜΟΧΩΣΤΟΥ (Famagusta) |
| F1025 | ΓΝ ΠΑΦΟΥ (Paphos) |
| F1055 | ΝΟΣΟΚΟΜΕΙΟ ΚΥΠΕΡΟΥΝΤΑΣ (Kyperounta) |
| F1026 | ΝΟΣΟΚΟΜΕΙΟ ΠΟΛΗΣ ΧΡΥΣΟΧΟΥΣ (Polis) |

Watch out: filtering Nicosia on the string «ΛΕΥΚΩΣΙΑΣ» alone also catches Makarios. Match the full provider name or the F-code.

---

## The ΟΑΥ report set (the checklist the app shows)

ΟΑΥ issues the same report in different formats depending on hospital and month: **PDF, XML or Excel**. The app accepts all three for every report type; only the SRA is fixed (always PDF). Build the extraction layer format-agnostic: one normalizer per report type that outputs the same internal schema whether the source was xlsx, xml or pdf.

**Required for a full cash reconciliation:**

1. **SRA / Remittance Advice** («Κατάσταση Πληρωμής», cheque) — **always PDF**. The anchor. Its lines dictate everything else.
2. **Ενδ. Πληρωμένες Απαιτήσεις** — inpatient summary Excel. ΣΥΝΟΠΤΙΚΟΣ ΠΙΝΑΚΑΣ block: Κανονικά, Εξειδικευμένα, ±με παραπεμπτικό, Z-catalogue, Σύνολο.
3. **Πληρωμένες Απαιτήσεις «all»** — paid HCP claims Excel, column DR SEGMENT with 5 values (Inpatient / Outpatient Specialists / A&E / Nurses-Midwives / Allied Health), amount column HIO REIMB. **ΟΑΥ often names this file "..._OS_..."** even though it holds all segments. Identify by content, never by filename.
4. **Πληρωμένες Απαιτήσεις ΦΑΡΜΑΚΑ** — pharma claims Excel, column TYPE (Drugs / Consumables), amount HIO REIMB.
5. **Pharmacist Fee Report** («Αμοιβή Φαρμακοποιού») — PDF. Packages × €1.60. Parse the table: invoice ID, packages, amount.

**Conditional — required only when the SRA has a matching line:**

6. Capitation Report (PD line includes capitation)
7. Quality Criteria («Ποιοτικά Κριτήρια», PD-KPIs and MRI/CT lines)
8. Hemodialysis monthly report (HEMO adjustment line)

**Optional cross-checks (accept if uploaded, never block on them):**

9. XML activity export — outpatient activity level, columns ClaimId / ActivityReimbursementAmount. Covers OS+NM+AP.
10. OKYPY ALL GL extract — sheet like `ALL OKYPY MM.YY`, columns VENDOR_CODE / COST_CENTER / ACCOUNT / EURO_AMOUNT.
11. IS Auditor Report — org-wide inpatient detail.

If no SRA is uploaded, offer **cross-check mode**: skip the cash tie-out and the Reconciliation tab's cheque check, produce the report-vs-report matrix instead (streams as rows, reports as columns, Range column). Everything else stays the same.

---

## UI flow (one page)

1. Title, short Greek/English subtitle.
2. **One `st.file_uploader` with `accept_multiple_files=True`**, types: xlsx, xls, xml, pdf.
3. On upload, identify each file **by content** (see below). Show the checklist as a table: report name → detected file → hospital → month → ✔/✖. Reject a mixed batch (two hospitals or two months) with a clear message.
4. A **Run** button, disabled until the required set is complete (or the user ticks "cross-check mode, no SRA").
5. After the run: on-screen summary (cheque total, 4 buckets, zero-check result, open variances) and a **Download Excel** button. `st.download_button` on an in-memory BytesIO — nothing written to disk.

Labels bilingual: Greek first, English in parentheses. Amounts formatted `1.234.567,89 €` on screen.

---

## File identification (content, not filename)

Write one `identify(file) -> ReportType, hospital_code, year, month` function:

- **Ενδ. summary**: header cells «Κωδικός ΓεΣΥ Παροχέα», «ΣΥΝΟΠΤΙΚΟΣ ΠΙΝΑΚΑΣ». Hospital/year/month sit in row 2.
- **Claims «all»**: has a DR SEGMENT column.
- **Pharma claims**: has TYPE column with Drugs/Consumables values.
- **Pharmacist Fee PDF**: text contains «Αμοιβή Φαρμακοποιού»; parse Μήνας/Έτος/Κωδικός Παροχέα and the table row (unit price, packages, amount).
- **SRA (always PDF)**: contains cheque/payment number and supplier lines. Parse every line: code, description, amount. pdfplumber first (text layer). If no text layer (scanned), fall back to OCR — pytesseract with the Greek traineddata (`ell`) — and re-run the same line parser. If OCR confidence is poor, show the extracted lines to the user for on-screen correction before running; never fail silently and never guess an amount.
- **XML files**: parse with lxml. Detect the report type from the root element / field names (e.g. ClaimId + ActivityReimbursementAmount = activity export; segment fields = claims). Same normalizer output as the Excel path.
- **GL**: VENDOR_CODE + EURO_AMOUNT columns.
- **IS Auditor**: Billing Provider Name + DRG Id columns.

Hospital code: read it from the file content (F-code column or header). Month/year likewise. Never trust the filename.

---

## Extraction rules (validated on real months — do not improvise)

- **Inpatient summary**: take Συνολική αμοιβή per category from ΣΥΝΟΠΤΙΚΟΣ ΠΙΝΑΚΑΣ. Regular = Κανονικά + Κανονικά με παραπεμπτικό. Specialized = Εξειδικευμένα + με παραπεμπτικό. Z-catalogue its own line. Σύνολο must equal the sum — assert it.
- **Claims «all»**: group HIO REIMB by DR SEGMENT. The Inpatient segment must equal the Ενδ. Σύνολο to the cent — assert it.
- **IS Auditor** (when uploaded): filter rows to the hospital by full provider name. DRG flag: `DRG Id` `.notna()` **first**, then `str.strip()!=''` and `lower()!='nan'` (pandas StringDtype quirk). DRG fees = DRG/FF Total Amount on DRG rows. Z-catalogue = **all** Procedures Total Amount (DRG rows + standalone ZD/ZF/ZC rows). Normal/Specialised split from Invoice Category.
- **GL** (when uploaded): filter VENDOR_CODE = F-code. Cost-centre map: 26001 regular DRG, 26002 specialized, 26003+26007 Z-catalogue, 25801 A&E, 25501 pharmacist fee, other 255xx pharma, remaining clinical 25xxx = outpatient bucket (holds OS+NM+AP together). Capitation = account 51001001.
- **Pharma claims**: sum HIO REIMB by TYPE.

Numbers: strip thousands separators, coerce, fillna(0). Every total the app prints must be reproducible from the raw file.

---

## Reconciliation logic → output workbook

One xlsx via openpyxl, five tabs, mirroring the fixture:

**1. `SRA_<cheque no>`** — every SRA line: Code, Description, Channel, Bucket (Inpatient / A&E / Outpatient / Pharma), the HIO source report that supports it, Amount. Bottom: TOTAL (live SUM), stated cheque total, and `Check = TOTAL − stated` which must be 0.

**2. `Reconciliation`** — the 4 buckets as **live SUMIFS on the SRA tab's Bucket column**, TOTAL, cheque, and a zero-check. No hardcoded bucket numbers.

**3. `Source_crosscheck`** — one row per check: source-report total (blue input) vs the SRA side (green formula pulling from tab 1), Diff (live), Note. Minimum checks: inpatient claims file = SRA IS line; pharma drugs = PHD; pharmacist fee = PHF (packages × 1.60 as a live formula); HCP claims ex-capitation ≈ SRA service lines; capitation = capitation report. When GL / IS Auditor / XML are uploaded, add their rows here too.

**4. `By_Clinic_Split`** — the SAP posting sheet. Inpatient by clinic/specialty with Fixed Fee and DRG columns (from the inpatient claims per-clinic detail), A&E, OS by specialty, NM, AP, PD (FFS + capitation), pharma lines, adjustments. Subtotals per bucket as live SUMs; the grand total must equal the cheque — put a zero-check at the bottom.

**5. `Legend`** — colour key and notes.

Formatting rules (non-negotiable):
- Blue font = hardcoded input off a source report. Black = formula. Green = cross-sheet link. Yellow fill = zero-check cells.
- Every subtotal, total, diff and check is a **live formula**. If a reviewer changes a blue cell, the whole workbook must re-tie or show the break.
- SUMIFS criteria reference header/label cells, not quoted strings.
- Brand colours for headers: navy #062E5C, blue #0072BC, sky #00AEEF, green #8DC63F, gray #595959.

Known variances to annotate automatically when the cross-check columns are present (note text, don't hide the diff):
- Z-catalogue GL below ΟΑΥ → Z-procedures/tail booked to clinical accounts. Classification, not cash.
- Pharma claims gross above GL → generics/discounts/co-pay reclass.
- Pharmacist fee GL ≈ flat ~€24k vs report packages × €1.60 → known booking issue, flag amber.

---

## Validation gates (in order, stop on failure with a plain-language message)

1. All files parse; each maps to exactly one report type.
2. Single hospital, single month across the batch.
3. Required set complete (or cross-check mode ticked).
4. Internal asserts: Ενδ Σύνολο = sum of its lines; claims-all Inpatient = Ενδ Σύνολο; SRA lines sum = stated cheque.
5. After building the workbook, reopen it and recompute: every zero-check cell must read 0 (except documented open variances, which appear in Source_crosscheck with a note, never silently absorbed).

Never plug a difference. An unexplained diff is a finding, shown in red, with the two sides and the gap.

---

## Tech notes

- Python 3.11+, streamlit, pandas, openpyxl, pdfplumber, lxml, pytesseract + tesseract-ocr-ell (OCR fallback for scanned SRAs). `requirements.txt` pinned; document the tesseract system package in the README.
- Pure functions in `recon/` (identify.py, extract.py, build_xlsx.py, checks.py); `app.py` is thin UI. Every extraction function unit-tested.
- All parsing from BytesIO. No temp files, no persistence, no outbound calls.
- Handle Greek text everywhere (UTF-8, Greek sheet names, Greek headers).

## Acceptance tests (fixtures — real months, expected numbers)

Ship `tests/` that run against the fixture files and assert:

- **F1049 Mar-2026** (the reference workbook): cheque 259434 = **€1,936,528.19**; buckets Inpatient 1,061,728.70 / A&E 131,284.66 / Outpatient 78,729.74 / Pharma 664,785.09; all zero-checks 0; pharmacist fee 8,076 × 1.60 = 12,921.60.
- **F1054 May-2026** (cross-check mode, no SRA): Ενδ = claims-all Inpatient = IS Auditor inpatient = **€9,754,514.71** (IS Auditor within €0.45); DRG fees 7,426,636.07; Z-catalogue 2,327,878.64; A&E claims = GL = 263,988.21; pharmacist fee report 32,853 × 1.60 = 52,564.80 vs GL 23,655.52 flagged.
- **F1054 Jan-2026**: inpatient three-way tie at **€13,162,508.96**; pharmacist fee 35,319 × 1.60 = 56,510.40 vs GL 24,229.17 flagged.

A build that reproduces these three months to the cent is done. Then hand it to a second hospital's finance officer for a real month before wider rollout.
