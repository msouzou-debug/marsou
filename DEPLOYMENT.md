# Deploying the OKYpY vendor-cleanup + invoice-agent apps

Both apps run on **one on-prem Linux VM** inside the OKYpY network (a Windows
server also works — see the note at the end). Nothing here needs internet
access at runtime except `pip install` during setup (use your proxy/mirror).

## What gets deployed

| App | Web UI | Background job |
|---|---|---|
| `vendor-cleanup/` | review queue, four-eyes approvals, exports — port **8090** | monthly `import` when new SAP extracts land |
| `invoice-agent/` | approval / review app (Greek UI) — port **8091** | daily pipeline at 06:30 (built-in scheduler) |

## 1. Prerequisites (once, as root)

```bash
apt-get update
apt-get install -y python3.11 python3.11-venv git \
    tesseract-ocr tesseract-ocr-ell poppler-utils
```

`tesseract-ocr-ell` + `poppler-utils` are **required in production** — Cyta and
EAC bills are scanned/garbled PDFs that only extract through OCR. Without them
every such bill lands in the review queue.

## 2. Install / update

```bash
sudo mkdir -p /opt/okypy && sudo chown $USER /opt/okypy
cd /opt/okypy
git clone -b claude/new-session-ve1lkl https://github.com/msouzou-debug/marsou.git app
# later updates:  cd /opt/okypy/app && git pull
./app/deploy/install.sh          # creates venv, installs both apps' requirements
```

## 3. Configure (before first start)

- `app/vendor-cleanup/config/settings.yaml` — real reviewer/approver emails.
- `app/invoice-agent/config/settings.yaml` — mailbox tenant/client IDs, watch
  folder UNC/mount, entities, approval users + € limits, alert recipients,
  `notifications.transport: smtp` (set `SMTP_HOST` in the env file).
- `/opt/okypy/env` (chmod 600, **never in git**):

  ```
  GRAPH_CLIENT_SECRET=...
  SMTP_HOST=mail.okypy.internal
  SMTP_PORT=25
  ```

- Drop the current SAP extracts into `app/vendor-cleanup/input/`.
- Leave `shadow_mode: true` in the invoice agent until the vendor-cleanup
  go-live gate is met (shared-IBAN groups resolved + mapping published).

## 4. Services (systemd)

```bash
sudo cp app/deploy/*.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now vendor-cleanup-web invoice-agent-web invoice-agent-daily
```

| Unit | What it runs |
|---|---|
| `vendor-cleanup-web` | waitress on 127.0.0.1:8090 |
| `invoice-agent-web` | waitress on 127.0.0.1:8091 |
| `invoice-agent-daily` | `run_daily.py` (blocking scheduler, fires at `schedule.daily_at`) |

The web apps bind to the internal interface only. Put your internal reverse
proxy (IIS/nginx) with the internal HTTPS cert in front if users reach them by
hostname; otherwise share the `http://<vm>:8090` / `:8091` URLs directly on
the LAN and adjust `server.host` to the VM's LAN IP.

## 5. First run + smoke test

```bash
cd /opt/okypy/app/vendor-cleanup && ../venv/bin/python -m vendor_cleanup import
cd /opt/okypy/app/invoice-agent  && ../venv/bin/python run_daily.py --now
../venv/bin/python tests/test_agent.py        # 35 tests must pass on the VM
```

Then open both web UIs, log in as a configured user, and confirm the queue
pages render.

## 6. Updating after code changes

```bash
cd /opt/okypy/app && git pull
sudo systemctl restart vendor-cleanup-web invoice-agent-web invoice-agent-daily
```

SQLite migrations apply automatically on the next start/run. Databases,
archives and outputs live outside git, so `git pull` never touches data.

## 7. Backups (§10)

Weekly encrypted copy of `vendor-cleanup/vendor_cleanup.db`,
`invoice-agent/db/`, and `invoice-agent/archive/` to the location IT
designates — a cron line with `tar | gpg` to the backup share is enough.

## Windows server instead?

Everything runs the same under Python 3.11 for Windows: use Task Scheduler
for `run_daily.py --now` (daily 06:30) and the monthly import, `nssm` (or two
scheduled at-boot tasks) to keep the two waitress web apps running, and
install the tesseract Windows build with Greek language data.
