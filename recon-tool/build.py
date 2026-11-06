#!/usr/bin/env python3
"""Build the single-file tools from src/ templates.

Inlines the SheetJS library and the base64-encoded OKYpY logo so each output
is a single self-contained file that works offline. Run after every change
to any template in src/:

    python3 build.py
"""
import base64, os, re, sys

ROOT = os.path.dirname(os.path.abspath(__file__))

TARGETS = [
    ('app_template.html', 'OKYpY_Reconciliation_Tool.html'),
    ('ic_template.html', 'OKYpY_IC_Matrix_Tool.html'),
]

def main():
    lib_path = os.path.join(ROOT, 'vendor', 'xlsx-style.full.min.js')
    logo_path = os.path.join(ROOT, 'assets', 'okypy_logo_full.png')
    lib = open(lib_path, encoding='utf-8').read()
    logo = base64.b64encode(open(logo_path, 'rb').read()).decode()

    for tpl_name, out_name in TARGETS:
        tpl_path = os.path.join(ROOT, 'src', tpl_name)
        out_path = os.path.join(ROOT, 'dist', out_name)
        tpl = open(tpl_path, encoding='utf-8').read()
        m = re.search(r"const APP_VERSION='(\d+\.\d+)'", tpl)
        if not m:
            sys.exit(f'ERROR: APP_VERSION missing from {tpl_name}')
        ver = m.group(1)
        # every visible copy of the number must agree with the constant
        stray = {x for x in re.findall(r'v(\d+\.\d+)(?=</span>)', tpl)} - {ver}
        if stray:
            sys.exit(f'ERROR: {tpl_name} still shows version(s) {sorted(stray)} but APP_VERSION is {ver}')
        for marker in ('__XLSX_LIB__', '__LOGO_FULL__'):
            if marker not in tpl:
                sys.exit(f'ERROR: marker {marker} missing from {tpl_name}')
        out = (tpl.replace('__LOGO_FULL__', logo)
                  .replace('<script>__XLSX_LIB__</script>', '<script>\n' + lib + '\n</script>'))
        os.makedirs(os.path.dirname(out_path), exist_ok=True)
        with open(out_path, 'w', encoding='utf-8') as f:
            f.write(out)
        print(f'Built {out_path} v{ver} ({os.path.getsize(out_path)//1024} KB)')

if __name__ == '__main__':
    main()
