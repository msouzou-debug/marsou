"""Build the single-file Capitation Fees page.

dist/index.html            page body for publishing as a claude.ai artifact
dist/capitation_tool.html  standalone copy to open from disk or a shared drive
"""
import base64, json, pathlib

root = pathlib.Path(__file__).parent
src = root / "src"
page = (src / "app.html").read_text(encoding="utf-8")
uri = lambda p: "data:image/png;base64," + base64.b64encode((src / "assets" / p).read_bytes()).decode()
# The example summary is built from real monthly files, so it stays out of git.
ex_path = src / "assets" / "example_july2026.json"
example = json.loads(ex_path.read_text(encoding="utf-8")) if ex_path.exists() else None
page = (page.replace("{{LOGO}}", uri("logo.png"))
            .replace("{{LOGO_WHITE}}", uri("logo_white.png"))
            .replace("{{EXAMPLE}}", json.dumps(example, ensure_ascii=False))
            .replace("/*{{PARSECAP}}*/", (src / "parsecap.js").read_text(encoding="utf-8"))
            .replace("/*{{PARSERA}}*/", (src / "parsera.js").read_text(encoding="utf-8"))
            .replace("/*{{CORE}}*/", (src / "core.js").read_text(encoding="utf-8")))
assert "{{" not in page, "unfilled placeholder"
dist = root / "dist"
dist.mkdir(exist_ok=True)
(dist / "index.html").write_text(page, encoding="utf-8")
standalone = ('<!doctype html><html lang="el"><head><meta charset="utf-8">'
              '<meta name="viewport" content="width=device-width,initial-scale=1"></head><body>'
              + page + "</body></html>")
(dist / "capitation_tool.html").write_text(standalone, encoding="utf-8")
print("built", len(page) // 1024, "KB")

# Offline single file: inline the pinned libraries so it runs with no internet.
# Needs the npm packages (pdfjs-dist@3.11.174, jszip@3.10.1, exceljs@4.4.0) in ./node_modules.
import re, sys
nm = root / "node_modules"
LIBS = {
    "pdf.js/3.11.174/pdf.min.js": "pdfjs-dist/build/pdf.min.js",
    "pdf.js/3.11.174/pdf.worker.min.js": "pdfjs-dist/build/pdf.worker.min.js",
    "jszip/3.10.1/jszip.min.js": "jszip/dist/jszip.min.js",
    "exceljs/4.4.0/exceljs.min.js": "exceljs/dist/exceljs.min.js",
}
if all((nm / p).exists() for p in LIBS.values()):
    off = page
    for cdn, local in LIBS.items():
        js = (nm / local).read_text(encoding="utf-8").replace("</script", "<\\/script")
        tag = f'<script src="https://cdnjs.cloudflare.com/ajax/libs/{cdn}"></script>'
        assert tag in off, cdn
        off = off.replace(tag, "<script>" + js + "</script>")
    off = re.sub(r'<link rel="(preconnect|stylesheet)" href="https://fonts\.[^"]+"[^>]*>\n?', "", off)
    off = off.replace("if (window.pdfjsLib) pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';", "")
    assert "cdnjs" not in off and "googleapis" not in off
    (dist / "capitation_tool_offline.html").write_text(
        '<!doctype html><html lang="el"><head><meta charset="utf-8">'
        '<meta name="viewport" content="width=device-width,initial-scale=1"></head><body>' + off + "</body></html>",
        encoding="utf-8")
    print("offline", (dist / "capitation_tool_offline.html").stat().st_size // 1024, "KB")
else:
    print("offline build skipped: npm packages missing", file=sys.stderr)
