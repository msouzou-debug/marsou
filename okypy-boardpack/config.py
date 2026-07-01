# -*- coding: utf-8 -*-
"""
Central configuration for the OKYπY Board-Pack generator.

Everything that could be renamed in the source workbook — category names,
column indices, exclusion lists, group mappings, the materiality threshold and
the display labels used in the deck — lives here, so a rename in the source
never requires a code change (spec §3).

IMPORTANT (first-run tuning): the category names below are taken verbatim from
the build spec. The reconciliation gate (core/metrics.py) will surface any
mismatch between these names and the raw values in your actual workbook's
column C. If a name differs, edit it here — not in the code.
"""

# ── Sheet names ──────────────────────────────────────────────────────────────
SHEET_2026 = "DATA 2026"
SHEET_2025 = "DATA 2025"

# ── Column indices (0-based tuple positions) ─────────────────────────────────
# NB: the spec's parenthetical numbers ("col L (index 12)") are 1-BASED Excel
# columns; here we store the 0-based positions used for row-tuple access
# (Excel A→0, C→2, H→7, L→11, M→12, N→13).
COL_SECTION = 0      # A
COL_CATEGORY = 2     # C

# DATA 2026 — dedicated summary columns (fixed, independent of MM)
COL_2026_MONTH = 11   # L  — month figure
COL_2026_YTD = 12     # M  — YTD Ιαν–MM
COL_2026_BUDGET = 13  # N  — Π/Υ περιόδου (cumulative budget to date)

# DATA 2025 — per-month columns; no budget. January sits in column H (0-based 7);
# month MM is COL_2025_JAN + MM - 1, and YTD = sum of Jan..MM columns.
COL_2025_JAN = 7  # H

# ── Section flags (column A) ─────────────────────────────────────────────────
FLAG_REVENUE = "ΕΣΟΔΑ"
FLAG_EXPENSE = "EXPENSES"

# ── EBITDA-basis exclusions (spec §5.1) ──────────────────────────────────────
# Excluded from BOTH years unless noted.
EXCLUDE_REVENUE = [
    "ΑΠΟΖ. ΦΑΡΜΑΚΩΝ Β ΦΑΣΗΣ",          # pharma pass-through (nets to zero)
]
EXCLUDE_EXPENSE = [
    "ΑΝΑΛΩΣΗ ΦΑΡΜΑΚΩΝ Β ΦΑΣΗΣ",        # pharma pass-through (nets to zero)
    "Αποσβέσεις και προβλέψεις",         # EBITDA is before D&A
]
# 2025 revenue ONLY — article 01870, category blank in DATA 2025 (≈€5.1M YTD).
# Dropping it makes 2025 revenue tie to the deck. We match on the raw category
# text; because the cell is blank, we also allow an article-code fallback (below).
EXCLUDE_REVENUE_2025_ONLY = [
    "ΚΥΒΕΡΝΗΤ ΧΟΡ ΣΤΑ ΕΙΔΙΚΑ ΤΑΜΕΙΑ",
]
# The special-fund line has a BLANK category (col C) in DATA 2025; its article
# code sits in column F (0-based 5). Drop blank-category revenue rows whose
# article is listed here.
ARTICLE_COL = 5  # F — «Άρθρο»
EXCLUDE_REVENUE_2025_ARTICLES = ["01870"]

# ── Group mapping — the 4 detail lines (spec §5.2) ───────────────────────────
# "Άλλα Έσοδα" = these revenue categories; everything else revenue → "Έσοδα ΟΑΥ".
GROUP_ALLA_ESODA = [
    "Άλλα έσοδα",
    "Δημόσια Υγεία / Αρμόδιες Αρχές",
]
# "Κόστος Προσωπικού" = these expense categories; everything else → "Λοιπά Λειτουργικά".
GROUP_KOSTOS_PROSOPIKOU = [
    "Αποσπασμένο Προσωπικό",
    "Συμβόλαιο ΟΚΥπΥ",
    "Ωρομίσθιο Προσωπικό",
]

# Row labels used inside the two results tables (ΜΗΝΑ / ΣΩΡΕΥΤΙΚΑ).
LABEL_ESODA_OAY = "Έσοδα ΟΑΥ"
LABEL_ALLA_ESODA = "Άλλα Έσοδα"
LABEL_SYNOLO_ESODON = "Σύνολο Εσόδων"
LABEL_KOSTOS_PROSOPIKOU = "Κόστος Προσωπικού"
LABEL_LOIPA_LEITOURGIKA = "Λοιπά Λειτουργικά"
LABEL_SYNOLO_EXODON = "Σύνολο Λειτ. Εξόδων"
LABEL_EBITDA = "EBITDA"

# ── Variance tables (spec §5.3 / §10) ────────────────────────────────────────
# Show a category row when |variance vs Π/Υ| ≥ THRESHOLD (euros). Default 0.8 €M.
VARIANCE_THRESHOLD_EUR = 0.8e6
LABEL_LOIPES = "Λοιπές κατηγορίες"
LABEL_SYNOLO_ESODON_CAPS = "ΣΥΝΟΛΟ ΕΣΟΔΩΝ"
LABEL_SYNOLO_EXODON_CAPS = "ΣΥΝΟΛΟ ΕΞΟΔΩΝ"

# Optional prettifier: raw column-C name  →  short label shown in the deck's
# variance tables. Defaults to identity for anything not listed. Tune on first
# run so the variance rows read exactly like the approved deck.
VARIANCE_DISPLAY_LABELS = {
    # keys = raw column-C names in the workbook; values = deck labels
    "Ενδονοσοκομεική Φρ. ΟΑΥ": "Ενδονοσ. Φροντίδα ΟΑΥ",
    "Εξωνοσοκομειακή Φρ. ΟΑΥ": "Εξωνοσ. Φροντίδα ΟΑΥ",
    "Δημόσια Υγεία / Αρμόδιες Αρχές": "Δημόσια Υγεία / Αρχές",
    "Άλλα έσοδα": "Άλλα Έσοδα",
    "Εγγραφές Προσωπικών Ιατρών ΟΑΥ": "Εγγραφές ΟΑΥ",
    "Αποσπασμένο Προσωπικό": "Αποσπασμένο Προσωπικό",
    "Ωρομίσθιο Προσωπικό": "Ωρομίσθιο Προσωπικό",
    "Συμβόλαιο ΟΚΥπΥ": "Σύμβαση ΟΚΥπΥ",
    "Άλλες Λειτουργικές δαπάνες": "Άλλες Λειτουργικές",
}

# ── Reconciliation tolerance ─────────────────────────────────────────────────
# Figures round to 0.1 €M in the deck; allow a small footing tolerance (euros).
RECON_TOLERANCE_EUR = 5.0e4  # 0.05 €M — below display resolution
# 2025 revenue must tie to the deck's 2025 total after §5.1 exclusions.
DECK_2025_REVENUE_YTD = 218_340_121  # from approved deck (D.totRev25); tune if deck changes

# ── Greek month forms (no tonos on ALL-CAPS, per skill) ──────────────────────
MONTHS = {
    1:  dict(nom="Ιανουάριος",  gen="Ιανουαρίου",  short="Ιαν",  caps_short="ΙΑΝ",  caps_gen="ΙΑΝΟΥΑΡΙΟΥ"),
    2:  dict(nom="Φεβρουάριος", gen="Φεβρουαρίου", short="Φεβ",  caps_short="ΦΕΒ",  caps_gen="ΦΕΒΡΟΥΑΡΙΟΥ"),
    3:  dict(nom="Μάρτιος",     gen="Μαρτίου",     short="Μαρ",  caps_short="ΜΑΡ",  caps_gen="ΜΑΡΤΙΟΥ"),
    4:  dict(nom="Απρίλιος",    gen="Απριλίου",    short="Απρ",  caps_short="ΑΠΡ",  caps_gen="ΑΠΡΙΛΙΟΥ"),
    5:  dict(nom="Μάιος",       gen="Μαΐου",       short="Μαΐ",  caps_short="ΜΑΪ",  caps_gen="ΜΑΪΟΥ"),
    6:  dict(nom="Ιούνιος",     gen="Ιουνίου",     short="Ιουν", caps_short="ΙΟΥΝ", caps_gen="ΙΟΥΝΙΟΥ"),
    7:  dict(nom="Ιούλιος",     gen="Ιουλίου",     short="Ιουλ", caps_short="ΙΟΥΛ", caps_gen="ΙΟΥΛΙΟΥ"),
    8:  dict(nom="Αύγουστος",   gen="Αυγούστου",   short="Αυγ",  caps_short="ΑΥΓ",  caps_gen="ΑΥΓΟΥΣΤΟΥ"),
    9:  dict(nom="Σεπτέμβριος", gen="Σεπτεμβρίου", short="Σεπ",  caps_short="ΣΕΠ",  caps_gen="ΣΕΠΤΕΜΒΡΙΟΥ"),
    10: dict(nom="Οκτώβριος",   gen="Οκτωβρίου",   short="Οκτ",  caps_short="ΟΚΤ",  caps_gen="ΟΚΤΩΒΡΙΟΥ"),
    11: dict(nom="Νοέμβριος",   gen="Νοεμβρίου",   short="Νοε",  caps_short="ΝΟΕ",  caps_gen="ΝΟΕΜΒΡΙΟΥ"),
    12: dict(nom="Δεκέμβριος",  gen="Δεκεμβρίου",  short="Δεκ",  caps_short="ΔΕΚ",  caps_gen="ΔΕΚΕΜΒΡΙΟΥ"),
}

# The template ships as the approved May-2026 (MM=5) deck. Injection replaces the
# template month with the target month, so the base month is fixed here.
TEMPLATE_MONTH = 5
TEMPLATE_YEAR = 2026

# ── Output naming ────────────────────────────────────────────────────────────
OUTPUT_PATTERN = "BoardPack_{year}_{mm:02d}"
TEMPLATE_FILE = "templates/presentation_template.html"
OUTPUT_DIR = "outputs"

# Vendored Chart.js (inlined into every output so the deck renders fully offline;
# the shipped template still references the CDN and stays verbatim on disk).
CHARTJS_VENDOR = "templates/assets/chart.umd.js"
CHARTJS_CDN_TAG = ('<script src="https://cdnjs.cloudflare.com/ajax/libs/'
                   'Chart.js/4.4.1/chart.umd.js"></script>')

# Tabs (section ids) rendered into the PPTX, in order.
DECK_TABS = [
    "exec", "overview", "monthly", "oay",
    "allaesoda", "payroll", "loipaexp", "hospitals",
]
