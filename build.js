#!/usr/bin/env node
/*
 * Συναρμολόγηση του τελικού specialized-ceiling-app.html:
 * ενσωματώνει inline τις βιβλιοθήκες SheetJS + ExcelJS και το src/core.js
 * μέσα στο src/app.src.html, ώστε το αποτέλεσμα να είναι ένα μόνο αρχείο
 * που δουλεύει πλήρως offline.
 */
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const OUT = path.join(ROOT, 'specialized-ceiling-app.html');

function lib(p) {
  const full = require.resolve(p);
  const code = fs.readFileSync(full, 'utf8');
  if (code.includes('</script')) throw new Error(p + ' περιέχει </script — δεν μπορεί να ενσωματωθεί inline.');
  return code;
}

const template = fs.readFileSync(path.join(ROOT, 'src', 'app.src.html'), 'utf8');
const core = fs.readFileSync(path.join(ROOT, 'src', 'core.js'), 'utf8');
if (core.includes('</script')) throw new Error('core.js περιέχει </script');

const xlsxCode = lib('xlsx/dist/xlsx.full.min.js');
const exceljsCode = lib('exceljs/dist/exceljs.min.js');

let out = template;
const inject = (marker, code, label) => {
  if (!out.includes(marker)) throw new Error('Λείπει marker ' + marker);
  // Συνάρτηση αντικατάστασης: τα $& / $' μέσα στον minified κώδικα
  // δεν πρέπει να ερμηνευθούν ως replacement patterns.
  out = out.replace(marker, function () {
    return '<script>/* ' + label + ' */\n' + code + '\n</script>';
  });
};
inject('<!--INJECT:XLSX-->', xlsxCode, 'SheetJS (xlsx) — inline για offline χρήση');
inject('<!--INJECT:EXCELJS-->', exceljsCode, 'ExcelJS — inline για offline χρήση');
inject('<!--INJECT:CORE-->', core, 'core.js');

fs.writeFileSync(OUT, out);
console.log('OK →', OUT, (fs.statSync(OUT).size / 1024 / 1024).toFixed(2) + ' MB');
