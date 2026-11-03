#!/usr/bin/env python3
"""Χτίζει το αυτόνομο αρχείο dist/okypy-timologisi.html (χωρίς εξαρτήσεις δικτύου)."""
import base64, pathlib
R = pathlib.Path(__file__).resolve().parent
rd = lambda p: (R / p).read_text(encoding='utf-8')
b64 = lambda p: base64.b64encode((R / p).read_bytes()).decode()
html = rd('src/index.html')
parts = {
    'CSS': rd('src/app.css'),
    'LOGO': 'data:image/png;base64,' + b64('assets/okypy_logo.png'),
    'PDFWORKER': rd('vendor/pdf.worker.min.js'),
    'XLSX': rd('vendor/xlsx.full.min.js'),
    'JSPDF': rd('vendor/jspdf.umd.min.js'),
    'AUTOTABLE': rd('vendor/jspdf.plugin.autotable.min.js'),
    'PDFJS': rd('vendor/pdf.min.js'),
    'FONTREG': b64('vendor/LiberationSans-Regular.ttf'),
    'FONTBOLD': b64('vendor/LiberationSans-Bold.ttf'),
    'APP': rd('src/app.js'),
}
for k, v in parts.items():
    tag = '/*@@%s@@*/' % k
    assert html.count(tag) == 1, k
    if k not in ('FONTREG', 'FONTBOLD', 'LOGO', 'CSS'):
        assert '</script' not in v.lower(), k
    html = html.replace(tag, v)
out = R / 'dist' / 'okypy-timologisi.html'
out.write_text(html, encoding='utf-8')
print(out, round(out.stat().st_size / 1e6, 2), 'MB')
