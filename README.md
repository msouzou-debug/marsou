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
5. Download the workbook. Five tabs: `SRA_<cheque>`, `Reconciliation`,
   `Source_crosscheck`, `By_Clinic_Split`, `Legend`. Blue font = input off a
   source report, black = live formula, green = cross-sheet link, yellow
   fill = zero-check. Every total is a live formula — edit a blue cell and
   the workbook re-ties or shows the break.

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

## Layout

```
app.py               thin Streamlit UI
recon/
  models.py          report types, hospitals, buckets, normalized schemas
  numbers.py         Greek/Anglo amount parsing, 1.234.567,89 € formatting
  identify.py        identify(file) -> report type, hospital, year, month
  extract.py         one normalizer per report type (xlsx/xls/xml/pdf/OCR)
  checks.py          gates, cross-checks, variance annotation, clinic split
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
