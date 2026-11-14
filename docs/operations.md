# eHR operations, one page

For the person who looks after eHR day to day. Install and upgrade steps are in `deploy/README.md`.

**Two rules.** Never restart another app's service. The full test suite passes before any install.

## Where things are

| What | Where (example paths) |
|---|---|
| App code, current release | `/opt/ehr/current` (a link to `/opt/ehr/releases/<version>`) |
| Settings | `/etc/ehr/ehr.env` (every variable is explained in `deploy/ehr.env.example`) |
| Database | the engine named in `EHR_DATABASE_URI` |
| Uploaded documents | `EHR_STORAGE_DIR`, for example `/var/lib/ehr/storage` |
| Service log | `journalctl -u ehr` |
| Timer and mail logs | `/var/log/ehr/timers.log` and `/var/log/ehr/mail.log` |

The database and the storage folder belong together. Back them up, and restore them, as a pair.

## What the two timers do

Both run as the `ehr` user from cron, through `scripts/ehr-cli.sh`.

- `run-timers` (hourly, working hours, Monday to Friday): queues reminders, escalations and returned-request warnings, and withdraws returned requests nobody resubmitted. It counts working days from the public holidays table, so keep that table current for the year. A day is a Cyprus calendar day: a task opened at 23:30 UTC on a Friday counts as opened on Saturday. Running it twice does no harm.
- `send-mail` (every 5 minutes): sends the queued emails and retries failed ones, up to 5 attempts. Mail older than 48 hours is marked failed, not sent late.

Check a timer ran: look at the last lines of its log. Each run prints one line of counts.

## When emails do not arrive

1. Sign in as an admin and open Settings, Email log. Is the email there?
2. Not there: the action did not queue one. Check the audit log for `mail_queued` on that request. No row means the rule did not call for an email.
3. There, state `queued`: nothing sent it. Check `mail.log` and that cron is running `send-mail`. Run `scripts/ehr-cli.sh send-mail` by hand and read the counts.
4. There, state `failed`: the row shows the last error. Check the server address, port and password in `ehr.env`.
5. Everything stays `queued` and cron is fine: the `mail_backend` setting is still `outbox_only`, which sends nothing on purpose. Marios turns on `smtp` or `graph` once the mail details exist.
6. Sent, but the person sees nothing: look in their spam folder, then ask the mail team to trace the message.

## Reading the audit log

Open Audit log in the top bar (admins and other holders of the audit permission). Newest entries come first, 50 to a page. Filters: request number (any spelling, with or without dash), user, event, and a date range as dd/mm/yyyy. Times show in Cyprus time (`EHR_TIMEZONE`, summer time included); they are stored in UTC. A date typed in the From or To box means that day in Cyprus, from 00:00 to 23:59.

Useful events: `login`, `login_failed`, `login_locked`, `password_changed`, `request_action` rows for each decision, `document_view` and `document_download`, `setting_changed`, `role_changed`, `mail_queued`. The log can be read and filtered here, nothing more. It cannot be edited or exported from the app.

## A user is locked out

After 5 failed sign-ins in 15 minutes a username is locked for 15 minutes. It clears itself. To clear it at once, as the `ehr` user:

`scripts/ehr-cli.sh unlock-user <username>`

An address that fails 20 times in 15 minutes is locked the same way. Add `--ip <address>` to clear it too.

## Time zone

Times are stored in UTC and shown in Cyprus time. The zone is `EHR_TIMEZONE` (default `Europe/Nicosia`). The server needs the system time zone database (the `tzdata` package). Without it the app stops at start-up with a message that names the zone; it does not show UTC by mistake. `scripts/preflight.sh` checks this too. Emails carry no times, only the request link.

## Retention of personal data

The retention period is recorded as the setting `retention_years` = 10. This is an assumption. **No deletion job exists and none runs.** Nothing in eHR deletes a request, a leaver name, a document or an audit row because of its age. The value is recorded so that a future job can use it once the DPO confirms the period. Until then, change the value only after the DPO decides, and build the job as a separate piece of work.

## Quick health check

- `curl -s http://127.0.0.1:5006/healthz` answers `{"status":"ok"}`. A 503 means the database is behind the code: run `scripts/ehr-cli.sh upgrade-db` (see the upgrade steps first).
- `scripts/preflight.sh --skip-port` lists anything wrong with settings, storage, database and LibreOffice.
- No Word or Excel preview: LibreOffice is missing or `EHR_SOFFICE_BIN` is wrong. The files still download.
