// Builds the server set-up instructions for the eHire server administrator.
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
c.push(new Paragraph({ spacing: { after: 60 }, children: [new TextRun({ text: 'eHire: server set-up instructions', font: FONT, size: 44, bold: true, color: DEEP })] }));
c.push(p([run('For the server administrator', { color: GREY }), run('  ·  19/11/2026  ·  release ' + RELEASE, { color: GREY })], { spacing: { after: 240 } }));

c.push(p('eHire is a new web application of ΟΚΥπΥ. Its first module, «Έγκριση Θέσεων», handles requests to fill a post. It runs on the shared Linux server next to eFinance and eArchive, as its own service with its own user, port, database and folders. It shares nothing with the other applications.'));
c.push(p('This note lists what to create, every setting to fill in, the order of the first install, and the checks that show it works. It holds no passwords, tokens or secrets. Where a secret is needed, the note says which setting takes it and who provides it.'));

c.push(h1('1. Rules for this server'));
c.push(bullet('Never restart or stop another application\'s service. Only ehire.service is touched.'));
c.push(bullet('eHire runs as its own system user, ehire. That user owns nothing outside the eHire folders.'));
c.push(bullet('A release is staged with its checksum and verified before it is unpacked.'));
c.push(bullet('The database and the documents folder are backed up together before any install or upgrade.'));
c.push(bullet('Secrets live only in the settings file, readable by root and the ehire group. They are never put in email, chat, the database or a repository.'));

c.push(h1('2. What the server needs'));
c.push(table([2700, 6326], ['Item', 'Detail'], [
  ['Python', '3.10, with the venv module.'],
  ['Time zones', 'The tzdata package. eHire refuses to start without it.'],
  ['LibreOffice', 'For Word and Excel previews and for the PDF sent to eArchive. Version 7.3.7 is already installed at /usr/bin/soffice.'],
  ['Database', 'None to install. eHire uses one SQLite file, as eFinance does.'],
  ['Published through', 'The Cloudflare tunnel, as https://ehire.shso.online. The tunnel runs on another machine and connects to this server at http://10.227.56.22:5008. No nginx block is needed.'],
  ['Firewall', 'A rule that lets only the tunnel\'s machine reach port 5008 on this server.'],
  ['Outbound access', 'Microsoft Graph (login.microsoftonline.com and graph.microsoft.com, port 443) for email. The domain controller on port 636 for sign-in. Nothing else.'],
]));
c.push(gap());

c.push(h1('3. User, folders and ownership'));
c.push(table([2500, 3900, 2626], ['What', 'Where', 'Owner and mode'], [
  ['System user and group', 'ehire (no login shell)', ''],
  ['Releases', '/opt/ehire/releases/ehire-<version>/', 'ehire'],
  ['Live release', '/opt/ehire/current (a link to one release)', 'ehire'],
  ['Python environment', '/opt/ehire/venv (a link to /opt/ehire/venv-<version>; the old one is kept for rollback)', 'ehire'],
  ['Staging', '/opt/ehire/staging', 'ehire'],
  ['Settings file', '/etc/ehire/ehire.env', 'root:ehire, 640'],
  ['AD CA certificate', '/etc/ehire/ad-ca.pem', 'root:ehire, 640'],
  ['Database', '/var/lib/ehire/ehire.sqlite3', 'ehire'],
  ['Documents', '/var/lib/ehire/storage', 'ehire'],
  ['Backups', '/var/backups/ehire/<timestamp>/', 'ehire'],
  ['Logs', '/var/log/ehire/', 'ehire'],
  ['Service', 'ehire.service', ''],
], [1]));
c.push(p('The folder /var/lib/ehire must be writable by ehire. While eHire runs, two more files appear beside the database (ehire.sqlite3-wal and ehire.sqlite3-shm). That is normal.', { spacing: { before: 120, after: 110 } }));

c.push(h1('4. Port and network'));
c.push(table([2700, 6326], ['Item', 'Value'], [
  ['Listen address', '0.0.0.0:5008. The tunnel reaches the server from another machine, so 127.0.0.1 is not enough. Port 5008 was free on 14/11/2026 and again on 19/11/2026.'],
  ['Workers', 'One gunicorn worker. eHire refuses to start with more on SQLite.'],
  ['Reached by users', 'https://ehire.shso.online, through the Cloudflare tunnel only. A 502 there means nothing is listening on 5008.'],
  ['Firewall', 'Port 5008 is plain HTTP. Allow it only from the tunnel\'s machine, so nobody on the internal network reaches eHire directly.'],
  ['Talks to eArchive', 'http://127.0.0.1:5011, directly. Never through nginx or Cloudflare: eArchive refuses such calls.'],
  ['Receives from eArchive', 'http://127.0.0.1:5008/api/v1/archive-events, loopback only.'],
  ['Health check', 'http://127.0.0.1:5008/healthz answers {"status":"ok"}.'],
]));
c.push(gap());

c.push(h1('5. The settings file'));
c.push(p('Create /etc/ehire/ehire.env from deploy/ehire.env.example in the release. One NAME=value per line, no spaces around the equals sign. The tables below give each value or say where it comes from. Settings not listed keep the default in the template.'));

c.push(h2('Core'));
c.push(table([3000, 3200, 2826], ['Setting', 'Value', 'Note'], [
  ['EHIRE_ENV', 'production', 'Turns on the start-up safety checks.'],
  ['EHIRE_SECRET_KEY', '48 random characters', 'Generate on the server (command below). Never reuse another app\'s key.'],
  ['EHIRE_DATABASE_URI', 'sqlite:////var/lib/ehire/ehire.sqlite3', 'Four slashes.'],
  ['EHIRE_BASE_URL', 'https://ehire.shso.online', 'The button in every email points here.'],
  ['EHIRE_HTTPS', 'true', 'When users reach eHire over HTTPS.'],
  ['EHIRE_PROXY_HOPS', '1', 'The tunnel is the one proxy. A wrong value records the wrong address in the audit log.'],
  ['EHIRE_BIND', '0.0.0.0:5008', 'Not 127.0.0.1: the tunnel connects from another machine.'],
  ['EHIRE_WORKERS', '1', ''],
  ['EHIRE_TIMEZONE', 'Europe/Nicosia', ''],
  ['EHIRE_STORAGE_DIR', '/var/lib/ehire/storage', ''],
], [0, 1]));
c.push(p('Generate the secret key:', { spacing: { before: 140, after: 40 } }));
c.push(...code('python3 -c "import secrets; print(secrets.token_urlsafe(48))"'));

c.push(h2('Sign-in with Active Directory'));
c.push(p('Local accounts work without this. Leave EHIRE_AD_ENABLED=false until the values below are in hand.'));
c.push(table([3000, 3200, 2826], ['Setting', 'Value', 'From'], [
  ['EHIRE_AD_ENABLED', 'true', ''],
  ['EHIRE_AD_SERVER', 'domain controller host name', 'IT. Exactly as written in its certificate.'],
  ['EHIRE_AD_PORT', '636', 'LDAPS only.'],
  ['EHIRE_AD_DOMAIN', 'the domain', 'IT. Users sign in as name@domain.'],
  ['EHIRE_AD_BASE_DN', 'the search base', 'IT.'],
  ['EHIRE_AD_UID_ATTRIBUTE', 'sAMAccountName', 'Change only if IT says so.'],
  ['EHIRE_AD_CA_FILE', '/etc/ehire/ad-ca.pem', 'IT: the internal CA certificate as a PEM file.'],
], [0, 1]));
c.push(p('eHire checks the domain controller\'s certificate against that CA file and refuses plain LDAP. A person\'s first sign-in creates an inactive account; an eHire administrator activates it and gives it a role.', { spacing: { before: 120, after: 110 } }));

c.push(h2('Email through Microsoft Graph'));
c.push(p('eHire has its own app registration and its own sender mailbox, separate from eFinance.'));
c.push(table([3000, 3200, 2826], ['Setting', 'Value', 'From'], [
  ['EHIRE_GRAPH_TENANT', 'tenant id', 'IT.'],
  ['EHIRE_GRAPH_CLIENT_ID', 'application (client) id', 'IT.'],
  ['EHIRE_GRAPH_CLIENT_SECRET', 'client secret', 'IT. Note its expiry date.'],
  ['EHIRE_GRAPH_SENDER', 'eHire\'s sender mailbox', 'IT.'],
], [0]));
c.push(p('The registration needs the Mail.Send application permission, limited by an access policy to eHire\'s mailbox. Email stays switched off inside eHire until an eHire administrator turns it on, so nothing is sent during set-up.', { spacing: { before: 120, after: 110 } }));

c.push(h2('eArchive'));
c.push(table([3000, 3200, 2826], ['Setting', 'Value', 'From'], [
  ['EHIRE_ARCHIVE_URL', 'http://127.0.0.1:5011', 'Fixed.'],
  ['EHIRE_ARCHIVE_TOKEN', 'eArchive\'s token for eHire', 'Copied from EHR_INGEST_TOKEN in /opt/emetroon/.env, file to file.'],
  ['EHIRE_ARCHIVE_WEB_URL', 'leave empty for now', 'eArchive\'s public web address, once IT has published it.'],
], [0, 1]));
c.push(p('Copy the token without printing it on screen. The exact commands are in deploy/README.md, section "eArchive deposits". Afterwards this command must print 1:', { spacing: { before: 120, after: 40 } }));
c.push(...code("sudo grep -c '^EHIRE_ARCHIVE_TOKEN=.' /etc/ehire/ehire.env"));

c.push(h2('Leave empty'));
c.push(bullet('The EHIRE_SMTP_* settings. Email goes through Graph.'));
c.push(bullet('The EHIRE_EFINANCE_* settings. The eFinance link (cost centres and budget check) stays switched off until eFinance has built its side; docs/operations.md says how to switch it on.'));
c.push(bullet('EHIRE_ARCHIVE_DROP_DIR. It belongs to a transport that is not used.'));

c.push(h1('6. What to ask IT for'));
c.push(table([4300, 4726], ['Item', 'Used for'], [
  ['The address of the machine that runs the Cloudflare tunnel, for the firewall rule on port 5008', 'Publishing eHire to users'],
  ['Domain controller host name, domain, search base DN', 'Sign-in'],
  ['Internal CA certificate as a PEM file', 'Sign-in'],
  ['Tenant id, client id, client secret, sender mailbox of eHire\'s own app registration', 'Email'],
  ['Where the nightly backup folder is copied to', 'Backup'],
]));
c.push(gap());

c.push(h1('7. First install, in order'));
c.push(p('The install is one command. The installer checks, backs up, installs, restarts and checks. It runs only as root and never calls sudo itself. It touches only the eHire folders, the ehire user and ehire.service. It never restarts another service, never touches nginx, apache or cron, and installs no cron lines.'));
c.push(step('Copy three files to one folder on the server: the tarball, its .sha256 file and install-ehire.sh. Read the script first. Compare the tarball checksum with the one in section 15 by a second route (phone or chat), not only the copy that travelled with the file.'));
c.push(step([run('(sudo) ', { bold: true }), run('Rehearse. It prints every action and changes nothing.')]));
c.push(...code('sudo bash install-ehire.sh --dry-run ehire-' + RELEASE + '.tar.gz'));
c.push(step([run('(sudo) ', { bold: true }), run('Install. With a terminal it prints the plan and asks once. With no terminal (SSH from PowerShell, a script) add --yes. With no internet on the server add --wheels <folder> (a folder of wheel files built elsewhere).')]));
c.push(...code('sudo bash install-ehire.sh ehire-' + RELEASE + '.tar.gz'));
c.push(step('Read the 14 lines [1/14] to [14/14]. Each ends in ok or the reason it stopped. The same text is saved in /var/log/ehire/install-<time>.log. The secret key is never shown or logged.'));
c.push(step('Create the first administrator. It asks for a user name, a full name and a password, twice, so the installer does not run it. The password is typed, never given on the command line.'));
c.push(...code('sudo -u ehire /opt/ehire/current/scripts/ehire-cli.sh create-admin'));
c.push(step([run('(sudo) ', { bold: true }), run('Add the firewall rule that lets only the tunnel\'s machine reach port 5008. The tunnel rule for ehire.shso.online already points at http://10.227.56.22:5008, so the address works as soon as eHire is running.')]));
c.push(step('Install the scheduled jobs in section 8 for the ehire user, including the nightly backup. The installer prints the lines but does not install them.'));
c.push(step('Put the values from the list in section 6 into /etc/ehire/ehire.env: the installer made the file with a new secret key, EHIRE_DATABASE_URI, EHIRE_STORAGE_DIR, EHIRE_BIND=0.0.0.0:5008 and AD sign-in off. Then run scripts/preflight.sh --skip-port as ehire, and restart only ehire.'));
c.push(step('Run the checks in section 11.'));
c.push(table([1700, 7326], ['Exit code', 'Meaning'], [
  ['0', 'Done, or nothing to do (the same release is already current and healthy).'],
  ['1', 'A guard failed before any change: not root, a bad name or checksum, tests not passed, Python older than 3.10, no time zone data, low disk, the port in use by something else, no terminal and no --yes. Nothing was changed.'],
  ['2', 'It failed and was rolled back, or it failed before anything live was touched.'],
  ['3', 'It failed and could not roll back cleanly (also any failed first install). The message says what exists and what to do. Nothing is deleted automatically.'],
], [0]));
c.push(gap());
c.push(p([run('If a first install stops, ', { bold: true }), run('fix the cause shown in the failed line and run the same command again. It resumes and keeps the settings file.')]));
c.push(p([run('If the installer cannot be used. ', { bold: true }), run('The manual steps are in deploy/README.md, section "First install by hand": create the user and folders (sudo), verify and unpack the release, create the Python environment, write /etc/ehire/ehire.env, run init-db, create-admin, preflight, install and start only ehire.service, then the scheduled jobs and the firewall rule. They give the same result.')]));
c.push(p([run('Do not run seed-demo or seed-cases on this server. ', { bold: true }), run('They load test users that share a known password. They refuse to run when EHIRE_ENV=production.')], { spacing: { before: 100, after: 110 } }));

c.push(h1('8. Scheduled jobs'));
c.push(p('Four cron lines for the ehire user. They read the same settings file as the service.'));
c.push(table([3000, 2000, 4026], ['Job', 'When', 'What it does'], [
  ['run-timers', 'Hourly, 07:00 to 17:00, Monday to Friday', 'Reminders, escalations and automatic withdrawal of returned requests.'],
  ['send-mail', 'Every 5 minutes', 'Sends queued email and retries failures.'],
  ['send-archive', 'Every 5 minutes', 'Makes the PDF of each request and sends it to eArchive.'],
  ['Backup', 'Nightly at 01:30', 'Database, then documents folder. See section 9.'],
], [0]));
c.push(...code([
  '0 7-17 * * 1-5  /opt/ehire/current/scripts/ehire-cli.sh run-timers >> /var/log/ehire/timers.log 2>&1',
  '*/5 * * * *     /opt/ehire/current/scripts/ehire-cli.sh send-mail >> /var/log/ehire/mail.log 2>&1',
  '*/5 * * * *     /opt/ehire/current/scripts/ehire-cli.sh send-archive >> /var/log/ehire/archive.log 2>&1',
]));
c.push(p('The backup line is long; copy it from deploy/README.md, section "Backup and restore". Rotate the four log files with logrotate.'));

c.push(h1('9. Backup and restore'));
c.push(bullet([run('Never copy ehire.sqlite3 with cp or a file backup while eHire runs. ', { bold: true }), run('Part of the data sits in a second file, so a plain copy can be incomplete.')]));
c.push(bullet('Use the backup-db command. It is safe while eHire is running, never overwrites a file, and prints the checksum of the copy.'));
c.push(...code('scripts/ehire-cli.sh backup-db /var/backups/ehire/<timestamp>/ehire.sqlite3'));
c.push(bullet('Back up the documents folder straight after, into the same timestamp folder. The two belong together: one without the other is not a backup.'));
c.push(bullet('Copy each night\'s folder off the server and keep 30 days.'));
c.push(bullet('To restore: stop only ehire, move the three database files and the storage folder aside, put both parts of one backup in place, run upgrade-db if the backup is older than the code, start ehire, and check /healthz. The full steps are in deploy/README.md.'));
c.push(bullet('Test a restore on a spare machine once a quarter.'));

c.push(h1('10. Switching on the link to eArchive'));
c.push(p('Do this after eArchive\'s own deployment that adds eHire (its database version 30) is live. Until then eHire keeps its deposits in a queue and loses nothing.'));
c.push(step('Confirm eArchive answers on 127.0.0.1:5011.', 'num2'));
c.push(step('Copy the token into /etc/ehire/ehire.env as EHIRE_ARCHIVE_TOKEN (section 5).', 'num2'));
c.push(step('Restart only ehire so it reads the token, then switch the transport on.', 'num2'));
c.push(...code('scripts/ehire-cli.sh archive-transport http'));
c.push(step('Ask the eHire administrator to set the eArchive site code of every hospital and facility, in eHire under Settings. A request for a facility without a code waits until the code is set.', 'num2'));
c.push(step('Give the eArchive side this address for its notices, as its EHR_EVENTS_URL: http://127.0.0.1:5008/api/v1/archive-events', 'num2'));
c.push(step('In eHire, Settings, "eArchive deposits" shows each deposit and its protocol number. A row marked as needing attention shows eArchive\'s reason.', 'num2'));
c.push(step('To list the facilities that still have no site code, for the eArchive side to add:', 'num2'));
c.push(...code('scripts/ehire-cli.sh archive-sites'));
c.push(p('A request for a site that eArchive does not know yet is held and tried again once a day. It is never filed under another site. eHire shows only the eArchive protocol number until eArchive\'s web application is published. When the eArchive side gives its final web address, put it in EHIRE_ARCHIVE_WEB_URL and restart only ehire: the number then becomes a link on every request, old ones included.', { spacing: { before: 60, after: 110 } }));

c.push(h1('11. Checks after the install'));
c.push(table([4700, 4326], ['Check', 'Expected'], [
  ['curl -s http://127.0.0.1:5008/healthz', '{"status":"ok"}'],
  ['curl -s http://10.227.56.22:5008/healthz', '{"status":"ok"} (eHire answers on the network address)'],
  ['curl -sI https://ehire.shso.online/', 'A redirect to /login, not 502'],
  ['scripts/ehire-cli.sh db-status', 'pending=0'],
  ['scripts/preflight.sh', 'No FAIL lines'],
  ['scripts/verify-release.sh --dir /opt/ehire/current', 'ok: installed files match the release'],
  ['scripts/ehire-cli.sh ad-test <username>', 'The person\'s name and email, or the reason it failed'],
  ['Sign in as the administrator in a browser', 'The list of requests opens; Settings and the audit log open'],
  ['systemctl status of the other applications', 'Unchanged'],
], [0]));
c.push(gap());

c.push(h1('12. Upgrades and rollback'));
c.push(p('An upgrade is the same command as the first install. The installer sees /opt/ehire/current and treats it as an upgrade.'));
c.push(step('Copy the new tarball, its .sha256 file and install-ehire.sh to one folder on the server.', 'num3'));
c.push(step([run('(sudo) ', { bold: true }), run('Run it (add --dry-run first to see every action, --yes when no terminal is attached).')], 'num3'));
c.push(...code('sudo bash install-ehire.sh ehire-' + RELEASE + '.tar.gz'));
c.push(step('Read the result. It prints the version now linked and the version it installs. Before it stops anything it backs up the database (backup-db, the online copy) and the documents folder into /var/backups/ehire/<time>-pre-<version>/ and stops if either file is missing or empty. Then it stops only ehire, switches the link, runs upgrade-db (db-status must print pending=0), runs preflight, refreshes ehire.service if it changed, starts ehire and polls /healthz for 30 seconds.', 'num3'));
c.push(step('Run the checks in section 11.', 'num3'));
c.push(p([run('Automatic rollback. ', { bold: true }), run('If a step fails after the backup, the installer stops ehire, points the release link and the Python environment back at the old ones, restores the old service file if it replaced one, and restores the database and documents from the backup only if upgrade-db had started (stale -wal and -shm files are removed; the failed state is moved to <backup>/failed-upgrade/, not deleted). It starts ehire again, checks /healthz and exits with code 2. If a rollback step itself fails it exits with code 3 and lists what state it left. Anything saved between the backup and the stop (a few seconds) is not in the backup.')], { spacing: { before: 100, after: 110 } }));
c.push(p('The same command with the same release again, when it is current and healthy, does nothing and exits 0. An older release folder that is still on disk is refused unless --yes is given, because an older release may need an older database.'));
c.push(p([run('If the installer cannot be used. ', { bold: true }), run('The manual upgrade and rollback are in deploy/README.md, sections "Upgrade by hand" and "Backup and restore": back up the database and documents, verify and unpack, stop only ehire, switch the link, upgrade-db, preflight, start, check. To roll back by hand: stop ehire, point /opt/ehire/current at the old release, restore the database and documents from the backup if upgrade-db ran, and start ehire. eHire refuses to serve on a database that is behind the code, so a missed upgrade-db shows as "service is being upgraded", not as wrong data.')]));

c.push(h1('13. Useful commands'));
c.push(table([4300, 4726], ['Command', 'Use'], [
  ['scripts/ehire-cli.sh unlock-user <username>', 'Clears a sign-in lock. Five wrong passwords lock a name for 15 minutes.'],
  ['scripts/ehire-cli.sh ad-test <username>', 'Tries an AD sign-in from the server and says what failed.'],
  ['scripts/ehire-cli.sh db-status', 'Shows whether the database matches the code.'],
  ['scripts/ehire-cli.sh archive-transport', 'Shows whether deposits go to eArchive.'],
  ['scripts/ehire-cli.sh archive-sites', 'Lists facilities and their eArchive site codes.'],
  ['journalctl -u ehire', 'The service log.'],
], [0]));
c.push(gap());

c.push(h1('14. Not yet tested on a real system'));
c.push(p('eHire was built and tested away from this server, against stand-ins. Treat these as things to watch on the first install, and report anything that differs:'));
c.push(bullet('The test suite on Python 3.10. It was run on 3.11; a checker confirms nothing newer than 3.9 is used.'));
c.push(bullet('Sign-in against the real domain controller, its certificate chain and attribute names.'));
c.push(bullet('Sending through the real Graph registration, and how the emails look in Outlook.'));
c.push(bullet('SQLite on this server\'s disk, and a restore.'));
c.push(bullet('The link to the real eArchive. It was built to eArchive\'s specification and its answers of 16/11/2026, and tested against a stand-in only. eArchive is running eHire\'s sample deposits through its own test.'));
c.push(bullet('The AD library (ldap3 2.9.1) does not run on Python 3.12. It is fine on 3.10.'));

c.push(h1('15. Release'));
c.push(table([2700, 6326], ['Item', 'Value'], [
  ['File', 'ehire-' + RELEASE + '.tar.gz'],
  ['SHA-256', SHA || 'see the .sha256 file sent with the release'],
  ['Full guide', 'deploy/README.md inside the release'],
  ['Settings template', 'deploy/ehire.env.example inside the release'],
  ['Day-to-day running', 'docs/operations.md inside the release'],
], [1]));

const numLevel = { level: 0, format: LevelFormat.DECIMAL, text: '%1.', alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 440, hanging: 440 } }, run: { font: FONT, bold: true, color: DEEP } } };
const doc = new Document({
  creator: 'eHire build', title: 'eHire: server set-up instructions',
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
        new TextRun({ text: '\teHire · Έγκριση Θέσεων', font: FONT, size: 18, color: GREY })] })] }) },
    footers: { default: new Footer({ children: [new Paragraph({
      tabStops: [{ type: TabStopType.RIGHT, position: W }],
      children: [new TextRun({ text: 'eHire server set-up instructions · release ' + RELEASE, font: FONT, size: 16, color: GREY }),
        new TextRun({ children: ['\tPage ', PageNumber.CURRENT, ' of ', PageNumber.TOTAL_PAGES], font: FONT, size: 16, color: GREY })] })] }) },
    children: c,
  }],
});
Packer.toBuffer(doc).then((b) => { fs.writeFileSync(OUT, b); console.log('written', OUT, b.length); });
