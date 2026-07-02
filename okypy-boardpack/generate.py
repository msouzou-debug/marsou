# -*- coding: utf-8 -*-
"""
Headless generator (no Streamlit) — handy for automation / testing.

    python generate.py path/to/01-05_ΓΙΑ_CLAUDE.xlsx --mm 5 [--no-render]

Writes BoardPack_{YEAR}_{MM}.{html,pdf,pptx} to outputs/. Blocks on a failed
reconciliation gate (exit code 2), exactly like the UI.
"""
from __future__ import annotations

import argparse
import os
import sys

import config
from core import load as loadmod
from core import metrics as metricsmod
from core import inject as injectmod

BASE = os.path.dirname(os.path.abspath(__file__))


def main() -> int:
    ap = argparse.ArgumentParser(description="OKYπY Board-Pack generator (headless)")
    ap.add_argument("workbook", help="path to 01-MM_ΓΙΑ_CLAUDE.xlsx")
    ap.add_argument("--mm", type=int, default=None, help="month 1–12 (default: from filename)")
    ap.add_argument("--year", type=int, default=config.TEMPLATE_YEAR)
    ap.add_argument("--no-render", action="store_true", help="HTML only (skip PDF/PPTX)")
    args = ap.parse_args()

    mm = args.mm or loadmod.detect_month_from_filename(args.workbook) or config.TEMPLATE_MONTH
    print(f"Μήνας MM={mm:02d} ({config.MONTHS[mm]['nom']})")

    res = loadmod.load_workbook(args.workbook, mm)
    for w in res.warnings:
        print("⚠ ", w)
    m = metricsmod.compute(res, mm, args.year)

    if not m.recon_ok:
        print("❌ Αποτυχία συμφωνίας — δεν παράγονται αρχεία:")
        for b in m.breaches:
            print(f"   • {b['name']}: {b['gap']:,.0f} €")
        return 2
    print("✅ Συμφωνία καθαρή.")

    with open(os.path.join(BASE, config.TEMPLATE_FILE), encoding="utf-8") as fh:
        tmpl = fh.read()
    html, rep = injectmod.inject(
        tmpl, m, mm, args.year,
        injectmod.get_inpatient_default(tmpl), injectmod.get_alert_defaults(tmpl),
    )
    for w in rep.warnings:
        print("⚠ ", w)

    out_dir = os.path.join(BASE, config.OUTPUT_DIR)
    os.makedirs(out_dir, exist_ok=True)
    stem = config.OUTPUT_PATTERN.format(year=args.year, mm=mm)
    # remove any prior outputs for this stem so a failed run can't leave stale files
    for suffix in (".html", ".pdf", ".pptx", "_mobile.html"):
        old = os.path.join(out_dir, stem + suffix)
        if os.path.exists(old):
            os.remove(old)
    html_path = os.path.join(out_dir, stem + ".html")
    with open(html_path, "w", encoding="utf-8") as fh:
        fh.write(html)
    print("HTML →", html_path)

    if args.no_render:
        return 0

    from core import render as rendermod
    from core import ppt as pptmod
    # render each tab once; PDF, PPTX and mobile HTML are all built from these
    # same verified images (charts present, identical look)
    pngs = rendermod.render_pngs(html, os.path.join(out_dir, "_png_" + stem))
    pdf_path = os.path.join(out_dir, stem + ".pdf")
    pptmod.build_pdf(pngs, pdf_path)                 # one clean page per tab
    print("PDF  →", pdf_path)
    pptx_path = os.path.join(out_dir, stem + ".pptx")
    pptmod.build_pptx(pngs, pptx_path)               # faithful (matches the HTML)
    print("PPTX →", pptx_path)

    # static, no-JS mobile HTML (renders in iOS Files/Quick Look & any viewer)
    mobile_path = os.path.join(out_dir, stem + "_mobile.html")
    subtitle = f"{config.MONTHS[mm]['nom']} {args.year}"
    injectmod.build_mobile_html(pngs, mobile_path,
                                title="OKYπY — Πίνακας Διοικητικού Συμβουλίου",
                                subtitle=subtitle)
    print("Mobile →", mobile_path)

    # embed PDF/PPTX/mobile as data URIs so every toolbar button works standalone
    # (no server, no Python) — pressing ⬇ PPTX / 📱 Κινητό downloads the real file
    html = injectmod.embed_downloads(html, pdf_path=pdf_path, pptx_path=pptx_path,
                                     mobile_path=mobile_path, stem=stem)
    with open(html_path, "w", encoding="utf-8") as fh:
        fh.write(html)
    return 0


if __name__ == "__main__":
    sys.exit(main())
