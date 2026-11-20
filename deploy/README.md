# Deployment notes

**Rules.** Never restart another app's service. The full test suite passes before any install.
Nothing here is installed by the app. Marios runs every step that needs sudo. The scripts in `scripts/` never use sudo, never use the network (the port check talks to this machine only) and never touch another service.

Paths below are examples. eHire's port on the ΟΚΥπΥ server is 5008 (eFinance 5004, eVendor 5005).

**How users reach it.** eHire is published as `https://ehire.shso.online` through a Cloudflare tunnel that runs on another machine and connects to this server at `http://10.227.56.22:5008`. So eHire listens on `0.0.0.0:5008` (`EHIRE_BIND`), with `EHIRE_PROXY_HOPS=1`, `EHIRE_HTTPS=true` and `EHIRE_BASE_URL=https://ehire.shso.online`. A 502 from that address means nothing is listening on 5008: check `systemctl status ehire`. Because the port is plain HTTP and open on the network interface, add a firewall rule that lets only the tunnel's machine reach 5008; without it, anyone on the internal network can reach eHire directly and send a forged forwarded address. The link to eArchive is separate and stays on `127.0.0.1`.

## Install or upgrade with one command

This is the normal way. The manual steps further down are the fallback for when the installer cannot be used.

**Copy three files** from the build machine (`dist/`) to one folder on the server, read the script first, and compare the tarball checksum with the one on the build machine by a second route (phone, chat):

- `ehire-<version>.tar.gz`
- `ehire-<version>.tar.gz.sha256`
- `install-ehire.sh` (the same file is also inside the tarball)

**Run one command**, as root, from an SSH session:

```
sudo bash install-ehire.sh ehire-<version>.tar.gz
```

The script never calls sudo itself: it must be root, and says so when it is not. With a terminal attached it prints the plan and asks once. With no terminal (SSH driven from PowerShell, a script) it refuses unless `--yes` is given. Output is plain ASCII, one line per step (`[n/14] ... ok`, or the reason it stopped), and the whole run is also written to `/var/log/ehire/install-<time>.log` (the secret key is never printed or logged).

| Option | Meaning |
|---|---|
| `--wheels DIR` | Offline: `pip install --no-index --find-links DIR`. Without it pip downloads from PyPI. |
| `--dry-run` | Prints every action and changes nothing. Run it first. |
| `--yes` | Do not ask for confirmation. |
| `--no-start` | Install and check, but do not start the service. |
| `--port N` | Port (default 5008). An existing settings file wins and must agree. |
| `--root DIR` | Testing only: treat DIR as the filesystem root and record the root-only actions in `DIR/.actions.log`. Refused for `/`. |

**What it does, in order.** (1) Guards, before changing anything: root, bash 4, the tarball name, its `.sha256`, every file against `SHA256SUMS` (through `verify-release.sh`, from beside the script or from inside the tarball), `RELEASE-INFO` says `tests: passed` (a `--skip-tests` release is refused), Python 3.10 or newer with venv, systemd, the time zone database, 500 MB free on `/opt` and `/var/lib`; LibreOffice missing is a warning only. (2) Decides FIRST INSTALL (no `/opt/ehire/current`) or UPGRADE and prints the version being installed and the one now linked. The current release again, with a healthy service, exits 0 and changes nothing. An older release folder that is already unpacked needs `--yes`. (3) Port check: something other than eHire on the port stops it, with the process name and pid. (4) First install: creates the `ehire` user and group if missing, and the folders with the owners and modes in the Layout table. (5) Unpacks into `/opt/ehire/releases/ehire-<version>` (owner `ehire`, not writable by group or other). (6) Python environment: `venv-<version>` with `/opt/ehire/venv` as a link to it. On an upgrade a new one is built only when `requirements.txt` changed, and switched in at step 9; the old one stays for rollback. (7) First install writes `/etc/ehire/ehire.env` from the example with a fresh secret key. An existing file is never changed, reordered or printed: the script only lists the variable names the new example has and the file lacks. (8) Upgrade: backs up the database (`backup-db`, from the current release, as `ehire`) and the storage folder to `/var/backups/ehire/<UTC time>-pre-<version>/` and stops if either file is missing or empty. (9) Stops only `ehire.service`, points `current` at the new release, runs `init-db` (first install) or `upgrade-db` (upgrade), and `db-status` must say `pending=0`. (10) `preflight.sh --skip-port`, as `ehire`: any FAIL stops it. (11) Installs `ehire.service` from the release when it differs (the old one is kept as `ehire.service.bak`), `daemon-reload`, `enable`, `start`. (12) Polls `http://127.0.0.1:<port>/healthz` for 30 seconds and checks that the unit is active. (13) Rolls back when needed. (14) Prints a summary, the three addresses to check and the manual steps.

All app commands run as the `ehire` user through `runuser`, never as root. The script touches only `/opt/ehire`, `/etc/ehire`, `/var/lib/ehire`, `/var/log/ehire`, `/var/backups/ehire`, the user `ehire` and `ehire.service`. It never restarts or reloads another unit, never runs `daemon-reexec`, never touches nginx, apache or cron, and never installs cron lines. The only network use is `pip` (no `--wheels`) and `127.0.0.1` for the health check.

**Rollback (upgrade only, automatic after the backup).** If anything fails after the backup was taken, it stops `ehire`, points `current` and `venv` back, restores the previous service file if it replaced one, and restores the database and the storage folder from the backup only if `upgrade-db` had started (stale `-wal` and `-shm` files are removed, the failed state is moved to `<backup>/failed-upgrade/`, nothing is deleted). Then it starts `ehire` again if it was running, checks `/healthz` and exits 2. Anything saved between the backup and the stop is not in the backup: the window is a few seconds. A failed first install cannot be rolled back: the unit is stopped and disabled, files stay in place, the script prints what exists and the commands to remove it (it never runs `rm -rf`), and the same command resumes the install after the cause is fixed.

**Exit codes.** 0 done, or nothing to do. 1 a guard failed, nothing changed (also: no terminal and no `--yes`, or the prompt was declined). 2 failed and rolled back, or failed before anything live was touched. 3 failed and could not roll back cleanly (first install failures, or a rollback step failed): the message says what state it is in.

**What is left for a person** (the script prints these as copy-paste lines):

1. First install: `sudo -u ehire /opt/ehire/current/scripts/ehire-cli.sh create-admin`. It asks for a password, so the script does not run it.
2. The firewall rule: only the tunnel machine may reach the port.
3. The three cron lines and the nightly backup line (Scheduled jobs and Backup and restore below). The script does not install cron.
4. Values from IT in `/etc/ehire/ehire.env`: AD server, domain, base DN and CA file; Graph tenant, client id, secret and sender mailbox; the eArchive token. After editing, run `preflight.sh --skip-port` and restart only `ehire`.
5. Copy the backup folder off the server.

## Prerequisites

- Linux server inside the organisation's network, with a reverse proxy that serves HTTPS and passes requests to gunicorn on `127.0.0.1`.
- Python 3.10 or newer (the server runs 3.10).
- The system time zone database (the `tzdata` package on Linux) so that `Europe/Nicosia` loads. Without it the app does not start.
- SQLite 3.37 or newer (the server has 3.37.2; Python's `sqlite3` module is used, nothing to install). It is the production database, as in eFinance (decision of 14/11/2026, ADR 0001). The folder that holds the file must be writable by the `ehire` user: WAL mode creates `-wal` and `-shm` files beside it.
- For Active Directory sign-in (optional): the domain controller's name, the domain, a search base, and the organisation's internal CA certificate as a PEM file, all from IT. See Active Directory below.
- LibreOffice (`soffice`) for Word and Excel previews. Without it the files still download.
- A mail server or a Microsoft Graph app registration, when real email is turned on.

## Layout

| What | Where |
|---|---|
| System user and group | `ehire` (no login shell, owns nothing else) |
| Releases | `/opt/ehire/releases/ehire-<version>/`, with `/opt/ehire/current` pointing at the live one |
| Python environment | `/opt/ehire/venv` (a link to `/opt/ehire/venv-<version>` when the installer built it; the manual steps make it a plain folder) |
| Settings | `/etc/ehire/ehire.env`, owner root, group `ehire`, mode 640 (template: `deploy/ehire.env.example`) |
| Database | `/var/lib/ehire/ehire.sqlite3` (plus `ehire.sqlite3-wal` and `-shm` while running), owner `ehire`, outside the code folder |
| Documents | `/var/lib/ehire/storage`, owner `ehire` |
| Backups | `/var/backups/ehire/<timestamp>/`, owner `ehire` (see Backup and restore) |
| AD CA certificate | `/etc/ehire/ad-ca.pem`, owner root, group `ehire`, mode 640 |
| Logs | `/var/log/ehire/`, owner `ehire` (service output goes to journald: `journalctl -u ehire`) |
| Service | `ehire.service` (example: `deploy/ehire.service.example`), port from `EHIRE_BIND` |

## Environment file

`deploy/ehire.env.example` lists every variable the app reads, one line of meaning each, with no real values. Copy it, fill it in, and keep it out of the release folders. A test checks that the file and the code agree. Required in production: `EHIRE_ENV=production`, `EHIRE_SECRET_KEY` (32 or more random characters), `EHIRE_DATABASE_URI` (`sqlite:////var/lib/ehire/ehire.sqlite3`, four slashes), `EHIRE_BASE_URL`, `EHIRE_STORAGE_DIR`. The app refuses to start in production with the default secret, with CSRF off, with debug on, with a SQLite file that is not an absolute path outside the code folder in a folder the `ehire` user can write, or with Active Directory switched on without LDAPS and a readable CA file, and says which.

**SQLite and workers.** SQLite allows one writer. gunicorn runs exactly one sync worker (`EHIRE_WORKERS=1`, no threads), as eFinance does; it refuses to start with more on SQLite. Every connection is set to WAL, a 5000 ms busy timeout (`EHIRE_SQLITE_BUSY_TIMEOUT_MS`), foreign keys on and `synchronous=NORMAL`, and every write transaction starts with `BEGIN IMMEDIATE`, so request numbers and the one-action-per-task rule hold even while a cron job writes. A request that holds a transaction open for long (a Word preview waiting for LibreOffice, up to `EHIRE_CONVERT_TIMEOUT`) makes a cron job wait; it retries at its next run.

## Build and check a release (on the build machine)

```
scripts/make-release.sh            # runs the full test suite, then builds dist/ehire-<version>.tar.gz
scripts/verify-release.sh dist/ehire-<version>.tar.gz
```

`make-release.sh` stops if any test fails. The tarball holds the source only: no `.venv`, tests, caches, briefs or `docs/` drafts (`docs/operations.md` is kept). It carries `SHA256SUMS` (every file) and `RELEASE-INFO` (version, commit, test result). A separate `dist/ehire-<version>.tar.gz.sha256` covers the tarball itself. Copy both files to the server. Compare the checksum with the one on the build machine by a second route (phone, chat), not only the copy that travelled with the file.

## First install by hand (fallback, Marios, on the server)

Only when `install-ehire.sh` cannot be used. The installer does all of this, in this order.

1. Create the user and folders (sudo): the `ehire` user and group; `/opt/ehire/releases`, `/etc/ehire`, `/var/lib/ehire/storage`, `/var/log/ehire`, owned as in the table above.
2. Stage the release: put the tarball and its `.sha256` in `/opt/ehire/staging/`, run `scripts/verify-release.sh` on it (copy that small script over from the build machine together with the tarball; read it first), then unpack into `/opt/ehire/releases/` and point `/opt/ehire/current` at it.
3. As `ehire`: `python3 -m venv /opt/ehire/venv`, then `/opt/ehire/venv/bin/pip install -r /opt/ehire/current/requirements.txt`. With no internet on the server, build a wheel folder elsewhere and use `pip install --no-index --find-links <folder>`.
4. Write `/etc/ehire/ehire.env` from the example. Create `/var/lib/ehire` first, owner `ehire`, mode 750.
5. As `ehire`, in `/opt/ehire/current`: `scripts/ehire-cli.sh init-db` (creates the tables and marks them current).
6. Create the first admin: `scripts/ehire-cli.sh create-admin`. It asks for a username, a full name and, twice, a password. The password is never an argument. The admin then loads the lists (Directorates, facilities, positions, cost centres, public holidays) and the other users in Settings. Never run `seed-demo` here: it holds a known password, and it refuses to run in production. For acceptance testing use `load-test-data` instead (section Test data below).
7. `scripts/preflight.sh`. Fix every FAIL line. It checks the Python version, the settings file, the secret, the SQLite file (absolute path, outside the code folder, folder writable, WAL on, one worker), Active Directory settings when on, storage, schema version, LibreOffice and the port.
8. Install `ehire.service` and the cron lines (below), including the nightly backup. Start only `ehire`: `systemctl start ehire` (sudo).
9. Health check: `curl -s http://127.0.0.1:5008/healthz` answers `{"status":"ok"}`. Sign in and open the Audit log.

## Upgrade by hand (fallback)

Only when `install-ehire.sh` cannot be used. Stage and test first, switch last. Each step is one command Marios can read.

1. Run the full test suite on the build machine and build the release (`scripts/make-release.sh`).
2. **Back up** the database and the storage folder together (see Backup and restore). Note the time.
3. Copy the tarball and `.sha256` to the server. `scripts/verify-release.sh` must say `ok`. Unpack into `/opt/ehire/releases/ehire-<new>/`. If `requirements.txt` changed, update `/opt/ehire/venv` now.
4. Run `scripts/preflight.sh --skip-port` from the new folder. Only the `database is behind the code` FAIL is expected at this point.
5. **Stop only `ehire`**: `systemctl stop ehire` (sudo). Do not touch any other service.
6. Switch the link: `ln -sfn /opt/ehire/releases/ehire-<new> /opt/ehire/current`.
7. As `ehire`: `scripts/ehire-cli.sh upgrade-db`, then `scripts/ehire-cli.sh db-status` (must print `pending=0`).
8. `scripts/preflight.sh` (all ok), then start: `systemctl start ehire` (sudo).
9. Health check: `/healthz` answers ok; sign in; open one request. Run `scripts/verify-release.sh --dir /opt/ehire/current` to confirm the installed files match the release.

**Rollback.** Stop `ehire`. Point `/opt/ehire/current` back at the old release. If `upgrade-db` ran, restore the database and the storage folder from the backup of step 2 (migrations only go forward; the old code needs the old schema). Start `ehire`. Check `/healthz`. The app and `gunicorn` both refuse to run on a database that is behind the code, so a missed `upgrade-db` shows up as a 503 or a failed start, not as wrong data.

## Scheduled jobs

Two jobs keep the timers and the mail moving; a third is the nightly backup (next section). They run as the `ehire` user through `scripts/ehire-cli.sh`, which reads the same environment file as the service. Paths are examples.

```
# Reminders, escalations, returned-request warnings and automatic withdrawal. Hourly on working hours.
0 7-17 * * 1-5  /opt/ehire/current/scripts/ehire-cli.sh run-timers >> /var/log/ehire/timers.log 2>&1

# Send queued email (also retries failed ones, up to 5 attempts). Every 5 minutes.
*/5 * * * *     /opt/ehire/current/scripts/ehire-cli.sh send-mail >> /var/log/ehire/mail.log 2>&1

# Make the PDFs of eArchive deposits and hand them to the archive transport. An unreachable eArchive is retried with growing gaps (5 min, 15 min, 1 h, 6 h, then daily), without limit.
*/5 * * * *     /opt/ehire/current/scripts/ehire-cli.sh send-archive >> /var/log/ehire/archive.log 2>&1
```

- `run-timers` counts working days from the `public_holiday` table (Monday to Friday, minus holidays) and never counts paused time. Each reminder, escalation and warning goes once per clock start, so running it more often is safe. `--at 2026-03-02T09:00:00+00:00` runs it as if it were that time (testing only).
- The web app also tries to send right after a successful action. A failure there is never shown to the user; the cron job is the safety net.
- Queued mail older than `MAIL_MAX_AGE_HOURS` (48) is marked failed, not sent, when a real backend is turned on. This stops a backlog of test mail reaching real people.

## eArchive deposits

At submission and when a request ends (approved, rejected or withdrawn) the app queues a deposit: a PDF of the request plus its supporting documents (docs/contracts/06-earchive-deposit.md; eArchive's own note is docs/external/earchive-ingest-2026-11-16.md). The PDF is made by `send-archive` (LibreOffice takes seconds, so the web request never waits for it). Which transport is used is the `archive_transport` setting: `none` (default: nothing is sent, deposits wait), `folder` (`EHIRE_ARCHIVE_DROP_DIR`) or `http` (eArchive's ingest route on this machine). The PDFs live in the storage folder under `archive/`, so the normal storage backup holds them. Rotate `archive.log` like the other logs.

**Switching on the http transport (Marios, in this order).**

1. eArchive's side must be live with its token (`EHR_INGEST_TOKEN` in `/opt/emetroon/.env`) and eArchive must answer on `127.0.0.1:5011`.
2. Copy the token from file to file without printing it. The setting name in eHire is `EHIRE_ARCHIVE_TOKEN`, in `/etc/ehire/ehire.env`:

```
sudo python3 - <<'PY'
import re
tok = re.search(r'^EHR_INGEST_TOKEN=(.*)$', open('/opt/emetroon/.env').read(), re.M).group(1).strip().strip('"\'')
path = '/etc/ehire/ehire.env'
text = open(path).read()
new, n = re.subn(r'^EHIRE_ARCHIVE_TOKEN=.*$', lambda m: 'EHIRE_ARCHIVE_TOKEN=' + tok, text, flags=re.M)
open(path, 'w').write(new if n else text.rstrip('\n') + '\nEHIRE_ARCHIVE_TOKEN=' + tok + '\n')
PY
sudo grep -c '^EHIRE_ARCHIVE_TOKEN=.' /etc/ehire/ehire.env     # prints 1, not the token
```

3. Leave `EHIRE_ARCHIVE_URL=http://127.0.0.1:5011`. It must be plain http on this machine; anything else stops the app from starting.
4. Run `scripts/preflight.sh --skip-port`, then restart the eHire service (only eHire's own service).
5. As the ehire user: `scripts/ehire-cli.sh archive-transport http`. Run it without a name to check.
6. Make sure the cron line `send-archive` below is installed. Deposits that waited go out at the next run, oldest first, one at a time.
7. Set the eArchive site code of every facility (Settings, facilities). Without it a deposit is `blocked` (`NO_SITE`) and goes out by itself once the code is set. `scripts/ehire-cli.sh archive-sites` prints every active facility with its Directorate and its code or "none", and how many have none: send eArchive that list for the facilities outside the twelve. Until eArchive adds a code it answers `UNKNOWN_REGISTRY`; eHire then keeps the deposit waiting, tries once a day and never uses another site's code.
8. A request with more than 19 documents goes as zips («Συνημμένα.zip», «Συνημμένα (2).zip» and so on). Each zip file is at most 50 MB (eArchive limits every part, a zip included); inside a zip each file is at most 50 MB, at most 200 files; at most 19 attachment parts and 200 MB for the whole request. eHire splits the documents over as many zips as it takes; the zips are kept in the storage folder under `archive/` with the PDF. Past those limits, or with one document over 50 MB, the deposit is `blocked` with a readable reason. The protocol number is shown as text only. Once eArchive's web app is published, put its address in `EHIRE_ARCHIVE_WEB_URL` in `/etc/ehire/ehire.env` (http or https, empty by default) and restart the service: the number becomes a link to `<address>/protocols/<protocol id>` for every request.
9. Give eArchive the address for its notices: `http://127.0.0.1:5008/api/v1/archive-events` (the port is the one in `EHIRE_BIND`), as its `EHR_EVENTS_URL`. eArchive uses the same token for them.

Before the first real deposit, eArchive runs the six sample deposits (a submitted request, an approved and a rejected one each as submitted and decided, and 25 attachments in one zip) from `scripts/ehire-cli.sh archive-samples <folder>` (demo data only; refused when `EHIRE_ENV=production`) through its own test.

## Logs

- Service (gunicorn access and errors): `journalctl -u ehire`.
- `/var/log/ehire/timers.log`, `/var/log/ehire/mail.log`, `/var/log/ehire/archive.log`: one line per run. Rotate them with logrotate (weekly, 8 files).
- What users did: the Audit log in the app. What mail the app made: Settings, Email log.
- Passwords, tokens and typed credentials are never written to these logs or to the audit log.

## Public holidays

`scripts/ehire-cli.sh load-holidays` adds the Cyprus public holidays, with Greek and English names, for this year and the next. `--year 2028` loads one year; repeat the option for more. Dates already in the table are skipped, so it is safe to run again. Easter dates come from the Orthodox calendar in code. 24 December and Easter Tuesday are public-service holidays: remove them in Settings if the organisation does not observe them. Run it once a year, in the autumn, for the year after next.

## Test data (acceptance testing only)

`scripts/ehire-cli.sh load-test-data` loads invented users with every role, lists and seven sample requests (at step 3, step 4, the CEO, rejected, approved, returned, withdrawn; no draft). It asks for one password (typed twice) that all test accounts share. It never takes the password as an option and never prints it. It is allowed in production and safe to run again. Test rows are easy to tell apart: usernames start with `test.`, full names end with the Greek word for "test" in brackets, Directorate and cost-centre codes start with `T-`, and every address ends in `@test.invalid`, so no mail reaches a real mailbox. It refuses when a real person already holds a central role (the test requests would be routed to them). If `archive_transport` is not `none` it warns: the test requests would queue eArchive deposits.

`scripts/ehire-cli.sh clear-test-data` removes all of it before go-live: the test requests with their leavers, actions, financials, documents (files too), tasks, queued mail and archive deposits (with their PDFs), then the test role assignments, users and lists. It shows the counts and asks for a typed confirmation (`--yes` skips). It refuses, changing nothing, and says why, when a real user has acted on or created a test request, when a test deposit reached eArchive (state `stored`), or when real data points at a test row. Audit rows are never deleted: those of test users stay, with the user id emptied, and one `list_changed` row records the clear with the removed users and request numbers. Request numbering goes back to where the real requests left it, so the first real request is number 1.

## Users and locks

- First admin: `scripts/ehire-cli.sh create-admin`.
- Sign-in lock: 5 failed attempts for a username in 15 minutes lock that username for 15 minutes; 20 failures from one address lock the address. Clear it now with `scripts/ehire-cli.sh unlock-user <username>` (add `--ip <address>` for the address). An attacker who knows a username can keep it locked by trying every 15 minutes, which is why the command exists.
- Forgotten password, or a locked-out admin with a local account: `scripts/ehire-cli.sh reset-password <username>`. It asks twice for the new password (never an option), clears that user's sign-in lock and makes them choose their own password at the next sign-in. It is written to the audit log as `password_changed` with `by: cli`. Directory (AD) accounts are refused: reset those in AD.
- Sessions end after 30 minutes without a request (`EHIRE_SESSION_IDLE_MINUTES`) and 12 hours after sign-in (`EHIRE_SESSION_MAX_HOURS`).
- Behind a reverse proxy, set `EHIRE_PROXY_HOPS` to the number of proxies so the lock and the audit log see the user's address and not the proxy's.

## Backup and restore

The database and the storage folder describe the same requests. Back both up as one unit, and restore both from the same backup. A database restored without its documents shows files that do not exist; documents restored without the database are orphans.

**Never copy `ehire.sqlite3` with `cp` or a file backup while the app runs.** In WAL mode part of the data sits in the `-wal` file, so a plain copy can be torn or miss recent commits. `flask backup-db` uses SQLite's online backup, works while the app is running, writes to a temporary name and renames it, never overwrites an existing file, checks the copy and prints its sha256. The backup is a single file in the normal journal mode.

Nightly, as the `ehire` user, two steps that belong together, database first and documents second (a document uploaded in between is then an orphan file, which is harmless; the other order could leave a row without its file):

```
# 1. database   2. document folder   (one folder per night, kept under one timestamp)
30 1 * * *  d=/var/backups/ehire/$(date +\%Y-\%m-\%dT\%H\%M) && mkdir -p "$d" && /opt/ehire/current/scripts/ehire-cli.sh backup-db "$d/ehire.sqlite3" && tar -C /var/lib/ehire -czf "$d/storage.tar.gz" storage >> /var/log/ehire/backup.log 2>&1
```

Then copy the night's folder off this machine (the backup host or share Marios names) and prune old folders (for example keep 30 days). A folder with only one of the two files is not a backup: delete it and look at `backup.log`. Do the same by hand before every upgrade, with the same two commands. Test a restore once a quarter on a spare machine. A backup nobody has restored is a guess.

**Restore.** Stop only `ehire`; touch nothing else.

1. `systemctl stop ehire` (sudo).
2. Keep what is there: move `/var/lib/ehire/ehire.sqlite3`, `ehire.sqlite3-wal` and `ehire.sqlite3-shm` and the `storage` folder into a dated side folder. Do not delete them yet. A stale `-wal` or `-shm` next to a restored file corrupts it, so all three must go.
3. Copy the backup's `ehire.sqlite3` to `/var/lib/ehire/ehire.sqlite3`, unpack `storage.tar.gz` into `/var/lib/ehire/` (it recreates `storage`). Owner `ehire`, as before. Check the file against the sha256 that `backup-db` printed.
4. If the backup is from an older release than the code: `scripts/ehire-cli.sh upgrade-db`. Then `scripts/ehire-cli.sh db-status` (must say `pending=0`) and `scripts/preflight.sh --skip-port`.
5. `systemctl start ehire` (sudo).
6. Health check: `curl -s http://127.0.0.1:5008/healthz` answers `{"status":"ok"}`. Sign in, open a request that has a document and view it.

Other engines are not supported by this guide; `backup-db` refuses them.

## Active Directory

Optional. Local accounts always work, also when the directory is down. With `EHIRE_AD_ENABLED=true`:

- Sign-in tries the local account first. A name that belongs to a local account is never sent to the directory. Any other name is tried against AD: a simple bind as `<username>@<EHIRE_AD_DOMAIN>` with the person's own password (no service account), over LDAPS (`EHIRE_AD_PORT`, default 636), with the server certificate checked against `EHIRE_AD_CA_FILE`. No StartTLS and no plain LDAP.
- The typed name must be the bare account name (`jsmith`, not `jsmith@domain` or `DOMAIN\jsmith`). An empty password is never sent.
- A first successful AD sign-in creates the person as an inactive user with no roles and shows "Your account was created. You can sign in once an administrator activates it." Nobody is emailed. An administrator opens Settings, Users (the row says "Waiting for activation"), presses Activate and gives the roles. Later sign-ins refresh the full name and email from `EHIRE_AD_BASE_DN`.
- AD users have no password in eHire and no password page. The sign-in lock (5 failures in 15 minutes) applies; a locked name is not sent to AD.
- Check the link without the web app, as the `ehire` user: `scripts/ehire-cli.sh ad-test <username>`. It asks for the password (not echoed) and prints the name and email it read, or the kind of failure: cannot connect, certificate not trusted, wrong credentials, user not found under the base DN.
- IT supplies: server name (as in its certificate), domain, search base, the account-name attribute if it is not `sAMAccountName`, and the CA certificate in PEM form for `EHIRE_AD_CA_FILE`.

## Email settings

The `mail_backend` row in the `setting` table chooses the backend: `outbox_only` (default, nothing leaves the app), `smtp` or `graph`. Secrets come from the environment file only.

| Variable | Used by | Meaning |
|---|---|---|
| `EHIRE_BASE_URL` | all | Address in the email button, for example `https://ehire.example.invalid` |
| `EHIRE_SMTP_HOST`, `EHIRE_SMTP_PORT` (587), `EHIRE_SMTP_USER`, `EHIRE_SMTP_PASSWORD`, `EHIRE_SMTP_STARTTLS` (1) | smtp | Mail server |
| `EHIRE_MAIL_FROM` | smtp | Sender address |
| `EHIRE_GRAPH_TENANT`, `EHIRE_GRAPH_CLIENT_ID`, `EHIRE_GRAPH_CLIENT_SECRET`, `EHIRE_GRAPH_SENDER` | graph | App registration with the `Mail.Send` application permission, and the mailbox that sends |

## What the app sends to browsers

Every response carries a Content-Security-Policy (scripts only from the app itself), `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY` (the email preview allows same-site framing), `Referrer-Policy: same-origin`, a minimal `Permissions-Policy` and, for pages and document files, `Cache-Control: no-store`. `Strict-Transport-Security` is sent when `EHIRE_HTTPS=true`, without `includeSubDomains` because the host is shared. The reverse proxy must not strip or replace these headers.
