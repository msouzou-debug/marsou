# -*- coding: utf-8 -*-
"""
serve.py — one-command local server for the monthly board pack.

    python serve.py [path/to/01-MM_ΓΙΑ_CLAUDE.xlsx] [--mm N] [--port 8000]

Open http://localhost:8000 in a browser. The page shows the current deck with a
toolbar to (a) upload next month's Excel → regenerate & refresh, and (b) download
the HTML / PDF / PPTX. Fully local — nothing leaves the machine.
"""
from __future__ import annotations

import argparse
import cgi
import io
import json
import os
import tempfile
import traceback
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import config
from core import load as loadmod
from core import metrics as metricsmod
from core import inject as injectmod

BASE = os.path.dirname(os.path.abspath(__file__))
OUTPUT_DIR = os.path.join(BASE, config.OUTPUT_DIR)
TEMPLATE_PATH = os.path.join(BASE, config.TEMPLATE_FILE)

STATE = {"stem": None, "mm": config.TEMPLATE_MONTH, "year": config.TEMPLATE_YEAR}


def regenerate(xlsx_path: str, mm: int, year: int) -> tuple[bool, str]:
    """Run the full pipeline; returns (ok, message)."""
    res = loadmod.load_workbook(xlsx_path, mm)
    m = metricsmod.compute(res, mm, year)
    if not m.recon_ok:
        gaps = "; ".join(f"{b['name']} ({b['gap']:,.0f}€)" for b in m.breaches[:4])
        return False, "Αποτυχία συμφωνίας: " + gaps
    with open(TEMPLATE_PATH, encoding="utf-8") as fh:
        tmpl = fh.read()
    html, _ = injectmod.inject(tmpl, m, mm, year,
                              injectmod.get_inpatient_default(tmpl),
                              injectmod.get_alert_defaults(tmpl))
    os.makedirs(OUTPUT_DIR, exist_ok=True)
    stem = config.OUTPUT_PATTERN.format(year=year, mm=mm)
    with open(os.path.join(OUTPUT_DIR, stem + ".html"), "w", encoding="utf-8") as fh:
        fh.write(html)
    # PDF + PPTX (best-effort; HTML always succeeds)
    try:
        from core import render as rendermod
        from core import ppt as pptmod
        rendermod.render_pdf(html, os.path.join(OUTPUT_DIR, stem + ".pdf"))
        pngs = rendermod.render_pngs(html, os.path.join(OUTPUT_DIR, "_png_" + stem))
        pptmod.build_pptx(pngs, os.path.join(OUTPUT_DIR, stem + ".pptx"))
    except Exception as e:  # noqa: BLE001
        print("⚠ PDF/PPTX skipped:", e)
    STATE.update(stem=stem, mm=mm, year=year)
    return True, stem


def _path(ext: str) -> str:
    return os.path.join(OUTPUT_DIR, (STATE["stem"] or "") + "." + ext)


class Handler(BaseHTTPRequestHandler):
    def _send(self, code, body, ctype="text/html; charset=utf-8", extra=None):
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        for k, v in (extra or {}).items():
            self.send_header(k, v)
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        path = self.path.split("?", 1)[0]
        if path in ("/", "/index.html"):
            f = _path("html")
            if not os.path.exists(f):
                msg = "<h2>Ανεβάστε ένα Excel: <code>python serve.py 01-MM_ΓΙΑ_CLAUDE.xlsx</code></h2>"
                return self._send(200, msg.encode("utf-8"))
            with open(f, "rb") as fh:
                return self._send(200, fh.read())
        if path.startswith("/download/"):
            ext = path.rsplit("/", 1)[-1]
            mimes = {"html": "text/html", "pdf": "application/pdf",
                     "pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation"}
            if ext in mimes and os.path.exists(_path(ext)):
                with open(_path(ext), "rb") as fh:
                    data = fh.read()
                name = STATE["stem"] + "." + ext
                return self._send(200, data, mimes[ext],
                                  {"Content-Disposition": f'attachment; filename="{name}"'})
            return self._send(404, b"not found")
        return self._send(404, b"not found")

    def do_POST(self):
        if self.path.split("?", 1)[0] != "/upload":
            return self._send(404, b"not found")
        try:
            form = cgi.FieldStorage(fp=self.rfile, headers=self.headers,
                                    environ={"REQUEST_METHOD": "POST",
                                             "CONTENT_TYPE": self.headers["Content-Type"]})
            item = form["file"]
            fname = item.filename or "upload.xlsx"
            mm = loadmod.detect_month_from_filename(fname) or STATE["mm"]
            with tempfile.NamedTemporaryFile(suffix=".xlsx", delete=False) as tmp:
                tmp.write(item.file.read())
                xlsx = tmp.name
            try:
                ok, msg = regenerate(xlsx, mm, STATE["year"])
            finally:
                os.unlink(xlsx)
            body = json.dumps({"ok": ok, "error": None if ok else msg}).encode()
            return self._send(200, body, "application/json")
        except Exception as e:  # noqa: BLE001
            traceback.print_exc()
            return self._send(200, json.dumps({"ok": False, "error": str(e)}).encode(),
                              "application/json")

    def log_message(self, *a):
        pass  # quiet


def main():
    ap = argparse.ArgumentParser(description="OKYπY Board-Pack local server")
    ap.add_argument("workbook", nargs="?", help="initial 01-MM_ΓΙΑ_CLAUDE.xlsx")
    ap.add_argument("--mm", type=int, default=None)
    ap.add_argument("--year", type=int, default=config.TEMPLATE_YEAR)
    ap.add_argument("--port", type=int, default=8000)
    args = ap.parse_args()

    if args.workbook:
        mm = args.mm or loadmod.detect_month_from_filename(args.workbook) or config.TEMPLATE_MONTH
        print(f"Παραγωγή για μήνα {mm:02d}…")
        ok, msg = regenerate(args.workbook, mm, args.year)
        print(("✅ " if ok else "❌ ") + msg)
    else:
        # fall back to any existing output
        existing = sorted(f for f in os.listdir(OUTPUT_DIR) if f.endswith(".html")) if os.path.isdir(OUTPUT_DIR) else []
        if existing:
            STATE["stem"] = existing[-1][:-5]

    srv = ThreadingHTTPServer(("127.0.0.1", args.port), Handler)
    print(f"▶ http://localhost:{args.port}  (Ctrl+C για τερματισμό)")
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        print("\nτέλος.")


if __name__ == "__main__":
    main()
