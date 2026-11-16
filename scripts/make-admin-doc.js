// Builds the server set-up instructions for the eHR server administrator.
const fs = require('fs');
const {
  Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell, Header, Footer, ImageRun,
  AlignmentType, HeadingLevel, WidthType, ShadingType, BorderStyle, LevelFormat, PageNumber, TabStopType,
} = require('docx');

const [, , LOGO, OUT, RELEASE, SHA] = process.argv;
const FONT = 'Lato', MONO = 'Consolas';
const DEEP = '1B75BB', BLUE = '069FEC', TEXT = '3F4042', GREY = '58595B', LINE = 'DCDFE3', TINT = 'EEF5FB';
const W = 9026; // A4 text width in DXA with 1-inch margins

const run = (t, o = {}) => new TextRun({ text: t, font: FONT, size: 21, color: TEXT, ...o });
const p = (t, o = {}) => new Paragraph({ spacing: { after: 110, line: 290 }, ...o, children: Array.isArray(t) ? t : [run(t)] });
const h1 = (t) => new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun({ text: t, font: FONT })] });
const h2 = (t) => new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun({ text: t, font: FONT })] });
const bullet = (t) => new Paragraph({ numbering: { reference: 'bul', level: 0 }, spacing: { after: 60, line: 280 }, children: Array.isArray(t) ? t : [run(t)] });
const step = (t, ref = 'num') => new Paragraph({ numbering: { reference: ref, level: 0 }, spacing: { after: 80, line: 280 }, children: Array.isArray(t) ? t : [run(t)] });
const mono = (t) => run(t, { font: MONO, size: 19 });
const code = (lines) => (Array.isArray(lines) ? lines : [lines]).map((l, i, a) => new Paragraph({
  shading: { type: ShadingType.CLEAR, fill: 'F4F5F7', color: 'auto' },
  spacing: { before: i === 0 ? 60 : 0, after: i === a.length - 1 ? 140 : 0, line: 260 },
  indent: { left: 120, right: 120 },
  children: [new TextRun({ text: l, font: MONO, size: 18, color: '1F2328' })],
}));

const border = { style: BorderStyle.SINGLE, size: 4, color: LINE };
const borders = { top: border, bottom: border, left: border, right: border };
function table(widths, head, rows, monoCols = []) {
  const cell = (t, i, isHead) => new TableCell({
    width: { size: widths[i], type: WidthType.DXA }, borders,
    margins: { top: 70, bottom: 70, left: 110, right: 110 },
    shading: isHead ? { type: ShadingType.CLEAR, fill: TINT, color: 'auto' } : undefined,
    children: [new Paragraph({ spacing: { after: 0, line: 270 }, children: [
      isHead ? run(t, { bold: true, color: DEEP, size: 20 })
        : (monoCols.includes(i) ? new TextRun({ text: t, font: MONO, size: 18, color: '1F2328' }) : run(t, { size: 20 }))] })],
  });
  return new Table({
    width: { size: W, type: WidthType.DXA }, columnWidths: widths,
    rows: [new TableRow({ tableHeader: true, children: head.map((t, i) => cell(t, i, true)) }),
      ...rows.map((r) => new TableRow({ cantSplit: true, children: r.map((t, i) => cell(t, i, false)) }))],
  });
}
const gap = () => new Paragraph({ spacing: { after: 120 }, children: [] });

const c = [];
c.push(new Paragraph({ spacing: { after: 60 }, children: [new TextRun({ text: 'eHR: server set-up instructions', font: FONT, size: 44, bold: true, color: DEEP })] }));
c.push(p([run('For the server administrator', { color: GREY }), run('  ·  16/11/2026  ·  release ' + RELEASE, { color: GREY })], { spacing: { after: 240 } }));

c.push(p('eHR is a new web application of ΟΚΥπΥ. Its first module, «Έγκριση Θέσεων», handles requests to fill a post. It runs on the shared Linux server next to eFinance and eArchive, as its own service with its own user, port, database and folders. It shares nothing with the other applications.'));
c.push(p('This note lists what to create, every setting to fill in, the order of the first install, and the checks that show it works. It holds no passwords, tokens or secrets. Where a secret is needed, the note says which setting takes it and who provides it.'));

c.push(h1('1. Rules for this server'));
c.push(bullet('Never restart or stop another application\'s service. Only ehr.service is touched.'));
c.push(bullet('eHR runs as its own system user, ehr. That user owns nothing outside the eHR folders.'));
c.push(bullet('A release is staged with its checksum and verified before it is unpacked.'));
c.push(bullet('The database and the documents folder are backed up together before any install or upgrade.'));
c.push(bullet('Secrets live only in the settings file, readable by root and the ehr group. They are never put in email, chat, the database or a repository.'));

c.push(h1('2. What the server needs'));
c.push(table([2700, 6326], ['Item', 'Detail'], [
  ['Python', '3.10, with the venv module.'],
  ['Time zones', 'The tzdata package. eHR refuses to start without it.'],
  ['LibreOffice', 'For Word and Excel previews and for the PDF sent to eArchive. Version 7.3.7 is already installed at /usr/bin/soffice.'],
  ['Database', 'None to install. eHR uses one SQLite file, as eFinance does.'],
  ['Web server', 'nginx in front, with a host name and certificate from IT, when eHR is published to users.'],
  ['Outbound access', 'Microsoft Graph (login.microsoftonline.com and graph.microsoft.com, port 443) for email. The domain controller on port 636 for sign-in. Nothing else.'],
]));
c.push(gap());

c.push(h1('3. User, folders and ownership'));
c.push(table([2500, 3900, 2626], ['What', 'Where', 'Owner and mode'], [
  ['System user and group', 'ehr (no login shell)', ''],
  ['Releases', '/opt/ehr/releases/ehr-<version>/', 'ehr'],
  ['Live release', '/opt/ehr/current (a link to one release)', 'ehr'],
  ['Python environment', '/opt/ehr/venv', 'ehr'],
  ['Staging', '/opt/ehr/staging', 'ehr'],
  ['Settings file', '/etc/ehr/ehr.env', 'root:ehr, 640'],
  ['AD CA certificate', '/etc/ehr/ad-ca.pem', 'root:ehr, 640'],
  ['Database', '/var/lib/ehr/ehr.sqlite3', 'ehr'],
  ['Documents', '/var/lib/ehr/storage', 'ehr'],
  ['Backups', '/var/backups/ehr/<timestamp>/', 'ehr'],
  ['Logs', '/var/log/ehr/', 'ehr'],
  ['Service', 'ehr.service', ''],
], [1]));
c.push(p('The folder /var/lib/ehr must be writable by ehr. While eHR runs, two more files appear beside the database (ehr.sqlite3-wal and ehr.sqlite3-shm). That is normal.', { spacing: { before: 120, after: 110 } }));

c.push(h1('4. Port and network'));
c.push(table([2700, 6326], ['Item', 'Value'], [
  ['Listen address', '127.0.0.1:5008. Port 5006 is taken; 5008 and 5009 were free on 14/11/2026.'],
  ['Workers', 'One gunicorn worker. eHR refuses to start with more on SQLite.'],
  ['Reached by users', 'Through nginx only. eHR itself listens on the server\'s loopback address.'],
  ['Talks to eArchive', 'http://127.0.0.1:5011, directly. Never through nginx or Cloudflare: eArchive refuses such calls.'],
  ['Receives from eArchive', 'http://127.0.0.1:5008/api/v1/archive-events, loopback only.'],
  ['Health check', 'http://127.0.0.1:5008/healthz answers {"status":"ok"}.'],
]));
c.push(gap());

c.push(h1('5. The settings file'));
c.push(p('Create /etc/ehr/ehr.env from deploy/ehr.env.example in the release. One NAME=value per line, no spaces around the equals sign. The tables below give each value or say where it comes from. Settings not listed keep the default in the template.'));

c.push(h2('Core'));
c.push(table([3000, 3200, 2826], ['Setting', 'Value', 'Note'], [
  ['EHR_ENV', 'production', 'Turns on the start-up safety checks.'],
  ['EHR_SECRET_KEY', '48 random characters', 'Generate on the server (command below). Never reuse another app\'s key.'],
  ['EHR_DATABASE_URI', 'sqlite:////var/lib/ehr/ehr.sqlite3', 'Four slashes.'],
  ['EHR_BASE_URL', 'the address users open', 'The button in every email points here.'],
  ['EHR_HTTPS', 'true', 'When users reach eHR over HTTPS.'],
  ['EHR_PROXY_HOPS', '1', 'Number of proxies in front. 0 if none. A wrong value records the wrong address in the audit log.'],
  ['EHR_BIND', '127.0.0.1:5008', ''],
  ['EHR_WORKERS', '1', ''],
  ['EHR_TIMEZONE', 'Europe/Nicosia', ''],
  ['EHR_STORAGE_DIR', '/var/lib/ehr/storage', ''],
], [0, 1]));
c.push(p('Generate the secret key:', { spacing: { before: 140, after: 40 } }));
c.push(...code('python3 -c "import secrets; print(secrets.token_urlsafe(48))"'));

c.push(h2('Sign-in with Active Directory'));
c.push(p('Local accounts work without this. Leave EHR_AD_ENABLED=false until the values below are in hand.'));
c.push(table([3000, 3200, 2826], ['Setting', 'Value', 'From'], [
  ['EHR_AD_ENABLED', 'true', ''],
  ['EHR_AD_SERVER', 'domain controller host name', 'IT. Exactly as written in its certificate.'],
  ['EHR_AD_PORT', '636', 'LDAPS only.'],
  ['EHR_AD_DOMAIN', 'the domain', 'IT. Users sign in as name@domain.'],
  ['EHR_AD_BASE_DN', 'the search base', 'IT.'],
  ['EHR_AD_UID_ATTRIBUTE', 'sAMAccountName', 'Change only if IT says so.'],
  ['EHR_AD_CA_FILE', '/etc/ehr/ad-ca.pem', 'IT: the internal CA certificate as a PEM file.'],
], [0, 1]));
c.push(p('eHR checks the domain controller\'s certificate against that CA file and refuses plain LDAP. A person\'s first sign-in creates an inactive account; an eHR administrator activates it and gives it a role.', { spacing: { before: 120, after: 110 } }));

c.push(h2('Email through Microsoft Graph'));
c.push(p('eHR has its own app registration and its own sender mailbox, separate from eFinance.'));
c.push(table([3000, 3200, 2826], ['Setting', 'Value', 'From'], [
  ['EHR_GRAPH_TENANT', 'tenant id', 'IT.'],
  ['EHR_GRAPH_CLIENT_ID', 'application (client) id', 'IT.'],
  ['EHR_GRAPH_CLIENT_SECRET', 'client secret', 'IT. Note its expiry date.'],
  ['EHR_GRAPH_SENDER', 'eHR\'s sender mailbox', 'IT.'],
], [0]));
c.push(p('The registration needs the Mail.Send application permission, limited by an access policy to eHR\'s mailbox. Email stays switched off inside eHR until an eHR administrator turns it on, so nothing is sent during set-up.', { spacing: { before: 120, after: 110 } }));

c.push(h2('eArchive'));
c.push(table([3000, 3200, 2826], ['Setting', 'Value', 'From'], [
  ['EHR_ARCHIVE_URL', 'http://127.0.0.1:5011', 'Fixed.'],
  ['EHR_ARCHIVE_TOKEN', 'eArchive\'s token for eHR', 'Copied from EHR_INGEST_TOKEN in /opt/emetroon/.env, file to file.'],
  ['EHR_ARCHIVE_WEB_URL', 'leave empty for now', 'eArchive\'s public web address, once IT has published it.'],
], [0, 1]));
c.push(p('Copy the token without printing it on screen. The exact commands are in deploy/README.md, section "eArchive deposits". Afterwards this command must print 1:', { spacing: { before: 120, after: 40 } }));
c.push(...code("sudo grep -c '^EHR_ARCHIVE_TOKEN=.' /etc/ehr/ehr.env"));

c.push(h2('Leave empty'));
c.push(bullet('The EHR_SMTP_* settings. Email goes through Graph.'));
c.push(bullet('The EHR_EFINANCE_* settings. That link is not in use.'));
c.push(bullet('EHR_ARCHIVE_DROP_DIR. It belongs to a transport that is not used.'));

c.push(h1('6. What to ask IT for'));
c.push(table([4300, 4726], ['Item', 'Used for'], [
  ['Host name and certificate for eHR, and the nginx block', 'Publishing eHR to users'],
  ['Domain controller host name, domain, search base DN', 'Sign-in'],
  ['Internal CA certificate as a PEM file', 'Sign-in'],
  ['Tenant id, client id, client secret, sender mailbox of eHR\'s own app registration', 'Email'],
  ['Where the nightly backup folder is copied to', 'Backup'],
]));
c.push(gap());

c.push(h1('7. First install, in order'));
c.push(p([run('Commands marked '), run('(sudo)', { bold: true }), run(' run as root. All others run as the ehr user.')]));
c.push(step([run('(sudo) ', { bold: true }), run('Create the ehr user and group and the folders in section 3, with the owners shown.')]));
c.push(step('Put the release tarball and its .sha256 file in /opt/ehr/staging. Verify it. The answer must be "ok".'));
c.push(...code('scripts/verify-release.sh /opt/ehr/staging/ehr-' + RELEASE + '.tar.gz'));
c.push(step('Unpack it into /opt/ehr/releases/ and point /opt/ehr/current at it.'));
c.push(...code(['tar -xzf /opt/ehr/staging/ehr-' + RELEASE + '.tar.gz -C /opt/ehr/releases/', 'ln -sfn /opt/ehr/releases/ehr-' + RELEASE + ' /opt/ehr/current']));
c.push(step('Create the Python environment and install the packages. With no internet on the server, build a wheel folder elsewhere and install from it.'));
c.push(...code(['python3 -m venv /opt/ehr/venv', '/opt/ehr/venv/bin/pip install -r /opt/ehr/current/requirements.txt']));
c.push(step([run('(sudo) ', { bold: true }), run('Write /etc/ehr/ehr.env as in section 5. Owner root, group ehr, mode 640. Put the CA file in place with the same owner and mode.')]));
c.push(step('From /opt/ehr/current, create the tables.'));
c.push(...code('scripts/ehr-cli.sh init-db'));
c.push(step('Create the first administrator. It asks for a user name, a full name and a password, twice. The password is typed, never given on the command line.'));
c.push(...code('scripts/ehr-cli.sh create-admin'));
c.push(step('Run the pre-flight check and fix every line marked FAIL.'));
c.push(...code('scripts/preflight.sh'));
c.push(step([run('(sudo) ', { bold: true }), run('Install ehr.service from deploy/ehr.service.example and start it. Start only this service.')]));
c.push(...code(['systemctl enable ehr', 'systemctl start ehr']));
c.push(step('Install the scheduled jobs in section 8 for the ehr user.'));
c.push(step([run('(sudo) ', { bold: true }), run('Add the nginx block for eHR and reload nginx, once IT has supplied the name and certificate.')]));
c.push(step('Run the checks in section 11.'));
c.push(p([run('Do not run seed-demo or seed-cases on this server. ', { bold: true }), run('They load test users that share a known password. They refuse to run when EHR_ENV=production.')], { spacing: { before: 100, after: 110 } }));

c.push(h1('8. Scheduled jobs'));
c.push(p('Four cron lines for the ehr user. They read the same settings file as the service.'));
c.push(table([3000, 2000, 4026], ['Job', 'When', 'What it does'], [
  ['run-timers', 'Hourly, 07:00 to 17:00, Monday to Friday', 'Reminders, escalations and automatic withdrawal of returned requests.'],
  ['send-mail', 'Every 5 minutes', 'Sends queued email and retries failures.'],
  ['send-archive', 'Every 5 minutes', 'Makes the PDF of each request and sends it to eArchive.'],
  ['Backup', 'Nightly at 01:30', 'Database, then documents folder. See section 9.'],
], [0]));
c.push(...code([
  '0 7-17 * * 1-5  /opt/ehr/current/scripts/ehr-cli.sh run-timers >> /var/log/ehr/timers.log 2>&1',
  '*/5 * * * *     /opt/ehr/current/scripts/ehr-cli.sh send-mail >> /var/log/ehr/mail.log 2>&1',
  '*/5 * * * *     /opt/ehr/current/scripts/ehr-cli.sh send-archive >> /var/log/ehr/archive.log 2>&1',
]));
c.push(p('The backup line is long; copy it from deploy/README.md, section "Backup and restore". Rotate the four log files with logrotate.'));

c.push(h1('9. Backup and restore'));
c.push(bullet([run('Never copy ehr.sqlite3 with cp or a file backup while eHR runs. ', { bold: true }), run('Part of the data sits in a second file, so a plain copy can be incomplete.')]));
c.push(bullet('Use the backup-db command. It is safe while eHR is running, never overwrites a file, and prints the checksum of the copy.'));
c.push(...code('scripts/ehr-cli.sh backup-db /var/backups/ehr/<timestamp>/ehr.sqlite3'));
c.push(bullet('Back up the documents folder straight after, into the same timestamp folder. The two belong together: one without the other is not a backup.'));
c.push(bullet('Copy each night\'s folder off the server and keep 30 days.'));
c.push(bullet('To restore: stop only ehr, move the three database files and the storage folder aside, put both parts of one backup in place, run upgrade-db if the backup is older than the code, start ehr, and check /healthz. The full steps are in deploy/README.md.'));
c.push(bullet('Test a restore on a spare machine once a quarter.'));

c.push(h1('10. Switching on the link to eArchive'));
c.push(p('Do this after eArchive\'s own deployment that adds eHR (its database version 30) is live. Until then eHR keeps its deposits in a queue and loses nothing.'));
c.push(step('Confirm eArchive answers on 127.0.0.1:5011.', 'num2'));
c.push(step('Copy the token into /etc/ehr/ehr.env as EHR_ARCHIVE_TOKEN (section 5).', 'num2'));
c.push(step('Restart only ehr so it reads the token, then switch the transport on.', 'num2'));
c.push(...code('scripts/ehr-cli.sh archive-transport http'));
c.push(step('Ask the eHR administrator to set the eArchive site code of every hospital and facility, in eHR under Settings. A request for a facility without a code waits until the code is set.', 'num2'));
c.push(step('Give the eArchive side this address for its notices, as its EHR_EVENTS_URL: http://127.0.0.1:5008/api/v1/archive-events', 'num2'));
c.push(step('In eHR, Settings, "eArchive deposits" shows each deposit and its protocol number. A row marked as needing attention shows eArchive\'s reason.', 'num2'));
c.push(step('To list the facilities that still have no site code, for the eArchive side to add:', 'num2'));
c.push(...code('scripts/ehr-cli.sh archive-sites'));
c.push(p('A request for a site that eArchive does not know yet is held and tried again once a day. It is never filed under another site. eHR shows only the eArchive protocol number until eArchive\'s web application is published. When the eArchive side gives its final web address, put it in EHR_ARCHIVE_WEB_URL and restart only ehr: the number then becomes a link on every request, old ones included.', { spacing: { before: 60, after: 110 } }));

c.push(h1('11. Checks after the install'));
c.push(table([4700, 4326], ['Check', 'Expected'], [
  ['curl -s http://127.0.0.1:5008/healthz', '{"status":"ok"}'],
  ['scripts/ehr-cli.sh db-status', 'pending=0'],
  ['scripts/preflight.sh', 'No FAIL lines'],
  ['scripts/verify-release.sh --dir /opt/ehr/current', 'ok: installed files match the release'],
  ['scripts/ehr-cli.sh ad-test <username>', 'The person\'s name and email, or the reason it failed'],
  ['Sign in as the administrator in a browser', 'The list of requests opens; Settings and the audit log open'],
  ['systemctl status of the other applications', 'Unchanged'],
], [0]));
c.push(gap());

c.push(h1('12. Upgrades and rollback'));
c.push(step('Back up the database and the documents folder. Note the time.', 'num3'));
c.push(step('Stage and verify the new release, and unpack it beside the old one.', 'num3'));
c.push(step([run('(sudo) ', { bold: true }), run('Stop only ehr.')], 'num3'));
c.push(step('Point /opt/ehr/current at the new release and run scripts/ehr-cli.sh upgrade-db. Then db-status must print pending=0.', 'num3'));
c.push(step([run('(sudo) ', { bold: true }), run('Start ehr and run the checks in section 11.')], 'num3'));
c.push(p('To roll back: stop ehr, point /opt/ehr/current at the old release, restore the database and documents from the backup of step 1 if upgrade-db ran, and start ehr. eHR refuses to serve on a database that is behind the code, so a missed upgrade-db shows as "service is being upgraded", not as wrong data.', { spacing: { before: 100, after: 110 } }));

c.push(h1('13. Useful commands'));
c.push(table([4300, 4726], ['Command', 'Use'], [
  ['scripts/ehr-cli.sh unlock-user <username>', 'Clears a sign-in lock. Five wrong passwords lock a name for 15 minutes.'],
  ['scripts/ehr-cli.sh ad-test <username>', 'Tries an AD sign-in from the server and says what failed.'],
  ['scripts/ehr-cli.sh db-status', 'Shows whether the database matches the code.'],
  ['scripts/ehr-cli.sh archive-transport', 'Shows whether deposits go to eArchive.'],
  ['scripts/ehr-cli.sh archive-sites', 'Lists facilities and their eArchive site codes.'],
  ['journalctl -u ehr', 'The service log.'],
], [0]));
c.push(gap());

c.push(h1('14. Not yet tested on a real system'));
c.push(p('eHR was built and tested away from this server, against stand-ins. Treat these as things to watch on the first install, and report anything that differs:'));
c.push(bullet('The test suite on Python 3.10. It was run on 3.11; a checker confirms nothing newer than 3.9 is used.'));
c.push(bullet('Sign-in against the real domain controller, its certificate chain and attribute names.'));
c.push(bullet('Sending through the real Graph registration, and how the emails look in Outlook.'));
c.push(bullet('SQLite on this server\'s disk, and a restore.'));
c.push(bullet('The link to the real eArchive. It was built to eArchive\'s specification and its answers of 16/11/2026, and tested against a stand-in only. eArchive is running eHR\'s sample deposits through its own test.'));
c.push(bullet('The AD library (ldap3 2.9.1) does not run on Python 3.12. It is fine on 3.10.'));

c.push(h1('15. Release'));
c.push(table([2700, 6326], ['Item', 'Value'], [
  ['File', 'ehr-' + RELEASE + '.tar.gz'],
  ['SHA-256', SHA || 'see the .sha256 file sent with the release'],
  ['Full guide', 'deploy/README.md inside the release'],
  ['Settings template', 'deploy/ehr.env.example inside the release'],
  ['Day-to-day running', 'docs/operations.md inside the release'],
], [1]));

const numLevel = { level: 0, format: LevelFormat.DECIMAL, text: '%1.', alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 440, hanging: 440 } }, run: { font: FONT, bold: true, color: DEEP } } };
const doc = new Document({
  creator: 'eHR build', title: 'eHR: server set-up instructions',
  styles: {
    default: {
      document: { run: { font: FONT, size: 21, color: TEXT } },
      heading1: { run: { font: FONT, size: 28, bold: true, color: DEEP }, paragraph: { spacing: { before: 320, after: 130 }, keepNext: true } },
      heading2: { run: { font: FONT, size: 23, bold: true, color: TEXT }, paragraph: { spacing: { before: 220, after: 100 }, keepNext: true } },
    },
  },
  numbering: { config: [
    { reference: 'bul', levels: [{ level: 0, format: LevelFormat.BULLET, text: '•', alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 400, hanging: 260 } } } }] },
    { reference: 'num', levels: [numLevel] }, { reference: 'num2', levels: [numLevel] }, { reference: 'num3', levels: [numLevel] },
  ] },
  sections: [{
    properties: { page: { margin: { top: 1750, bottom: 1300, left: 1440, right: 1440, header: 500, footer: 500 } } },
    headers: { default: new Header({ children: [new Paragraph({
      border: { bottom: { style: BorderStyle.SINGLE, size: 12, color: BLUE, space: 6 } },
      tabStops: [{ type: TabStopType.RIGHT, position: W }],
      children: [new ImageRun({ type: 'png', data: fs.readFileSync(LOGO), transformation: { width: 96, height: 60 } }),
        new TextRun({ text: '\teHR · Έγκριση Θέσεων', font: FONT, size: 18, color: GREY })] })] }) },
    footers: { default: new Footer({ children: [new Paragraph({
      tabStops: [{ type: TabStopType.RIGHT, position: W }],
      children: [new TextRun({ text: 'eHR server set-up instructions · release ' + RELEASE, font: FONT, size: 16, color: GREY }),
        new TextRun({ children: ['\tPage ', PageNumber.CURRENT, ' of ', PageNumber.TOTAL_PAGES], font: FONT, size: 16, color: GREY })] })] }) },
    children: c,
  }],
});
Packer.toBuffer(doc).then((b) => { fs.writeFileSync(OUT, b); console.log('written', OUT, b.length); });
