# Hand-over to Marios: eHR «Έγκριση Θέσεων»

14/11/2026 · branch `claude/new-session-wdpfv7` · all six build phases done, not installed anywhere yet.

## What you are getting

- A separate Flask app, eHR, with its own database. Nothing HR-related touches eFinance.
- One module: «Έγκριση Θέσεων». Request form, six-step workflow, documents with an in-app viewer, emails, reminders, out of office, settings, audit log, Excel export.
- 604 automated tests, all passing on the last full run.
- An install pack: `deploy/README.md` (step by step), `deploy/ehr.env.example`, `deploy/ehr.service.example`, `scripts/make-release.sh`, `verify-release.sh`, `preflight.sh`, and `docs/operations.md` for day-to-day running.

## What has not been tested, because it can't be from a build session

- The real database engine. Everything ran on SQLite, and the app refuses to start in production on SQLite.
- Python 3.10 itself. The build used 3.11; a checker confirms the code needs nothing newer than 3.7, but the suite has to run on the server's 3.10 once.
- AD sign-in. It is a stub that always refuses. Local accounts work.
- Real email. The default mode, `outbox_only`, sends nothing. SMTP and Microsoft Graph senders exist and were tested against stand-ins.
- The eFinance link for ΟΑΥ figures. The endpoint does not exist in eFinance yet.
- The emails in Outlook. They were only viewed in a browser.

## Decisions I need from you

Server and install:

1. Database engine and version (the same one eFinance uses).
2. Port and service name. I used 5006 and `ehr`.
3. Folder layout. I used `/opt/ehr`, `/etc/ehr`, `/var/lib/ehr/storage`, `/var/log/ehr`.
4. Sign-in: AD only, or local accounts too. If AD, how eFinance connects to it.
5. Mail: SMTP or Microsoft Graph, and the sender address.
6. LibreOffice on the server, yes or no. Without it Office files can't be previewed, only downloaded.
7. How many reverse proxies sit in front of the app (`EHR_PROXY_HOPS`), so the sign-in lock and the audit log record real addresses.
8. HTTPS or plain HTTP inside the network (`EHR_HTTPS`).

eFinance link (read `docs/contracts/05-efinance-activity-link.md`, one page):

9. Do you agree to the endpoint as proposed, and will eFinance serve it? Until then, leave the source on "typed by hand" in Settings.
10. Its four open questions: the facility code both apps share, the ΟΑΥ specialty spelling, how the token is issued, and how the data month is reported.

The module itself:

11. Number prefix. Search now accepts Latin U for Θ, so typing `AEU-2026-0007` finds «ΑΕΘ-2026-0007». The prefix itself can stay as it is.
12. Decided 14/11/2026: the five central roles can create requests. The ΓΕΔ's own request goes to the substitute at step 6.
13. Decided 14/11/2026: all times shown in Cyprus time; stored in UTC.
14. Greek labels still to confirm: «Ημερολόγιο ελέγχου», «Συμβάν», «Συμπληρώθηκαν χειροκίνητα», «Περιμένει εσάς», «Κλιμάκωση, για ενημέρωση», «Επέστρεψα», «Κάτοχος», «Καταγραφή email», «Παρακαλούμε μην απαντήσετε.»
15. Reminder at 2 working days, escalation at 5, automatic withdrawal of a returned request at 30. All three are settings; confirm the starting values.
16. An escalation for someone with no line manager (the ΓΕΔ) goes to the administrators. Confirm, or name who should get it.

For the organisation, through you:

17. Who holds each role in each Directorate, each substitute and each line manager.
18. The DPO's retention period and lawful basis for the leaver data. 10 years is recorded as an assumption. No deletion job exists.
19. Sign-off of the simplified form as a new revision.
20. Whether eFinance code may be shared with a Claude build session. No eFinance code was used in this build.

## What you do, in order

1. Answer 1 to 8. I then set the database driver, fix anything the real engine shows, and build the release.
2. Run the test suite on a machine with Python 3.10 and the chosen database.
3. Follow "First install" in `deploy/README.md`. Every sudo step is yours. The steps never touch another app's service.
4. Run `scripts/preflight.sh` and fix every FAIL line.
5. Create the first admin with `scripts/ehr-cli.sh create-admin`. Never run `seed-demo` on the server: it refuses in production because its users share a known password.
6. Load the lists, the users and the role holders in Settings.
7. Keep mail on `outbox_only`, walk one request through all six steps, and read the emails in Settings, «Καταγραφή email».
8. Switch mail on. Queued emails older than 48 hours are marked failed, not sent, so test emails don't reach real people.

## Things to know before go-live

- Back up the database and the document storage folder together. One without the other is not a backup.
- A username can be locked for 15 minutes by five wrong passwords. `scripts/ehr-cli.sh unlock-user <username>` clears it.
- After an upgrade the app answers "service is being upgraded" until `upgrade-db` has run.
- The lockout message reads «1 λεπτά» when one minute remains. Small, known, not fixed.
- The screens are plain Bootstrap with the brand colours. Claude Design's restyle has not been done.

## Where to look

| For | File |
|---|---|
| Install, upgrade, rollback, cron, backup | `deploy/README.md` |
| Every setting the app reads | `deploy/ehr.env.example` |
| Day-to-day running | `docs/operations.md` |
| Stack and why | `docs/adr/0001-stack.md` |
| Rules of the workflow | `docs/contracts/02-state-machine.md` |
| eFinance link proposal | `docs/contracts/05-efinance-activity-link.md` |
| Decisions so far | `memory.md` |
