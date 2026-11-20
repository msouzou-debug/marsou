# eHire operations, one page

For the person who looks after eHire day to day. Install and upgrade are one command, `sudo bash install-ehire.sh ehire-<version>.tar.gz` (section "Install or upgrade with one command" in `deploy/README.md`; the manual steps there are the fallback).

**Two rules.** Never restart another app's service. The full test suite passes before any install.

**Install or upgrade.** Copy `ehire-<version>.tar.gz`, its `.sha256` and `install-ehire.sh` to one folder on the server and run `sudo bash install-ehire.sh ehire-<version>.tar.gz` (add `--dry-run` first; `--yes` when no terminal is attached). It checks the release, backs up the database and the documents before an upgrade (`/var/backups/ehire/<time>-pre-<version>/`), switches, runs the migrations, checks `/healthz` and rolls back by itself when a step fails. Exit codes: 0 done, 1 refused before any change, 2 failed and rolled back, 3 failed and not cleanly rolled back. Its log is `/var/log/ehire/install-<time>.log`. It leaves to a person: `create-admin` (first install), the firewall rule, the cron and backup lines, and the IT values in `ehire.env`.

## Where things are

| What | Where (example paths) |
|---|---|
| App code, current release | `/opt/ehire/current` (a link to `/opt/ehire/releases/<version>`) |
| Settings | `/etc/ehire/ehire.env` (every variable is explained in `deploy/ehire.env.example`) |
| Database | SQLite file named in `EHIRE_DATABASE_URI`, for example `/var/lib/ehire/ehire.sqlite3` (with `-wal` and `-shm` beside it while running) |
| Backups | `/var/backups/ehire/<timestamp>/`: `ehire.sqlite3` and `storage.tar.gz` from the same night |
| Uploaded documents | `EHIRE_STORAGE_DIR`, for example `/var/lib/ehire/storage` |
| Service log | `journalctl -u ehire` |
| Timer and mail logs | `/var/log/ehire/timers.log` and `/var/log/ehire/mail.log` |

The database and the storage folder belong together. Back them up, and restore them, as a pair.

**Backup.** Never copy the SQLite file while the app runs (WAL mode keeps recent data in a side file). Use `scripts/ehire-cli.sh backup-db <new-file>`: it works while the app runs, refuses to overwrite and prints a sha256. Then archive the storage folder. The nightly cron line and the restore steps are in `deploy/README.md`, section Backup and restore. If `backup.log` shows an error, there is no backup for that night: run both steps by hand.

**One writer.** SQLite lets one process write at a time. The app runs one worker. If the log shows `database is locked`, something held the database longer than 5 seconds (a long Word preview, or a copy of the file taken with `cp` that never finished): find it, do not raise the number of workers.

## What the two timers do

Both run as the `ehire` user from cron, through `scripts/ehire-cli.sh`.

- `run-timers` (hourly, working hours, Monday to Friday): queues reminders, escalations and returned-request warnings, and withdraws returned requests nobody resubmitted. It counts working days from the public holidays table, so keep that table current for the year. A day is a Cyprus calendar day: a task opened at 23:30 UTC on a Friday counts as opened on Saturday. Running it twice does no harm.
- `send-mail` (every 5 minutes): sends the queued emails and retries failed ones, up to 5 attempts. Mail older than 48 hours is marked failed, not sent late.

- `send-archive` (every 5 minutes): makes the PDF of each queued eArchive deposit and hands it to the archive transport, one at a time. A deposit eArchive cannot take yet waits and is retried with growing gaps; a refused one is blocked until an administrator presses the retry button in Settings, eArchive deposits. Output: `rendered=… stored=… failed=… waiting=…`.

Check a timer ran: look at the last lines of its log. Each run prints one line of counts.

## When emails do not arrive

1. Sign in as an admin and open Settings, Email log. Is the email there?
2. Not there: the action did not queue one. Check the audit log for `mail_queued` on that request. No row means the rule did not call for an email.
3. There, state `queued`: nothing sent it. Check `mail.log` and that cron is running `send-mail`. Run `scripts/ehire-cli.sh send-mail` by hand and read the counts.
4. There, state `failed`: the row shows the last error. Check the server address, port and password in `ehire.env`.
5. Everything stays `queued` and cron is fine: the `mail_backend` setting is still `outbox_only`, which sends nothing on purpose. Marios turns on `smtp` or `graph` once the mail details exist.
6. Sent, but the person sees nothing: look in their spam folder, then ask the mail team to trace the message.

## When eArchive deposits wait or are blocked

Open Settings, eArchive deposits (administrators). On the Settings index a red count next to it shows deposits that are `blocked`. No email is sent for it.

- The notice "not set up" means nothing is sent: `archive_transport` is `none`, or it is `http` without `EHIRE_ARCHIVE_TOKEN`. Deposits wait and nothing is lost. To send into a folder, set `EHIRE_ARCHIVE_DROP_DIR`, restart the service, then `scripts/ehire-cli.sh archive-transport folder`. For eArchive itself see deploy/README.md, "eArchive deposits".
- `queued` with an error "did not answer" and a retry time: eArchive is down or restarting. Nothing to do; it is tried again after 5 min, 15 min, 1 h, 6 h, then daily, with the same key, so it cannot be filed twice. It is never dropped. If it lasts, check that eArchive runs on `127.0.0.1:5011`.
- `queued` with an error about the converter: LibreOffice is missing or stuck (`EHIRE_SOFFICE_BIN`, `EHIRE_CONVERT_TIMEOUT`).
- `failed`: a problem on eHire's side (a stored file missing or changed). Retried 10 times, then wait. Fix the cause and press the retry button.
- `blocked`: eArchive refused the deposit, or eHire saw it could not fit. The row shows eArchive's code and message. It is not sent again until you fix the cause and press the retry button (the meta part is then built again). What to do by cause:
  - `NO_SITE`: the facility has no eArchive site code. Set it in Settings, facilities. No button needed: the next run sends it.
  - `TOO_MANY_FILES`, `FILE_TOO_BIG`, `DEPOSIT_TOO_BIG`, `FILE_TYPE`: the reason is in Greek on the row and names the file. Up to 19 documents go to eArchive one by one. From 20 to 200 eHire sends them in zips («Συνημμένα.zip», «Συνημμένα (2).zip» and so on, same content every time): every zip file is at most 50 MB (eArchive's limit for each part), so the documents are spread over as many zips as needed, in the order of the request, with at most 19 attachment parts and 200 MB for the whole request. A request is blocked past 200 documents, with a single document over 50 MB (it cannot be sent at all), over 200 MB in all, or of a type eArchive does not take. The documents cannot be removed after submission. Ask the requester's Directorate and Marios: eArchive staff can file it by hand, or the limit can be discussed with them.
  - `401`, `UNAUTHORIZED`, `403` (`LOOPBACK_ONLY`, `SERVICE_ONLY`, `SOURCE_MISMATCH`): the token or the network is wrong. Check `EHIRE_ARCHIVE_TOKEN` against eArchive's `EHR_INGEST_TOKEN` and that the address is `127.0.0.1`. Then retry. All deposits will block the same way until this is fixed.
  - `UNKNOWN_REGISTRY` is not a block: eArchive does not have that site code yet. The deposit stays `queued` with the reason (in Greek, with the code), is tried again once a day, and is never filed under another code. Run `scripts/ehire-cli.sh archive-sites` for the list of facilities with their Directorate and code (or "none") and send the ones that need a code to eArchive through Marios. A facility with no code in eHire is `blocked` as `NO_SITE` and eArchive is not called.
  - `IDEMPOTENCY_MISMATCH` after the retry button: eArchive already filed the first attempt and the rebuilt meta differs (its `sent_at` counts). Once eArchive's update of 16/11/2026 is installed the answer names the record: the row becomes `stored` by itself and the audit log shows `archive_duplicate` with `resolved_from: IDEMPOTENCY_MISMATCH`. Before that update there is no record named: the row stays blocked with the reason. Ask Marios to look the source reference up in eArchive.
  - `SCHEMA_INVALID` (the row shows the first reasons eArchive gave), `SHA256_MISMATCH`, `ARCHIVE_*`, `TOO_LARGE`, `FILE_TOO_LARGE`, `MIME_REJECTED`: the deposit itself is wrong or eArchive changed. This is a bug or a change on one side. Do not keep pressing retry: send the row's error text to Marios.
  - `UNEXPECTED_ANSWER`, `REDIRECT_REFUSED`: eArchive answered in a way eHire does not accept. Check `EHIRE_ARCHIVE_URL` and that port 5011 is eArchive's API.
- The protocol number shows as plain text on the request page and here until `EHIRE_ARCHIVE_WEB_URL` is set in `/etc/ehire/ehire.env` (eArchive's public web address, http or https; a trailing slash is fine; empty by default). Once it is set and the service restarted, the number becomes a link to `<address>/protocols/<protocol id>` for every request, old ones included. The link is built when the page is shown from the stored protocol id; the address eArchive returned with the receipt is kept but not used, because it can change when IT publishes eArchive. A wrong address stops eHire from starting (the log says which setting).
- A duplicate (eArchive already has that source) is shown as `stored` with the number from eArchive, and the audit log has `archive_duplicate`.
- The PDF of any row can be opened from the page (the view is audited as `archive_pdf_view`).
- Notices from eArchive (disposal after 30 years, legal hold) appear on the deposit row and on the request page. eHire deletes nothing because of them.
- A request that ends (approved, rejected or withdrawn) has a `decided` deposit next to its `submitted` one; a request that was decided before deposits existed has only the decided one.

## Reading the audit log

Open Audit log in the top bar (admins and other holders of the audit permission). Newest entries come first, 50 to a page. Filters: request number (any spelling, with or without dash), user, event, and a date range as dd/mm/yyyy. Times show in Cyprus time (`EHIRE_TIMEZONE`, summer time included); they are stored in UTC. A date typed in the From or To box means that day in Cyprus, from 00:00 to 23:59.

Useful events: `login`, `login_failed`, `login_locked`, `password_changed`, `request_action` rows for each decision, `document_view` and `document_download`, `setting_changed`, `role_changed`, `mail_queued`. The log can be read and filtered here, nothing more. It cannot be edited or exported from the app.

## A user is locked out

After 5 failed sign-ins in 15 minutes a username is locked for 15 minutes. It clears itself. To clear it at once, as the `ehire` user:

`scripts/ehire-cli.sh unlock-user <username>`

An address that fails 20 times in 15 minutes is locked the same way. Add `--ip <address>` to clear it too.

## A forgotten password

For a local account: `scripts/ehire-cli.sh reset-password <username>`. It asks twice for the new password, clears the sign-in lock and makes the person choose their own at the next sign-in. Directory (AD) accounts are reset in AD.

## Public holidays

`scripts/ehire-cli.sh load-holidays` (add `--year 2028`, repeatable) loads the Cyprus holidays for this year and the next, and skips dates already there. 24 December and Easter Tuesday are public-service holidays; remove them in Settings if not observed. Run it each autumn.

## Test data

For acceptance testing: `scripts/ehire-cli.sh load-test-data` (asks once for the password all `test.*` accounts share) and, before go-live, `scripts/ehire-cli.sh clear-test-data`. Test mail goes to `@test.invalid` only. The clear refuses, and says why, when a real user touched a test request or a test deposit reached eArchive. Details: `deploy/README.md`, section Test data.

## Time zone

Times are stored in UTC and shown in Cyprus time. The zone is `EHIRE_TIMEZONE` (default `Europe/Nicosia`). The server needs the system time zone database (the `tzdata` package). Without it the app stops at start-up with a message that names the zone; it does not show UTC by mistake. `scripts/preflight.sh` checks this too. Emails carry no times, only the request link.

## Retention of personal data

The retention period is recorded as the setting `retention_years` = 10. This is an assumption. **No deletion job exists and none runs.** Nothing in eHire deletes a request, a leaver name, a document or an audit row because of its age. The value is recorded so that a future job can use it once the DPO confirms the period. Until then, change the value only after the DPO decides, and build the job as a separate piece of work.

## Active Directory sign-in

Off unless `EHIRE_AD_ENABLED=true`. Setup and the `ad-test` check are in `deploy/README.md`. A person's first AD sign-in creates an inactive account: in Settings, Users, press Activate and give roles. If AD is down, only AD users are affected; local accounts still sign in. A person who cannot sign in gets the same message for a wrong password, an inactive account and a directory that does not answer: run `scripts/ehire-cli.sh ad-test <username>` to see which. Audit events: `ad_user_created`, and `login` with the method (`local` or `ad`).

## Quick health check

- `curl -s http://127.0.0.1:5008/healthz` answers `{"status":"ok"}`. A 503 means the database is behind the code: run `scripts/ehire-cli.sh upgrade-db` (see the upgrade steps first).
- `scripts/preflight.sh --skip-port` lists anything wrong with settings, storage, database and LibreOffice.
- No Word or Excel preview: LibreOffice is missing or `EHIRE_SOFFICE_BIN` is wrong. The files still download.
