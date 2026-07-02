# OKYπY Board-Pack generator

A small **local, offline** app that turns the monthly revenue/expense workbook
into the approved Board EBITDA deck (month + YTD) in **HTML, PDF, PPTX and a
static mobile HTML** (built for phone viewing — renders even in the iOS Files
preview).

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

One-time setup on a new machine: install **Python 3** from
https://www.python.org/downloads/ (on Windows tick **"Add python.exe to
PATH"**). Then:

- **Windows:** double-click **`run.bat`**
- **macOS:** double-click **`run.command`**

The first run installs the libraries (needs internet once); after that it is
fully offline. It starts the local server and opens the browser automatically —
on a fresh machine you get an upload page: pick the monthly Excel and the deck
is generated on the spot. From then on use the bottom toolbar to upload next
month's Excel (🔄) or a Word/text commentary (📝), and to download the
PDF / PPTX / 📱 mobile HTML.

> The 🔄 Excel refresh only works on the `http://localhost:8000` page served by
> the launcher — a saved `.html` file opened directly cannot recompute the deck
> (that needs the Python engine). All the *download* buttons and 📝 commentary
> work everywhere, launcher or saved file.

### No admin rights? Use the portable bundle
The `build-windows-portable` GitHub Action publishes
`OKYpY-BoardPack-Windows-portable.zip` (release `portable-win-v1`): the tool
plus an embedded Python 3.12 and all libraries. Unzip → `run.bat`. Nothing is
installed; no admin rights are used.

### Windows 11 «Smart App Control» blocks run.bat
SAC blocks internet-downloaded script files (.bat) with no override. In order
of preference:
1. **Before extracting** the downloaded ZIP: right-click it → Properties →
   tick **Unblock** → OK → then extract. This removes the mark-of-the-web, so
   `run.bat` runs normally. (If the dialog instead is SmartScreen — blue
   «Windows protected your PC» — just click *More info → Run anyway*.)
2. If there is no Unblock option: use **`Launch.py`** instead of run.bat —
   right-click `Launch.py` → *Open with* → *Choose another app* → *Look for
   another app on this PC* → select `python\python.exe` **inside the tool's
   folder** → tick *Always*. Double-click `Launch.py` from then on. SAC allows
   it because python.exe is signed (Python Software Foundation) and .py is not
   an enforced script type.
3. Last resort: copy the ZIP onto a FAT32 USB stick and back (FAT32 cannot
   store the mark-of-the-web), then extract.

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
- **⬇ PDF / ⬇ PPTX / 📱 Κινητό (HTML)** — download the current outputs.

Fully local (stdlib server, no extra deps).

### Toolbar in the generated HTML (works with no Python)
Every generated HTML carries a bottom toolbar:
- **⬇ PDF / ⬇ PPTX / 📱 Κινητό (HTML)** — the PDF, the faithful PPTX **and** the
  static mobile HTML are **embedded** in the deck at build time (base64), so each
  button downloads the real file directly with no server and no Python. Pressing
  **⬇ PPTX** always saves the faithful, HTML-matching deck (real charts, correct
  order). (Embedding makes the desktop HTML large, ~13 MB — that copy is meant for
  the laptop/browser; the **📱 mobile HTML** it produces is the lightweight phone
  copy, ~1 MB.)
- **📝 Σχόλιο (Word/κείμενο)** — upload a **Word (.docx)** or plain-text file to
  replace the first-page «Κύριοι Μοχλοί Ελλείμματος» commentary, entirely in the
  browser (offline; the .docx is unzipped client-side). Structure the document
  with the headings **«Πλευρά Εσόδων»** and **«Πλευρά Εξόδων»**; each paragraph
  under a heading becomes one bullet in that column (the lead sentence up to the
  first full stop is bolded). A file without those headings replaces only the
  first «Πλευρά Εσόδων» narrative bullet.
- **🔄 Νέα δεδομένα (Excel)** — the monthly refresh; needs `serve.py` running
  (recomputing the deck requires the Python engine — a browser can't).

When `serve.py` is running, the same buttons also work by streaming the files
from the server (`/download/{pdf,pptx,mobile}`), so they function whether the
page is opened over `http://…` or from a saved `.html` file.

### Viewing on a phone
Three options, best to simplest:
1. **Interactive** — with the launcher/`serve.py` running, open the printed
   `http://<computer-ip>:8000` in the phone's **Safari/Chrome** (same Wi-Fi):
   full charts + tabs.
2. **📱 Κινητό (HTML)** — press the mobile button to get a **static, JavaScript-
   free** HTML (one full-width image per tab, tap-nav header). Save it to the
   phone and it renders in **any** viewer — including the **iOS Files / Quick Look
   preview**, where the interactive deck's charts/tabs would be blank (previews
   disable JavaScript). Fully offline and self-contained.
3. **PDF** — also renders everything (charts included) in any viewer.

The full interactive HTML needs a real browser with JavaScript; opened in a
preview pane it falls back to every section stacked (tables visible, charts
blank) — use the mobile HTML or PDF there instead.

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
    render.py               # Playwright: per-tab PNGs (waits for charts to paint)
    ppt.py                  # image-based 16:9 PPTX + one-page-per-tab PDF (Pillow)
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
* **PDF, PPTX and mobile HTML are all built from the same captured tab images**
  (faithful, non-editable) — one clean page/slide per tab, so charts are always
  present and nothing is split across a page break. The interactive HTML is the
  native/live artifact. Chart capture waits for webfonts + Chart.js and for every
  canvas to actually paint before the screenshot, so charts never come out blank.
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
