// v3.0 feature tests: profiles, sign auto-detect, balance tie-out, duplicates,
// search filter, manual selection matching, same-day N-to-M, carry-forward,
// reconciliation pack, styled export.
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');
const XLSX = require('../vendor/xlsx-style.full.min.js');
const ROOT = path.join(__dirname, '..');
const APP = 'file://' + path.join(ROOT, 'dist', 'OKYpY_Reconciliation_Tool.html');
const S = f => path.join(ROOT, 'samples', f);

let failures = 0;
const check = (name, cond, detail) => {
  console.log((cond ? 'PASS' : 'FAIL') + ': ' + name + (detail !== undefined ? ' ' + JSON.stringify(detail) : ''));
  if (!cond) failures++;
};
const newAppPage = async browser => {
  const page = await browser.newPage();
  page.on('pageerror', e => { console.log('PAGEERROR:', e.message); failures++; });
  await page.goto(APP);
  return page;
};

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined, headless: true });

  /* ============ 1. sign auto-detect + tie-out + manual selection + carry-forward (ic pair) ============ */
  let page = await newAppPage(browser);
  await page.setInputFiles('#fileA', S('ic_A.xlsx'));
  await page.setInputFiles('#fileB', S('ic_B.xlsx'));
  await page.waitForSelector('#stepMap:not(.hidden)');
  let r = await page.evaluate(() => ({
    flip: document.getElementById('flipB').checked,
    hint: document.getElementById('signHint').textContent,
  }));
  console.log('SIGN:', JSON.stringify(r));
  check('mirrored amounts auto-tick the sign flip', r.flip === true && r.hint.length > 0, r);

  await page.click('#runBtn');
  await page.waitForSelector('#stepRes:not(.hidden)');
  r = await page.evaluate(() => ({
    tie: document.getElementById('tieInfo').textContent,
    tieHidden: document.getElementById('tieInfo').classList.contains('hidden'),
  }));
  console.log('TIE:', JSON.stringify(r));
  check('balance tie-out shows agreement for both detected footers', !r.tieHidden && r.tie.includes('A:') && r.tie.includes('B:') && r.tie.includes('✓'), r.tie);

  /* export the untouched run NOW — the carry-forward test needs its open items intact */
  const [dlPrev] = await Promise.all([page.waitForEvent('download'), page.evaluate(() => exportExcel())]);
  const prevPath = path.join(__dirname, 'export_prev.xlsx');
  await dlPrev.saveAs(prevPath);

  /* search filter narrows the open tab */
  r = await page.evaluate(() => {
    RESULT.activeTab = 'onlyA'; renderResults();
    const before = document.querySelectorAll('#pane-onlyA tbody tr').length;
    RESULT.filterQ = 'H-77'; renderResults();
    const after = document.querySelectorAll('#pane-onlyA tbody tr').length;
    RESULT.filterQ = ''; renderResults();
    return { before, after };
  });
  check('search filter narrows results', r.before === 2 && r.after === 1, r);

  /* manual selection: cross-side H-77 (75) vs L-88 (60) */
  r = await page.evaluate(() => {
    RESULT.onlyA.find(x => x.key === 'H-77')._sel = true;
    RESULT.onlyB.find(x => x.key === 'L-88')._sel = true;
    renderResults();
    const info = document.getElementById('selInfo').textContent;
    matchSelected();
    return {
      info,
      committed: RESULT.committed.length,
      manual: RESULT.matched.filter(x => x.rule === 4).map(x => [x.key, +x.diff.toFixed(2)]),
      openA: document.querySelectorAll('#pane-onlyA tbody tr').length,
    };
  });
  console.log('SELECT:', JSON.stringify(r));
  check('selection toolbar shows totals', /75,00|75.00/.test(r.info) && /60,00|60.00/.test(r.info), r.info);
  check('manual cross-side match committed with residual 15', r.committed === 1 && r.manual.length === 1 && r.manual[0][1] === 15, r.manual);
  check('matched item left the open list', r.openA === 1, r.openA);

  /* same-side pairing (reversal-style): remaining keyless A 15.50 + nothing on B is <2 items;
     select the two remaining opens on A side only? only one left — instead select keyless A + keyless B */
  r = await page.evaluate(() => {
    RESULT.onlyA.forEach(x => { if (!inAccepted(x)) x._sel = true; });   // #10 (15.50)
    RESULT.onlyB.forEach(x => { if (!inAccepted(x)) x._sel = true; });   // #10 (7.77)
    matchSelected();
    return { committed: RESULT.committed.length, openLeft: [RESULT.onlyA.filter(x => !inAccepted(x)).length, RESULT.onlyB.filter(x => !inAccepted(x)).length] };
  });
  check('second manual group clears the open lists', r.committed === 2 && JSON.stringify(r.openLeft) === JSON.stringify([0, 0]), r);

  /* export after the manual commits — checks styling and that sel-groups export cleanly */
  const [dl1] = await Promise.all([page.waitForEvent('download'), page.evaluate(() => exportExcel())]);
  const v4Path = path.join(__dirname, 'export_v4.xlsx');
  await dl1.saveAs(v4Path);
  const wbPrev = XLSX.read(fs.readFileSync(v4Path), { type: 'buffer', cellStyles: true });
  const wsM = wbPrev.Sheets['Συμφωνούν'];
  check('styled export: header carries the brand fill', !!(wsM && wsM.A1 && wsM.A1.s && wsM.A1.s.fgColor && wsM.A1.s.fgColor.rgb === '069FEC'), wsM && wsM.A1 && wsM.A1.s);

  /* pack: the same file pair must update its line, a new pair must append */
  r = await page.evaluate(() => {
    addToPack(); addToPack();          // same reconciliation twice
    const dedup = PACK.length;
    SIDES.B.name = 'TRANS_other.xlsx'; // a different reconciliation
    addToPack();
    return { dedup, total: PACK.length };
  });
  check('re-adding the same file pair updates instead of duplicating', r.dedup === 1, r);
  check('a different file pair still appends to the pack', r.total === 2, r);
  const [dlP] = await Promise.all([page.waitForEvent('download'), page.evaluate(() => exportPack())]);
  const packPath = path.join(__dirname, 'export_pack.xlsx');
  await dlP.saveAs(packPath);
  const wbPack = XLSX.read(fs.readFileSync(packPath), { type: 'buffer', cellFormula: true });
  console.log('PACK SHEETS:', JSON.stringify(wbPack.SheetNames));
  const wsPack = wbPack.Sheets['Πακέτο'];
  check('pack summary sheet with per-run check formulas', wsPack && wsPack.K4 && /ROUND\(J4-\(E4\+G4\+I4\),2\)/.test(wsPack.K4.f || ''), wsPack.K4 && wsPack.K4.f);
  check('pack totals row uses live SUM', wsPack && wsPack.E6 && /^SUM\(E4:E5\)$/.test(wsPack.E6.f || ''), wsPack.E6 && wsPack.E6.f);
  check('per-run open-items sheets present', wbPack.SheetNames.filter(n => /Εκκρεμή/.test(n)).length === 2, wbPack.SheetNames);
  await page.close();

  /* ============ 2. carry-forward: feed the export back as previous period ============ */
  page = await newAppPage(browser);
  await page.setInputFiles('#fileA', S('ic_A.xlsx'));
  await page.setInputFiles('#fileB', S('ic_B.xlsx'));
  await page.waitForSelector('#stepMap:not(.hidden)');
  await page.setInputFiles('#filePrev', prevPath);
  await page.waitForFunction(() => document.getElementById('boxPrev').classList.contains('loaded') || document.getElementById('finfoPrev').textContent !== '');
  await page.click('#runBtn');
  await page.waitForSelector('#stepRes:not(.hidden)');
  r = await page.evaluate(() => ({
    bf: RESULT.bf && { n: RESULT.bf.n, resolved: RESULT.bf.resolved },
    flagged: RESULT.onlyA.concat(RESULT.onlyB).filter(x => x.bf).map(x => x.key).sort(),
    kpis: [...document.querySelectorAll('.kpi .l')].map(x => x.textContent),
  }));
  console.log('BF:', JSON.stringify(r));
  check('open items from the previous period are flagged brought-forward',
    r.bf && r.bf.n === 4 && JSON.stringify(r.flagged) === JSON.stringify(['#10', '#10', 'H-77', 'L-88']), r);
  check('brought-forward KPI shown', r.kpis.some(x => /προηγ|Brought/i.test(x)), r.kpis);
  await page.close();

  /* ============ 3. profile round-trip (fee pair) ============ */
  page = await newAppPage(browser);
  await page.setInputFiles('#fileA', S('fee_A.csv'));
  await page.setInputFiles('#fileB', S('fee_B.csv'));
  await page.waitForSelector('#stepMap:not(.hidden)');
  await page.evaluate(() => {
    document.getElementById('amtB').value = 'Debit'; document.getElementById('crB').value = 'Credit';
    document.getElementById('dateB').value = 'Date'; document.getElementById('descB').value = 'Description';
    document.getElementById('amtA').value = 'Amount'; document.getElementById('dateA').value = 'Date'; document.getElementById('descA').value = 'Text';
    document.querySelectorAll('#keysB input').forEach(x => { x.checked = x.value === 'RefNo'; x.closest('.keychip').classList.toggle('on', x.checked); });
    document.querySelectorAll('#keysA input').forEach(x => { x.checked = false; x.closest('.keychip').classList.toggle('on', false); });
    document.getElementById('flipB').checked = true;
    document.getElementById('nokeyon').checked = true;
    document.getElementById('nokeydays').value = 9;
    document.getElementById('nearon').checked = true;
  });
  const [dlProf] = await Promise.all([page.waitForEvent('download'), page.evaluate(() => saveProfile())]);
  const profPath = path.join(__dirname, 'profile_v4.json');
  await dlProf.saveAs(profPath);
  const prof = JSON.parse(fs.readFileSync(profPath, 'utf8'));
  check('profile stores sides and settings', prof.type === 'profile' && prof.sides.B.keys[0] === 'RefNo' && prof.settings.nokeydays === '9', Object.keys(prof));
  await page.close();

  page = await newAppPage(browser);
  await page.setInputFiles('#progFile', profPath);   // profile first...
  await page.setInputFiles('#fileA', S('fee_A.csv')); // ...then the files
  await page.setInputFiles('#fileB', S('fee_B.csv'));
  await page.waitForSelector('#stepMap:not(.hidden)');
  r = await page.evaluate(() => ({
    keysB: [...document.querySelectorAll('#keysB input:checked')].map(x => x.value),
    amtB: document.getElementById('amtB').value, crB: document.getElementById('crB').value,
    nokey: document.getElementById('nokeyon').checked,
    days: document.getElementById('nokeydays').value,
    near: document.getElementById('nearon').checked,
    flip: document.getElementById('flipB').checked,
  }));
  console.log('PROFILE:', JSON.stringify(r));
  check('profile re-applies the full setup to freshly loaded files',
    JSON.stringify(r.keysB) === JSON.stringify(['RefNo']) && r.amtB === 'Debit' && r.crB === 'Credit' &&
    r.nokey === true && r.days === '9' && r.near === true && r.flip === true, r);
  await page.close();

  /* ============ 4. duplicates warning ============ */
  page = await newAppPage(browser);
  await page.setInputFiles('#fileA', S('dup_A.csv'));
  await page.setInputFiles('#fileB', S('dup_B.csv'));
  await page.waitForSelector('#stepMap:not(.hidden)');
  await page.click('#runBtn');
  await page.waitForSelector('#stepRes:not(.hidden)');
  r = await page.evaluate(() => ({ dupA: RESULT.dupA, dupB: RESULT.dupB, warn: RESULT.warns.join(' ') }));
  console.log('DUP:', JSON.stringify(r));
  check('duplicate posting detected on side A only', r.dupA === 1 && r.dupB === 0 && /διπλοεγγραφ|duplicate/i.test(r.warn), r);
  await page.close();

  /* ============ 5. same-day N-to-M proposal (no-key mode) ============ */
  page = await newAppPage(browser);
  await page.setInputFiles('#fileA', S('nm_A.csv'));
  await page.setInputFiles('#fileB', S('nm_B.csv'));
  await page.waitForSelector('#stepMap:not(.hidden)');
  await page.evaluate(() => {
    ['A', 'B'].forEach(s => document.querySelectorAll('#keys' + s + ' input').forEach(x => { x.checked = false; x.closest('.keychip').classList.toggle('on', false); }));
    document.getElementById('flipB').checked = false;
    document.getElementById('nokeyon').checked = true;
    document.getElementById('nokeydays').value = 7;
  });
  await page.click('#runBtn');
  await page.waitForSelector('#stepRes:not(.hidden)');
  r = await page.evaluate(() => ({
    nm: RESULT.props.filter(p => p.nm).map(p => [p.itemsA.length, p.itemsB.length, +p.diff.toFixed(2)]),
  }));
  console.log('NM:', JSON.stringify(r));
  check('same-day 2-vs-3 batch proposed with zero difference',
    r.nm.length === 1 && JSON.stringify(r.nm[0]) === JSON.stringify([2, 3, 0]), r.nm);
  /* commit it and confirm export block formula */
  await page.evaluate(() => { RESULT.props.forEach(p => p.accepted = true); commitGroups(); });
  const [dlNm] = await Promise.all([page.waitForEvent('download'), page.evaluate(() => exportExcel())]);
  const nmPath = path.join(__dirname, 'export_nm.xlsx');
  await dlNm.saveAs(nmPath);
  const wbNm = XLSX.read(fs.readFileSync(nmPath), { type: 'buffer', cellFormula: true });
  const wsGnm = wbNm.Sheets['Ομάδες'];
  check('N-to-M group exports as one live block', wsGnm && wsGnm.G2 && /^SUM\(E2:E6\)-SUM\(F2:F6\)$/.test(wsGnm.G2.f || ''), wsGnm.G2 && wsGnm.G2.f);
  await page.close();

  /* ============ 6. v3.1: easy-pair proposals + column resize + no scroll-jump ============ */
  page = await newAppPage(browser);
  await page.setInputFiles('#fileA', S('easy_A.csv'));
  await page.setInputFiles('#fileB', S('easy_B.csv'));
  await page.waitForSelector('#stepMap:not(.hidden)');
  await page.evaluate(() => {
    ['A', 'B'].forEach(s => document.querySelectorAll('#keys' + s + ' input').forEach(x => { x.checked = false; x.closest('.keychip').classList.toggle('on', false); }));
    document.getElementById('flipB').checked = false;
    document.getElementById('nokeyon').checked = true;
    document.getElementById('nokeydays').value = 7;
  });
  await page.click('#runBtn');
  await page.waitForSelector('#stepRes:not(.hidden)');
  r = await page.evaluate(() => ({
    matched: RESULT.matched.length,
    tw: RESULT.props.filter(p => p.tw).map(p => [p.itemsA.length, p.itemsB.length, +p.diff.toFixed(2), p.itemsA[0].amtA]),
    rev: RESULT.props.filter(p => p.rev).map(p => [p.side, p.itemsA.length + p.itemsB.length, +p.diff.toFixed(2)]),
  }));
  console.log('EASY:', JSON.stringify(r));
  check('same-amount pair beyond the day window proposed as twin',
    r.tw.length === 1 && JSON.stringify(r.tw[0]) === JSON.stringify([1, 1, 0, 77.1]), r.tw);
  check('same-side debit/credit reversal proposed',
    r.rev.length === 1 && JSON.stringify(r.rev[0]) === JSON.stringify(['A', 2, 0]), r.rev);
  /* committing both easy pairs empties the open lists */
  r = await page.evaluate(() => {
    RESULT.props.forEach(p => p.accepted = true); commitGroups();
    return { openLeft: [RESULT.onlyA.filter(x => !inAccepted(x)).length, RESULT.onlyB.filter(x => !inAccepted(x)).length],
             keys: RESULT.matched.filter(x => x.rule === 4).map(x => x.key) };
  });
  check('committed easy pairs clear the open lists', JSON.stringify(r.openLeft) === JSON.stringify([0, 0]), r);
  check('committed easy pairs carry their tags',
    r.keys.some(k => /Αντιλογισμός|Reversal/.test(k)) && r.keys.some(k => /Ίδιο ποσό|Same amount/.test(k)), r.keys);
  const [dlE] = await Promise.all([page.waitForEvent('download'), page.evaluate(() => exportExcel())]);
  const easyPath = path.join(__dirname, 'export_easy.xlsx');
  await dlE.saveAs(easyPath);
  const wbE = XLSX.read(fs.readFileSync(easyPath), { type: 'buffer', cellFormula: true });
  const wsGE = wbE.Sheets['Ομάδες'];
  const gLabels = ['H2', 'H3', 'H4', 'H5'].map(a => wsGE && wsGE[a] && wsGE[a].v).filter(Boolean);
  check('Groups sheet labels the reversal and twin', gLabels.some(v => /Αντιλογισμός/.test(v)) && gLabels.some(v => /Ίδιο ποσό/.test(v)), gLabels);

  /* no scroll-jump: ticking a selection box must NOT rebuild the panes */
  r = await page.evaluate(() => {
    RESULT.activeTab = 'onlyA'; renderResults();
    const pane = document.getElementById('pane-onlyA');
    pane._marker = 'kept';
    // undo one committed group (and untick it) so an open row exists to tick
    uncommitGroup(0);
    RESULT.props.forEach(p => p.accepted = false); renderResults();
    const pane2 = document.getElementById('pane-onlyA');
    pane2._marker = 'kept2';
    const idx = RESULT.onlyA.findIndex(x => !inAccepted(x));
    toggleSel('onlyA', idx, true);
    return { sameNode: document.getElementById('pane-onlyA')._marker === 'kept2',
             selInfo: document.getElementById('selInfo').textContent };
  });
  check('ticking a row keeps the table DOM (no scroll reset)', r.sameNode === true && r.selInfo.length > 0, r);

  /* column resize: grips exist, widths persist across re-renders */
  r = await page.evaluate(() => {
    const grips = document.querySelectorAll('#pane-onlyA .colgrip').length;
    COLW.onlyA = [40, 120, 90];
    renderResults();
    const table = document.querySelector('#pane-onlyA table.grid');
    const th = table && table.tHead.rows[0].children[1];
    return { grips, fixed: table && table.classList.contains('fixedw'), w: th && th.style.width,
             clip: !!document.querySelector('#pane-onlyA td.clip') };
  });
  console.log('COLS:', JSON.stringify(r));
  check('header grips rendered and widths survive a re-render', r.grips > 0 && r.fixed === true && r.w === '120px', r);
  check('description cells are clipped with a tooltip', r.clip === true, r);
  await page.close();

  /* ============ 7. v3.2: fee sweep (1 vs 65) + live warnings ============ */
  page = await newAppPage(browser);
  await page.setInputFiles('#fileA', S('sweep_A.csv'));
  await page.setInputFiles('#fileB', S('sweep_B.csv'));
  await page.waitForSelector('#stepMap:not(.hidden)');
  await page.evaluate(() => {
    ['A', 'B'].forEach(s => document.querySelectorAll('#keys' + s + ' input').forEach(x => { x.checked = false; x.closest('.keychip').classList.toggle('on', false); }));
    document.getElementById('flipB').checked = false;
    document.getElementById('nokeyon').checked = true;
    document.getElementById('nokeydays').value = 7;
  });
  await page.click('#runBtn');
  await page.waitForSelector('#stepRes:not(.hidden)');
  r = await page.evaluate(() => ({
    props: RESULT.props.filter(p => p.members).map(p => [p.side, p.members.length, +p.diff.toFixed(2)]),
  }));
  console.log('SWEEP:', JSON.stringify(r));
  check('one charges entry proposed against all 65 fee lines',
    r.props.length === 1 && JSON.stringify(r.props[0]) === JSON.stringify(['A', 65, 0]), r.props);
  r = await page.evaluate(() => {
    RESULT.props.forEach(p => p.accepted = true); commitGroups();
    return [RESULT.onlyA.filter(x => !inAccepted(x)).length, RESULT.onlyB.filter(x => !inAccepted(x)).length];
  });
  check('committing the sweep clears both sides', JSON.stringify(r) === JSON.stringify([0, 0]), r);
  await page.close();

  /* live warnings: the no-key duplicate alert clears once the items are explained */
  page = await newAppPage(browser);
  await page.setInputFiles('#fileA', S('warn_A.csv'));
  await page.setInputFiles('#fileB', S('warn_B.csv'));
  await page.waitForSelector('#stepMap:not(.hidden)');
  await page.evaluate(() => {
    ['A', 'B'].forEach(s => document.querySelectorAll('#keys' + s + ' input').forEach(x => { x.checked = false; x.closest('.keychip').classList.toggle('on', false); }));
    document.getElementById('flipB').checked = false;
    document.getElementById('nokeyon').checked = true;
    document.getElementById('nokeydays').value = 7;
  });
  await page.click('#runBtn');
  await page.waitForSelector('#stepRes:not(.hidden)');
  r = await page.evaluate(() => {
    const w = document.getElementById('resWarn');
    const before = { shown: !w.classList.contains('hidden'), text: w.textContent };
    RESULT.props.forEach(p => p.accepted = true); commitGroups();
    const after = { shown: !document.getElementById('resWarn').classList.contains('hidden') };
    return { before, after };
  });
  console.log('LIVEWARN:', JSON.stringify(r));
  check('duplicate warning shows while the identical fees are open',
    r.before.shown === true && /διπλοεγγραφ|duplicate/i.test(r.before.text), r.before);
  check('duplicate warning clears after the group is committed', r.after.shown === false, r.after);
  await page.close();

  /* ============ 8. v3.3: adjusted pair — the real 05.2026 HNS miss ============ */
  page = await newAppPage(browser);
  await page.setInputFiles('#fileA', S('adj_A.csv'));
  await page.setInputFiles('#fileB', S('adj_B.csv'));
  await page.waitForSelector('#stepMap:not(.hidden)');
  await page.evaluate(() => {
    ['A', 'B'].forEach(s => document.querySelectorAll('#keys' + s + ' input').forEach(x => { x.checked = false; x.closest('.keychip').classList.toggle('on', false); }));
    document.getElementById('flipB').checked = false;
    document.getElementById('nokeyon').checked = true;
    document.getElementById('nokeydays').value = 90;
  });
  await page.click('#runBtn');
  await page.waitForSelector('#stepRes:not(.hidden)');
  r = await page.evaluate(() => ({
    adj: RESULT.props.filter(p => p.adj).map(p => [p.itemsA.length, p.itemsB.length, +p.diff.toFixed(2),
      p.itemsA.map(x => x.amtA), p.itemsB.map(x => x.amtB)]),
  }));
  console.log('ADJ:', JSON.stringify(r));
  check('near pair + FX line proposed as one zero-diff group',
    r.adj.length === 1 && r.adj[0][0] === 2 && r.adj[0][1] === 1 && r.adj[0][2] === 0 &&
    JSON.stringify(r.adj[0][3].sort()) === JSON.stringify([-8818.4, 0.13]) &&
    JSON.stringify(r.adj[0][4]) === JSON.stringify([-8818.27]), r.adj);
  r = await page.evaluate(() => {
    RESULT.props.forEach(p => p.accepted = true); commitGroups();
    return { open: [RESULT.onlyA.filter(x => !inAccepted(x)).length, RESULT.onlyB.filter(x => !inAccepted(x)).length],
             key: RESULT.matched.filter(x => x.rule === 4).map(x => x.key) };
  });
  check('committing the adjusted pair clears everything', JSON.stringify(r.open) === JSON.stringify([0, 0]), r);
  check('the committed group carries the adjustment tag', r.key.some(k => /προσαρμογ|adjustment/i.test(k)), r.key);
  await page.close();

  /* ============ 9. v3.4: description fallback (Text → Document Header Text) ============ */
  page = await newAppPage(browser);
  await page.setInputFiles('#fileA', S('dh_A.csv'));
  await page.setInputFiles('#fileB', S('dh_B.csv'));
  await page.waitForSelector('#stepMap:not(.hidden)');
  await page.evaluate(() => { document.getElementById('flipB').checked = true; });
  await page.click('#runBtn');
  await page.waitForSelector('#stepRes:not(.hidden)');
  r = await page.evaluate(() => ({
    desc: [document.getElementById('descA').value, document.getElementById('descB').value],
    m: RESULT.matched.map(x => [x.key, x.descA, x.descB]).sort(),
  }));
  console.log('DESCFB:', JSON.stringify(r));
  check('pairwise: blank Text falls back to Document Header Text',
    r.desc.every(d => d === 'Text') && r.m.length === 3 &&
    JSON.stringify(r.m[0]) === JSON.stringify(['D1', 'HDR ALPHA', 'HDR ALPHA B']) &&
    JSON.stringify(r.m[1]) === JSON.stringify(['D2', 'TXT BETA', 'TXT BETA B']), r);
  await page.close();

  await browser.close();
  console.log(failures ? 'V4 TESTS FAILED: ' + failures : 'V4 TESTS PASSED');
  process.exit(failures ? 1 : 0);
})();
