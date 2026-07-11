#!/usr/bin/env python3
"""Build dist/OKYpY_Reconciliation_Tool.html from src/app_template.html.

Inlines the SheetJS library and the base64-encoded OKYpY logo so the output
is a single self-contained file that works offline. Run after every change
to src/app_template.html:

    python3 build.py
"""
import base64, os, sys

ROOT = os.path.dirname(os.path.abspath(__file__))

def main():
    tpl_path = os.path.join(ROOT, 'src', 'app_template.html')
    lib_path = os.path.join(ROOT, 'vendor', 'xlsx-style.full.min.js')
    logo_path = os.path.join(ROOT, 'assets', 'okypy_logo_full.png')
    out_path = os.path.join(ROOT, 'dist', 'OKYpY_Reconciliation_Tool.html')

    tpl = open(tpl_path, encoding='utf-8').read()
    for marker in ('__XLSX_LIB__', '__LOGO_FULL__'):
        if marker not in tpl:
            sys.exit(f'ERROR: marker {marker} missing from template')

    lib = open(lib_path, encoding='utf-8').read()
    logo = base64.b64encode(open(logo_path, 'rb').read()).decode()

    out = (tpl.replace('__LOGO_FULL__', logo)
              .replace('<script>__XLSX_LIB__</script>', '<script>\n' + lib + '\n</script>'))

    os.makedirs(os.path.dirname(out_path), exist_ok=True)
    with open(out_path, 'w', encoding='utf-8') as f:
        f.write(out)
    print(f'Built {out_path} ({os.path.getsize(out_path)//1024} KB)')

if __name__ == '__main__':
    main()
