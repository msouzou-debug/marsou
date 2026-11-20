#!/usr/bin/env bash
# Publish the manuals into the app: docs/manuals/*.docx become PDFs in ehire/manuals/ (read in the browser from the
# Manuals page), and the UAT workbooks are copied as they are. Existing files are overwritten. Run after
# make-manuals.js, make-uat-plan.js and make_uat_xlsx.py. Needs LibreOffice (soffice).
set -euo pipefail
cd "$(dirname "$0")/../.."
mkdir -p ehire/manuals
for stem in eHire-user-guide eHire-admin-guide eHire-UAT-plan; do
  for lang in el en; do
    soffice --headless --convert-to pdf --outdir ehire/manuals "docs/manuals/$stem-$lang.docx" >/dev/null 2>&1
    [ -s "ehire/manuals/$stem-$lang.pdf" ] || { echo "could not convert $stem-$lang.docx" >&2; exit 1; }
  done
done
cp docs/manuals/eHire-UAT-test-scripts-el.xlsx docs/manuals/eHire-UAT-test-scripts-en.xlsx ehire/manuals/
ls -la ehire/manuals
