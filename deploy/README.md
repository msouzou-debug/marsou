# Deployment notes

**Rules.** Never restart another app's service. The full test suite passes before any install.
Nothing here is installed by the app. Marios runs every step that needs sudo. The scripts in `scripts/` never use sudo, never use the network (the port check talks to this machine only) and never touch another service.

Paths below are examples. Port 5008 is a proposal; Marios assigns the real one (eFinance 5004, eVendor 5005).

## Prerequisites

- Linux server inside the organisation's network, with a reverse proxy that serves HTTPS and passes requests to gunicorn on `127.0.0.1`.
- Python 3.10 or newer (the server runs 3.10).
- The system time zone database (the `tzdata` package on Linux) so that `Europe/Nicosia` loads. Without it the app does not start.
- SQLite 3.37 or newer (the server has 3.37.2; Python's `sqlite3` module is used, nothing to install). It is the production database, as in eFinance (decision of 14/11/2026, ADR 0001). The folder that holds the file must be writable by the `ehr` user: WAL mode creates `-wal` and `-shm` files beside it.
- For Active Directory sign-in (optional): the domain controller's name, the domain, a search base, and the organisation's internal CA certificate as a PEM file, all from IT. See Active Directory below.
- LibreOffice (`soffice`) for Word and Excel previews. Without it the files still download.
- A mail server or a Microsoft Graph app registration, when real email is turned on.

## Layout

| What | Where |
|---|---|
| System user and group | `ehr` (no login shell, owns nothing else) |
| Releases | `/opt/ehr/releases/ehr-<version>/`, with `/opt/ehr/current` pointing at the live one |
| Python environment | `/opt/ehr/venv` |
| Settings | `/etc/ehr/ehr.env`, owner root, group `ehr`, mode 640 (template: `deploy/ehr.env.example`) |
| Database | `/var/lib/ehr/ehr.sqlite3` (plus `ehr.sqlite3-wal` and `-shm` while running), owner `ehr`, outside the code folder |
| Documents | `/var/lib/ehr/storage`, owner `ehr` |
| Backups | `/var/backups/ehr/<timestamp>/`, owner `ehr` (see Backup and restore) |
| AD CA certificate | `/etc/ehr/ad-ca.pem`, owner root, group `ehr`, mode 640 |
| Logs | `/var/log/ehr/`, owner `ehr` (service output goes to journald: `journalctl -u ehr`) |
| Service | `ehr.service` (example: `deploy/ehr.service.example`), port from `EHR_BIND` |

## Environment file

`deploy/ehr.env.example` lists every variable the app reads, one line of meaning each, with no real values. Copy it, fill it in, and keep it out of the release folders. A test checks that the file and the code agree. Required in production: `EHR_ENV=production`, `EHR_SECRET_KEY` (32 or more random characters), `EHR_DATABASE_URI` (`sqlite:////var/lib/ehr/ehr.sqlite3`, four slashes), `EHR_BASE_URL`, `EHR_STORAGE_DIR`. The app refuses to start in production with the default secret, with CSRF off, with debug on, with a SQLite file that is not an absolute path outside the code folder in a folder the `ehr` user can write, or with Active Directory switched on without LDAPS and a readable CA file, and says which.

**SQLite and workers.** SQLite allows one writer. gunicorn runs exactly one sync worker (`EHR_WORKERS=1`, no threads), as eFinance does; it refuses to start with more on SQLite. Every connection is set to WAL, a 5000 ms busy timeout (`EHR_SQLITE_BUSY_TIMEOUT_MS`), foreign keys on and `synchronous=NORMAL`, and every write transaction starts with `BEGIN IMMEDIATE`, so request numbers and the one-action-per-task rule hold even while a cron job writes. A request that holds a transaction open for long (a Word preview waiting for LibreOffice, up to `EHR_CONVERT_TIMEOUT`) makes a cron job wait; it retries at its next run.

## Build and check a release (on the build machine)

```
scripts/make-release.sh            # runs the full test suite, then builds dist/ehr-<version>.tar.gz
scripts/verify-release.sh dist/ehr-<version>.tar.gz
```

`make-release.sh` stops if any test fails. The tarball holds the source only: no `.venv`, tests, caches, briefs or `docs/` drafts (`docs/operations.md` is kept). It carries `SHA256SUMS` (every file) and `RELEASE-INFO` (version, commit, test result). A separate `dist/ehr-<version>.tar.gz.sha256` covers the tarball itself. Copy both files to the server. Compare the checksum with the one on the build machine by a second route (phone, chat), not only the copy that travelled with the file.

## First install (Marios, on the server)

1. Create the user and folders (sudo): the `ehr` user and group; `/opt/ehr/releases`, `/etc/ehr`, `/var/lib/ehr/storage`, `/var/log/ehr`, owned as in the table above.
2. Stage the release: put the tarball and its `.sha256` in `/opt/ehr/staging/`, run `scripts/verify-release.sh` on it (copy that small script over from the build machine together with the tarball; read it first), then unpack into `/opt/ehr/releases/` and point `/opt/ehr/current` at it.
3. As `ehr`: `python3 -m venv /opt/ehr/venv`, then `/opt/ehr/venv/bin/pip install -r /opt/ehr/current/requirements.txt`. With no internet on the server, build a wheel folder elsewhere and use `pip install --no-index --find-links <folder>`.
4. Write `/etc/ehr/ehr.env` from the example. Create `/var/lib/ehr` first, owner `ehr`, mode 750.
5. As `ehr`, in `/opt/ehr/current`: `scripts/ehr-cli.sh init-db` (creates the tables and marks them current).
6. Create the first admin: `scripts/ehr-cli.sh create-admin`. It asks for a username, a full name and, twice, a password. The password is never an argument. The admin then loads the lists (Directorates, facilities, positions, cost centres, public holidays) and the other users in Settings. Never run `seed-demo` here: it holds a known password, and it refuses to run in production.
7. `scripts/preflight.sh`. Fix every FAIL line. It checks the Python version, the settings file, the secret, the SQLite file (absolute path, outside the code folder, folder writable, WAL on, one worker), Active Directory settings when on, storage, schema version, LibreOffice and the port.
8. Install `ehr.service` and the cron lines (below), including the nightly backup. Start only `ehr`: `systemctl start ehr` (sudo).
9. Health check: `curl -s http://127.0.0.1:5008/healthz` answers `{"status":"ok"}`. Sign in and open the Audit log.

## Upgrade

Stage and test first, switch last. Each step is one command Marios can read.

1. Run the full test suite on the build machine and build the release (`scripts/make-release.sh`).
2. **Back up** the database and the storage folder together (see Backup and restore). Note the time.
3. Copy the tarball and `.sha256` to the server. `scripts/verify-release.sh` must say `ok`. Unpack into `/opt/ehr/releases/ehr-<new>/`. If `requirements.txt` changed, update `/opt/ehr/venv` now.
4. Run `scripts/preflight.sh --skip-port` from the new folder. Only the `database is behind the code` FAIL is expected at this point.
5. **Stop only `ehr`**: `systemctl stop ehr` (sudo). Do not touch any other service.
6. Switch the link: `ln -sfn /opt/ehr/releases/ehr-<new> /opt/ehr/current`.
7. As `ehr`: `scripts/ehr-cli.sh upgrade-db`, then `scripts/ehr-cli.sh db-status` (must print `pending=0`).
8. `scripts/preflight.sh` (all ok), then start: `systemctl start ehr` (sudo).
9. Health check: `/healthz` answers ok; sign in; open one request. Run `scripts/verify-release.sh --dir /opt/ehr/current` to confirm the installed files match the release.

**Rollback.** Stop `ehr`. Point `/opt/ehr/current` back at the old release. If `upgrade-db` ran, restore the database and the storage folder from the backup of step 2 (migrations only go forward; the old code needs the old schema). Start `ehr`. Check `/healthz`. The app and `gunicorn` both refuse to run on a database that is behind the code, so a missed `upgrade-db` shows up as a 503 or a failed start, not as wrong data.

## Scheduled jobs

Two jobs keep the timers and the mail moving; a third is the nightly backup (next section). They run as the `ehr` user through `scripts/ehr-cli.sh`, which reads the same environment file as the service. Paths are examples.

```
# Reminders, escalations, returned-request warnings and automatic withdrawal. Hourly on working hours.
0 7-17 * * 1-5  /opt/ehr/current/scripts/ehr-cli.sh run-timers >> /var/log/ehr/timers.log 2>&1

# Send queued email (also retries failed ones, up to 5 attempts). Every 5 minutes.
*/5 * * * *     /opt/ehr/current/scripts/ehr-cli.sh send-mail >> /var/log/ehr/mail.log 2>&1
```

- `run-timers` counts working days from the `public_holiday` table (Monday to Friday, minus holidays) and never counts paused time. Each reminder, escalation and warning goes once per clock start, so running it more often is safe. `--at 2026-03-02T09:00:00+00:00` runs it as if it were that time (testing only).
- The web app also tries to send right after a successful action. A failure there is never shown to the user; the cron job is the safety net.
- Queued mail older than `MAIL_MAX_AGE_HOURS` (48) is marked failed, not sent, when a real backend is turned on. This stops a backlog of test mail reaching real people.

## Logs

- Service (gunicorn access and errors): `journalctl -u ehr`.
- `/var/log/ehr/timers.log`, `/var/log/ehr/mail.log`: one line per run. Rotate them with logrotate (weekly, 8 files).
- What users did: the Audit log in the app. What mail the app made: Settings, Email log.
- Passwords, tokens and typed credentials are never written to these logs or to the audit log.

## Users and locks

- First admin: `scripts/ehr-cli.sh create-admin`.
- Sign-in lock: 5 failed attempts for a username in 15 minutes lock that username for 15 minutes; 20 failures from one address lock the address. Clear it now with `scripts/ehr-cli.sh unlock-user <username>` (add `--ip <address>` for the address). An attacker who knows a username can keep it locked by trying every 15 minutes, which is why the command exists.
- Sessions end after 30 minutes without a request (`EHR_SESSION_IDLE_MINUTES`) and 12 hours after sign-in (`EHR_SESSION_MAX_HOURS`).
- Behind a reverse proxy, set `EHR_PROXY_HOPS` to the number of proxies so the lock and the audit log see the user's address and not the proxy's.

## Backup and restore

The database and the storage folder describe the same requests. Back both up as one unit, and restore both from the same backup. A database restored without its documents shows files that do not exist; documents restored without the database are orphans.

**Never copy `ehr.sqlite3` with `cp` or a file backup while the app runs.** In WAL mode part of the data sits in the `-wal` file, so a plain copy can be torn or miss recent commits. `flask backup-db` uses SQLite's online backup, works while the app is running, writes to a temporary name and renames it, never overwrites an existing file, checks the copy and prints its sha256. The backup is a single file in the normal journal mode.

Nightly, as the `ehr` user, two steps that belong together, database first and documents second (a document uploaded in between is then an orphan file, which is harmless; the other order could leave a row without its file):

```
# 1. database   2. document folder   (one folder per night, kept under one timestamp)
30 1 * * *  d=/var/backups/ehr/$(date +\%Y-\%m-\%dT\%H\%M) && mkdir -p "$d" && /opt/ehr/current/scripts/ehr-cli.sh backup-db "$d/ehr.sqlite3" && tar -C /var/lib/ehr -czf "$d/storage.tar.gz" storage >> /var/log/ehr/backup.log 2>&1
```

Then copy the night's folder off this machine (the backup host or share Marios names) and prune old folders (for example keep 30 days). A folder with only one of the two files is not a backup: delete it and look at `backup.log`. Do the same by hand before every upgrade, with the same two commands. Test a restore once a quarter on a spare machine. A backup nobody has restored is a guess.

**Restore.** Stop only `ehr`; touch nothing else.

1. `systemctl stop ehr` (sudo).
2. Keep what is there: move `/var/lib/ehr/ehr.sqlite3`, `ehr.sqlite3-wal` and `ehr.sqlite3-shm` and the `storage` folder into a dated side folder. Do not delete them yet. A stale `-wal` or `-shm` next to a restored file corrupts it, so all three must go.
3. Copy the backup's `ehr.sqlite3` to `/var/lib/ehr/ehr.sqlite3`, unpack `storage.tar.gz` into `/var/lib/ehr/` (it recreates `storage`). Owner `ehr`, as before. Check the file against the sha256 that `backup-db` printed.
4. If the backup is from an older release than the code: `scripts/ehr-cli.sh upgrade-db`. Then `scripts/ehr-cli.sh db-status` (must say `pending=0`) and `scripts/preflight.sh --skip-port`.
5. `systemctl start ehr` (sudo).
6. Health check: `curl -s http://127.0.0.1:5008/healthz` answers `{"status":"ok"}`. Sign in, open a request that has a document and view it.

Other engines are not supported by this guide; `backup-db` refuses them.

## Active Directory

Optional. Local accounts always work, also when the directory is down. With `EHR_AD_ENABLED=true`:

- Sign-in tries the local account first. A name that belongs to a local account is never sent to the directory. Any other name is tried against AD: a simple bind as `<username>@<EHR_AD_DOMAIN>` with the person's own password (no service account), over LDAPS (`EHR_AD_PORT`, default 636), with the server certificate checked against `EHR_AD_CA_FILE`. No StartTLS and no plain LDAP.
- The typed name must be the bare account name (`jsmith`, not `jsmith@domain` or `DOMAIN\jsmith`). An empty password is never sent.
- A first successful AD sign-in creates the person as an inactive user with no roles and shows "Your account was created. You can sign in once an administrator activates it." Nobody is emailed. An administrator opens Settings, Users (the row says "Waiting for activation"), presses Activate and gives the roles. Later sign-ins refresh the full name and email from `EHR_AD_BASE_DN`.
- AD users have no password in eHR and no password page. The sign-in lock (5 failures in 15 minutes) applies; a locked name is not sent to AD.
- Check the link without the web app, as the `ehr` user: `scripts/ehr-cli.sh ad-test <username>`. It asks for the password (not echoed) and prints the name and email it read, or the kind of failure: cannot connect, certificate not trusted, wrong credentials, user not found under the base DN.
- IT supplies: server name (as in its certificate), domain, search base, the account-name attribute if it is not `sAMAccountName`, and the CA certificate in PEM form for `EHR_AD_CA_FILE`.

## Email settings

The `mail_backend` row in the `setting` table chooses the backend: `outbox_only` (default, nothing leaves the app), `smtp` or `graph`. Secrets come from the environment file only.

| Variable | Used by | Meaning |
|---|---|---|
| `EHR_BASE_URL` | all | Address in the email button, for example `https://ehr.example.invalid` |
| `EHR_SMTP_HOST`, `EHR_SMTP_PORT` (587), `EHR_SMTP_USER`, `EHR_SMTP_PASSWORD`, `EHR_SMTP_STARTTLS` (1) | smtp | Mail server |
| `EHR_MAIL_FROM` | smtp | Sender address |
| `EHR_GRAPH_TENANT`, `EHR_GRAPH_CLIENT_ID`, `EHR_GRAPH_CLIENT_SECRET`, `EHR_GRAPH_SENDER` | graph | App registration with the `Mail.Send` application permission, and the mailbox that sends |

## What the app sends to browsers

Every response carries a Content-Security-Policy (scripts only from the app itself), `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY` (the email preview allows same-site framing), `Referrer-Policy: same-origin`, a minimal `Permissions-Policy` and, for pages and document files, `Cache-Control: no-store`. `Strict-Transport-Security` is sent when `EHR_HTTPS=true`, without `includeSubDomains` because the host is shared. The reverse proxy must not strip or replace these headers.
