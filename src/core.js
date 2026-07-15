/*
 * core.js — Καθαρή λογική (χωρίς DOM) για την εφαρμογή
 * «Επίπτωση Υπέρβασης Εξειδικευμένων Μονάδων (ΟΚΥπΥ)».
 *
 * Runs both in the browser (window.CeilingCore) and in Node (module.exports)
 * so the exact same code the app ships with is what the tests exercise.
 */
(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) module.exports = factory();
  else root.CeilingCore = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /* ------------------------------------------------------------------ *
   * Σταθερές / προεπιλογές 2026
   * ------------------------------------------------------------------ */

  var HOSPITALS = [
    { code: 'F1054', name: 'ΓΝ Λευκωσίας',        agreed: 5239, brH1: 4852 },
    { code: 'F1050', name: 'Μακάρειο',             agreed: 2743, brH1: 4320 },
    { code: 'F1047', name: 'ΓΝ Λεμεσού',           agreed: 1519, brH1: 4331 },
    { code: 'F1048', name: 'ΓΝ Λάρνακας',          agreed:  304, brH1: 4183 },
    { code: 'F1049', name: 'ΓΝ Αμμοχώστου',        agreed:   92, brH1: 4187 },
    { code: 'F1025', name: 'ΓΝ Πάφου',             agreed:  148, brH1: 4156 },
    { code: 'F1026', name: 'Ν. Πόλης Χρυσοχούς',   agreed:    7, brH1: 4027 },
    { code: 'F1055', name: 'Ν. Τροόδους',          agreed:    0, brH1: 4027 }
  ];
  var HOSPITAL_CODES = HOSPITALS.map(function (h) { return h.code; });

  // Γνωστές τελικές εκπτώσεις ΟΑΥ 2026 (δεκαδικά, αρνητικά).
  var DEFAULT_DISCOUNTS = { 1: -0.4032, 2: -0.4509, 3: -0.6031, 4: -0.4877, 5: 0 };

  var MONTHS_EL = ['', 'Ιανουάριος', 'Φεβρουάριος', 'Μάρτιος', 'Απρίλιος', 'Μάιος', 'Ιούνιος',
    'Ιούλιος', 'Αύγουστος', 'Σεπτέμβριος', 'Οκτώβριος', 'Νοέμβριος', 'Δεκέμβριος'];

  var DEFAULT_YEAR = 2026;

  // Στήλες του IS Auditor Report — ακριβές ταίριασμα κειμένου επικεφαλίδας.
  var IS_COLUMNS = {
    provider: 'Billing Provider Id',
    category: 'Invoice Category',
    ae: 'AE Referral',
    acw: 'Adjusted Cost Weight',
    amount: 'DRG/FF Total Amount(Hospital + Total Doctor)'
  };

  // Κατώφλια πληρότητας αρχείου IS Auditor (πλήρης μήνας: ~7.500–10.000
  // γραμμές, ~300–500 Specialised).
  var MIN_TOTAL_ROWS = 5000;
  var MIN_SPEC_ROWS = 200;

  /* ------------------------------------------------------------------ *
   * Βοηθητικά
   * ------------------------------------------------------------------ */

  function toStr(v) {
    if (v === null || v === undefined) return '';
    return String(v).trim();
  }

  // Αριθμητική μετατροπή με προστασία για NaN / 'nan' / κενά / χιλιάδες.
  function toNum(v) {
    if (typeof v === 'number') return isFinite(v) ? v : null;
    var s = toStr(v);
    if (s === '' || /^nan$/i.test(s)) return null;
    // δεκτά και "1,234.5" και ευρωπαϊκό "1.234,5"
    if (/^\-?\d{1,3}(\.\d{3})+(,\d+)?$/.test(s)) s = s.replace(/\./g, '').replace(',', '.');
    else s = s.replace(/,/g, '');
    var n = parseFloat(s);
    return isFinite(n) ? n : null;
  }

  // Κανονικοποίηση ελληνικών: αφαίρεση τόνων/διαλυτικών + κεφαλαία.
  function normalizeGreek(s) {
    return toStr(s).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase();
  }

  /* ------------------------------------------------------------------ *
   * Ανίχνευση μήνα/έτους από όνομα αρχείου ή κείμενο (π.χ. B1 του Conso)
   * ------------------------------------------------------------------ */

  // [regex πάνω σε κανονικοποιημένο (χωρίς τόνους, κεφαλαία) κείμενο, μήνας]
  var MONTH_TOKENS = [
    [/ΙΑΝΟΥΑΡ|(^|[^Α-Ω])ΙΑΝ([^Α-Ω]|$)/, 1],
    [/ΦΕΒΡΟΥΑΡ|(^|[^Α-Ω])ΦΕΒ([^Α-Ω]|$)/, 2],
    [/ΜΑΡΤΙ|(^|[^Α-Ω])ΜΑΡ([^Α-Ω]|$)/, 3],
    [/ΑΠΡΙΛΙ|(^|[^Α-Ω])ΑΠΡ([^Α-Ω]|$)/, 4],
    [/ΜΑΙΟ|ΜΑΙΟΥ|(^|[^Α-Ω])ΜΑΙ([^Α-Ω]|$)/, 5],
    [/ΙΟΥΝΙ|(^|[^Α-Ω])ΙΟΥΝ([^Α-Ω]|$)/, 6],
    [/ΙΟΥΛΙ|(^|[^Α-Ω])ΙΟΥΛ([^Α-Ω]|$)/, 7],
    [/ΑΥΓΟΥΣΤ|(^|[^Α-Ω])ΑΥΓ([^Α-Ω]|$)/, 8],
    [/ΣΕΠΤΕΜΒΡΙ|(^|[^Α-Ω])ΣΕΠ([^Α-Ω]|$)/, 9],
    [/ΟΚΤΩΒΡΙ|(^|[^Α-Ω])ΟΚΤ([^Α-Ω]|$)/, 10],
    [/ΝΟΕΜΒΡΙ|(^|[^Α-Ω])ΝΟΕ([^Α-Ω]|$)/, 11],
    [/ΔΕΚΕΜΒΡΙ|(^|[^Α-Ω])ΔΕΚ([^Α-Ω]|$)/, 12],
    [/JANUARY|(^|[^A-Z])JAN([^A-Z]|$|\d)/, 1],
    [/FEBRUARY|(^|[^A-Z])FEB([^A-Z]|$|\d)/, 2],
    [/MARCH|(^|[^A-Z])MAR([^A-Z]|$|\d)/, 3],
    [/APRIL|(^|[^A-Z])APR([^A-Z]|$|\d)/, 4],
    [/(^|[^A-Z])MAY([^A-Z]|$|\d)/, 5],
    [/JUNE|(^|[^A-Z])JUN([^A-Z]|$|\d)/, 6],
    [/JULY|(^|[^A-Z])JUL([^A-Z]|$|\d)/, 7],
    [/AUGUST|(^|[^A-Z])AUG([^A-Z]|$|\d)/, 8],
    [/SEPTEMBER|(^|[^A-Z])SEPT?([^A-Z]|$|\d)/, 9],
    [/OCTOBER|(^|[^A-Z])OCT([^A-Z]|$|\d)/, 10],
    [/NOVEMBER|(^|[^A-Z])NOV([^A-Z]|$|\d)/, 11],
    [/DECEMBER|(^|[^A-Z])DEC([^A-Z]|$|\d)/, 12]
  ];

  // Επιστρέφει {month, year} — οποιοδήποτε από τα δύο μπορεί να είναι null.
  function detectMonthYear(text) {
    var n = normalizeGreek(text);
    var month = null, year = null;

    for (var i = 0; i < MONTH_TOKENS.length; i++) {
      if (MONTH_TOKENS[i][0].test(n)) { month = MONTH_TOKENS[i][1]; break; }
    }

    var y4 = n.match(/20\d{2}/);
    if (y4) year = parseInt(y4[0], 10);

    if (month === null) {
      // Αριθμητικά μοτίβα: 2026-01, 2026_01, 01_2026, 2026.1 κ.λπ.
      var m1 = n.match(/20\d{2}[._\-\s]?(1[0-2]|0[1-9])(?![0-9])/);
      var m2 = n.match(/(?:^|[^0-9])(1[0-2]|0?[1-9])[._\-\s]20\d{2}/);
      if (m1) month = parseInt(m1[1], 10);
      else if (m2) month = parseInt(m2[1], 10);
    } else if (year === null) {
      // Διψήφιο έτος κολλημένο σε όνομα μήνα, π.χ. March_26, ΙΑΝ26.
      var y2 = n.match(/(?:[Α-ΩA-Z])[._\-\s]?(\d{2})(?![0-9])/);
      if (y2) year = 2000 + parseInt(y2[1], 10);
    }

    return { month: month, year: year };
  }

  /* ------------------------------------------------------------------ *
   * Ανάγνωση IS Auditor Report
   * ------------------------------------------------------------------ */

  function parseISAuditor(XLSX, wb, filename) {
    var res = {
      ok: false, error: null, filename: filename || '',
      totalRows: 0, specialisedRows: 0, incomplete: false,
      perProvider: {}
    };
    HOSPITAL_CODES.forEach(function (c) {
      res.perProvider[c] = { pos: 0, posAe: 0, neg: 0, negAe: 0 };
    });

    // Επιλογή φύλλου: αγνοούμε κάθε φύλλο 'lists', παίρνουμε το πρώτο που μένει.
    var names = wb.SheetNames.filter(function (n) { return n.toLowerCase().trim() !== 'lists'; });
    if (!names.length) { res.error = 'Δεν βρέθηκε φύλλο δεδομένων (μόνο "Lists").'; return res; }
    var ws = wb.Sheets[names[0]];
    var rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null, raw: true });
    if (!rows.length) { res.error = 'Το φύλλο «' + names[0] + '» είναι κενό.'; return res; }

    // Εντοπισμός γραμμής επικεφαλίδων στις πρώτες 10 γραμμές.
    var headerIdx = -1, colIdx = {};
    for (var r = 0; r < Math.min(rows.length, 10); r++) {
      var cells = (rows[r] || []).map(toStr);
      if (cells.indexOf(IS_COLUMNS.provider) !== -1) { headerIdx = r; break; }
    }
    if (headerIdx === -1) {
      res.error = 'Δεν βρέθηκε επικεφαλίδα «' + IS_COLUMNS.provider + '».';
      return res;
    }
    var headerCells = rows[headerIdx].map(toStr);
    var missing = [];
    Object.keys(IS_COLUMNS).forEach(function (k) {
      var idx = headerCells.indexOf(IS_COLUMNS[k]);
      if (idx === -1) missing.push(IS_COLUMNS[k]);
      colIdx[k] = idx;
    });
    if (missing.length) {
      res.error = 'Λείπουν στήλες: ' + missing.join(', ');
      return res;
    }

    for (var i = headerIdx + 1; i < rows.length; i++) {
      var row = rows[i] || [];
      var empty = row.every(function (c) { return toStr(c) === ''; });
      if (empty) continue;
      res.totalRows++;

      var cat = toStr(row[colIdx.category]);
      if (cat !== 'Specialised') continue; // εξαιρεί Normal, Birth, κενά
      res.specialisedRows++;

      var code = toStr(row[colIdx.provider]);
      if (HOSPITAL_CODES.indexOf(code) === -1) continue; // π.χ. F1111

      var acw = toNum(row[colIdx.acw]);
      var amt = toNum(row[colIdx.amount]);
      if (acw === null || amt === null) continue;

      var p = res.perProvider[code];
      var isAe = toStr(row[colIdx.ae]) === 'Y';
      if (amt > 0) {
        p.pos += acw;
        if (isAe) p.posAe += acw;
      } else if (amt < 0) {
        p.neg += acw;
        if (isAe) p.negAe += acw;
      }
    }

    res.incomplete = res.totalRows < MIN_TOTAL_ROWS || res.specialisedRows < MIN_SPEC_ROWS;
    res.ok = true;
    return res;
  }

  /* ------------------------------------------------------------------ *
   * Ανάγνωση Conso (μονάδες ΤΑΕΠ άνω του 15%)
   * ------------------------------------------------------------------ */

  function parseConso(XLSX, wb, filename) {
    var res = { ok: false, error: null, filename: filename || '', b1: '', over15: {}, sheetsUsed: [], warnings: [] };

    if (!wb.SheetNames.length) { res.error = 'Κενό αρχείο.'; return res; }
    var first = wb.Sheets[wb.SheetNames[0]];
    var b1 = first && first['B1'] ? first['B1'].v : '';
    res.b1 = toStr(b1);

    wb.SheetNames.forEach(function (name) {
      // Ανεκτική αντιστοίχιση φύλλου → κωδικός: δεκτά «F1054», «f1054»,
      // «F1047 - ΓΝ Λεμεσού» κ.λπ. Τα TOTAL/ΣΥΝΟΛΟ αγνοούνται πάντα.
      var norm = normalizeGreek(name);
      if (/TOTAL|ΣΥΝΟΛ/.test(norm)) return;
      var m = norm.match(/F\d{4}/);
      var code = m ? m[0] : null;
      if (!code || HOSPITAL_CODES.indexOf(code) === -1) return;
      if (code in res.over15) return; // πρώτο φύλλο ανά κωδικό

      var ws = wb.Sheets[name];
      var rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null, raw: true });
      // Η ετικέτα «Εξειδικευμένα» μπορεί να μην είναι ακριβώς στη στήλη B
      // (συγχωνευμένα κελιά, κενά, κεφαλαία)· ψάχνουμε παντού, χωρίς τόνους/πεζά,
      // και παίρνουμε το πρώτο αριθμητικό κελί δεξιά της στην ίδια γραμμή
      // (στην κανονική διάταξη B=«Εξειδικευμένα» → C=μονάδες).
      var found = null;
      for (var r = 0; r < rows.length && found === null; r++) {
        var row = rows[r] || [];
        for (var cIdx = 0; cIdx < row.length; cIdx++) {
          if (!/^ΕΞΕΙΔΙΚΕΥΜΕΝ/.test(normalizeGreek(row[cIdx]))) continue;
          for (var v = cIdx + 1; v < row.length; v++) {
            var num = toNum(row[v]);
            if (num !== null) { found = num; break; }
          }
          if (found !== null) break;
        }
      }
      if (found === null) {
        res.warnings.push('Φύλλο «' + name + '»: δεν βρέθηκε γραμμή «Εξειδικευμένα» με αριθμητική τιμή — θα ληφθεί 0.');
      } else {
        res.over15[code] = found;
        res.sheetsUsed.push(code);
      }
    });

    if (!res.sheetsUsed.length) {
      res.warnings.push('Δεν εντοπίστηκε καμία τιμή ΤΑΕΠ >15% στο αρχείο — ελέγξτε ότι τα φύλλα ονομάζονται με τους κωδικούς νοσηλευτηρίων (F1054, F1047, …) και περιέχουν γραμμή «Εξειδικευμένα».');
    }
    res.ok = true;
    return res;
  }

  /* ------------------------------------------------------------------ *
   * Ανάγνωση αρχείου εκπτώσεων ΟΑΥ (προαιρετικό)
   * ------------------------------------------------------------------ */

  function parseDiscountFile(XLSX, wb, filename) {
    var res = { ok: false, error: null, filename: filename || '', entries: [] };
    if (!wb.SheetNames.length) { res.error = 'Κενό αρχείο.'; return res; }
    var ws = wb.Sheets[wb.SheetNames[0]];
    var rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null, raw: true });

    // Πίνακας από τη γραμμή 6: A=έτος, B=ελληνικός μήνας, M=Τελικό % Έκπτωσης.
    for (var r = 5; r < rows.length; r++) {
      var row = rows[r] || [];
      var year = toNum(row[0]);
      var monthName = toStr(row[1]);
      var pct = toNum(row[12]); // στήλη M
      if (year === null || monthName === '' || pct === null) continue;
      var det = detectMonthYear(monthName);
      if (det.month === null) continue;
      // Αμυντικά: αν δοθεί π.χ. -45.1 αντί -0.451, μετατροπή σε δεκαδικό.
      if (Math.abs(pct) > 1) pct = pct / 100;
      res.entries.push({ year: Math.round(year), month: det.month, pct: pct });
    }
    res.ok = true;
    return res;
  }

  /* ------------------------------------------------------------------ *
   * Υπολογισμός ανά νοσηλευτήριο × μήνα
   * ------------------------------------------------------------------ */

  // assumptions: { hospitals: {code:{agreed, brH1, brH2}}, discounts: {1..12: δεκαδικό|null},
  //               creditToggle: 'ΝΑΙ'|'ΟΧΙ' }
  // monthData:   { is: perProvider map, over15: {code: units} }
  function computeMonthRows(month, monthData, assumptions) {
    var toggle = assumptions.creditToggle === 'ΝΑΙ';
    var discount = assumptions.discounts[month];
    return HOSPITALS.map(function (h) {
      var a = assumptions.hospitals[h.code] || {};
      var p = (monthData.is && monthData.is[h.code]) || { pos: 0, posAe: 0, neg: 0, negAe: 0 };
      var over15 = (monthData.over15 && monthData.over15[h.code]) || 0;
      var credit = toggle ? (p.neg - p.negAe) : 0;
      var counted = p.pos - p.posAe + over15 + credit;
      var agreedMonthly = (a.agreed || 0) / 12;
      var excess = Math.max(0, counted - agreedMonthly);
      var br = month <= 6 ? a.brH1 : a.brH2;
      var d = (discount === null || discount === undefined) ? null : discount;
      var reducedBr = (br !== null && br !== undefined && d !== null) ? br * (1 + d) : null;
      var fullAmt = (br !== null && br !== undefined) ? excess * br : null;
      var redAmt = reducedBr !== null ? excess * reducedBr : null;
      var impact = (fullAmt !== null && redAmt !== null) ? redAmt - fullAmt : null;
      return {
        code: h.code, name: h.name, month: month,
        pos: p.pos, posAe: p.posAe, neg: p.neg, negAe: p.negAe, over15: over15,
        credit: credit, counted: counted, agreedMonthly: agreedMonthly, excess: excess,
        br: (br === undefined ? null : br), discount: d, reducedBr: reducedBr,
        fullAmt: fullAmt, redAmt: redAmt, impact: impact,
        amberFlag: over15 === 0 && p.posAe > 0
      };
    });
  }

  /* ------------------------------------------------------------------ *
   * Έλεγχοι πριν την εξαγωγή
   * ------------------------------------------------------------------ */

  // state: { isFiles: [{filename, month, parsed, includeAnyway}],
  //          consoFiles: [{filename, month, parsed}], assumptions }
  function validateForExport(state) {
    var errors = [];
    var a = state.assumptions;

    if (!state.isFiles.length) {
      errors.push('Δεν έχει μεταφορτωθεί κανένα IS Auditor Report.');
      return errors;
    }

    var monthsSeen = {};
    state.isFiles.forEach(function (f) {
      if (!f.month) errors.push('Το αρχείο «' + f.filename + '» δεν έχει αντιστοιχιστεί σε μήνα.');
      else if (monthsSeen[f.month])
        errors.push('Δύο IS Auditor Reports για τον μήνα ' + MONTHS_EL[f.month] + ' («' + monthsSeen[f.month] + '», «' + f.filename + '»).');
      else monthsSeen[f.month] = f.filename;

      if (f.parsed && f.parsed.incomplete && !f.includeAnyway)
        errors.push('Το αρχείο «' + f.filename + '» είναι πιθανώς ελλιπές — επιβεβαιώστε τη συμπερίληψή του ή αφαιρέστε το.');
    });

    var consoSeen = {};
    state.consoFiles.forEach(function (f) {
      if (!f.month) errors.push('Το αρχείο Conso «' + f.filename + '» δεν έχει αντιστοιχιστεί σε μήνα.');
      else {
        if (consoSeen[f.month])
          errors.push('Δύο αρχεία Conso για τον μήνα ' + MONTHS_EL[f.month] + '.');
        consoSeen[f.month] = f.filename;
        if (!monthsSeen[f.month])
          errors.push('Αρχείο Conso για τον μήνα ' + MONTHS_EL[f.month] + ' χωρίς αντίστοιχο IS Auditor Report.');
      }
    });

    Object.keys(monthsSeen).map(Number).forEach(function (m) {
      var d = a.discounts[m];
      if (d === null || d === undefined || d === '')
        errors.push('Λείπει το % έκπτωσης ΟΑΥ για τον μήνα ' + MONTHS_EL[m] + ' — η εξαγωγή μπλοκάρεται.');
      if (m > 6) {
        HOSPITALS.forEach(function (h) {
          var hh = a.hospitals[h.code] || {};
          if (hh.brH2 === null || hh.brH2 === undefined || hh.brH2 === '')
            errors.push('Ο μήνας ' + MONTHS_EL[m] + ' απαιτεί βασική τιμή Β΄ εξαμήνου για το ' + h.name + '.');
        });
      }
    });

    return errors;
  }

  /* ------------------------------------------------------------------ *
   * Δημιουργία workbook εξόδου (ExcelJS) — ζωντανές φόρμουλες
   * ------------------------------------------------------------------ */

  var COLORS = {
    navy: 'FF062E5C', blue: 'FF0072BC', sky: 'FF00AEEF', green: 'FF8DC63F',
    inputFont: 'FF0000FF', linkFont: 'FF008000', border: 'FFBFBFBF',
    amber: 'FFFFF2CC', yellow: 'FFFFFF00', grayNote: 'FF595959'
  };
  var FMT = {
    units: '#,##0.0',
    euro: '€#,##0;(€#,##0);-',
    pct: '0.0%'
  };

  function thinBorder() {
    var s = { style: 'thin', color: { argb: COLORS.border } };
    return { top: s, left: s, bottom: s, right: s };
  }

  function setCell(ws, addr, opts) {
    var c = ws.getCell(addr);
    if ('value' in opts) c.value = opts.value;
    c.font = Object.assign({ name: 'Arial', size: 10 }, opts.font || {});
    if (opts.numFmt) c.numFmt = opts.numFmt;
    if (opts.fill) c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: opts.fill } };
    if (opts.border) c.border = thinBorder();
    if (opts.align) c.alignment = opts.align;
    return c;
  }

  function headerCell(ws, addr, text) {
    setCell(ws, addr, {
      value: text, border: true, fill: COLORS.navy,
      font: { bold: true, color: { argb: 'FFFFFFFF' } },
      align: { vertical: 'middle', horizontal: 'center', wrapText: true }
    });
  }

  function colLetter(n) { // 1 -> A
    var s = '';
    while (n > 0) { var m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); }
    return s;
  }

  function round1(v) { return v === null ? null : Math.round(v * 10) / 10; }

  /*
   * payload: {
   *   year, months: [αύξοντες αριθμοί μηνών],
   *   rows: αποτελέσματα computeMonthRows για όλους τους μήνες (ταξινομημένα μήνας→νοσηλευτήριο),
   *   assumptions, sources: { isFiles: [...names], consoFiles: [...names], discountFile: name|null }
   * }
   */
  function buildWorkbook(ExcelJS, payload) {
    var wb = new ExcelJS.Workbook();
    wb.creator = 'ΟΚΥπΥ — Επίπτωση Υπέρβασης Εξειδικευμένων Μονάδων';
    wb.created = new Date();
    wb.calcProperties = { fullCalcOnLoad: true };

    var year = payload.year;
    var months = payload.months.slice().sort(function (a, b) { return a - b; });
    var rows = payload.rows;
    var a = payload.assumptions;
    var nRows = rows.length;

    var sheetOpts = {
      views: [{ showGridLines: false }],
      pageSetup: { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0 }
    };
    var wsSyn = wb.addWorksheet('Σύνοψη', sheetOpts);
    var wsCalc = wb.addWorksheet('Υπολογισμός', sheetOpts);
    var wsData = wb.addWorksheet('Δεδομένα', sheetOpts);
    var wsIn = wb.addWorksheet('Εισαγωγές', sheetOpts);

    /* ---------------- Εισαγωγές ---------------- */
    var IN = {
      hospHeader: 4, hospFirst: 5, hospLast: 4 + HOSPITALS.length, // 5..12
      discHeader: 15, discFirst: 16, discLast: 27,
      toggleRow: 29
    };

    setCell(wsIn, 'A1', { value: 'Εισαγωγές — Παραδοχές υπολογισμού', font: { bold: true, size: 14, color: { argb: COLORS.navy } } });
    setCell(wsIn, 'A2', { value: 'Έτος αναφοράς: ' + year, font: { color: { argb: COLORS.grayNote } } });

    setCell(wsIn, 'A3', { value: 'Πίνακας νοσηλευτηρίων', font: { bold: true, size: 11, color: { argb: COLORS.blue } } });
    ['Κωδικός', 'Νοσηλευτήριο', 'Συμφωνημένες ετήσιες μονάδες ' + year,
      'Συμφωνημένες μηνιαίες (= ετήσιες ÷ 12)',
      'Βασική τιμή 01/01–30/06 (€)', 'Βασική τιμή 01/07–31/12 (€)'
    ].forEach(function (t, i) { headerCell(wsIn, colLetter(i + 1) + IN.hospHeader, t); });

    HOSPITALS.forEach(function (h, i) {
      var r = IN.hospFirst + i;
      var hh = a.hospitals[h.code] || {};
      setCell(wsIn, 'A' + r, { value: h.code, border: true });
      setCell(wsIn, 'B' + r, { value: h.name, border: true });
      setCell(wsIn, 'C' + r, { value: hh.agreed, border: true, numFmt: FMT.units, font: { color: { argb: COLORS.inputFont } } });
      setCell(wsIn, 'D' + r, {
        value: { formula: 'C' + r + '/12', result: (hh.agreed || 0) / 12 },
        border: true, numFmt: FMT.units
      });
      setCell(wsIn, 'E' + r, { value: hh.brH1, border: true, numFmt: FMT.euro, font: { color: { argb: COLORS.inputFont } } });
      setCell(wsIn, 'F' + r, {
        value: (hh.brH2 === undefined || hh.brH2 === null || hh.brH2 === '') ? null : hh.brH2,
        border: true, numFmt: FMT.euro, font: { color: { argb: COLORS.inputFont } }
      });
    });

    setCell(wsIn, 'A14', { value: 'Πίνακας εκπτώσεων ΟΑΥ (πανκύπριο μηνιαίο ποσοστό)', font: { bold: true, size: 11, color: { argb: COLORS.blue } } });
    ['Μήνας (αρ.)', 'Μήνας', 'Τελικό % Έκπτωσης'].forEach(function (t, i) { headerCell(wsIn, colLetter(i + 1) + IN.discHeader, t); });
    for (var m = 1; m <= 12; m++) {
      var r = IN.discFirst + m - 1;
      var d = a.discounts[m];
      setCell(wsIn, 'A' + r, { value: m, border: true });
      setCell(wsIn, 'B' + r, { value: MONTHS_EL[m], border: true });
      setCell(wsIn, 'C' + r, {
        value: (d === null || d === undefined || d === '') ? null : d,
        border: true, numFmt: FMT.pct, font: { color: { argb: COLORS.inputFont } }
      });
    }

    setCell(wsIn, 'A' + IN.toggleRow, { value: 'Αφαίρεση πιστωτικών σημειώσεων;', font: { bold: true } });
    var tog = setCell(wsIn, 'B' + IN.toggleRow, {
      value: a.creditToggle === 'ΝΑΙ' ? 'ΝΑΙ' : 'ΟΧΙ',
      border: true, fill: COLORS.yellow, font: { bold: true }, align: { horizontal: 'center' }
    });
    tog.dataValidation = {
      type: 'list', allowBlank: false, formulae: ['"ΝΑΙ,ΟΧΙ"'],
      showErrorMessage: true, errorTitle: 'Μη έγκυρη τιμή', error: 'Επιλέξτε ΝΑΙ ή ΟΧΙ.'
    };

    var lr = IN.toggleRow + 2;
    setCell(wsIn, 'A' + lr, { value: 'Υπόμνημα', font: { bold: true, size: 11, color: { argb: COLORS.blue } } });
    setCell(wsIn, 'A' + (lr + 1), { value: 'Μπλε γραμματοσειρά = τιμές εισαγωγής (επεξεργάσιμες)', font: { color: { argb: COLORS.inputFont } } });
    setCell(wsIn, 'A' + (lr + 2), { value: 'Μαύρη γραμματοσειρά = ζωντανές φόρμουλες' });
    setCell(wsIn, 'A' + (lr + 3), { value: 'Πράσινη γραμματοσειρά = συνδέσεις μεταξύ φύλλων', font: { color: { argb: COLORS.linkFont } } });
    var srcRow = lr + 5;
    setCell(wsIn, 'A' + srcRow, { value: 'Πηγές', font: { bold: true, size: 11, color: { argb: COLORS.blue } } });
    setCell(wsIn, 'A' + (srcRow + 1), { value: 'IS Auditor Reports (HIO): ' + (payload.sources.isFiles.join(' · ') || '—'), font: { color: { argb: COLORS.grayNote } } });
    setCell(wsIn, 'A' + (srcRow + 2), { value: 'Conso >15%: ' + (payload.sources.consoFiles.join(' · ') || '—'), font: { color: { argb: COLORS.grayNote } } });
    setCell(wsIn, 'A' + (srcRow + 3), {
      value: 'Εκπτώσεις ΟΑΥ: ' + (payload.sources.discountFile || 'χειροκίνητη καταχώρηση'),
      font: { color: { argb: COLORS.grayNote } }
    });

    wsIn.columns = [{ width: 12 }, { width: 26 }, { width: 26 }, { width: 26 }, { width: 24 }, { width: 24 }];

    /* ---------------- Δεδομένα ---------------- */
    var DATA_FIRST = 5;
    setCell(wsData, 'A1', { value: 'Δεδομένα πηγής ανά νοσηλευτήριο × μήνα', font: { bold: true, size: 14, color: { argb: COLORS.navy } } });
    setCell(wsData, 'A2', {
      value: 'Πηγή μονάδων: Adjusted Cost Weight, Invoice Category = Specialised, IS Auditor Reports (HIO). Μονάδες ΤΑΕΠ >15%: αρχεία Conso.',
      font: { color: { argb: COLORS.grayNote } }
    });
    setCell(wsData, 'A3', {
      value: 'Αρχεία: ' + payload.sources.isFiles.concat(payload.sources.consoFiles).join(' · '),
      font: { color: { argb: COLORS.grayNote }, size: 8 }
    });
    ['Κωδικός', 'Νοσηλευτήριο', 'Μήνας (αρ.)',
      'Θετικές εξειδικευμένες μονάδες', 'εκ των οποίων ΤΑΕΠ (AE Referral)',
      'Αρνητικές μονάδες (πιστωτικές)', 'εκ των οποίων ΤΑΕΠ (AE Referral)',
      'ΤΑΕΠ εξειδικευμένα > 15% (Conso)'
    ].forEach(function (t, i) { headerCell(wsData, colLetter(i + 1) + 4, t); });

    rows.forEach(function (row, i) {
      var r = DATA_FIRST + i;
      setCell(wsData, 'A' + r, { value: row.code, border: true });
      setCell(wsData, 'B' + r, { value: row.name, border: true });
      setCell(wsData, 'C' + r, { value: row.month, border: true, align: { horizontal: 'center' } });
      [['D', row.pos], ['E', row.posAe], ['F', row.neg], ['G', row.negAe], ['H', row.over15]]
        .forEach(function (cv) {
          setCell(wsData, cv[0] + r, { value: cv[1], border: true, numFmt: FMT.units, font: { color: { argb: COLORS.inputFont } } });
        });
    });
    wsData.columns = [{ width: 10 }, { width: 24 }, { width: 10 }, { width: 16 }, { width: 16 }, { width: 16 }, { width: 16 }, { width: 16 }];

    /* ---------------- Υπολογισμός ---------------- */
    var CALC_FIRST = 5;
    var CALC_LAST = CALC_FIRST + nRows - 1;
    var TOT_ROW = CALC_LAST + 1;

    setCell(wsCalc, 'A1', { value: 'Υπολογισμός επίπτωσης υπέρβασης', font: { bold: true, size: 14, color: { argb: COLORS.navy } } });
    setCell(wsCalc, 'A2', {
      value: 'Προσμετρώμενες = Θετικές − ΤΑΕΠ + ΤΑΕΠ>15% ± Πιστωτικές · Υπέρβαση = MAX(0, Προσμετρώμενες − Συμφωνημένες μηνιαίες) · Επίπτωση = Υπέρβαση × Βασική τιμή × % Έκπτωσης',
      font: { color: { argb: COLORS.grayNote } }
    });
    ['Κωδικός', 'Νοσηλευτήριο', 'Μήνας (αρ.)', 'Έτος',
      'Θετικές μονάδες', 'μείον ΤΑΕΠ', 'συν ΤΑΕΠ >15%', '± Πιστωτικές',
      'Προσμετρώμενες μονάδες', 'Συμφωνημένες μηνιαίες', 'Μονάδες υπέρβασης',
      'Βασική τιμή (€)', 'Έκπτωση ΟΑΥ %', 'Μειωμένη βασική τιμή (€)',
      'Ποσό με πλήρη τιμή (€)', 'Ποσό με μειωμένη τιμή (€)', 'Επίπτωση εσόδων (€)'
    ].forEach(function (t, i) { headerCell(wsCalc, colLetter(i + 1) + 4, t); });

    var hMatch = "MATCH($A{r},'Εισαγωγές'!$A$" + IN.hospFirst + ':$A$' + IN.hospLast + ',0)';
    rows.forEach(function (row, i) {
      var r = CALC_FIRST + i;
      var dr = DATA_FIRST + i; // ίδια σειρά γραμμών με το φύλλο Δεδομένα
      var mm = hMatch.replace('{r}', r);
      function F(addr, formula, result, numFmt, green) {
        setCell(wsCalc, addr + r, {
          value: { formula: formula, result: (result === null || result === undefined) ? undefined : result },
          border: true, numFmt: numFmt,
          font: green ? { color: { argb: COLORS.linkFont } } : {}
        });
      }
      F('A', "'Δεδομένα'!A" + dr, row.code, null, true);
      F('B', "'Δεδομένα'!B" + dr, row.name, null, true);
      F('C', "'Δεδομένα'!C" + dr, row.month, null, true);
      setCell(wsCalc, 'D' + r, { value: year, border: true, font: { color: { argb: COLORS.inputFont } }, align: { horizontal: 'center' } });
      F('E', "'Δεδομένα'!D" + dr, row.pos, FMT.units, true);
      F('F', "'Δεδομένα'!E" + dr, row.posAe, FMT.units, true);
      F('G', "'Δεδομένα'!H" + dr, row.over15, FMT.units, true);
      F('H', 'IF(\'Εισαγωγές\'!$B$' + IN.toggleRow + '="ΝΑΙ",\'Δεδομένα\'!F' + dr + "-'Δεδομένα'!G" + dr + ',0)', row.credit, FMT.units);
      F('I', 'E' + r + '-F' + r + '+G' + r + '+H' + r, row.counted, FMT.units);
      F('J', "INDEX('Εισαγωγές'!$D$" + IN.hospFirst + ':$D$' + IN.hospLast + ',' + mm + ')', row.agreedMonthly, FMT.units);
      F('K', 'MAX(0,I' + r + '-J' + r + ')', row.excess, FMT.units);
      F('L', 'IF(C' + r + "<=6,INDEX('Εισαγωγές'!$E$" + IN.hospFirst + ':$E$' + IN.hospLast + ',' + mm + ')' +
             ",INDEX('Εισαγωγές'!$F$" + IN.hospFirst + ':$F$' + IN.hospLast + ',' + mm + '))', row.br, FMT.euro);
      F('M', "INDEX('Εισαγωγές'!$C$" + IN.discFirst + ':$C$' + IN.discLast + ',MATCH($C' + r + ",'Εισαγωγές'!$A$" + IN.discFirst + ':$A$' + IN.discLast + ',0))', row.discount, FMT.pct);
      F('N', 'L' + r + '*(1+M' + r + ')', row.reducedBr, FMT.euro);
      F('O', 'K' + r + '*L' + r, row.fullAmt, FMT.euro);
      F('P', 'K' + r + '*N' + r, row.redAmt, FMT.euro);
      F('Q', 'P' + r + '-O' + r, row.impact, FMT.euro);
    });

    // Γραμμή συνόλων
    setCell(wsCalc, 'B' + TOT_ROW, { value: 'Σύνολο ΟΚΥπΥ', border: true, fill: COLORS.navy, font: { bold: true, color: { argb: 'FFFFFFFF' } } });
    [['K', FMT.units, 'excess'], ['O', FMT.euro, 'fullAmt'], ['P', FMT.euro, 'redAmt'], ['Q', FMT.euro, 'impact']]
      .forEach(function (cf) {
        var sum = rows.reduce(function (s, row) { return s + (row[cf[2]] || 0); }, 0);
        setCell(wsCalc, cf[0] + TOT_ROW, {
          value: { formula: 'SUM(' + cf[0] + CALC_FIRST + ':' + cf[0] + CALC_LAST + ')', result: sum },
          border: true, numFmt: cf[1], font: { bold: true }, fill: COLORS.amber
        });
      });

    wsCalc.columns = [{ width: 10 }, { width: 22 }, { width: 9 }, { width: 7 },
      { width: 12 }, { width: 11 }, { width: 12 }, { width: 12 }, { width: 15 }, { width: 14 },
      { width: 12 }, { width: 13 }, { width: 11 }, { width: 14 }, { width: 15 }, { width: 15 }, { width: 16 }];

    /* ---------------- Σύνοψη ---------------- */
    setCell(wsSyn, 'A1', { value: 'Επίπτωση Υπέρβασης Εξειδικευμένων Μονάδων — ΟΚΥπΥ ' + year, font: { bold: true, size: 14, color: { argb: COLORS.navy } } });
    setCell(wsSyn, 'A2', { value: 'Σύνοψη ανά νοσηλευτήριο και μήνα (όλα τα ποσά υπολογίζονται με ζωντανές φόρμουλες SUMIFS από το φύλλο «Υπολογισμός»)', font: { color: { argb: COLORS.grayNote } } });

    var qCol = "'Υπολογισμός'!$Q$" + CALC_FIRST + ':$Q$' + CALC_LAST;
    var kCol = "'Υπολογισμός'!$K$" + CALC_FIRST + ':$K$' + CALC_LAST;
    var aCol = "'Υπολογισμός'!$A$" + CALC_FIRST + ':$A$' + CALC_LAST;
    var cCol = "'Υπολογισμός'!$C$" + CALC_FIRST + ':$C$' + CALC_LAST;

    function sumBy(pred, field) {
      return rows.reduce(function (s, row) { return s + (pred(row) ? (row[field] || 0) : 0); }, 0);
    }

    // matrix: {title, sectionRow, field ('impact'|'excess'), sumRange, numFmt}
    function writeMatrix(mx) {
      var numRow = mx.sectionRow + 1;   // γραμμή με αριθμούς μηνών (κριτήρια SUMIFS)
      var headRow = mx.sectionRow + 2;
      var firstData = mx.sectionRow + 3;
      var totalRow = firstData + HOSPITALS.length;
      var nM = months.length;
      var totCol = colLetter(3 + nM);

      setCell(wsSyn, 'A' + mx.sectionRow, { value: mx.title, font: { bold: true, size: 12, color: { argb: COLORS.blue } } });
      setCell(wsSyn, 'B' + numRow, { value: 'Μήνας (αρ.):', font: { size: 8, color: { argb: COLORS.grayNote } }, align: { horizontal: 'right' } });
      months.forEach(function (m, j) {
        setCell(wsSyn, colLetter(3 + j) + numRow, { value: m, font: { size: 8, color: { argb: COLORS.grayNote } }, align: { horizontal: 'center' } });
      });
      headerCell(wsSyn, 'A' + headRow, 'Κωδικός');
      headerCell(wsSyn, 'B' + headRow, 'Νοσηλευτήριο');
      months.forEach(function (m, j) { headerCell(wsSyn, colLetter(3 + j) + headRow, MONTHS_EL[m]); });
      headerCell(wsSyn, totCol + headRow, 'Σύνολο');

      HOSPITALS.forEach(function (h, i) {
        var r = firstData + i;
        setCell(wsSyn, 'A' + r, { value: h.code, border: true });
        setCell(wsSyn, 'B' + r, { value: h.name, border: true });
        months.forEach(function (m, j) {
          var cl = colLetter(3 + j);
          var v = sumBy(function (row) { return row.code === h.code && row.month === m; }, mx.field);
          setCell(wsSyn, cl + r, {
            value: { formula: 'SUMIFS(' + mx.sumRange + ',' + aCol + ',$A' + r + ',' + cCol + ',' + cl + '$' + numRow + ')', result: v },
            border: true, numFmt: mx.numFmt
          });
        });
        var vt = sumBy(function (row) { return row.code === h.code; }, mx.field);
        setCell(wsSyn, totCol + r, {
          value: { formula: 'SUM(C' + r + ':' + colLetter(2 + nM) + r + ')', result: vt },
          border: true, numFmt: mx.numFmt, font: { bold: true }
        });
      });

      setCell(wsSyn, 'A' + totalRow, { value: '', border: true, fill: COLORS.navy });
      setCell(wsSyn, 'B' + totalRow, { value: 'Σύνολο ΟΚΥπΥ', border: true, fill: COLORS.navy, font: { bold: true, color: { argb: 'FFFFFFFF' } } });
      for (var j = 0; j <= nM; j++) {
        var cl = colLetter(3 + j);
        var v = (j < nM)
          ? sumBy(function (row) { return row.month === months[j]; }, mx.field)
          : sumBy(function () { return true; }, mx.field);
        setCell(wsSyn, cl + totalRow, {
          value: { formula: 'SUM(' + cl + firstData + ':' + cl + (totalRow - 1) + ')', result: v },
          border: true, numFmt: mx.numFmt, font: { bold: true }, fill: COLORS.amber
        });
      }
      return totalRow;
    }

    var end1 = writeMatrix({ title: '1. Επίπτωση εσόδων (€)', sectionRow: 4, field: 'impact', sumRange: qCol, numFmt: FMT.euro });
    var end2 = writeMatrix({ title: '2. Μονάδες υπέρβασης', sectionRow: end1 + 2, field: 'excess', sumRange: kCol, numFmt: FMT.units });

    var noteRow = end2 + 2;
    var missingMonths = [];
    for (var mi = 1; mi <= Math.max.apply(null, months); mi++) {
      if (months.indexOf(mi) === -1) missingMonths.push(MONTHS_EL[mi]);
    }
    var notes = [
      'Σημειώσεις',
      '• Μεθοδολογία: Προσμετρώμενες μονάδες = Θετικές εξειδικευμένες − ΤΑΕΠ παραπομπές + ΤΑΕΠ >15% (Conso) ± πιστωτικές σημειώσεις (βλ. διακόπτη). Υπέρβαση = MAX(0, Προσμετρώμενες − Συμφωνημένες μηνιαίες).',
      '• Συμφωνημένες μηνιαίες μονάδες = ετήσιες ÷ 12 (φύλλο «Εισαγωγές»).',
      '• Επίπτωση εσόδων = Υπέρβαση × Βασική τιμή × Τελικό % Έκπτωσης ΟΑΥ (πανκύπριο μηνιαίο ποσοστό, φύλλο «Εισαγωγές»). Αρνητικό ποσό = απώλεια εσόδων.',
      '• Αφαίρεση πιστωτικών σημειώσεων: ' + (a.creditToggle === 'ΝΑΙ' ? 'ΝΑΙ' : 'ΟΧΙ') +
        '. Προσοχή: η βάση καταμέτρησης του ΟΑΥ δεν έχει επιβεβαιωθεί ως προς τον χειρισμό των πιστωτικών σημειώσεων.',
      '• Μήνες που δεν περιλαμβάνονται: ' + (missingMonths.length ? missingMonths.join(', ') : 'κανένας (πλήρης σειρά έως ' + MONTHS_EL[Math.max.apply(null, months)] + ')') + '.'
    ];
    notes.forEach(function (t, i) {
      setCell(wsSyn, 'A' + (noteRow + i), {
        value: t,
        font: i === 0 ? { bold: true, size: 11, color: { argb: COLORS.blue } } : { size: 9, color: { argb: COLORS.grayNote } }
      });
    });

    var synCols = [{ width: 10 }, { width: 24 }];
    months.forEach(function () { synCols.push({ width: 14 }); });
    synCols.push({ width: 15 });
    wsSyn.columns = synCols;

    return Promise.resolve(wb);
  }

  function exportFilename(year, lastMonth) {
    return 'Επίπτωση_Υπέρβασης_Εξειδικευμένων_' + year + '_' + String(lastMonth).padStart(2, '0') + '.xlsx';
  }

  function defaultAssumptions() {
    var hospitals = {};
    HOSPITALS.forEach(function (h) {
      hospitals[h.code] = { agreed: h.agreed, brH1: h.brH1, brH2: null };
    });
    var discounts = {};
    for (var m = 1; m <= 12; m++) {
      discounts[m] = (m in DEFAULT_DISCOUNTS) ? DEFAULT_DISCOUNTS[m] : null;
    }
    return { year: DEFAULT_YEAR, hospitals: hospitals, discounts: discounts, creditToggle: 'ΟΧΙ' };
  }

  return {
    HOSPITALS: HOSPITALS,
    HOSPITAL_CODES: HOSPITAL_CODES,
    MONTHS_EL: MONTHS_EL,
    DEFAULT_DISCOUNTS: DEFAULT_DISCOUNTS,
    DEFAULT_YEAR: DEFAULT_YEAR,
    MIN_TOTAL_ROWS: MIN_TOTAL_ROWS,
    MIN_SPEC_ROWS: MIN_SPEC_ROWS,
    toNum: toNum,
    toStr: toStr,
    normalizeGreek: normalizeGreek,
    detectMonthYear: detectMonthYear,
    parseISAuditor: parseISAuditor,
    parseConso: parseConso,
    parseDiscountFile: parseDiscountFile,
    computeMonthRows: computeMonthRows,
    validateForExport: validateForExport,
    buildWorkbook: buildWorkbook,
    exportFilename: exportFilename,
    defaultAssumptions: defaultAssumptions
  };
});
