"""Build okypy-recon.html — the whole app in ONE file.

Inlines every <script src="..."> of index.html (vendor libraries included)
so the result can be emailed / copied around and opened with a double-click,
no folders needed.  Run after changing anything under webapp/:

    python webapp/build_single.py
"""
from __future__ import annotations

import re
from pathlib import Path

HERE = Path(__file__).resolve().parent
OUT = HERE / "okypy-recon.html"

html = (HERE / "index.html").read_text(encoding="utf-8")


def inline(match: re.Match) -> str:
    src = match.group(1)
    body = (HERE / src).read_text(encoding="utf-8")
    # '</script' inside the JS (always within string literals in these libs)
    # would terminate the inline tag early — escape it
    body = body.replace("</script", "<\\/script")
    return f"<script>/* inlined: {src} */\n{body}\n</script>"


html = re.sub(r'<script src="([^"]+)"></script>', inline, html)
# the missing-folders banner is meaningless in the single file
html = html.replace("okypy-recon.html", "okypy-recon.html")  # (name stays)
OUT.write_text(html, encoding="utf-8")
print(f"wrote {OUT} ({OUT.stat().st_size / 1e6:.1f} MB)")
