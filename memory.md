# memory.md

Standing rules and decisions for this project. Read at the start of every session. Add to it when the owner decides something; keep one line per fact.

## Writing rules (owner's standard, all sessions)

- Any Greek text: load `greek-how-to-write`, `okypy-greek-terms` and `hellenic-linguist` first. The glossary wins over any other wording.
- Any English or Greek text: also load `natural-document-writer`, `write-like-a-human`, `anti-ai-writing` and `humanize`.
- Short, plain, active voice. No em dashes as asides, no promotional words. State assumptions and shortcuts.
- Ask questions before building. Prefer the simple solution.
- Excel outputs: live formulas, auditable.
- Commands first, always: when a reply involves something to run, put the exact commands at the top, in copy-ready blocks, before any explanation. Marios runs server work from PowerShell on his machine, so give each step as one line of the form `ssh -t administrator@10.227.56.22 "sudo bash /tmp/<script>.sh"`, with files copied to `/tmp` on the server by `scp` first. (Marios, 19/11/2026.)

## Greek terms approved on 13 and 14/11/2026 (also in the `okypy-greek-terms` skill)

| Avoid | Use |
|---|---|
| Αποθήκευση πρόχειρου | Αποθήκευση ως πρόχειρο |
| Προσθήκη αποχωρήσαντος | Προσθήκη ατόμου που αποχώρησε |
| Λήψη (download button) | Κατεβάστε το αρχείο |

| Meaning | Use |
|---|---|
| Withdraw request (button) | Απόσυρση αιτήματος |
| Withdrawn (status) | Αποσύρθηκε |
| Keep my answer (button) | Διατήρηση της απάντησής μου |
| On hold, while the request is with the requester | Σε αναμονή |
| View request (email button, as in eFinance) | Προβολή αιτήματος |
| Is there credit? (step 4 question) | Υπάρχει πίστωση; |
| Commitment article (budget) | Άρθρο δέσμευσης |
| Are funds available? (step 2 question) | Υπάρχει διαθέσιμο κονδύλι; |
| Procedures (ΟΑΥ activity) | Ιατρικές πράξεις |
| Headcount | Αριθμός προσωπικού |
| Annual employer cost | Ετήσιο εργοδοτικό κόστος |
| Round (one resubmission cycle) | Κύκλος {n} |
| Substitute acting for the holder | {who}, αντί για {holder} |
| Tracker states: done, current step, pending, waiting, negative answer | Ολοκληρώθηκε · Τρέχον βήμα · Εκκρεμεί · Περιμένει · Αρνητική απάντηση |
| Draft (status) | Πρόχειρο |
| Audit log | Ημερολόγιο ελέγχου |
| Audit event | Συμβάν |
| Figures typed by hand | Συμπληρώθηκαν χειροκίνητα |
| Out of office: I am back (button) | Επέστρεψα |
| Role holder | Κάτοχος |
| Email log | Καταγραφή email |
| Email footer (as eFinance) | Αυτόματο μήνυμα από το eHire · Οργανισμός Κρατικών Υπηρεσιών Υγείας (ΟΚΥπΥ) |
| Manuals (menu) · User guide · Administrator guide (proposed 20/11, awaiting approval) | Εγχειρίδια · Οδηγός χρήστη · Οδηγός διαχειριστή |
| Email status labels (as eFinance) | Χρειάζεται ενέργεια · Χρειάζεται προσοχή · Ολοκληρώθηκε · Για ενημέρωση |
| Working days | εργάσιμες ημέρες |
| eFinance link (approved 23/11/2026): budget, spent, committed, available balance, budget line | Προϋπολογισμός · Δαπάνες · Δεσμεύσεις · Διαθέσιμο υπόλοιπο · Γραμμή προϋπολογισμού |
| eFinance link (approved 23/11/2026): panel heading, as-of line, sync button, settings title | Στοιχεία από το eFinance · Στοιχεία της {date} · Συγχρονισμός τώρα · Σύνδεση με το eFinance |

The full glossary lives in the skill. When the owner fixes or approves a term: update the skill, send the owner the updated skill file, and add the row here.

## Project decisions

- The owner of this project is Marios. "The owner" and "Marios" in these files and in the contracts are the same person; he also runs the eFinance server.

- 12/11/2026, Marios: eFinance must not hold HR information for now. eHR is a separate app with its own database. Any link to eFinance is narrow, read-only, without personal data, and agreed through Marios.
- «Έγκριση Θέσεων» (`position-approval`) is the first module of eHR. Briefs: `claude/position-approval-01-…` (build) and `-02-…` (UI), both version 2.
- Stack follows eFinance: Python 3.10, Flask 3.1.3, Jinja, Bootstrap 5.3.3, everything served locally. See `docs/adr/0001-stack.md`.
- Emails never record an action. One button, «Προβολή αιτήματος», then sign-in, then the request.
- Nobody acts on a request they submitted.
- Build runs with Fable 5.2 as orchestrator and the subagents in `.claude/agents/`. Contracts in `docs/contracts/` come first; subagents build against them.
- No real request data, staff names or ΟΑΥ files in a Claude session. Invented sample data only.
- Shared-server rules: own system user, service and port; Marios runs every sudo step; full test suite passes before any install; never restart another app's service.
- Design: Claude Design works from the UI brief. Hand-over points are in `docs/design/coordination-with-claude-design.md`.

- 13/11/2026, owner: yes to O1 to O5 in contract 02 (restart at step 2 on a material change; a return pauses the returner's task; answers can be replaced only after a resubmission in the returned step; comment required on negative answers; escalation informs the line manager and leaves the task where it is).

- 13/11/2026, owner: the Greek budget and tracker terms chosen in Phase 1 are approved (listed above).

- 14/11/2026, owner: the ΟΑΥ figures in the financial table have both sources available: served by eFinance (through the narrow read-only link, once Marios agrees it) or typed by hand. An administrator picks the source in Settings; typing stays the fallback when eFinance has no figures.

- 14/11/2026, Marios: the Greek labels from Phases 4 to 6 are approved (listed above).
- 14/11/2026, Marios: sign-in offers both AD and local accounts. Mail goes through Microsoft Graph. The facility code is the same in eHR and eFinance.
- 14/11/2026, Marios: in number search the Latin letter U stands for Θ, so «ΑΕΘ-2026-0007» is found by typing AEU-2026-0007.
- 14/11/2026, Marios: central roles can create requests (this replaces the earlier assumption that only requesters and Directorate roles can). The conflict-of-interest rule still applies to them.
- 14/11/2026, Marios: times are shown in Cyprus time (Europe/Nicosia) and stored in UTC.
- 14/11/2026, Marios: retention period assumed at 10 years until the DPO confirms. It is recorded as a setting; no deletion job exists or runs.
- Questions for the eFinance side go as a drafted message that Marios passes on.

- 14/11/2026, eFinance session (partial, server unreachable since 12/11): eFinance uses raw SQL and has MySQL settings, production engine not yet confirmed; ports 5004, 5005, 5011, 5012, 5014 and 8080 are taken and 5006 is not confirmed free; it recommends a separate Graph app registration for eHR; whether eFinance holds the ΟΑΥ reports is not confirmed, so keep the ΟΑΥ source on typing. Details in `docs/adr/0001-stack.md`.

- 14/11/2026, Marios (relayed by the eFinance session): eHR mail uses its own Microsoft 365 app registration and its own sender mailbox, separate from eFinance. IT sets it up (Mail.Send, limited by an access policy to eHR's mailbox) through Marios. eHR reads its own `EHR_GRAPH_*` settings and shares nothing with eFinance's mail settings.

- 14/11/2026, eFinance session (full answers, from the code and server): eFinance production runs on SQLite; MySQL 8.0.46 is on the server. Port 5006 is taken; eHR now defaults to 127.0.0.1:5008. LibreOffice 7.3.7 is installed. AD in eFinance is `ldap3` 2.9.1, simple bind as user@domain, local account tried first, first AD sign-in creates an inactive account an admin activates. eFinance does NOT hold ΟΑΥ activity by specialty, so contract 05 cannot be served from it and the figures stay typed until Marios names the source. Details in `docs/adr/0001-stack.md`.

- 14/11/2026, Marios: eHR's database is SQLite, as eFinance runs in production (one gunicorn worker, WAL).
- 14/11/2026, Marios: ΟΑΥ figures are typed by hand for now. Later eFinance will be populated from SAP reports, management accounts and ΟΑΥ reports held in a folder or database, and can then serve eHR. Keep the provider interface; build no loader in eHR.
- 14/11/2026, Marios: build AD sign-in (ldap3, LDAPS with the certificate checked, local account first, new AD users inactive until an administrator activates them).
- 14/11/2026, Marios: emails use the eFinance frame (ΟΚΥπΥ logo, 640 px, status label and 4 px bar, Outlook-safe button, footer) and its four status labels: Χρειάζεται ενέργεια, Χρειάζεται προσοχή, Ολοκληρώθηκε, Για ενημέρωση. These replace the per-event email labels approved earlier (Περιμένει εσάς, Κλιμάκωση για ενημέρωση, Χωρίς υπεύθυνο, Θα αποσυρθεί).

- 14/11/2026, Marios: requests that are fully approved or still pending must be saved and stored in eArchive. eArchive is a document management tool with its own agent; questions for it go through Marios.
- 16/11/2026, Marios, on eArchive deposits: (1) deposit a PDF of the request (details, checks and opinions, full history) plus the supporting documents; (2) the full record, personal data included (leaver names, employment status, employer cost); (3) deposit at submission and again at the final decision; (4) rejected and withdrawn requests are not deposited, they stay in eHR; (5) if eArchive is down, queue and retry without blocking the approval.

- 16/11/2026, Marios: eArchive's rule stands: every request gets two deposits, one when submitted and one when decided (approved, rejected or withdrawn). This replaces answer (4) above. eArchive keeps the records 30 years in the closed ΑΔ registry; its specification is `docs/external/earchive-ingest-2026-11-16.md`.
- 16/11/2026, Marios: the ambulance service (Υπηρεσία Ασθενοφόρων) will split from the organisation. It needs no eArchive site code. It stays in eHR's lists for now; an administrator deactivates it in Settings when the split happens.

- 16/11/2026: release `ehr-1.0.0-rc1` built from commit 393bdd5 with the full suite passing (870 tests) and verified with its checksum. The tarball is not in the repo (`dist/` is ignored); it was sent to Marios with `docs/eHR-server-setup-instructions.docx`, the note for the server administrator (rebuilt by `scripts/make-admin-doc.js`).

- 16/11/2026, eArchive's answers (`docs/external/earchive-answers-2026-11-16.md`), applied: the per-file field is `kind` with a required `mime`; errors sit inside `error`; identical content is required on a retry; the request PDF is titled in Greek; past 19 attachments they go as one «Συνημμένα.zip»; the record link is stored but only the protocol number is shown until eArchive's web app is published; an unknown site code waits and retries daily. Release `1.0.0-rc1` predates this and its eArchive link would be refused: do not install it.

- 16/11/2026: release `ehr-1.0.0-rc2` built with the full suite passing and verified with its checksum (de9bb33a…8e815, 176 files). It replaces rc1 and is the one to install. Sent to Marios with the updated `docs/eHR-server-setup-instructions.docx` and the corrected eArchive samples (four deposits).

- 16/11/2026, eArchive's second answers (`docs/external/earchive-answers-2-2026-11-16.md`), applied: a key is recorded only when a deposit is filed; a mismatch answer names the protocol number once eArchive's update is installed; the zip itself is limited to 50 MB, so attachments split across several zips; validation errors come per field; the record link is built from `EHR_ARCHIVE_WEB_URL` plus the protocol id (empty until eArchive is published). Only two points stay open with eArchive: site codes for facilities outside its twelve, and the date and address of its web app. Release rc2 predates this: do not install it.

- 16/11/2026: release `ehr-1.0.0-rc3` built with the full suite passing and verified with its checksum (4ec7f0bebd244d76be1fa9c634f53e773b6c3ce00430d91aa8d572a3d360fbb4). It replaces rc2 and is the one to install. Sent to Marios with the updated Word document and six eArchive sample deposits.

- 16/11/2026, eArchive's correction: site codes are eFinance's, the same in every ΟΚΥπΥ tool: HQ, NGH, ARC, LGH, LAR, PAP, FAM, TRD, CHR, MH, HC, CNS. The old NAM, PAF, KYP, POL, MHS, PHC still file as aliases but must not be sent. eHR now validates against the twelve current codes. Release rc3 offers the old codes in Settings: do not install it.

- 16/11/2026: release `ehr-1.0.0-rc4` built with the full suite passing and verified with its checksum (ffd5e2128121fb19044f8ede3cd79d8d728d69e1a64247fba8b0fec6c9f2e37e). It carries eFinance's site codes, replaces rc3 and is the one to install. Sent to Marios with the updated Word document.

- 19/11/2026, from the server administrator (Δημήτρης Καολής), relayed by Marios: eHR is published as `https://ehire.shso.online` through a Cloudflare tunnel that runs on another machine and connects to the server at `10.227.56.22:5008`. So eHR listens on `0.0.0.0:5008` with `EHR_PROXY_HOPS=1`, `EHR_HTTPS=true` and `EHR_BASE_URL=https://ehire.shso.online`; no nginx block. Port 5008 should be limited in the firewall to the tunnel's machine. On 19/11 the address answered 502 only because eHR was not installed yet.

- 19/11/2026, Marios: the app's name is **eHire**, not eHR. eHR will later be a portal that includes the hiring process. Rename everything to eHire: what people see, the server names (user `ehire`, `/opt/ehire`, `/etc/ehire/ehire.env`, `/var/lib/ehire`, `ehire.service`), the settings prefix (`EHIRE_*`) and the code package (`ehire`), so the names `ehr` and `/opt/ehr` stay free for the portal. Ask eArchive to rename its side to eHire too (source_system, token name, service user). In the entries above, read "eHR" as eHire.

- 19/11/2026: the rename to eHire is done in the repo: package `ehire/`, settings `EHIRE_*`, server names `ehire`, `/opt/ehire`, `/etc/ehire/ehire.env`, `/var/lib/ehire`, `ehire.service`, helper `scripts/ehire-cli.sh`, releases `ehire-<version>`. eHire sends eArchive `source_system: "eHire"` and key `ehire:<id>`; eArchive's side still says eHR (`EHR_INGEST_TOKEN`, `svc-ehr`, `EHR_EVENTS_URL`) until it renames, so the archive transport stays off. Releases rc1 to rc4 carry the old name: do not install them.

- 19/11/2026: release `ehire-1.0.0-rc5` built with the full suite passing and verified with its checksum (faa142906980ee4d25d50d34d7260e34bed2fc130bdbc58e31b81fc8100a4425). It is the first release named eHire, carries the tunnel settings (0.0.0.0:5008, https://ehire.shso.online, one proxy hop) and is the one to install. Sent to Marios with `docs/eHire-server-setup-instructions.docx` and six eArchive samples under the new name.

- 19/11/2026: every pinned package must install on Python 3.10. SQLAlchemy 2.1.8 needs 3.11, so releases rc1 to rc5 could not have been installed on the server; from rc6 the pin is SQLAlchemy 2.0.58. Check with `pip download --python-version 3.10 --only-binary=:all:` before each release. Releases ship with an offline wheel set for Python 3.10 on x86_64.
- 19/11/2026: `scripts/install-ehire.sh` installs or upgrades with one sudo command (guards, backup, switch, health check, rollback). systemd, useradd and runuser were never exercised: first run on the server is `--dry-run`.

- 19/11/2026: release `ehire-1.0.0-rc6` built with the full suite passing (950 tests) and verified with its checksum (7912822e64b9fe9ab02900b8a32a982bbe3f5f5517c9192e8e865fe439955388, 177 files). First release that installs on Python 3.10 (SQLAlchemy 2.0.58) and ships `install-ehire.sh`. Sent to Marios with the offline wheel set `ehire-wheels-py310.tar.gz` (16 packages, x86_64) and the updated Word document. A first rc6 build failed on one timing-sensitive test while other work loaded the machine; the suite passed twice afterwards. The failing test's name was not captured.

- 20/11/2026: `ehire-1.0.0-rc6` is installed on the server (10.227.56.22, first install, schema version 5, service `ehire` active) and `https://ehire.shso.online/` answers through the tunnel. Marios created the first administrator and signed in. Still to do on the server: firewall for port 5008 (needs the tunnel machine's address), cron lines and nightly backup, AD and Graph values from IT, eArchive token after its rename.
- 20/11/2026: the server sends outbound HTTP through a proxy (squid), and `curl` uses it even for 127.0.0.1: test locally with `curl --noproxy '*'`. Graph mail will probably need the proxy set in `/etc/ehire/ehire.env` (not tested).
- 20/11/2026, Marios: load invented test data on the live server for UAT and wipe it before go-live (`load-test-data`, `clear-test-data`; test accounts are `test.*` with a password Marios types). Real lists come from eFinance by a drafted message plus the Excel import in Settings (`/settings/import`); Marios fills in role holders himself. Manuals wanted in Greek and English: user guide, administrator guide, UAT plan, UAT test scripts (Excel). The UI follows eFinance's layout once its files arrive; a first restyle from the brand guidelines is in (ΟΚΥπΥ logo, eHire logo, Lato with Greek served locally).
- 20/11/2026, built for rc7: Excel import, `load-test-data`, `clear-test-data`, `reset-password`, `load-holidays` (Cyprus holidays computed from Orthodox Easter; 24 Dec and Easter Tuesday included, an administrator can remove them), gunicorn `control_socket_disable = True` (fixes the `/opt/ehire/.gunicorn` error). `clear-test-data` sets `audit_log.user_id` to NULL for the removed test users (the only case where audit rows change) and resets the request numbering: both await Marios's yes.
- 20/11/2026: release `ehire-1.0.0-rc7` built from commit d232930 with the full suite passing and verified with its checksum (bb07382d66e9670a67e23f0061a71e8c288397eebb9f2a9b2be37ff240a43b70, 190 files). Same packages as rc6, so the upgrade reuses the server's Python environment and needs no wheels. The rc6 to rc7 upgrade was rehearsed here with the installer in a test folder. Sent to Marios as `ehire-install-rc7.zip`.
- 20/11/2026: rc7 installed on the server (upgrade from rc6 worked first time), bank holidays for 2026 and 2027 and the test data loaded.
- 20/11/2026, Marios: menu on the left as in eFinance, with Settings as an expandable group. Done from the brand guidelines (blue side menu, white top bar, white panels on a light page); eFinance's own layout files are still awaited and the look gets matched to them when they arrive.
- 20/11/2026: release `ehire-1.0.0-rc8` built from commit 88351f6 with the full suite passing and verified with its checksum (c455c860830d7812a7a7bbdd8e661491f0829ea57a11af94dc13b4d153c7ff4e, 191 files). It carries the left menu, panels, request numbers that begin with ΑΕΘ when no prefix setting is recorded (the server was issuing EHIRE-...), and the All tab as the start page for viewers and administrators. Sent to Marios as `ehire-install-rc8.zip`, with `eHire-manuals.zip`: user guide, administrator guide, UAT plan and UAT test scripts (65 cases, live formulas), each in Greek and English, in `docs/manuals/`. Rebuild them with `scripts/manuals/take-screenshots.sh`, `node scripts/manuals/make-manuals.js`, `python3 scripts/manuals/make_uat_xlsx.py`, `node scripts/manuals/make-uat-plan.js`.
- The gaps found while writing the manuals on 20/11 were fixed in rc9.
- 20/11/2026, eFinance's answers (`docs/external/efinance-answers-2026-11-20.md`, with its base template and CSS): side menu `#0A2C49`, 250 px, current item with a green left border `#8BC53F`, groups that expand, user block (name, role, EL|EN, «Κωδικός», «Αποσύνδεση») at the foot of the menu; no top bar on a desktop, a dark bar with a menu button on phones; page `#f2f5f8`, white cards with a `#dbe3ea` border and .5rem radius, primary `#1873B8`, font Segoe UI / system, badges as pills; detail pages have the status and approval chain in a sticky right column. eHire follows all of this from rc9 (Lato is no longer shipped). eFinance has no Directorates, only 13 entities (hospitals, MH, HC, AMB, CNS, HQ), 30 Health Centres under HC and 1,702 cost centres; it holds no positions.
- 20/11/2026, eFinance's rights model, for when eHire's is rebuilt: roles and their rights are editable in a tick-box matrix (`roles`, `role_permissions`); a user has one main role plus extra roles, rights are the union; entities are ticked per user, not per role; `admin` can do everything, cannot be an extra role, and the last active admin cannot be removed; pending AD sign-ups are approved on their own page. eHire today has fixed rights per role and holders per Directorate; Marios asked to follow eFinance's admin rights, and how far (editable matrix, extra roles) is his decision before it is built.
- 20/11/2026, eFinance on the server: its service sets no proxy variables and calls Microsoft Graph directly; it uses systemd timers for jobs (cron only for a root backup); backups stay on the same disk, no off-server copy yet; no AD CA file exists under `/opt/finance`; whether port 5008 is limited in the firewall is unknown.
- 20/11/2026: `eHire-import-from-eFinance-2026-11-20.xlsx` (not in the repo) holds eFinance's lists in eHire's import format: each entity as a Directorate and a facility of the same code, the Health Centres under HC, cost centres with the Greek name repeated as the English one. It passes the importer's checks. The mapping of hospitals to Directorates is an assumption Marios must confirm.
- 20/11/2026, Marios: eHire gets eFinance's editable rights matrix as well (tick rights per role), in a release after rc9, once it is agreed which rights may be changed. The approval route's own rules (who is asked at each step, nobody acts on their own request) stay fixed in the engine.
- 20/11/2026, eArchive's reply 4 (`docs/external/earchive-reply-4-2026-11-20.md`): its rename to eHire is installed and live (`source_system` must be exactly "eHire", key `ehire:<id>`, token setting `EHIRE_INGEST_TOKEN` in `/opt/emetroon/.env`, service user `svc-ehire`, notices to `http://127.0.0.1:5008/api/v1/archive-events`); "eHR" is now refused. eHire can send once Marios copies the token file to file into `EHIRE_ARCHIVE_TOKEN`. Do NOT switch the archive transport on while test data is loaded: test requests would be filed in the 30-year registry. Order: finish UAT, `clear-test-data`, copy the token, set site codes, then `archive-transport http`.
- 20/11/2026: rc8 installed on the server; Marios reset the `admin` password with `reset-password`.
- 20/11/2026: release `ehire-1.0.0-rc9` built from commit 007ca08 with the full suite passing (1,017 tests) and verified with its checksum (cb82fdc101bf15c9a5e8d954aae7f4f732d4906474d09af6bf927227fb436e16, 199 files). Same packages as rc6 to rc8. It carries: eFinance's frame; the request page with the route and history in a right-hand column and a phone layout for approving; «Εγχειρίδια» in the menu (guides as PDF inside the app, administrator files for administrators only); password fields with show/hide and Caps Lock and keyboard indicators; set-password, AD users in advance and a pending filter in Users; viewer and administrator holders in Roles; the withdrawal email to approvers of a returned request; plural forms, translated audit events, working days in the status line, the language redirect; the blocked eArchive count in the menu. Sent to Marios as `ehire-install-rc9.zip` with `eHire-manuals-rc9.zip` and the updated `okypy-greek-terms` skill.
- 20/11/2026, Marios: request numbers take the shape `EHIRE-<directorate code>-<position code>-<YYYYMMDD>-<NN>`, for example `EHIRE-NGH-NUR-20261120-01`. Directorate code upper-cased with non-Latin-letter-or-digit characters removed (`X` if none left); position code is a new optional field on each position (2 to 6 Latin capitals or digits, not unique), falling back to MED, NUR, ALH, ADM, OTH by staff category; the date is the submission day in Cyprus time; `NN` counts from 01 per directorate, position code and day (three digits past 99), issued in the submit transaction. The default prefix is `EHIRE` (the `number_prefix` setting still overrides). Existing numbers are never renumbered; a resubmission keeps its number; a draft has none.
- Greek terms proposed on 20/11 and awaiting Marios's approval: «Αλλαγή κωδικού» (menu), «Κατέβασμα εγγράφου» (audit event), «Χρήστης προβολής» (viewer role), «Χρήστες προβολής και διαχειριστές», «Ορισμός νέου κωδικού», «αποστολή» for an eArchive deposit, «Πληκτρολόγιο: Ελληνικά / Αγγλικά», «Το Caps Lock είναι ενεργό».
- Not covered by the UAT test scripts yet: the rc9 additions (set password, AD users in advance, viewer and administrator roles, Manuals page, password helpers).
- 20/11/2026: rc9 installed on the server. Marios reported the language switch missing, the ΟΚΥπΥ logo out of proportion and the route at the top: consistent with the new pages arriving with the previous release's cached stylesheet (not confirmed; this session cannot reach the site). From rc10 every static address carries a hash of the file (`ehire/staticver.py`), the language switch is two buttons in the menu plus EL | EN in the phone bar, and the logo has a fixed height in the page.
- 20/11/2026, Marios: polish the Greek and the UI with `frontend-design`, `zizi-skills:design-guide`, `greek-how-to-write`, `okypy-greek-terms`, `hellenic-linguist` and `humanize`. Done for rc10: all 620 Greek labels reviewed (22 corrected; «Κάτοχος» capitalised everywhere, «εγγραφή» for an eArchive record, «ουρά» for the queue) and every screen polished inside eFinance's frame (one panel and title style, 44 px controls, contrast and focus fixed, empty states, red for destructive actions). Sample requests in the seed file now carry Greek text.
- 20/11/2026: release `ehire-1.0.0-rc10` built from commit 659d639 with the full suite passing and verified with its checksum (bc3cf91b906ca58e7318f2dbe3a16cdb6857a76ade63eee9f68cebfd24555870, 201 files). Same packages as rc6 to rc9. It carries migration 0006 (position code, number counter): the installer applies it after its backup; the rc9 to rc10 upgrade was rehearsed here in a test folder and ended at schema version 6. Sent to Marios as `ehire-install-rc10.zip` with `eHire-manuals-rc10.zip`. Check the manuals' quoted labels with `python3 scripts/manuals/check-labels.py`.
- Greek terms from the rc10 polish awaiting Marios's approval: «Αίτημα έγκρισης θέσεων» (PDF title), «Καλώς επιστρέψατε», «Παρουσιάστηκε σφάλμα», «εγκρίνοντες», «Κωδικός θέσης». Open: the long dash in eArchive file names and document types (left as is), and `mail.escalation_due.intro` has no singular form.
- 23/11/2026: rc10 installed on the server; Marios cleared and reloaded the test data, so test requests carry the new number shape. `clear-test-data` now accepts its confirmation phrase with or without quotation marks (in the repo, for the next release).
- 23/11/2026: cost centres follow eFinance (same SAP codes and names, each tied to its entity, which eHire holds as a Directorate); the request form offers only the chosen Directorate's cost centres plus those with no Directorate, with a search box. Migration 0007 adds `cost_centre.directorate_id`; the Excel import takes an optional `directorate_code`.
- 23/11/2026, Marios (contract 07, `docs/contracts/07-efinance-link.md`): entities, Directorates and hospitals are the same thing; eFinance is the master list of cost centres and a change there must reach eHire; every request is checked against eFinance's budget for its budget line at steps 2 and 4; eHire warns and a person decides (a «Ναι» against a warning needs a comment); a cost centre switched off or gone in eFinance is switched off in eHire; the sync runs nightly (02:40) and on a «Συγχρονισμός τώρα» button.
- 23/11/2026: eHire's side of contract 07 is built against a stand-in eFinance and ships switched off (`efinance_link` = `none`, nothing is called) until eFinance builds its two endpoints and Marios copies the token file to file. Commands `efinance-test`, `efinance-link none|http`, `sync-cost-centres`; engine rule B1 (`budget_comment_required`); last sync kept in settings rows, no migration. The figures seen with an answer go into the request PDF and into the eArchive approval comment.
- 23/11/2026, Marios: the Greek terms of the eFinance link are approved (rows above, with the warning texts and the unavailable text); the skill file was updated and sent.
- 23/11/2026: the request to the eFinance session for the two endpoints of contract 07 is `docs/external/request-to-efinance-2026-11-23.md` (11 questions; sent to Marios to pass on). Until eFinance answers and builds, the link stays `none` and cost centres are aligned with `eHire-import-from-eFinance-2026-11-23.xlsx` (not in the repo; 13 Directorates, 43 facilities, 1,702 cost centres each with its entity; needs rc11).
- 23/11/2026: release `ehire-1.0.0-rc11` built from commit 3137f22 with the full suite passing (1,206 tests) and verified with its checksum (8cc6d7d14aa6c2beb3213bb0c9836220bccfbfb5c27067e0d83d14a9f9f02420). Same packages as rc6 to rc10. It carries migration 0007 (cost centre's Directorate), the cost-centre filter and search on the form, eHire's side of the eFinance link (off), and the forgiving `clear-test-data` prompt. The rc10 to rc11 upgrade was rehearsed here in a test folder and ended at schema version 7. A first build attempt failed on one test that passed on two full reruns; its name was not captured, so `make-release.sh` now prints failing test names. Sent to Marios as `ehire-install-rc11.zip` with `eHire-manuals-rc11.zip` and the import file.
- 23/11/2026, Marios: picking a budget line stays optional. rc11 is installed on the server.

## Status

- Names below predate the rename: read `ehr`, `EHR_*` and eHR as `ehire`, `EHIRE_*` and eHire.
- 13/11/2026: Phase 0 done (ADR, four contracts, subagent definitions, empty app with tests). All six phases built, plus the decisions of 14 to 16/11: SQLite in production, AD sign-in next to local accounts, emails in the eFinance frame, default port 5008, and eArchive deposits (request PDF plus documents, one deposit when submitted and one when decided, posted to eArchive on 127.0.0.1:5011 with `EHR_ARCHIVE_TOKEN`, notices back on `/api/v1/archive-events`, site code per facility). Not done: install on the server, Claude Design restyle. Never tested for real: the AD bind, a Graph tenant, the emails in Outlook, SQLite on the server's disk, Python 3.10 itself, and the real eArchive (only a local stand-in). Still open with eArchive (contract 06): site codes for facilities outside its twelve, and the date and address of its web app. From IT: AD server name, domain, base DN and CA file; Graph tenant, client id, secret and sender mailbox. Known small gaps: `login.locked` has no singular form; number search needs the full digits; ldap3 2.9.1 does not run on Python 3.12; a request with more than 200 attachments cannot be deposited automatically.
