// Takes the screenshots the manuals use, against an eHire that runs on BASE with the demo data
// (init-db, seed-demo, seed-cases, load-holidays) and nothing else. Run by take-screenshots.sh, which builds that
// database; run it on a fresh database every time, because it submits and moves requests.
//
// Usage: node shoot.js <lang el|en> <out dir> <work dir>
// Writes <out dir>/<name>.png. The names are the ones the data files (user-*.js, admin-*.js) refer to.
const { chromium, devices } = require('playwright');
const path = require('path');
const fs = require('fs');
const { execFileSync } = require('child_process');

const [, , LANG, OUT, WORK] = process.argv;
const BASE = process.env.SHOT_BASE || 'http://127.0.0.1:5097';
const PW = 'demo-1234'; // the demo password seed-demo prints; demo data only
const PY = process.env.SHOT_PYTHON || 'python3';
const log = (...a) => console.log(LANG, ...a);
const T = LANG === 'el'
  ? { need: 'Η κλινική λειτουργεί με δύο ιατρούς λιγότερους από τον Σεπτέμβριο.', alt: 'Οι εφημερίες δεν καλύπτονται με υπερωρίες.',
      leaver: 'Άτομο Α (δείγμα)', send: 'Αποστολή', note: 'Προστέθηκε το οργανόγραμμα της κλινικής.', doc: 'Οργανόγραμμα κλινικής (δείγμα).pdf', action: 'Χρειάζεται ενέργεια' }
  : { need: 'The clinic has run two doctors short since September.', alt: 'The on-call rota cannot be covered by overtime.',
      leaver: 'Leaver A (sample)', send: 'Send', note: 'The clinic organisation chart is now attached.', doc: 'Clinic organisation chart (sample).pdf', action: 'Action needed' };

// A one-page PDF, enough for the upload check (the app checks the header, not the content).
function samplePdf() {
  const objs = ['<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] >>'];
  let body = '%PDF-1.4\n';
  const offsets = [];
  objs.forEach((o, i) => { offsets.push(body.length); body += (i + 1) + ' 0 obj\n' + o + '\nendobj\n'; });
  const xref = body.length;
  body += 'xref\n0 ' + (objs.length + 1) + '\n0000000000 65535 f \n' + offsets.map((n) => String(n).padStart(10, '0') + ' 00000 n \n').join('');
  body += 'trailer\n<< /Size ' + (objs.length + 1) + ' /Root 1 0 R >>\nstartxref\n' + xref + '\n%%EOF\n';
  return Buffer.from(body, 'latin1');
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch();
  const newPage = async (phone = false) => {
    const { defaultBrowserType, ...iphone } = devices['iPhone 13']; // eslint-disable-line no-unused-vars
    const ctx = await browser.newContext({ ...(phone ? iphone : { viewport: { width: 1280, height: 800 }, deviceScaleFactor: 2 }),
      acceptDownloads: true, locale: LANG === 'el' ? 'el-GR' : 'en-GB' });
    const pg = await ctx.newPage();
    // The side menu is sticky and one screen tall; in a tall capture it would float mid-page. Pin it to the top.
    // Not on a phone, where the menu is an off-canvas panel that must stay hidden.
    if (!phone) await ctx.addInitScript(() => document.addEventListener('DOMContentLoaded', () => {
      const st = document.createElement('style');
      st.textContent = '#ehire-side{position:static!important;height:auto!important;align-self:stretch}';
      document.head.appendChild(st);
    }));
    pg.setDefaultTimeout(10000);
    return pg;
  };
  const settle = async (p) => { await p.waitForLoadState('networkidle').catch(() => {}); await p.waitForTimeout(400); };
  const shot = async (p, name, opts = {}) => {
    const file = path.join(OUT, name + '.png');
    await settle(p);
    if (opts.sel) {
      const el = p.locator(opts.sel).first();
      await el.scrollIntoViewIfNeeded();
      // With opts.to, the capture runs from the top of `sel` to the bottom of `to`.
      const box = await p.evaluate(([a, b]) => {
        const r = document.querySelector(a).getBoundingClientRect();
        const e = b ? document.querySelector(b).getBoundingClientRect() : r;
        const top = Math.min(r.top, e.top), bottom = Math.max(r.bottom, e.bottom);
        const left = Math.min(r.left, e.left), right = Math.max(r.right, e.right);
        return { x: left + window.scrollX, y: top + window.scrollY, width: right - left, height: bottom - top };
      }, [opts.sel, opts.to || null]);
      const pad = opts.pad ?? 12;
      const width = await p.evaluate(() => document.documentElement.scrollWidth);
      const x = Math.max(0, box.x - pad);
      const clip = { x, y: Math.max(0, box.y - pad), width: Math.min(width - x, box.width + 2 * pad), height: box.height + 2 * pad };
      if (opts.maxH) clip.height = Math.min(clip.height, opts.maxH);
      await p.screenshot({ path: file, clip, fullPage: true });
    } else if (opts.top) {
      const width = p.viewportSize().width;
      await p.screenshot({ path: file, clip: { x: 0, y: 0, width, height: opts.top }, fullPage: true });
    } else {
      await p.screenshot({ path: file, fullPage: true });
    }
    log('shot', name);
  };
  const login = async (user, phone = false) => {
    const p = await newPage(phone);
    await p.goto(BASE + '/login?lang=' + LANG);
    await p.fill('#username', user);
    await p.fill('#password', PW);
    await p.click('button[type=submit]');
    await settle(p);
    await p.goto(BASE + '/requests?lang=' + LANG); // also stores the language on the user, so their emails use it
    await settle(p);
    return p;
  };
  const idOf = (p) => Number(new URL(p.url()).pathname.split('/')[2]);
  const card = '[data-ehire-card]';

  // Sign-in page, and the password help: the eye button and the keyboard line (a Greek letter typed)
  {
    const p = await newPage();
    await p.goto(BASE + '/login?lang=' + LANG);
    await shot(p, 'u01-login');
    await p.fill('#username', 'nic.requester');
    await p.click('#password');
    await p.keyboard.insertText('demo');
    await p.keyboard.insertText('δ');
    await shot(p, 'u27-login-password', { sel: 'img[src*="okypy_logo_full"]', to: 'form:has(#password)', pad: 16 });
    await p.context().close();
  }
  // The people who receive the sample emails read them in this language.
  for (const u of ['nic.hr', 'nic.sci']) { const q = await login(u); await q.context().close(); }

  // Requester: list, empty form, filled form, draft with a document, submit
  let newId, newNumber;
  {
    const p = await login('nic.requester');
    await shot(p, 'u02-list-requester', { top: 640 });
    await p.goto(BASE + '/requests/new');
    await settle(p);
    await p.click('button[name=intent][value=submit]');
    await shot(p, 'u05-validation', { sel: '#ehire-error-summary', maxH: 420 });
    await p.goto(BASE + '/requests/new');
    await settle(p);
    await p.selectOption('#f-directorate_id', { index: 1 });
    await settle(p);
    await p.selectOption('#f-facility_id', '1');
    await p.selectOption('#f-cost_centre_id', '1');
    await p.selectOption('#f-category', 'medical');
    await settle(p);
    await p.selectOption('#f-position_id', '1');
    await p.fill('#f-positions_count', '2');
    await settle(p);
    await p.selectOption('#f-oay_specialty_id', '1').catch(() => log('no specialty field'));
    await p.selectOption('#f-reason', 'resignation');
    await settle(p);
    await p.fill('#f-leavers-0-name', T.leaver);
    await p.fill('#f-leavers-0-leave_date', '30/09/2026');
    await p.selectOption('#f-leavers-0-employment', 'okypy_contract');
    await shot(p, 'u03-form-post', { top: 800 });
    await shot(p, 'u04-form-reason', { sel: '#f-leavers' });
    await p.fill('#f-need_text', T.need);
    await p.fill('#f-alternatives_text', T.alt);
    await p.check('#f-absence_flag-no');
    await settle(p);
    await p.check('#f-external_funding_flag-no').catch(() => log('no funding field'));
    await p.click('button[name=intent][value=draft]');
    await settle(p);
    newId = idOf(p);
    await p.setInputFiles('#ehire-docs-input', { name: T.doc, mimeType: 'application/pdf', buffer: samplePdf() });
    await p.dispatchEvent('#ehire-docs-input', 'change');
    await p.click('#ehire-docs-send');
    await shot(p, 'u06-documents', { sel: 'section:has(> #sec-documents)' });
    await p.click('button[name=intent][value=submit]');
    await settle(p);
    newNumber = (await p.locator('main h1').first().innerText()).trim();
    log('new number', newNumber);
    await shot(p, 'u07-submitted', { top: 800 });
    await p.goto(BASE + '/manuals');
    await shot(p, 'u28-manuals', { sel: 'main h1', to: 'main a[href*="/manuals/"]:last-of-type', pad: 16 });
    await p.context().close();
  }

  // Directorate Accountant: list with the out-of-office box, the card with the financial table, return
  {
    const p = await login('nic.accountant');
    await shot(p, 'u08-list-approver', { top: 620 });
    await shot(p, 'u20-ooo', { sel: 'section[aria-labelledby="ooo-title"]' });
    await p.goto(BASE + '/requests/' + newId + '?do=review');
    await settle(p);
    const c = p.locator(card).first();
    await c.locator('input[name=position][value=yes]').check();
    await c.locator('input[name=funds][value=yes]').check();
    const fill = async (n, v) => { const f = c.locator(`[name="${n}"]`); if (await f.count() && !(await f.getAttribute('readonly'))) await f.fill(v); };
    await c.locator('select[name=oay_specialty_id]').selectOption('1').catch(() => {});
    await fill('oay_data_month', '09/2026');
    await fill('payroll_to_month', '09/2026');
    const lines = ['visits', 'procedures', 'revenue', 'payroll_cost', 'headcount'];
    const vals = { prev_year: ['18.420', '3.150', '1.284.500,00', '1.010.200,00', '14'], ytd: ['13.905', '2.410', '968.300,00', '802.750,00', '13'] };
    for (const per of ['prev_year', 'ytd']) for (let i = 0; i < lines.length; i++) await fill(`fin.${per}.${lines[i]}`, vals[per][i]);
    await shot(p, 'u09-card-accountant', { sel: card });
    await c.locator('details summary').last().click();
    await shot(p, 'u14-return', { sel: card + ' details:has(input[value="return"])' });
    await c.locator('button[type=submit]', { hasText: T.send }).first().click();
    await settle(p);
    await p.context().close();
  }

  const cardShot = async (user, url, name) => {
    const p = await login(user);
    await p.goto(BASE + url);
    await shot(p, name, { sel: card });
    return p;
  };
  await (await cardShot('nic.hr', '/requests/' + newId + '?do=review', 'u10-card-hr')).context().close();
  await (await cardShot('lim.sci', '/requests/1?do=review', 'u11-card-opinion')).context().close();
  {
    const p = await cardShot('central.finmgmt', '/requests/2?do=review', 'u12-card-finmgmt');
    // The request page on a computer: two columns, the route and the history on the right
    await p.setViewportSize({ width: 1280, height: 1000 });
    await p.goto(BASE + '/requests/2');
    await settle(p);
    await p.evaluate(() => window.scrollTo(0, 0));
    await p.screenshot({ path: path.join(OUT, 'u24-request-desktop.png') });
    log('shot', 'u24-request-desktop');
    await p.context().close();
  }
  {
    // The same request on a phone: the action card with the key facts, then the route opened
    const p = await login('central.finmgmt', true);
    await p.goto(BASE + '/requests/2?do=review');
    await shot(p, 'u25-phone-card', { sel: card, pad: 8 });
    await p.locator('[data-ehire-route] > summary').click();
    await shot(p, 'u26-phone-route', { sel: 'div:has(> #sec-tracker)', pad: 8, maxH: 760 });
    await p.context().close();
  }
  await (await cardShot('central.ceo', '/requests/3?do=review', 'u16-card-ceo')).context().close();

  // Requester: returned request, resubmit, withdraw control
  {
    const p = await login('nic.requester');
    await p.goto(BASE + '/requests/6');
    await shot(p, 'u17-returned', { sel: 'section[aria-labelledby="ehire-returned-title"]' });
    await p.goto(BASE + '/requests/6/edit');
    await settle(p);
    await p.fill('#f-resubmit_note', T.note);
    await shot(p, 'u18-resubmit-note', { sel: 'section:has(> #sec-note)', pad: 16 });
    await p.click('button[name=intent][value=resubmit]');
    await settle(p);
    await p.goto(BASE + '/requests/' + newId);
    await settle(p);
    await p.locator('section:has(form[action*="/withdraw"]) summary').click();
    await shot(p, 'u19-withdraw', { sel: 'section:has(form[action*="/withdraw"])', pad: 16 });
    await p.context().close();
  }
  await (await cardShot('nic.sci', '/requests/6?do=review', 'u21-keep-answer')).context().close();
  {
    const p = await login('lim.requester');
    await p.goto(BASE + '/requests/4');
    await shot(p, 'u22-rejected', { top: 640 });
    await p.context().close();
  }

  // Administrator pages
  {
    const p = await login('demo.admin');
    await shot(p, 'a01-admin-list', { top: 560 });
    await p.goto(BASE + '/manuals');
    await shot(p, 'a15-manuals-admin', { sel: 'main h1', to: 'main a[href*="/manuals/"]:last-of-type', pad: 16 });
    await p.goto(BASE + '/settings/users');
    await shot(p, 'a02-settings', { sel: '#ehire-side img', to: '#ehire-side details:has(a[href*="/settings/users"])', pad: 0 });
    // A new temporary password: open the control under one user's row
    const pwRow = p.locator('details:has(form[action*="/password"])').nth(1);
    await pwRow.locator('summary').click();
    await pwRow.evaluate((d) => d.setAttribute('data-shot', '1'));
    await p.evaluate(() => { const d = document.querySelector('details[data-shot]'); d.previousElementSibling.setAttribute('data-shot-row', '1'); });
    await shot(p, 'a16-users-password', { sel: 'form[data-shot-row]', to: 'details[data-shot]' });
    await p.goto(BASE + '/settings/roles');
    await shot(p, 'a17-roles-others', { sel: 'section[aria-labelledby=roles-other]' });
    for (const [url, name, top] of [['/settings/directorate', 'a03-directorates', 640], ['/settings/position', 'a18-positions', 640], ['/settings/facility', 'a04-facilities', 640],
      ['/settings/users', 'a05-users', 700], ['/settings/roles', 'a06-roles', 800], ['/settings/holidays', 'a07-holidays', 720],
      ['/settings/timings', 'a08-timings', 720], ['/settings/outbox', 'a09-outbox', 640]]) {
      await p.goto(BASE + url);
      await shot(p, name, { top });
    }
    // One email that asks for action, about the request made above
    const row = p.locator('tr', { hasText: newNumber }).filter({ hasText: T.action });
    await row.locator('a[href*="/settings/outbox/"]').first().click();
    await settle(p);
    const mail = p.frameLocator('iframe').locator('body > table').first();
    await mail.screenshot({ path: path.join(OUT, 'u23-email.png') });
    log('shot', 'u23-email');
    await p.goto(BASE + '/settings/archive');
    await shot(p, 'a10-archive', { top: 640 });
    await p.goto(BASE + '/settings/import');
    await shot(p, 'a11-import');
    const dl = p.waitForEvent('download');
    await p.click('a[href*="import/template"]');
    const tpl = path.join(WORK, LANG + '-template.xlsx');
    await (await dl).saveAs(tpl);
    const bad = path.join(WORK, LANG + '-bad.xlsx'), good = path.join(WORK, LANG + '-good.xlsx');
    execFileSync(PY, [path.join(__dirname, 'make-import-files.py'), tpl, bad, good], { stdio: 'inherit' });
    await p.setInputFiles('#import-file', bad);
    await p.click('form[enctype] button[type=submit]');
    await shot(p, 'a12-import-errors', { sel: 'main', maxH: 720 });
    await p.goto(BASE + '/settings/import');
    await p.setInputFiles('#import-file', good);
    await p.click('form[enctype] button[type=submit]');
    await shot(p, 'a13-import-preview', { sel: 'main', maxH: 560 });
    await p.goto(BASE + '/audit');
    await shot(p, 'a14-audit', { top: 760 });
    await p.context().close();
  }
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
