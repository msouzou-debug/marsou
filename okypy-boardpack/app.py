# -*- coding: utf-8 -*-
"""
OKYπY Board-Pack generator — Streamlit UI.

Run:  streamlit run app.py

Upload the monthly workbook, type the board commentary, preview the four EBITDA
tables behind a reconciliation gate, then generate HTML + PDF + PPTX. Fully
offline — nothing leaves the machine.
"""
from __future__ import annotations

import os
import tempfile

import pandas as pd
import streamlit as st

import config
from core import load as loadmod
from core import metrics as metricsmod
from core import inject as injectmod

BASE = os.path.dirname(os.path.abspath(__file__))
TEMPLATE_PATH = os.path.join(BASE, config.TEMPLATE_FILE)
OUTPUT_DIR = os.path.join(BASE, config.OUTPUT_DIR)

st.set_page_config(page_title="OKYπY Board-Pack", layout="wide", page_icon="📊")


@st.cache_data
def _template() -> str:
    with open(TEMPLATE_PATH, encoding="utf-8") as fh:
        return fh.read()


def _rows_to_df(rows) -> pd.DataFrame:
    return pd.DataFrame([{
        "Δείκτης": r.label,
        "2026": injectmod.fmt_m(r.v2026),
        "2025": injectmod.fmt_m(r.v2025),
        "Π/Υ": injectmod.fmt_m(r.budget),
        "Απόκλ. vs Π/Υ": injectmod.fmt_var(r.vpy),
        "Απόκλ. v 2025": injectmod.fmt_var(r.v25),
    } for r in rows])


def _variance_to_df(vt) -> pd.DataFrame:
    rows = list(vt.rows) + [vt.loipes, vt.total]
    return _rows_to_df(rows)


# ── header ───────────────────────────────────────────────────────────────────
st.title("📊 OKYπY · Παραγωγή Board-Pack (EBITDA)")
st.caption("Τοπική εφαρμογή — δημόσια οικονομικά δεδομένα, τίποτα δεν φεύγει από τη συσκευή. "
           "Φάση 1: μόνο η καρτέλα «Σύνοψη Αποτελεσμάτων» (sec-exec).")

# ── 1) upload + month ────────────────────────────────────────────────────────
st.header("1 · Αρχείο δεδομένων")
up = st.file_uploader("Ανεβάστε το μηνιαίο workbook (01-MM_ΓΙΑ_CLAUDE.xlsx)", type=["xlsx"])

detected_mm = loadmod.detect_month_from_filename(up.name) if up else None
default_mm = detected_mm or config.TEMPLATE_MONTH
mm = st.selectbox(
    "Μήνας (MM) — καθορίζει YTD, διαιρέτη Π/Υ και όλες τις περιόδους",
    options=list(range(1, 13)),
    index=default_mm - 1,
    format_func=lambda i: f"{i:02d} · {config.MONTHS[i]['nom']}",
)
if detected_mm:
    st.caption(f"Εντοπίστηκε ο μήνας **{detected_mm:02d}** από το όνομα αρχείου.")
year = config.TEMPLATE_YEAR

# ── 2) commentary ────────────────────────────────────────────────────────────
st.header("2 · Σχολιασμός Διοικητικού Συμβουλίου")
tmpl = _template()
default_narr = injectmod.get_inpatient_default(tmpl)
default_alerts = injectmod.get_alert_defaults(tmpl)

inpatient = st.text_area(
    "Ενδονοσοκομειακή αφήγηση (θα ενσωματωθεί αυτούσια — το «<» κωδικοποιείται ως &lt;)",
    value=default_narr, height=180,
)

st.subheader("Top 4 Στρατηγικές Αποκλίσεις (κενές γραμμές παραλείπονται)")
alerts = []
for i in range(4):
    d = default_alerts[i] if i < len(default_alerts) else {"severity": "🔴", "title": "", "body": ""}
    c1, c2, c3 = st.columns([1, 4, 5])
    sev = c1.selectbox(f"#{i+1}", ["🔴", "🟡"],
                       index=0 if d.get("severity", "🔴") == "🔴" else 1, key=f"sev{i}")
    title = c2.text_input("Τίτλος", value=d.get("title", ""), key=f"title{i}",
                          label_visibility="collapsed", placeholder="Τίτλος απόκλισης")
    body = c3.text_input("Σχόλιο", value=d.get("body", ""), key=f"body{i}",
                         label_visibility="collapsed", placeholder="Προαιρετικό σχόλιο μίας γραμμής")
    alerts.append({"severity": sev, "title": title, "body": body})

# ── 3) preview + reconciliation gate ─────────────────────────────────────────
st.header("3 · Προεπισκόπηση & Έλεγχος Συμφωνίας")

if "metrics" not in st.session_state:
    st.session_state.metrics = None

if st.button("🔍 Προεπισκόπηση", type="primary", disabled=up is None):
    with tempfile.NamedTemporaryFile(suffix=".xlsx", delete=False) as fh:
        fh.write(up.getbuffer())
        xlsx_path = fh.name
    try:
        res = loadmod.load_workbook(xlsx_path, mm)
    finally:
        os.unlink(xlsx_path)
    for w in res.warnings:
        st.warning(w)
    st.session_state.metrics = metricsmod.compute(res, mm, year)

m = st.session_state.metrics
if m is not None:
    if m.recon_ok:
        st.success("✅ Όλα δένουν — η συμφωνία είναι καθαρή. Μπορείτε να παράγετε το board-pack.")
    else:
        st.error("❌ Αποτυχία συμφωνίας — δεν επιτρέπεται παραγωγή μέχρι να διορθωθεί:")
        st.table(pd.DataFrame([
            {"Έλεγχος": b["name"], "Διαφορά (€)": f"{b['gap']:,.0f}"} for b in m.breaches
        ]))

    c1, c2 = st.columns(2)
    with c1:
        st.markdown(f"**ΑΠΟΤΕΛΕΣΜΑΤΑ {config.MONTHS[mm]['caps_gen']} {year}**")
        st.table(_rows_to_df(m.results_month))
    with c2:
        st.markdown(f"**ΣΩΡΕΥΤΙΚΑ ΙΑΝ–{config.MONTHS[mm]['caps_short']} {year}**")
        st.table(_rows_to_df(m.results_ytd))
    c3, c4 = st.columns(2)
    with c3:
        st.markdown("**ΑΠΟΚΛΙΣΕΙΣ ΕΣΟΔΩΝ vs Π/Υ**")
        st.table(_variance_to_df(m.var_rev))
    with c4:
        st.markdown("**ΑΠΟΚΛΙΣΕΙΣ ΕΞΟΔΩΝ vs Π/Υ**")
        st.table(_variance_to_df(m.var_exp))

# ── 4) generate ──────────────────────────────────────────────────────────────
st.header("4 · Παραγωγή Board-Pack")
can_generate = m is not None and m.recon_ok
if not can_generate:
    st.info("Η παραγωγή ενεργοποιείται μόνο όταν η προεπισκόπηση περάσει καθαρά τον έλεγχο συμφωνίας.")

if st.button("⚙️ Δημιουργία HTML / PDF / PPTX", disabled=not can_generate):
    os.makedirs(OUTPUT_DIR, exist_ok=True)
    stem = config.OUTPUT_PATTERN.format(year=year, mm=mm)
    with st.spinner("Ενσωμάτωση αριθμών & σχολίων…"):
        html, rep = injectmod.inject(tmpl, m, mm, year, inpatient, alerts)
        for w in rep.warnings:
            st.warning(w)
        html_path = os.path.join(OUTPUT_DIR, stem + ".html")
        with open(html_path, "w", encoding="utf-8") as fh:
            fh.write(html)
    st.success(f"HTML: {html_path}")
    with open(html_path, "rb") as fh:
        st.download_button("⬇️ HTML", fh, file_name=stem + ".html", mime="text/html")

    # PDF + PPTX (need Playwright Chromium)
    try:
        from core import render as rendermod
        from core import ppt as pptmod
        with st.spinner("Παραγωγή PDF (Playwright)…"):
            pdf_path = os.path.join(OUTPUT_DIR, stem + ".pdf")
            rendermod.render_pdf(html, pdf_path)
        with open(pdf_path, "rb") as fh:
            st.download_button("⬇️ PDF", fh, file_name=stem + ".pdf", mime="application/pdf")

        with st.spinner("Παραγωγή PPTX…"):
            png_dir = os.path.join(OUTPUT_DIR, "_png_" + stem)
            pngs = rendermod.render_pngs(html, png_dir)
            pptx_path = os.path.join(OUTPUT_DIR, stem + ".pptx")
            pptmod.build_pptx(pngs, pptx_path)
        with open(pptx_path, "rb") as fh:
            st.download_button("⬇️ PPTX", fh, file_name=stem + ".pptx",
                               mime="application/vnd.openxmlformats-officedocument.presentationml.presentation")
    except Exception as e:  # noqa: BLE001
        st.warning(f"PDF/PPTX δεν παρήχθησαν ({e}). Το HTML είναι έτοιμο. "
                   "Ελέγξτε ότι έχει εγκατασταθεί ο Chromium: `python -m playwright install chromium`.")
