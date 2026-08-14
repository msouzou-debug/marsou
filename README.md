# OKYπY — Συμφωνία Πληρωμών ΟΑΥ (HIO Reconciliation App)

Single-page internal Streamlit app that reconciles ΟΑΥ (HIO) payments for any
of the 8 OKYπY hospitals, one month at a time. Drop the month's ΟΑΥ report
files into the upload zone; the app checks the set is complete, runs the
reconciliation, and returns one Excel workbook: SRA breakdown, 4-bucket cash
settlement, source cross-checks, and the by-clinic revenue split finance
posts to SAP.

**Stateless.** No database, no login, nothing written to disk — files live in
the browser session, the workbook is built in memory. The full functional
spec is in [`CLAUDE.md`](CLAUDE.md).

The tool ships in **two equivalent flavours** with the same logic, checks and
output workbook:

| | HTML app (`webapp/`) | Streamlit app (`app.py`) |
|---|---|---|
| Runs | entirely in the browser — double-click `webapp/index.html` or serve the folder statically | Python server (`streamlit run app.py`) |
| Files | never leave the user's machine | uploaded to the on-prem server session |
| Scanned SRAs (OCR) | not supported — paste/correct the text on screen | pytesseract + Greek traineddata |
| Dependencies | none (JS libraries vendored in `webapp/vendor/`) | `requirements.txt` + tesseract |

## Run — HTML app (no installation)

**Easiest: the single file.** Download `webapp/okypy-recon.html` (~3.4 MB,
everything embedded) and double-click it. That one file is the whole app —
it can be copied to a share or emailed around; nothing is fetched from the
network.

Alternatively use the multi-file layout — open `webapp/index.html` with the
`js/` and `vendor/` folders next to it, or host the `webapp/` folder on any
static file server for the LAN:

```bash
python -m http.server 8080 -d webapp
```

After editing anything under `webapp/`, regenerate the single file with
`python webapp/build_single.py`.

## Run — Streamlit app

```bash
pip install -r requirements.txt
streamlit run app.py
```

Users reach it over the LAN at `http://<server>:8501`.

### System packages (OCR fallback for scanned SRAs)

Text-layer PDFs are parsed with pdfplumber. Scanned SRAs fall back to OCR,
which needs the Tesseract binary **and the Greek traineddata**:

```bash
# Debian/Ubuntu
sudo apt-get install tesseract-ocr tesseract-ocr-ell
```

Without these the app still runs; it only refuses scanned (image-only) PDFs
with a clear message. When OCR *is* used, the extracted SRA lines are shown
on screen for correction before the run — the app never guesses an amount.

## Usage

1. Drop **all** of the month's files in the single upload zone (xlsx / xls /
   xml / pdf). Files are identified **by content, never by filename** — ΟΑΥ's
   "..._OS_..." naming of the all-segments claims file is handled.
2. The checklist shows report → detected file → hospital → month → ✔/✖.
   Mixed batches (two hospitals or two months) are rejected.
3. **Run** is enabled once the required set is complete:
   SRA (PDF) · Ενδ. Πληρωμένες Απαιτήσεις · Πληρωμένες Απαιτήσεις «all» ·
   ΦΑΡΜΑΚΑ · Αμοιβή Φαρμακοποιού — plus Capitation / Ποιοτικά Κριτήρια /
   Αιμοκάθαρση whenever the SRA has a matching line. GL extract, IS Auditor
   and the XML activity export are optional cross-checks.
4. **No SRA?** Tick *cross-check mode*: the cash tie-out is skipped and a
   report-vs-report matrix (streams × reports, Range column) is produced
   instead.
5. Download the workbook: `SRA_<cheque>`, `Reconciliation`, `GL_Bridge`,
   `Απαιτήσεις_vs_SRA`, `Source_crosscheck`, `Ανάλυση_ελέγχων`,
   `By_Clinic_Split`, `Ανά_ιατρό`, `Πώς_δένουν`, `Legend`. Blue font = input off a source report, black =
   live formula, green = cross-sheet link, yellow fill = zero-check. Every
   total is a live formula — edit a blue cell and the workbook re-ties or
   shows the break.

   `Ανάλυση_ελέγχων` is the audit trail: every `Source_crosscheck` row
   written out as a full reconciliation — each side broken into its
   components (report figures, SRA lines as live SUMIFS, reconciling items),
   live subtotals, the difference, and two cells proving the block agrees
   with `Source_crosscheck`. A side whose itemisation doesn't add up gets an
   explicit *not itemised* row, so nothing is absorbed silently.

`By_Clinic_Split` splits the inpatient fee **three ways** — DRG, daily
treatments, and Z-catalogue drugs/procedures — each with its own live column
subtotal. The three sources are **combined, never chosen between**: whichever
per-clinic view accounts for more of the bucket (the claims file's
per-speciality grouping, or ΟΑΥ's per-clinic pivot) supplies the totals, and
the per-claim detail table's `Procedure Class Id` supplies the classification
(`FixedFee` → daily, `ZDRUG`/`ZPROC`/`ZCONSU` → Z-drugs). DRG is then what is
left of each clinic's own total. That matters because the detail table
usually lists **only** the fixed-fee side — reading it alone drops the DRG
euros, the bulk of the bucket. A clinic whose classified euros exceed its
total is left unsplit rather than forced; files with no detail table fall
back to the pivot, with the Z column empty.

`GL_Bridge` is the cash-vs-booked page: the cheque per bucket (linked from
`Reconciliation`), the ΟΑΥ ledger's own cost centres for the same bucket, and
the live variance, with two zero-checks — the cash side equals the cheque,
and the bucket variances add up to (cash − booked). Known ledger
classifications are annotated per bucket; the account-level detail stays in
`Source_crosscheck`. The GL also now reads 26003 (Z-catalogue) and 26007
(per diem / daily) apart, while `z_catalogue` still returns the pair so the
existing 26003+26007 check is unchanged.

`Απαιτήσεις_vs_SRA` reconciles the «Πληρωμένες Απαιτήσεις all» export (A&E
included) to the cheque, segment by segment: panel A puts each `DR SEGMENT`
total next to the SRA's daily line for that stream, panel B lists every other
service code the cheque pays — built from the codes actually present on the
SRA tab, so the two panels are the whole non-pharma cheque **by
construction** — and panel C carries the completeness zero-check plus the
named explanation of the panel-A gap (capitation paid inside the PD lines).
Whatever is left is written out as *unexplained*, in red. Nothing is absorbed
into a residual line.

## Validation gates (in order, stop on failure)

1. Every file parses and maps to exactly one report type.
2. Single hospital, single month across the batch.
3. Required set complete (or cross-check mode ticked).
4. Internal asserts: Ενδ Σύνολο = sum of its lines; claims-all Inpatient =
   Ενδ Σύνολο to the cent; SRA lines sum = stated cheque.
5. The built workbook is reopened and every zero-check recomputed — all must
   read 0. Known variances (Z-catalogue classification, pharma reclass,
   pharmacist-fee flat booking) are annotated in `Source_crosscheck`, never
   silently absorbed. Unexplained differences are findings, in red.

## Mental-health units (non-hospital ΟΑΥ providers)

ΟΑΥ also pays OKYπY units that are not one of the 8 hospitals — the mental
health services — and ships a whole month as ONE folder covering several of
them at once. The app detects that shape and switches to **provider mode**:

- a batch is grouped **by provider, from file content only**: the SRA by the
  supplier F-code in its header (which wraps across two lines,
  `...INCOME-MENTAL / HEALTH-F1070`), the paid-claims file by its
  `PAYMENT NO.` (= that provider's cheque), the activity export by its
  `ProviderId`. ΟΑΥ names every unit's file identically, so filenames are
  never consulted;
- the required set per provider is **SRA + Πληρωμένες Απαιτήσεις «all»** —
  these units bill service streams only (OS / NM / AP), with no DRG summary,
  no pharmacy and no pharmacist fee;
- the activity export arrives as **.xlsx** (in a folder called `XMLS`); it is
  normalised to exactly what the XML path produces, so every cross-check is
  format-agnostic;
- provider names are read from the file content (`ProviderName`) and only
  fall back to the built-in registry, so a unit the app has never seen still
  shows its real name;
- output is ONE workbook: `Σύνοψη_παρόχων` (a row per provider — the cheque
  split by stream as live SUMIFS into that provider's own SRA tab, its claims
  and activity figures, the differences, and a grand total that must equal
  the sum of the cheques), one `SRA_<cheque>` tab per provider,
  `Ανά_μονάδα_ιατρό`, and the shared `Source_crosscheck` /
  `Ανάλυση_ελέγχων` / `Legend` sectioned per provider;
- `Ανά_μονάδα_ιατρό` is the posting sheet: each unit's cheque split by
  speciality and by professional off the claims file's `ASSOCIATED DOCTOR` /
  `DR SPECIALITY` columns, then bridged to the cheque in live formulas. The
  claims-vs-SRA gap and the SRA lines outside OS/NM/AP are their own rows —
  nothing is spread across professionals to force a tie — and each unit block
  ends in a zero-check.

### Clinic split and the SAP upload file

These units have a clinic structure the ΟΑΥ files do not carry: a
professional works, say, 3/5 of the week in one Ε.Ι.Ψ.Υ. and 2/5 in another.
ΟΑΥ pays the UNIT; the service posts by CLINIC. The bridge is the **monthly
staff roster**, uploaded with the month's files:

- the roster is any workbook with `Personal ID / First Name / Last Name` and
  one column per month («ΙΑΝΟΥΑΡΙΟΣ 2026» …). The month cell holds the
  placement — «3/5 Ε.Ι.Ψ.Υ. ΛΑΡΝΑΚΑΣ και 2/5 Ψ.Ν.Α» — and a «√» means
  *unchanged*, so the last stated month to its left is carried forward.
  Upload **one roster per profession**; the app merges them;
- professionals are matched to the roster across alphabets (ΟΑΥ prints
  «ΟΘΩΝ ΤΣΙΡΚΑΣ / OTHON TSIRKAS», the roster is Greek only). A fuzzy match is
  accepted only when it is both very close and unique — otherwise the
  professional lands in a visible «no roster row» block with the full amount
  intact. Money is never attributed on a maybe;
- `Ανά_κλινική` shows clinic → professional → share → amount, with a
  zero-check against the claims files;
- `JOURNAL ENTRIES` writes the month in the service's own SAP journal
  template, reproduced from their workbook: three header rows (group row,
  the descriptive row finance reads, then the technical `BKPF-`/`BSEG-` field
  names), data from row 4, and the remittance advice in the last column.
  **One layout for both kinds of month** — see below for how a hospital fills
  it.
  **One document per remittance advice** — a debit line (`01` / `200000`)
  whose amount is a live `SUM` of its own credit lines, then one credit line
  (`50` / `412002`, tax `O0`) per cost centre × internal order × **professional**,
  ordered by cost centre, order, then professional. `BKTXT` and `SGTXT` are
  formulas off the advice column, so changing the advice number updates both
  texts.

  The amount column (`BSEG-DMBTR`) therefore breaks down by professional, and
  a helper column beside the advice names whose money each line is. Each
  professional's lines add back to what the `Ανά_μονάδα_ιατρό` sheet pays them
  (its column E) — the roster only re-splits that money across clinics, it
  never changes it, so a professional working two clinics gets a line in each.

  Whatever the clinic split does not cover (claims-vs-SRA, adjustment lines)
  becomes an explicit *TO CLASSIFY* line so every document still posts the
  whole advice with the unallocated part visible — it is never spread over
  the clinics.

  It downloads as its own file, where the journal sheet stays **clean** —
  finance selects it whole and feeds it to SAP — and the checks (credits =
  debits, and each document against its own advice) sit on a separate
  `Έλεγχος_SAP` sheet.

The SAP codes come from an **optional lookup** — a sheet or a file with
`Κλινική | Κέντρο κόστους | Εσωτερική εντολή | Κείμενο SAP` (plus an optional
`Ειδικότητα` column). The internal order follows the professional category
(13 nurses, 14/16 allied health, 15 doctors…) rather than the clinic, so when
a clinic row leaves it blank a speciality-keyed row supplies it — that
fallback fills the internal order only, never the cost centre. Without the
lookup the sheet is still produced, keyed by clinic, with those two columns
blank and highlighted and every clinic that needs a code listed — the app
never invents an account code.

### The same journal for a hospital month

A hospital and a mental-health unit post the same cheque differently, so the
credit lines come from different places — but the **layout is one file and one
template**, and finance uploads the same kind of thing either way:

| | mental-health unit | hospital |
|---|---|---|
| document | one per remittance advice / unit | one for the month |
| credit line | cost centre × internal order × professional | one per `By_Clinic_Split` row |
| driven by | the monthly staff roster | the reconciliation itself |
| analysis column | the professional | the bucket (Inpatient / A&E / Outpatient / Pharma) |

So a hospital month exports **all four revenue streams in one go** — inpatient
by clinic, ΤΑΕΠ, outpatient by speciality, personal doctors, pharma and the
adjustment lines — and the document's total is the same figure
`By_Clinic_Split` already ties to the cheque, bucket by bucket. The tab is in
the workbook and downloads as its own file from the results page.

Verified on the real May-2026 month (five units, cheques 266444 / 266457 /
266458 / 266474 / 266475, €211.006,20 in total) — see
`tests/test_providers.py` and `tests/test_mapping.py`, which run the same
chain on synthetic fixtures.

## All eight hospitals (universality)

Nothing in the app is tied to one hospital or one month. The rules were
validated on real months of Famagusta, Larnaca and Nicosia, and every one of
them is keyed off content, not off an F-code:

- the eight codes live **only** in `HOSPITALS` (`recon/models.py`,
  `webapp/js/core.js`); the F-code regex and the checklist are derived from
  it, so adding a hospital is a one-line change;
- the org-wide reports (GL extract, IS Auditor) are filtered by
  `VENDOR_CODE` / provider name — «ΛΕΥΚΩΣΙΑΣ» alone is never used, it also
  appears in Makarios exports;
- the GL cost-centre map (26001 / 26002 / 26003+26007 / 25801 / 25501 /
  255xx / 25xxx, capitation 51001001, EOAF 11202192) is org-wide: verified
  on the real April-2026 extract for all eight vendors. Anything booked to a
  centre the map doesn't know is **shown** as its own `Source_crosscheck`
  row naming the centre — never absorbed into a bucket;
- streams a hospital doesn't have simply come out zero (Makarios has no
  ΤΑΕΠ; some hospitals have no capitation line), and thinner exports (no
  per-claim listing, no ASSOCIATED DOCTOR column) degrade the by-clinic /
  by-doctor detail without touching the cash reconciliation;
- the pharmacist-fee unit price is read from the report (1,60 € historically,
  1,62 € later) — including in the summary-only fallback;
- a cheque made out to a **satellite** provider (an F-code outside the eight,
  e.g. F1085) is tagged `SAT` and reported separately; a cheque for another
  OKYπY hospital is a mixed batch and trips gate 2.

`tests/test_universal.py` drives the whole chain — identify → gates →
extract → reconcile → build → gate-5 verify — once per hospital.

## Layout

```
app.py               thin Streamlit UI
recon/
  models.py          report types, hospitals, buckets, normalized schemas
  numbers.py         Greek/Anglo amount parsing, 1.234.567,89 € formatting
  identify.py        identify(file) -> report type, hospital, year, month
  extract.py         one normalizer per report type (xlsx/xls/xml/pdf/OCR)
  checks.py          gates, cross-checks, variance annotation, clinic split
  mapping.py         staff roster -> clinic split, SAP cost-centre lookup
  build_xlsx.py      workbook builder + gate-5 formula re-verification
webapp/              self-contained HTML app (same logic, ported to JS)
  okypy-recon.html   SINGLE-FILE build — the whole app in one file
  index.html         multi-file entry (needs js/ and vendor/ next to it)
  js/                core / identify / extract / checks / build_xlsx / app
  vendor/            SheetJS, pdf.js, ExcelJS (vendored, works offline)
  build_single.py    regenerates okypy-recon.html from the parts
tests/               unit + end-to-end tests on synthetic Greek fixtures
fixtures/            put the real ΟΑΥ months here (see fixtures/README.md)
```

The SRA line-code → bucket/source mapping lives in `SRA_CODE_MAP`
(`recon/extract.py` and mirrored in `webapp/js/extract.js`) with a keyword
fallback for SRAs without explicit codes. **Keep the Python and JS ports in
sync** — any rule change goes to both.

## Tests

```bash
python -m pytest tests/ -q
```

The suite runs on synthetic fixtures that mirror the brief's F1049 Mar-2026
numbers (cheque €1,936,528.19; buckets 1,061,728.70 / 131,284.66 /
78,729.74 / 664,785.09; pharmacist fee 8,076 × 1.60 €). The three real
acceptance months (`tests/test_acceptance.py`) run automatically when the
confidential files are placed under `fixtures/` — see `fixtures/README.md`.
A build that reproduces those three months to the cent is done.
