# Runbook — eCapital on 10.227.56.22

For a human at a terminal, deploying or operating eCapital on the ΟΚΥπΥ
server that already runs eMAP, eQuality, DIAS and eFinance. Read
`deploy/install.sh` and `deploy/release.sh` alongside this — this document
says what to do and why; the scripts say exactly what runs.

**Ports on this server.** `5001` eMAP, `5002` eQuality, `5003` DIAS, `5004`
eFinance, `5011` eArchive (formerly eMetroon) ingest, `5015` eCapital API
(loopback only), `5013` eCapital web (loopback only). Both eCapital
processes bind to `127.0.0.1` — nothing public reaches either port
directly. The host's existing nginx reverse-proxies `ecapital.shso.online`
to `127.0.0.1:5013` on **port `5016`**, and cloudflared (on its own box)
points at nginx's `5016`, not at eCapital directly — see §2.2 and
`deploy/cloudflared-request.md`. Port `80` is Apache's on this host (a
WordPress default vhost and `evendor.shso.org.cy`), and nginx's other
listeners are `8080`–`8082`, `8443`, `8444`, `9443`, `10080`, `10443`
(checked on the server, 30/09/2026).

`5000`-`5006`, `5010`-`5012` and `5055` are already taken by other services
on this host. **Port `5014` is reserved by the host owner — never use it.**

PostgreSQL **16.14 is already installed** on this host, at
`127.0.0.1:5432`, shared with BedMan and eArchive. We do not install or
administer it; §2.1 has what Marios (the host owner) needs to run.

---

## 1. Prerequisites

Before touching the server:

- The WireGuard tunnel to `10.227.56.22` is up. If it looks up but nothing
  answers, eFinance's own note applies here too: a hotspot advertising
  `10.0.0.0/8` can win the route over the tunnel's `0.0.0.0/0`. The fix is
  adding `10.227.56.0/24` to the WireGuard client's `AllowedIPs`, not
  touching Windows routes.
- You can `ssh administrator@10.227.56.22` and that account has sudo.
- Marios (the host owner) has set up the nginx server block in §2.2 and
  confirmed `sudo nginx -t` then `sudo systemctl reload nginx` went
  cleanly. Cloudflared has to point at nginx's port, not at eCapital's own
  `5013` — see `deploy/cloudflared-request.md`.
- The cloudflared request in `deploy/cloudflared-request.md` has been sent
  to whoever administers that box, and ideally already actioned — the
  release will work without it, but nobody outside the server can reach
  `ecapital.shso.online` until it is.
- **BLOCKING, owned by IT.** As of 19/09/2026, `ihcis.local` does not
  resolve from this host and neither 389 nor 636 answer. Before go-live, IT
  must supply the domain controllers' IPs or FQDNs, open 636 (LDAPS) from
  `10.227.56.22`, and give a read-only bind account. Everything below about
  `AUTH_MODE=ldap` assumes this has already happened; do not treat a UAT
  round with no working LDAP as ready for real accounts.

---

## 2. First install

Get `deploy/` onto the server — a git clone, or a plain copy:

```bash
rsync -a --exclude='.git' /path/to/repo/deploy/ administrator@10.227.56.22:/tmp/ecapital-deploy/
ssh -t administrator@10.227.56.22 'cd /tmp/ecapital-deploy && sudo bash install.sh'
```

`-t` gives a terminal, so the sudo prompt and anything interactive actually
work — the same reason eFinance's own deploy command uses it.

`install.sh` is idempotent and safe to re-run. It:

- installs corepack/pnpm 10, and Node 22 **only on a host with no Node at
  all**. `/usr/bin/node` on this server is Node 20, shared with eArchive
  (which has a native module), boardtool and emetroon-review, and it is
  left exactly as found: upgrading it is those teams' change, not ours
  (server review, 30/09/2026). eCapital builds and runs on Node 20 —
  verified on 20.20.2: full build, PDF guides and the whole test suite —
  and `package.json` says so under `engines`. A Node older than 20 stops
  the script with a message rather than upgrading anything. It does
  **not** touch PostgreSQL either, see §2.1;
- creates the `ecapital` system user and `/opt/ecapital`, `/etc/ecapital`,
  `/var/log/ecapital`, `/var/backups/ecapital`, `/opt/ecapital-releases`;
- writes `/etc/ecapital/api.env` and `/etc/ecapital/web.env` from the
  templates in `deploy/env/`, mode `600` owned by `ecapital`, **only if
  they do not already exist** — it never overwrites an env file you have
  already edited;
- installs and enables the two systemd units (`ecapital-api`,
  `ecapital-web` — enabled but not started, since there is no code at
  `/opt/ecapital/apps` yet) and the backup and restore-drill timers
  (enabled but not started either: the `ecapital` database does not exist
  until §2.1 is done, so the release scripts start both timers right after
  the first clean migration);
- puts the two scripts that run as root, `sync-release.sh` and
  `rollback.sh`, at `/usr/local/sbin/ecapital-sync-release` and
  `/usr/local/sbin/ecapital-rollback`, and the server-side release script
  at `/usr/local/bin/ecapital-release-on-server` — root-owned directories,
  **outside** `/opt/ecapital`. That tree belongs to the `ecapital` user, and
  the owner of a directory can replace any file in it whatever that file's
  own owner is; a root-run script living there would have let a compromised
  API process become root on the next release (server review, 30/09/2026).
  The scripts that run as `ecapital` (`migrate.sh`, `install-deps.sh`,
  `backup.sh`, `restore-drill.sh`) stay in `/opt/ecapital/deploy`;
- installs a logrotate stanza for the two flat log files the backup and
  restore-drill scripts write;
- installs a narrow sudoers file for `administrator` — see the comment at
  the top of `deploy/install.sh`'s sudoers block for exactly what it grants
  and why: every line names one fixed script or one fixed systemd unit,
  nothing open-ended.

It does **not** deploy application code. That is `deploy/release.sh`, §6.
It also does **not** touch PostgreSQL or nginx — §2.1 and §2.2 are done by
Marios, by hand, and this script cannot check that either has happened.

### 2.0 The short way: `deploy/first-setup.sh`, once, with sudo

Everything from §2.1 to §5.1 and §11.1, in one command, after `install.sh`:

```bash
sudo bash ~/ecapital-bootstrap/deploy/first-setup.sh --admin-username <your AD account name>
```

It generates the secrets straight into `/etc/ecapital/api.env` without
printing them, creates the PostgreSQL role, database and the two
extensions, makes the eArchive directory, writes the nginx block on `5016`
and reloads only if `nginx -t` passes, runs the release as `administrator`
(without the PDF guides unless `--with-guides`), aligns the `ecapital_app`
password, seeds the UAT data (`--no-seed` for production) and grants the
first administrator. Re-running it keeps every value already set. Added
02/10/2026 after the hand-typed path lost a password to a pasted
placeholder. The sections below describe what it does, step by step, for
anyone who needs to do or check one piece by hand.

### 2.1 Database: Marios creates the role and the database

PostgreSQL 16.14 is already installed on this host, shared with BedMan and
eArchive. We are not its administrator: no superuser access, and no
cluster-wide extensions without asking first. Ask Marios to run this, as
the `postgres` superuser, once:

```sql
CREATE ROLE ecapital LOGIN PASSWORD '<paste from api.env>';
CREATE DATABASE ecapital OWNER ecapital;
```

The password is whatever you are about to put in
`/etc/ecapital/api.env`'s `MIGRATION_DATABASE_URL` (§3) — generate it first,
then hand Marios the block above with the real value pasted in, rather than
asking him to invent one.

The application connects as a second role, `ecapital_app`. Migration 0001
creates it only `if not exists`, and **on this cluster the `ecapital` owner
role may not create roles** (02/10/2026: `permission denied to create
role`), so Marios creates it too, in the same sitting, with the password
that goes in `DATABASE_URL`:

```sql
CREATE ROLE ecapital_app LOGIN PASSWORD '<paste from api.env DATABASE_URL>';
```

`deploy/first-setup.sh` (§2.0) does exactly this, as postgres. The
migration then finds the role and only grants to it.

**Extensions.** Our migrations use `pgcrypto`, and from M2 onward
`pg_trgm`. Both need `CREATE EXTENSION`, which needs superuser — but only
once, and only inside the `ecapital` database, never cluster-wide. Ask
Marios to also run this, once, connected to the `ecapital` database:

```sql
\c ecapital
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS pg_trgm;
```

(`pg_trgm` is not used until M2; asking for it now avoids a second favour
later. If Marios would rather wait, `pgcrypto` alone is enough until then.)

### 2.2 Nginx: reverse proxy for eCapital web

There is no nginx vhost in front of eFinance on this host, but eCapital
gets one, because both its processes now bind to loopback only. It listens
on **`5016`**: port `80` belongs to Apache on this host, and a request with
`Host: ecapital.shso.online` on `80` today gets Apache's
`301 → https://dapsite.shso.online/`, so the block cannot share it
(checked on the server, 30/09/2026). `5016` is free and is the port the
cloudflared request names. Hand Marios this server block, paste-ready:

```nginx
server {
    listen 5016;
    server_name ecapital.shso.online;

    client_max_body_size 25m;  # SAP import uploads (Capex Plan, invoices)

    location / {
        proxy_pass http://127.0.0.1:5013;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

No websocket upgrade headers are needed — eCapital does not use
websockets. After installing the block, Marios runs:

```bash
sudo nginx -t
sudo systemctl reload nginx
```

`nginx -t` catches a syntax error before it can take nginx down; only
reload once it passes clean. We do not edit nginx or cloudflared
ourselves — this block, and the request in
`deploy/cloudflared-request.md`, are what we hand to Marios and to
whoever administers the cloudflared box respectively.

---

### 2.3 Both hostnames until cloudflared is repointed (06/10/2026)

The Cloudflare record `ecapital.shso.online` is not yet pointed at `5016`
(request sent, see `deploy/cloudflared-request.md`), while the older
`capital.shso.online` record still is. Until the admin acts, nginx answers
to both names and the API allows both origins:

```bash
sudo sed -i 's/^\(\s*server_name\s\+\)ecapital\.shso\.online;/\1ecapital.shso.online capital.shso.online;/' /etc/nginx/sites-available/ecapital
sudo nginx -t && sudo systemctl reload nginx
sudo sed -i 's#^CORS_ORIGINS=.*#CORS_ORIGINS=https://ecapital.shso.online,https://capital.shso.online#' /etc/ecapital/api.env
sudo systemctl restart ecapital-api
```

`NEXT_PUBLIC_APP_ORIGIN` stays `https://ecapital.shso.online`: it only
decides that the session cookie is `Secure` and the origin deep links
carry. Once `ecapital.shso.online` answers 200 through cloudflared, take
`capital.shso.online` out of both lines again, same two commands with the
name removed, and ask the admin to delete the old record.

## 3. Filling in the env files

Edit `/etc/ecapital/api.env` and `/etc/ecapital/web.env` on the server
(`sudo -e` or `sudoedit`, since they are mode `600` owned by `ecapital`).
Every `CHANGE-ME` needs a real value before the first release starts the
units. Where each one comes from:

| Variable | Where it comes from |
|---|---|
| `DATABASE_URL`, `MIGRATION_DATABASE_URL` passwords | Generate two different passwords yourself. Give Marios the `ecapital` (owner) one to paste into the `CREATE ROLE` statement in §2.1; the `ecapital_app` (application) role sets its own password the first time `deploy/migrate.sh` creates it, so set that same value on the role afterwards with `sudo -u postgres psql -d ecapital -c "ALTER ROLE ecapital_app PASSWORD '…';"` if it does not already match. |
| `LDAP_URL`, `LDAP_BASE_DN` | **Blocking as of 19/09/2026** — `ihcis.local` does not resolve from this host and 389/636 do not answer. IT must supply the domain controller(s), open 636 (LDAPS), and give a read-only bind account before this can be filled in for real; do not guess a DC name. Once IT responds, prefer `ldaps://<dc>:636`; `ldap://<dc>:389` with `LDAP_START_TLS=1` is the documented fallback only, if 636 turns out not to be reachable. |
| `LDAP_DOMAIN` | `ihcis.local` — fixed, given. |
| `SESSION_SECRET` | Generate on the server, do not reuse any other system's secret: `openssl rand -hex 32`. |
| `EMAP_URL`, `EFINANCE_URL` | The public hostnames already in use: `https://map.shso.online`, `https://finance.shso.online`. Used for human link-outs only — the API's own calls to eFinance (§4 of `INTEGRATION-eFinance-eMAP-eCapital.md`) go straight to `http://127.0.0.1:5004`, not through this hostname. |
| `EFINANCE_TOKEN` | The single bearer token eFinance issues eCapital (eFinance's integration record §2, ADR-0022, ADR-0029). eFinance keeps its copy as `ecapital_token` in its own mode-600 settings file; eCapital's copy is this line. It is made with eFinance's generator and nowhere else — see «Placing the eFinance token» below. |
| `EFINANCE_API_URL` | Where the loopback contract answers. Leave the default `http://127.0.0.1:5004` on this server; change it only on a UAT box that runs eFinance elsewhere. |
| `EFINANCE_PUSH_ENABLED` | **`0` on this UAT server.** Off, eCapital reads invoices, requisitions and the budget position but never sends a contract to eFinance, so the 41 seeded sample contracts cannot reach eFinance's contract picker. Set to `1` only on a deployment whose register is real (the Capex import, not the seed), then `sudo systemctl restart ecapital-api`. Added 02/10/2026, ADR-0029 addendum. |
| `NEXT_PUBLIC_APP_ORIGIN` | `https://ecapital.shso.online` — fixed, once the cloudflared request (§1) is live and pointed at nginx (§2.2). |
| `AUTH_MODE` (api.env) and `NEXT_PUBLIC_AUTH_MODE` (web.env) | `ldap` is the destination. `local` is the bridge while IT has not opened the directory (ADR-0030, §5.0): people sign in with a username and a password the administrator sets in Διαχείριση › Χρήστες. The two files must agree. Never `dev` here. |
| Everything else | The template comments in `deploy/env/*.env.example` say what each one is; most are fixed values for this server (ports, `BIND_HOST=127.0.0.1` on both files, `AUTH_MODE=ldap`, `DEV_AUTH=0`). |

Do not put real values in the repo's `deploy/env/*.env.example` — those stay
templates with `CHANGE-ME`.

### Placing the eFinance token

Placed on 02/10/2026 with eFinance's own generator, on the server:

```bash
sudo python3 /tmp/ecapital_token.py --force
```

The generator writes the new token into eFinance's settings file
(`ecapital_token`) and hands back the same value, which is captured into
`/etc/ecapital/api.env` as `EFINANCE_TOKEN=…` — file to file, the same way
the eArchive token is handled (§11.2). Never type it into a chat, an email
or a ticket, and never into the repo. `--force` replaces whatever token was
there before, so **both files change together or eCapital is locked out**
(§10, «UNAUTHENTICATED»). Then restart the API, which reads the token at
boot:

```bash
sudo systemctl restart ecapital-api
journalctl -u ecapital-api --since -2min | grep -i efinance   # no «not configured» line
```

With the token unset, blank or still `CHANGE-ME`, the API boots anyway and
holds: contracts are not pushed, nothing is read, the screens show eFinance
as not configured. Within ten minutes of the restart the retry pushes every
contract that has a budget code and a contractor with a SAP vendor code
(ADR-0029 §2); `POST /admin/efinance/sync` then reads what eFinance has.

---

## 4. First migrate, and the seed decision

Run the migration once the database and env files are in place — the
easiest way the first time is by hand, before there is a release to attach
it to:

```bash
ssh -t administrator@10.227.56.22 'sudo -u ecapital /opt/ecapital/deploy/migrate.sh'
```

(After the first release, `deploy/release.sh` runs this on every release —
`migrate` is safe to run twice, per `apps/api/README.md`.)

### Seed: yes on UAT, no on production

**The first deployment on `10.227.56.22` is UAT.** Run
`pnpm --filter @ecapital/api seed` — sample projects included — on it, per
the decision below. When this server is later promoted to production, or a
separate production host is stood up, that deployment does **not** run
`seed`; it takes the Capex Plan import instead. Nothing about this decision
changes which host `10.227.56.22` ends up being long-term, only what its
first deployment does.

`pnpm --filter @ecapital/api seed` loads the twelve org units (ADR-0024: the
Ambulance Service left ΟΚΥπΥ on 19/09/2026, so it is eight hospitals, ΔΥΨΥ,
ΠΦΥ and Κεντρικά Γραφεία; ADR-0024's addendum, 20/09/2026, adds Κοινοτική
Νοσηλευτική as a unit of its own), one building, eight development users **and 41
fixture projects with twelve fixture contractors** (`apps/api/src/db/seed-data.ts`, `seed-projects.ts`,
`seed-contracts.ts`, `seed-site.ts` — all idempotent). That fixture data is
exactly what a UAT environment needs and exactly what production must never
see: a board member or a real estates head must not find a made-up project
sitting in the live register.

- **UAT: run `seed`.** It gives testers real screens with real-looking data
  from the first sign-in, sample projects included.
- **Production: do NOT run `seed`.** This warning stands regardless of which
  decision above put a given deployment in "production": the twelve org
  units are the only piece of the seed production needs, and they go in by
  hand or by trimming the seed to just the org-unit rows if that becomes a
  maintained option later — check `seed-data.ts` before assuming it already
  offers that split. The group→role mappings are no longer needed at all:
  roles are assigned per user in Διαχείριση › Χρήστες (§5, ADR-0020).
- **Re-running the seed after a release that adds sample data (UAT only).**
  M5 (06/10/2026) added the maintenance sample: two agreements, the Nicosia
  SLA catalogue, schedules, orders and backlog items. A release runs the
  migrations and not the seed, so on this UAT server run it once by hand
  after the release, as `administrator`:

  ```bash
  sudo bash ~/ecapital-release/deploy/install.sh   # only when deploy/ changed since the last install; always from the staged checkout, never from /opt/ecapital/deploy, which is the OLD copy (08/10/2026: seed.sh was missing for exactly this reason)
  sudo -u ecapital /opt/ecapital/deploy/seed.sh
  ```

  `seed.sh` is `migrate.sh`'s twin: it loads `/etc/ecapital/api.env` and
  runs `pnpm --filter @ecapital/api seed` from `/opt/ecapital`. The seed is
  idempotent: what is already there is updated in place, never duplicated,
  and a tag or reference already issued is kept. The last line it prints
  is the count of everything it holds.
- **Production's real seed is the Capex Plan import**, `import:capex`
  (`apps/api/README.md` "Importing the Capex Plan"). That is what puts the
  113 real projects and their budget lines into the live register. Run
  `inspect`, then a dry run, then read the reconciliation report, then
  `--commit` — in that order, every time, per the README. Never run this
  against production data on a whim; it is a real import into the system of
  record.

---

## 5. The first administrator, and giving people their roles

Roles are **not** AD groups (ADR-0020, owner decision 19/09/2026). Active
Directory only authenticates; who may do what is assigned to a person, inside
eCapital, by an administrator — the same way eFinance does it. So a fresh
database needs exactly one thing done from the server, and everything after
that happens in the screen.

### 5.0 Before the directory answers: local accounts (ADR-0030)

As of 05/10/2026 the directory is not reachable from this host (§1), so
`ldap` lets nobody in. Until IT answers, the server runs `local` mode:
the same sign-in screen, with the password held by eCapital and set by
the administrator in the screen. Switch it on once, as `administrator`:

```bash
sudo sed -i 's/^AUTH_MODE=.*/AUTH_MODE=local/' /etc/ecapital/api.env
sudo sed -i 's/^NEXT_PUBLIC_AUTH_MODE=.*/NEXT_PUBLIC_AUTH_MODE=local/' /etc/ecapital/web.env
sudo systemctl restart ecapital-api ecapital-web
```

Then the first account, which is also the first administrator. It asks
for the password twice, echo off, and never prints it:

```bash
sudo ecapital-set-password admin --create-admin
```

(`ecapital-set-password` is installed by `install.sh`; re-run
`sudo bash ~/ecapital-bootstrap/deploy/install.sh` after a `git pull` if
the command is missing.) From here on everything happens in the screen:
sign in as that account, open **Διαχείριση › Χρήστες**, add people with
«Προσθήκη», save, open the row again and set a password under «Κωδικός
eCapital». The twelve seeded sample accounts are in the same list and
take a password the same way; they sign in by their address.

Rules while the mode is on: eight characters at least, hand a password
over by voice and never by email, and five wrong tries lock the name for
fifteen minutes (`sudo systemctl restart ecapital-api` clears every lock
at once).

**The day IT opens the directory:** fill `LDAP_URL` and `LDAP_BASE_DN`
(§3), set both `AUTH_MODE` lines back to `ldap`, restart both units.
Every account made in local mode carries `subject = ad:<username>`,
exactly like a pre-registered one, so the first Active Directory sign-in
adopts it with its roles and units (ADR-0020). The passwords are never
read again. Accounts whose username is not an AD account name (the
seeded samples, or `admin`) simply stop being able to sign in.

### 5.1 Create the first administrator

The screen that assigns roles is administrator-only, and a fresh database has
no administrator in it. Break into it once, with a shell:

```bash
cd /opt/ecapital
sudo -u ecapital env $(grep -v '^#' /etc/ecapital/api.env | xargs) \
  pnpm --filter @ecapital/api grant-admin -- \
    --username a.papadopoulos \
    --name "Ανδρέας Παπαδόπουλος" \
    --email a.papadopoulos@shso.org.cy
```

`--username` is the **sAMAccountName**, exactly as the person types it at the
sign-in screen — not the UPN and not the address. `--name` and `--email` are
optional: they fill the row until the first Active Directory sign-in
overwrites them with what the directory holds.

It prints what it did:

```
account a.papadopoulos: created (subject ad:a.papadopoulos)
role admin: granted
units: 11 unit(s)
```

The account does not have to exist in eCapital first. The row is
pre-registered with `subject = ad:<username>`; the first AD bind finds it by
account name and moves the subject onto the objectGUID, so the role is in
force the first time the person signs in. Running the command twice is safe —
the second run prints `already held`.

The command runs over the migration connection and writes an audit row under
the actor `cli:<os user>`. There is no way to run it without that trail.

### 5.2 Sign in and use the screen

1. Open `https://<the eCapital hostname>/` and sign in with that AD account.
2. Go to **Διαχείριση › Χρήστες**.
3. Either press «Προσθήκη» and pre-register the people you already know about
   — account name, name, roles, units — or wait for them to sign in once and
   then open their row and give them their roles.

A person who has signed in but has no role sees an empty application. That is
the safe direction and not a fault: the account exists, nobody has given it
anything yet. Their row in Διαχείριση › Χρήστες shows a last sign-in and no
roles, which is where to look first when somebody reports a blank screen.

Roles that reach every unit — Διαχειριστής, Οικονομική Διεύθυνση, Διοίκηση,
Ελεγκτής — ignore the unit list. Every other role needs at least one unit or
it grants nothing.

### 5.3 Appoint the auditor

CAPEX-01 §10: the auditor cannot be edited by an administrator. The screen
refuses `auditor_readonly` in both directions, so the appointment is made on
the server:

```bash
cd /opt/ecapital
sudo -u ecapital env $(grep -v '^#' /etc/ecapital/api.env | xargs) \
  pnpm --filter @ecapital/api grant-role -- \
    --username c.loizou --role auditor_readonly
```

Add `--revoke` to take it away again. `--role` accepts only the eight roles;
anything else is refused with the list printed.

### 5.4 AD groups, if you ever want them (optional)

`ecapital.role_mapping` is still there and still read. A sign-in takes the
**union** of the roles assigned in the screen and whatever the caller's AD
groups map to here, and never deletes an assignment. The table is empty on a
fresh database and nothing needs it.

Use it only if the organisation decides it would rather drive some roles from
AD after all. The column `group_id` holds the group's **distinguished name**
under `AUTH_MODE=ldap`; a null `org_unit_id` means every unit.

```sql
insert into ecapital.role_mapping (group_id, role, org_unit_id, note)
values ('CN=eCapital-Admins,OU=Groups,DC=ihcis,DC=local', 'admin', null,
        'Central IT — added 2026-xx-xx');

select rm.role, coalesce(ou.code, '(all units)') as unit, rm.group_id, rm.note
from ecapital.role_mapping rm
left join ecapital.org_unit ou on ou.id = rm.org_unit_id
order by rm.role, unit;
```

Run these as the `ecapital` (owner) role — `psql "$MIGRATION_DATABASE_URL"`
from `/etc/ecapital/api.env`. A row takes effect the next time that user signs
in; nothing needs restarting.

### 5.5 Switching an account off

Open the person's row in Διαχείριση › Χρήστες and clear «Ενεργός
λογαριασμός». They are refused at the next sign-in, and the session they are
already holding stops at their next request. There is no need to touch Active
Directory, and an account switched off in AD is refused at the bind anyway.

---

## 6. Release procedure

From the operator's machine, tunnel up:

```bash
cd /path/to/repo
bash deploy/release.sh
```

It builds locally, ships the build to the server, backs up the previous
release, syncs it into place, installs dependencies, migrates, restarts
both units, checks them, and prints md5 sums and a rollback command. Read
the header of `deploy/release.sh` for the exact sequence and why it is
in-place-with-a-backup rather than a symlink swap. The local build step also
runs `pnpm guides:build` (R50), so every release ships the sixteen
per-persona PDF guides freshly rendered from the current `docs/manual`
source, versioned with that release's git short SHA — the build aborts
before anything ships if `apps/web/src/help/map.json` names a manual
section that no longer exists.

If the md5 sums it prints do not match between local and remote, or a
health check fails, **stop** — do not tell anyone the release is done. An
empty value from a remote command means that command failed, not that the
file is empty or that "everything differs" (the same rule eFinance's own
notes give for `sudo md5sum` with no password).

After every release, run through §7 and archive the deploy checklist per
`docs/deploy-checklist.md`.

### 6.1 Server-side variant: no toolchain on the operator's machine

`deploy/release.sh` builds on the operator's laptop, which needs bash,
rsync, ssh, Node 22 and pnpm there. When the operator has only an SSH
client, the same release runs on the server instead:

```bash
ssh administrator@10.227.56.22
ecapital-release-on-server --ref <branch, tag or commit>
```

`install.sh` puts it at `/usr/local/bin/ecapital-release-on-server`. It runs as `administrator`, never as root,
fetches the ref of the public repository into `~/ecapital-src/tree` over
the host's proxy (git reads `https_proxy` from `/etc/environment`), builds
there, stages into `~/ecapital-release`, and from that point on calls
exactly what `release.sh` calls over ssh: `ecapital-sync-release`,
`install-deps.sh`, `migrate.sh`, the start of the two timers, the two
restarts, the health checks and the md5 table. It needs no sudoers line the file in §2 does not already
carry, and it never touches `/etc/ecapital` or the database itself.

Two things to know:

- **The PDF guides need Chromium on the server** (R50, `pnpm guides:build`).
  The first run prints the two one-time commands when it is missing: the
  browser's shared libraries as root (`playwright install-deps chromium`,
  Marios types the sudo), then the browser itself as `administrator`
  (`playwright install chromium`, into `~/.cache/ms-playwright`). Until
  then `--skip-guides` ships without fresh guides; write that down in the
  deploy checklist as a deviation, it is not the normal path.
- **If git cannot reach GitHub through the proxy**, download the branch as
  a ZIP from GitHub's web page, `scp` it to the server, and pass
  `--zip <file>` instead of `--ref`. Needs `unzip` on the host.

Everything in §7 and `docs/deploy-checklist.md` applies unchanged.

**A change under `deploy/` needs `install.sh` again.** The release syncs
`apps/` and `packages/` only; the helper scripts in `/opt/ecapital/deploy`
and the two in `/usr/local/sbin` are copies `install.sh` made. After a
`git pull` that touches `deploy/`, re-run `sudo bash <checkout>/deploy/install.sh`
(idempotent, never overwrites an env file) before the next release.

---

## 7. Smoke tests

Run these after every release, from a browser reaching
`https://ecapital.shso.online`. If cloudflared is not wired up yet but nginx
is (§2.2), the same nginx port works directly:
`http://10.227.56.22:5016`. eCapital's own `5013` is loopback-only
and unreachable from off the box even over the WireGuard tunnel; to bypass
both nginx and cloudflared for a quick check, SSH in and curl
`127.0.0.1:5013` on the server itself, or open an SSH local port forward
(`ssh -L 5013:127.0.0.1:5013 administrator@10.227.56.22`) and browse
`http://localhost:5013` on your own machine.

1. **Sign in as a real AD user.** eCapital's Greek sign-in test accounts are
   `ihcis.local` accounts this document does not know — get real
   credentials for at least one mapped user from whoever administers AD,
   or from the eFinance team, before the first UAT round. Do not invent
   test usernames here.
2. **Unit switcher** shows the units that user's role mapping grants, and
   nothing else.
3. **S01** (the portfolio screen) loads with a KPI strip and RAG counts for
   those units.
4. **Create a project** and confirm it gets a code in the
   `<UNIT>-<year>-<seq>` shape (ADR-0014).
5. **`/contracts?q=CAP-…`** resolves a real contract reference the way
   eMAP's own `/contracts?q=` does (INTEGRATION-eMAP.md §3) — try it with a
   ref that exists once contracts have been awarded.

If any of these fail right after a release, check the failure modes in §10
before assuming the release itself is bad.

---

## 8. Rollback

```bash
ssh -t administrator@10.227.56.22 "sudo /usr/local/sbin/ecapital-rollback <stamp>"
```

`<stamp>` is the one `deploy/release.sh` printed for the release you are
undoing (also `ls /opt/ecapital-releases` on the server). This restores
**code only** — it deliberately does not touch the database. Migrations in
this codebase are forward-only, hand-written SQL with no down scripts
(ADR-0008), so rolling back code after a release that also migrated the
schema is not automatically consistent. Read what `rollback.sh` prints at
the end before assuming the rollback alone fixed things; if in doubt,
restore the matching backup into a scratch database first (§9) and compare.

After a rollback: `sudo -u ecapital /opt/ecapital/deploy/install-deps.sh`
(the restored `pnpm-lock.yaml` may need different `node_modules`), then
restart both units.

---

## 9. Backups and the restore drill

- **Nightly**, 02:20 — `ecapital-backup.timer` runs `pg_dump --format=custom`
  into `/var/backups/ecapital/ecapital-<stamp>.dump`, keeps 30 days. Log:
  `/var/log/ecapital/backup.log`.
- **Monthly**, 1st at 03:00 — `ecapital-restore-drill.timer` restores the
  latest dump into a scratch database (`ecapital_restore_drill`), counts
  `ecapital.project` rows, compares against the live count with a 10%
  shrink tolerance, and drops the scratch database either way. Log:
  `/var/log/ecapital/restore-drill.log`. This satisfies CAPEX-01 §3's
  "monthly test restore, logged" — check the log monthly; a gap in it is
  itself the finding, the same way eFinance's own heartbeat note treats "it
  never ran" as a failure mode distinct from "it ran and found nothing
  wrong".
- Run either by hand: `sudo systemctl start ecapital-backup.service` /
  `ecapital-restore-drill.service`, then read the log.
- Neither backup ever leaves this machine. If off-box backup retention
  becomes a requirement, that is new work, not something either script does
  today — say so rather than assume it is covered.

---

## 10. Logs, health, and what to do when things fail

- **Logs**: `journalctl -u ecapital-api` / `-u ecapital-web` — both log JSON
  lines to the journal (no separate app log files; see
  `apps/api/README.md` "Notes"). Add `--since -10min` or `-f` as needed.
- **Health**: `curl --noproxy '*' http://127.0.0.1:5015/health` — liveness,
  database reachability, last applied migration, no token required
  (`apps/api/README.md`, `GET /health`). Always use `--noproxy '*'`: the
  corporate Squid proxy answers with a fake `503` otherwise, on this server
  as on eFinance's.

**Migration stops with `DATABASE_URL: Invalid input: expected string,
received undefined`.** `migrate.sh` loads `/etc/ecapital/api.env` itself
(since 02/10/2026; the first UAT release hit this). Either the installed
copy of `migrate.sh` is older than that — re-run `install.sh` — or
`api.env` is missing, unreadable by `ecapital`, or still carries
`CHANGE-ME` in `DATABASE_URL` (§3).

**`ecapital-web` restart-loops with `Invalid project directory provided,
no such directory: /opt/ecapital/apps/web/-p`.** The installed unit file is
older than 02/10/2026 and still starts Next through `pnpm … start -- -p`,
which pnpm 10 forwards literally. Re-run `install.sh` (it re-installs the
unit and reloads systemd), then `sudo systemctl restart ecapital-web`.

**API refuses to boot, journal says something about `DEV_AUTH`.**
`config.ts` refuses to start with `DEV_AUTH=1` while `NODE_ENV=production`
(ADR-0009) — that guard is doing its job. Fix: set `DEV_AUTH=0` in
`/etc/ecapital/api.env` (it should already be, from the template) and
restart.

**Port 5013 (or 5015) already in use.** Something else is bound to it —
check with `sudo ss -ltnp | grep -E ':5013|:5015'`. Nothing else on this
server should be using either port (§ports table above); if something is,
find out what before killing it. Remember `5014` is reserved by the host
owner and `5000`-`5006`, `5010`-`5012`, `5055` belong to other services —
never reassign eCapital onto any of them.

**A 503 that looks like it came from nowhere.** This is almost always the
host's Squid proxy, not eCapital or nginx. `/etc/environment` sets
`http_proxy` for interactive shells, but systemd units do not inherit it —
so any loopback call eCapital's API makes (for example to eFinance on
`127.0.0.1:5004`) can still get routed through Squid if `NO_PROXY` is
missing from the unit, and Squid answers with a fake `503` for a
destination it cannot reach as a proxy. Both systemd units
(`deploy/systemd/ecapital-api.service`, `ecapital-web.service`) set
`Environment=NO_PROXY=127.0.0.1,localhost` for exactly this reason — if a
unit's file has lost that line, that is the fix, not chasing the 503
anywhere else. The same rule applies to any `curl` run by hand on this
server: always add `--noproxy '*'`.

**eFinance answers `UNAUTHENTICATED` (401).** A contract's
`GET /contracts/:id/efinance` shows `lastError: "UNAUTHENTICATED: …"`, or a
sync reports it per feed. eFinance's `ecapital_token` and eCapital's
`EFINANCE_TOKEN` disagree — almost always because the generator was run
again with `--force` (§3) and only one of the two files took the new value,
or because `ecapital-api` was not restarted after `api.env` changed. Run the
generator once more and capture its value into `api.env` (§3, «Placing the
eFinance token»), restart `ecapital-api`, and press
`POST /contracts/:id/efinance/push` on one contract to see it answer; the
ten-minute retry takes the rest. A `403 LOOPBACK_ONLY` instead means the
call did not come straight from this host to `127.0.0.1:5004` — check
`EFINANCE_API_URL` and the `NO_PROXY` line above.

**Postgres authentication failures.** Check the password in
`/etc/ecapital/api.env` matches what the role actually has
(`ALTER ROLE … PASSWORD …`, §3) — a mismatch here is the most common cause,
especially right after Marios first creates the `ecapital` role (§2.1) or
right after the first migration creates `ecapital_app`, before either
password has been set to match the env file. `sudo -u postgres psql -c
"\du"` lists the roles; it does not show passwords.

**Empty output from a privileged command.** Treat it as "the command
failed", never as "the answer is empty" or "everything differs" — the same
rule eFinance's CLAUDE.md gives for `sudo md5sum` with no password.

---

## 11. eArchive

eArchive (formerly eMetroon — the paths on this host still say `emetroon`)
is ΟΚΥπΥ's protocol and records system, and it runs on this same server.
eCapital files three kinds of paper with it: the award decision on a
contract, the business case behind a project and an approved variation. It
keeps the protocol number eArchive assigns and a pointer to it — **eCapital
is not an archive and never holds a second copy of one** (ADR-0023,
`docs/INTEGRATION-eFinance-eMAP-eCapital.md` §6).

Three things have to be true before a document can leave this server: the
directory exists and is the API's to write, the token is in both
configurations, and the unit has been restarted since.

### 11.1 The document directory

Paste-ready, once, as `administrator`:

```bash
sudo install -d -o ecapital -g ecapital -m 0750 /var/lib/ecapital/documents
sudo ls -ld /var/lib/ecapital/documents
```

Expected: `drwxr-x--- … ecapital ecapital … /var/lib/ecapital/documents`.

This is `DOCUMENT_STORE_DIR` in `/etc/ecapital/api.env`. The systemd unit
lists it under `ReadWritePaths`, so it is the only place outside the release
tree the API may write — if the directory is missing or owned by somebody
else, uploads fail with a permission error and nothing is queued.

What lives here is the operational copy: the bytes the multipart upload
needs in hand, and which a retry an hour later still needs. It is not a
document store for people to browse, it is not backed up as if it were the
archive, and a file in it whose item has been filed is of no further
interest — eArchive has it.

### 11.2 The token

**The value lives in eArchive's own configuration and is copied from there
into ours, file to file, on this server** (agreed with the eArchive session,
02/10/2026). eArchive generated it on 19/09/2026 and keeps it in
`/opt/emetroon/.env`, line `ECAPITAL_INGEST_TOKEN=`, a file of the `emetroon`
user, mode 600. It is never sent by email, never pasted into a chat, never
committed, and never written into a deployment note — including this one.
Marios runs, as `administrator`:

```bash
T=$(sudo grep -m1 "^ECAPITAL_INGEST_TOKEN=" /opt/emetroon/.env | cut -d= -f2-)
[ -n "$T" ] && sudo sed -i "s|^ECAPITAL_INGEST_TOKEN=.*|ECAPITAL_INGEST_TOKEN=$T|" /etc/ecapital/api.env \
  && sudo systemctl restart ecapital-api && echo copied || echo "NOT FOUND in /opt/emetroon/.env — nothing changed"
unset T
```

Then prove both sides hold the same value without showing it — two identical
lines means they match:

```bash
sudo grep -m1 "^ECAPITAL_INGEST_TOKEN=" /opt/emetroon/.env   | cut -d= -f2- | sha256sum
sudo grep -m1 "^ECAPITAL_INGEST_TOKEN=" /etc/ecapital/api.env | cut -d= -f2- | sha256sum
```

(`deploy/first-setup.sh` writes a random value into `api.env` first; this
copy replaces it. The earlier text here, "Marios generates it and writes it
into both files", is superseded: eArchive's copy is the one that counts.)

The same string is then in two places:

1. `/etc/ecapital/api.env` → `ECAPITAL_INGEST_TOKEN=…` (replacing
   `CHANGE-ME`). eCapital sends it to eArchive on every ingest call **and**
   checks it on every callback eArchive makes back.
2. eArchive's own configuration, as the token it issues eCapital. That side
   is eArchive's to place; ask them for the setting name.

Then:

```bash
sudo systemctl restart ecapital-api
journalctl -u ecapital-api --since -2min | grep -i earchive
```

With no token — or with `CHANGE-ME` still in the file — the API boots
normally and logs a warning, documents are recorded and queued, and
**nothing is sent**. That is the intended state until the token is placed;
it is a hold, not a fault. `GET /admin/dms/outbox` reports
`senderConfigured: false` while it lasts.

### 11.3 Checking it works

```bash
# The queue, as an administrator (a signed-in admin token, not the eArchive one).
curl --noproxy '*' -H "Authorization: Bearer <admin token>" \
  http://127.0.0.1:5015/admin/dms/outbox | head -c 400
```

`senderConfigured: true` and items moving from `QUEUED` to `SENT` with a
`protocolNumber` like `ΤΥ/2026/00001` is what success looks like. An item at
`FAILED` carries eArchive's own code — `SCHEMA_INVALID`, `MIME_REJECTED`,
`DUPLICATE_SOURCE_REF` and the rest — and the administrator has had an
`email_outbox` line about it. A failed item is never retried on its own;
`POST /admin/dms/outbox/<id>/retry` is how somebody says try again after
the cause has been dealt with.

The callback runs the other way: eArchive calls
`POST http://127.0.0.1:5015/api/v1/dms/events` with the same bearer token,
for `protocol.deleted`, `legal_hold.set` and `legal_hold.cleared`. It is
**loopback only** — a request carrying `X-Forwarded-For`, `X-Real-IP`,
`Forwarded`, `CF-Connecting-IP` or `CF-Ray` is refused `403`, the same rule
§10's eFinance contract states in the other direction (ADR-0022). If
eArchive's calls are being refused with 403, something is putting the
request through a proxy that adds one of those headers; that is the thing to
fix, not the rule.

**A 503, or a `CONNECTION_FAILED` on every item.** Same cause as §10's
entry: the host's Squid proxy. The unit sets
`Environment=NO_PROXY=127.0.0.1,localhost`, which covers eFinance on `5004`
and eArchive on `5011` alike; if that line has gone from the unit file, that
is the fix. Confirm with:

```bash
systemctl show ecapital-api -p Environment | tr ' ' '\n' | grep -i no_proxy
```

### 11.4 Samples for eArchive

`docs/integration/ecapital-dms-samples/` holds one `meta.json` per item
type and a `curl` example with placeholders, the same way the eFinance
contract was handed over. Send that directory to eArchive when asking them
to test the route — it carries no token and no real document.
