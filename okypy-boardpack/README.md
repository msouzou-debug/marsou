# OKYπY Board-Pack generator

A small **local, offline** app that turns the monthly revenue/expense workbook
into the approved Board EBITDA deck (month + YTD) in **HTML, PDF and PPTX**.

It does **not** rebuild the deck. It starts from the board-approved
`presentation_template.html` and *injects* freshly recomputed numbers, tables and
commentary into stable, text-anchored positions — so the approved look is
preserved and risk stays low. Nothing leaves the machine (public-sector data).

> **Recomputed tabs (all 8).** Driven entirely by the uploaded workbook and
> updating for any month:
> - **Σύνοψη Αποτελεσμάτων** — four EBITDA tables, ΣΥΝΟΨΗ headline, exec bar
>   charts, inpatient narrative + up to four alert lines.
> - **Αναλυτικές Αποτελεσμάτων** — consolidated EBITDA P&L + 5 KPI tiles.
> - **Μηνιαία Ανάλυση** — per-month tiles, EBITDA-trend chart, monthly table.
> - **Ανά Νοσηλευτήριο** — per-unit scoreboard, both charts, the Public-Health
>   clearing cards (special units) and the standard per-hospital cards. `n25` is
>   the 2025 EBITDA net from source; `ph_oh` is a €0,5M policy constant
>   (`config.HOSPITAL_PH_OH`).
> - **Λειτ. Έξοδα** — opex summary, threshold-based Άλλες overrun sub-analysis
>   (col G), monthly stacked chart.
> - **ΟΑΥ Έσοδα** — full OAY table, inpatient/outpatient monthly charts and
>   per-unit tables with Αξιολόγηση badges.
> - **Άλλα Έσοδα** — sub-category analysis (col G, both years) + per-unit
>   distribution chart/table.
>
> All monthly figures come straight from the DATA sheets' per-month columns, so
> every tab is mutually consistent (this corrects a drift in the original deck,
> whose monthly-2025 series did not sum to the stated 2025 total).
>
> - **Μισθοδοσία** — KPI tiles, personnel comparison, ΟΚΥΠΥ Σύμβαση component
>   table, Ωρομίσθιο waterfall, all cost/headcount trend charts, and the
>   Επιδόματα/Υπερωρίες Top-N tables (from the ΜΙΣΘΟΔ/ΩΡΟΜΙΣΘΙΟ/ΥΠΕΡΩΡΙΕΣ/
>   HEADCOUNT sheets). **All 8 tabs now recompute from the workbook.**
>
> Two payroll caveats (data not in the workbook): the Top-N tables' Π/Υ column
> shows «—» (no budget-by-unit/type exists), and the Σύμβαση-trend head-count
> line keeps the template value (HEADCOUNT covers only Αποσπασμένοι/Ωρομίσθιοι).

---

## Install

```bash
cd okypy-boardpack
pip install -r requirements.txt
python -m playwright install chromium      # once, for PDF/PPTX
```

Chart.js is **vendored** at `templates/assets/chart.umd.js` and inlined into
every output, so the generated deck renders charts with no network access.

The generated **HTML is responsive** — a mobile/tablet layer is injected at
build time (columns collapse to a single column ≤900px, padding tightens, the
tab bar becomes swipeable, tables scroll horizontally) while the desktop look is
untouched. The PDF/PPTX always render at the fixed desktop 1920px width.

## Run (UI)

```bash
streamlit run app.py
```

1. **Upload** `01-MM_ΓΙΑ_CLAUDE.xlsx`. The month `MM` is auto-detected from the
   filename; override it with the dropdown.
2. **Commentary** — edit the inpatient narrative (prefilled with the approved
   text) and the four "Top 4 Στρατηγικές Αποκλίσεις" alert lines (empty ones are
   dropped). Text is injected verbatim; `<` is encoded as `&lt;`.
3. **Προεπισκόπηση** — runs load → metrics → the reconciliation gate and shows
   the four tables plus a green "όλα δένουν" / red gap report.
4. **Δημιουργία** — enabled only when reconciliation is clean; writes
   `outputs/BoardPack_{YYYY}_{MM}.{html,pdf,pptx}` with download buttons.

## Easiest: double-click launcher

- **macOS:** double-click **`run.command`**
- **Windows:** double-click **`run.bat`**

It installs deps on first run, starts the local server, and opens the deck in
your browser. Use the bottom toolbar to upload next month's Excel (🔄) or a
commentary text file (📝), and to download the PDF / PPTX.

**View on your phone:** with the launcher running, the terminal prints a
`http://<computer-ip>:8000` address — open **that** in your phone's **Safari or
Chrome** (same Wi-Fi) and the interactive deck (charts + tabs) works. A local
HTML file opened from the iOS **Files preview will not work** (iOS disables the
JavaScript the charts/tabs need) — for a no-setup phone view, use the **PDF**,
which renders everything in any viewer.

## Run (browser — monthly refresh)

```bash
python serve.py path/to/01-05_ΓΙΑ_CLAUDE.xlsx     # then open http://localhost:8000
```

The page shows the deck with a bottom toolbar:
- **🔄 Νέα δεδομένα (Excel)** — upload next month's workbook; it regenerates and
  refreshes in place (month auto-detected from the filename).
- **⬇ HTML / ⬇ PDF / ⬇ PPTX** — download the current outputs.

Fully local (stdlib server, no extra deps).

### Toolbar in the generated HTML (works with no Python)
Every generated HTML carries a bottom toolbar:
- **⬇ HTML / PDF / PPTX** — the PDF and PPTX are **embedded** in the HTML at
  build time (base64), so all three download directly from the file with no
  server and no Python. (This makes the HTML large, ~13 MB.)
- **📝 Σχόλιο (κείμενο)** — upload a plain-text file to replace the first-page
  commentary, entirely in the browser (offline).
- **🔄 Νέα δεδομένα (Excel)** — the monthly refresh; needs `serve.py` running
  (recomputing the deck requires the Python engine — a browser can't).

### Viewing on a phone
Open the HTML in a real browser (Safari / Chrome), **not** an attachment/preview
pane — previews often disable JavaScript, which the interactive charts and tab
navigation need. If JS is unavailable the deck falls back to showing every
section stacked (tables visible, charts blank). For a zero-dependency phone view,
the **PDF renders everything (charts included) in any viewer**.

## Run (headless)

```bash
python generate.py path/to/01-05_ΓΙΑ_CLAUDE.xlsx --mm 5
python generate.py path/to/01-05_ΓΙΑ_CLAUDE.xlsx --no-render   # HTML only
```

Exits with code `2` (and writes nothing) if the reconciliation gate fails.

---

## Input workbook

Sheets **`DATA 2026`** and **`DATA 2025`**. Column **A** = section flag
(`ΕΣΟΔΑ` / `EXPENSES`), column **C** = category name. Read with `data_only=True`.

| | 2026 (`DATA 2026`) | 2025 (`DATA 2025`) |
|---|---|---|
| Month | col **L** | col for month MM (Jan = col **H**) |
| YTD Ιαν–MM | col **M** | sum of Jan..MM columns (**H..**) |
| Budget (period) | col **N** | — (none) |

**Monthly budget = period budget (col N) ÷ MM.** (deck convention)

> The 2025 sheet stores one column per month starting at **H** (January), so YTD
> and the "current month" scale automatically with `MM` — no config change per
> month.

## Metrics rules (spec §5)

* **EBITDA basis — excluded both sides:** revenue `ΑΠΟΖ. ΦΑΡΜΑΚΩΝ Β ΦΑΣΗΣ` and
  expense `ΑΝΑΛΩΣΗ ΦΑΡΜΑΚΩΝ Β ΦΑΣΗΣ` (pass-through); expense
  `Αποσβέσεις και προβλέψεις` (before D&A); **2025 revenue only** the article
  `01870` blank-category line (`ΚΥΒΕΡΝΗΤ ΧΟΡ ΣΤΑ ΕΙΔΙΚΑ ΤΑΜΕΙΑ`, ≈€5.1M).
* **Groups:** Άλλα Έσοδα = `Άλλα έσοδα` + `Δημόσια Υγεία / Αρμόδιες Αρχές`;
  Κόστος Προσωπικού = `Αποσπασμένο Προσωπικό` + `Συμβόλαιο ΟΚΥπΥ` +
  `Ωρομίσθιο Προσωπικό`; Έσοδα ΟΑΥ = the rest of revenue; Λοιπά Λειτουργικά =
  the rest of expenses.
* **Variance tables** list categories with `|vΠΥ| ≥ 0.8 €M` (configurable), then
  a balancing **«Λοιπές κατηγορίες»** computed per column so all three columns
  foot exactly, then the `ΣΥΝΟΛΟ` total.
* **Reconciliation gate** (blocks export): the results subtotals foot, EBITDA =
  Σύνολο Εσόδων − Σύνολο Εξόδων, the variance tables foot per column, and 2025
  revenue after exclusions ties to the deck's 2025 total.

## Formatting (spec §6)

Millions, one decimal, Greek decimal comma (`€46,6`); euro sign `€` (U+20AC);
real minus `−` (U+2212). Variance colours: `.vp` green (favourable) / `.vn` pink
(adverse) — revenue `>0→vp`, expense `>0→vn`. All backgrounds are painted at the
`<td>` (the template's `tr:nth-child(even)` rule overrides `<tr>` backgrounds);
adverse variance rows are shaded `#FCE4EC`, subtotals `#eef2f6`, EBITDA `#FFF0F5`.

---

## Project layout

```
okypy-boardpack/
  app.py                    # Streamlit UI
  generate.py               # headless CLI
  config.py                 # column indices, names, exclusions, groups, threshold, month forms
  core/
    load.py                 # workbook -> merged category frames (2026 & 2025)
    metrics.py              # exclusions, groups, month/YTD/budget, variances, recon gate
    inject.py               # fill template with numbers + commentary; validate
    render.py               # Playwright: print PDF + per-tab PNGs
    ppt.py                  # python-pptx: NATIVE editable 16:9 deck (tables/charts)
  templates/
    presentation_template.html   # the approved deck (verbatim)
    assets/chart.umd.js          # vendored Chart.js (inlined at build for offline)
  tests/make_sample.py      # builds a synthetic workbook reproducing the deck
  outputs/                  # generated files land here
```

Everything that could be renamed in the source (category names, column indices,
exclusion lists, group mappings, threshold, display labels, month word-forms)
lives in **`config.py`**.

---

## Explicit assumptions / shortcuts

* **Materiality threshold** for a variance-table category = `|vΠΥ| ≥ 0.8 €M`
  (`config.VARIANCE_THRESHOLD_EUR`). The approved May deck also shows two
  sub-threshold expense rows (Ηλεκτρισμός, Συντηρήσεις) by editorial choice; this
  tool folds anything below the threshold into «Λοιπές κατηγορίες». Footing is
  guaranteed either way.
* **`MM`** is parsed from the filename and user-overridable.
* **Monthly budget** = cumulative period budget (col N) ÷ `MM`.
* **Display labels** in the variance tables are prettified from the raw column-C
  names via `config.VARIANCE_DISPLAY_LABELS` — tune these to your workbook so the
  rows read exactly like the approved deck.
* **Commentary mapping:** the inpatient narrative fills the first
  «Πλευρά Εσόδων» bullet; the four alert lines fill the hero
  "Top 4 Στρατηγικές Αποκλίσεις" cards (optional one-line body shown beneath the
  title). Text is injected verbatim — never auto-generated.
* **PPTX slides are images** (faithful, non-editable); HTML is the native/
  interactive artifact. PDF keeps selectable text.
* **Year** is assumed to match the template's fiscal year (2026). Running a
  different fiscal year needs a small config/template addition.

## First-run tuning

I built the load/metrics layer to the documented schema. Because the deck's
category labels are prettified versions of the raw column-C names, the very first
run against a **real** workbook may trip the reconciliation gate on a name
mismatch. When it does, the UI/CLI prints the exact `€`-gap and the failing
check — edit the offending name in `config.py` (never in code) and re-run. The
gate is the safety net: no outputs are written until every check is clean.

`tests/make_sample.py` generates a synthetic workbook that reproduces the
approved May-2026 figures end-to-end, so you can exercise the whole pipeline
without the real file.
```bash
python tests/make_sample.py
python generate.py tests/01-05_ΓΙΑ_CLAUDE.xlsx --mm 5
```
