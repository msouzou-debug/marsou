# OKYπY Board-Pack generator

A small **local, offline** app that turns the monthly revenue/expense workbook
into the approved Board EBITDA deck (month + YTD) in **HTML, PDF and PPTX**.

It does **not** rebuild the deck. It starts from the board-approved
`presentation_template.html` and *injects* freshly recomputed numbers, tables and
commentary into stable, text-anchored positions — so the approved look is
preserved and risk stays low. Nothing leaves the machine (public-sector data).

> **Recomputed tabs.** These are driven entirely by the uploaded workbook and
> update for any month:
> - **Σύνοψη Αποτελεσμάτων** (`sec-exec`) — four EBITDA tables, ΣΥΝΟΨΗ headline,
>   exec bar charts, inpatient narrative + up to four alert lines.
> - **Αναλυτικές Αποτελεσμάτων** (`sec-overview`) — consolidated EBITDA P&L
>   (every category line, subtotals, pharma pass-through & D&A) + the 5 KPI tiles.
> - **Μηνιαία Ανάλυση** (`sec-monthly`) — per-month KPI tiles, the EBITDA-trend
>   chart and the monthly detail table, from the workbook's monthly columns.
>
> The 2026 and 2025 monthly figures come straight from the DATA sheets' per-month
> columns, so the P&L, monthly and summary tabs are mutually consistent (this
> corrects a rounding/extract drift in the original approved deck, where the
> monthly-2025 series did not sum to the stated 2025 total).
>
> **Still pass-through** (render from the approved deck, not yet recomputed):
> ΟΑΥ Έσοδα, Άλλα Έσοδα, Μισθοδοσία, Λειτ. Έξοδα, Ανά Νοσηλευτήριο. These need
> per-hospital / component-level detail (the workbook's Νοσηλ. dimension and the
> ΜΙΣΘΟΔ / ΩΡΟΜΙΣΘΙΟ / ΥΠΕΡΩΡΙΕΣ / clinic sheets) and the per-unit Public-Health
> clearing logic — the next phase-2 increment.

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
    ppt.py                  # python-pptx: PNGs -> 16:9 deck
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
