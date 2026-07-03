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
import json
import os
import sys
import tempfile
import traceback
from email import policy
from email.parser import BytesParser
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

# Windows consoles default to cp1252, which cannot print the Greek status
# messages — force UTF-8 (harmless elsewhere).
if sys.stdout and hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

import config
from core import load as loadmod
from core import metrics as metricsmod
from core import inject as injectmod

BASE = os.path.dirname(os.path.abspath(__file__))
OUTPUT_DIR = os.path.join(BASE, config.OUTPUT_DIR)
TEMPLATE_PATH = os.path.join(BASE, config.TEMPLATE_FILE)

STATE = {"stem": None, "mm": config.TEMPLATE_MONTH, "year": config.TEMPLATE_YEAR}

# First-run screen (no deck generated yet): a proper upload page, so the very
# first Excel can be loaded from the browser — no command line needed.
EMPTY_PAGE = """<!doctype html><html lang="el"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>OKYπY Board-Pack</title><style>
body{font-family:"Segoe UI",Arial,sans-serif;background:#F7F8FA;color:#0b2545;
  display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0}
.card{background:#fff;border-radius:14px;box-shadow:0 4px 24px rgba(0,0,0,.10);
  padding:40px 44px;max-width:520px;text-align:center}
h1{font-size:20px;color:#062E5C;margin:0 0 8px}
p{font-size:14px;color:#51617a;line-height:1.6;margin:0 0 22px}
label{display:inline-block;background:#00AEEF;color:#fff;font-weight:600;font-size:15px;
  padding:12px 26px;border-radius:999px;cursor:pointer}
label:hover{background:#0095cc}
#st{margin-top:16px;font-size:13px;color:#51617a;min-height:18px}
</style></head><body><div class="card">
<h1>OKYπY — Μηνιαίος Πίνακας Διοικητικού Συμβουλίου</h1>
<p>Ανεβάστε το μηνιαίο Excel (π.χ. <b>01-05 ΓΙΑ CLAUDE.xlsx</b>) για να παραχθεί
το deck. Ο μήνας εντοπίζεται αυτόματα από το όνομα του αρχείου.</p>
<label>📊 Επιλογή Excel<input id="f" type="file" accept=".xlsx" style="display:none"></label>
<div id="st"></div>
<script>
document.getElementById('f').onchange=function(){
  var f=this.files&&this.files[0]; if(!f) return;
  var st=document.getElementById('st'); st.textContent='Παραγωγή… (μπορεί να πάρει 1–2 λεπτά)';
  var fd=new FormData(); fd.append('file', f);
  fetch('upload',{method:'POST',body:fd}).then(function(r){return r.json();}).then(function(j){
    if(j&&j.ok){ location.reload(); } else { st.textContent='Σφάλμα: '+((j&&j.error)||'άγνωστο'); }
  }).catch(function(e){ st.textContent='Σφάλμα: '+e; });
};
</script></div></body></html>"""


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
    html_path = os.path.join(OUTPUT_DIR, stem + ".html")
    with open(html_path, "w", encoding="utf-8") as fh:
        fh.write(html)
    # PDF + PPTX + mobile HTML (best-effort; HTML always succeeds)
    pdf_path = os.path.join(OUTPUT_DIR, stem + ".pdf")
    pptx_path = os.path.join(OUTPUT_DIR, stem + ".pptx")
    mobile_path = os.path.join(OUTPUT_DIR, stem + "_mobile.html")
    for p in (pdf_path, pptx_path, mobile_path):
        if os.path.exists(p):
            os.remove(p)
    try:
        from core import render as rendermod
        from core import ppt as pptmod
        pngs = rendermod.render_pngs(html, os.path.join(OUTPUT_DIR, "_png_" + stem))
        pptmod.build_pdf(pngs, pdf_path)              # one clean page per tab
        pptmod.build_pptx(pngs, pptx_path)            # faithful (matches the HTML)
        injectmod.build_mobile_html(pngs, mobile_path,
                                    title="OKYπY — Πίνακας Διοικητικού Συμβουλίου",
                                    subtitle=f"{config.MONTHS[mm]['nom']} {year}")
    except Exception as e:  # noqa: BLE001
        print("⚠ PDF/PPTX/mobile skipped:", e)
    with open(html_path, "w", encoding="utf-8") as fh:
        fh.write(injectmod.embed_downloads(
            html, pdf_path=pdf_path, pptx_path=pptx_path,
            mobile_path=mobile_path, stem=stem))
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
                return self._send(200, EMPTY_PAGE.encode("utf-8"))
            with open(f, "rb") as fh:
                return self._send(200, fh.read())
        if path.startswith("/download/"):
            route = path.rsplit("/", 1)[-1]
            PPTX = "application/vnd.openxmlformats-officedocument.presentationml.presentation"
            # route -> (on-disk filename == download filename, mime)
            files = {
                "html":   (STATE["stem"] + ".html",        "text/html"),
                "pdf":    (STATE["stem"] + ".pdf",         "application/pdf"),
                "pptx":   (STATE["stem"] + ".pptx",        PPTX),
                "mobile": (STATE["stem"] + "_mobile.html", "text/html"),
            }
            if route in files:
                name, mime = files[route]
                fp = os.path.join(OUTPUT_DIR, name)
                if os.path.exists(fp):
                    with open(fp, "rb") as fh:
                        data = fh.read()
                    return self._send(200, data, mime,
                                      {"Content-Disposition": f'attachment; filename="{name}"'})
            return self._send(404, b"not found")
        return self._send(404, b"not found")

    def _read_upload(self):
        """Parse the multipart/form-data body and return (filename, bytes) of
        the «file» field. Uses the email parser — the cgi module was removed in
        Python 3.13."""
        length = int(self.headers.get("Content-Length") or 0)
        body = self.rfile.read(length)
        ctype = self.headers.get("Content-Type") or ""
        msg = BytesParser(policy=policy.default).parsebytes(
            b"Content-Type: " + ctype.encode("latin-1") + b"\r\nMIME-Version: 1.0\r\n\r\n" + body)
        if msg.is_multipart():
            for part in msg.iter_parts():
                if part.get_param("name", header="content-disposition") == "file":
                    return (part.get_filename() or "upload.xlsx",
                            part.get_payload(decode=True) or b"")
        raise ValueError("Δεν βρέθηκε αρχείο στο αίτημα.")

    def do_POST(self):
        if self.path.split("?", 1)[0] != "/upload":
            return self._send(404, b"not found")
        try:
            fname, data = self._read_upload()
            mm = loadmod.detect_month_from_filename(fname) or STATE["mm"]
            with tempfile.NamedTemporaryFile(suffix=".xlsx", delete=False) as tmp:
                tmp.write(data)
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
    ap.add_argument("--open", action="store_true",
                    help="open the browser once the server is up (used by run.bat/run.command)")
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

    lan = _lan_ip()
    srv = ThreadingHTTPServer(("0.0.0.0", args.port), Handler)
    print(f"▶ Σε αυτόν τον υπολογιστή:  http://localhost:{args.port}")
    if lan:
        print(f"▶ Στο κινητό (ίδιο Wi-Fi), Safari/Chrome:  http://{lan}:{args.port}")
    print("  (Ctrl+C για τερματισμό)")
    if args.open:
        import threading
        import webbrowser
        threading.Timer(1.0, webbrowser.open, [f"http://localhost:{args.port}"]).start()
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        print("\nτέλος.")


def _lan_ip():
    import socket
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("8.8.8.8", 80))
        ip = s.getsockname()[0]
        s.close()
        return ip
    except Exception:
        return None


if __name__ == "__main__":
    main()
