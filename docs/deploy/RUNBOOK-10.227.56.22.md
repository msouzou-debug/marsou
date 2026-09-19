# Runbook — eCapital on 10.227.56.22

For a human at a terminal, deploying or operating eCapital on the ΟΚΥπΥ
server that already runs eMAP, eQuality, DIAS and eFinance. Read
`deploy/install.sh` and `deploy/release.sh` alongside this — this document
says what to do and why; the scripts say exactly what runs.

**Ports on this server.** `5001` eMAP, `5002` eQuality, `5003` DIAS, `5004`
eFinance (fronted by nginx on `8081`), `5015` eCapital API (loopback only),
`5005` eCapital web (this is what cloudflared reaches). PostgreSQL `5432` is
new for this host — none of the four siblings use it, they run on SQLite or
their own store.

---

## 1. Prerequisites

Before touching the server:

- The WireGuard tunnel to `10.227.56.22` is up. If it looks up but nothing
  answers, eFinance's own note applies here too: a hotspot advertising
  `10.0.0.0/8` can win the route over the tunnel's `0.0.0.0/0`. The fix is
  adding `10.227.56.0/24` to the WireGuard client's `AllowedIPs`, not
  touching Windows routes.
- You can `ssh administrator@10.227.56.22` and that account has sudo.
- The cloudflared request in `deploy/cloudflared-request.md` has been sent
  to whoever administers that box, and ideally already actioned — the
  release will work without it, but nobody outside the server can reach
  `capital.shso.online` until it is.
- You know, or can get, the on-prem Active Directory details eFinance
  already uses: its `ad_server`, `ad_port`, `ad_use_ssl` and `ad_base_dn`
  settings (`ihcis.local`). eCapital signs in against the same directory
  (`AUTH_MODE=ldap`) — see §3.

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

- installs Node 22, corepack/pnpm 10, and PostgreSQL 16 from PGDG;
- creates the `ecapital` system user and `/opt/ecapital`, `/etc/ecapital`,
  `/var/log/ecapital`, `/var/backups/ecapital`, `/opt/ecapital-releases`;
- creates the `ecapital` (owner) and `ecapital_app` (application) Postgres
  roles and the `ecapital` database, with **placeholder passwords** it
  prints — change them (§3) before the first release;
- writes `/etc/ecapital/api.env` and `/etc/ecapital/web.env` from the
  templates in `deploy/env/`, **only if they do not already exist** — it
  never overwrites an env file you have already edited;
- installs and enables the two systemd units (`ecapital-api`,
  `ecapital-web` — enabled but not started, since there is no code at
  `/opt/ecapital/apps` yet) and the backup and restore-drill timers
  (started immediately, since they only need Postgres);
- installs a logrotate stanza for the two flat log files the backup and
  restore-drill scripts write;
- installs a narrow sudoers file for `administrator` — see the comment at
  the top of `deploy/install.sh`'s sudoers block for exactly what it grants
  and why: every line names one fixed script or one fixed systemd unit,
  nothing open-ended.

It does **not** deploy application code. That is `deploy/release.sh`, §5.

---

## 3. Filling in the env files

Edit `/etc/ecapital/api.env` and `/etc/ecapital/web.env` on the server
(`sudo -e` or `sudoedit`, since they are `0640 root:ecapital`). Every
`CHANGE-ME` needs a real value before the first release starts the units.
Where each one comes from:

| Variable | Where it comes from |
|---|---|
| `DATABASE_URL`, `MIGRATION_DATABASE_URL` passwords | Set with `sudo -u postgres psql -c "ALTER ROLE ecapital PASSWORD '…';"` and the same for `ecapital_app` (install.sh printed this reminder). Pick two different, generated passwords; put the same values in the env file. |
| `LDAP_URL`, `LDAP_BASE_DN` | eFinance's own AD settings — `/opt/finance/settings.json`'s `ad_server`, `ad_port`, `ad_use_ssl`, `ad_base_dn` (eFinance CLAUDE.md, "Auth"). Same directory, same values; there is no reason eCapital should bind to a different DC or search base. |
| `LDAP_DOMAIN` | `ihcis.local` — fixed, given. |
| `SESSION_SECRET` | Generate on the server, do not reuse any other system's secret: `openssl rand -hex 32`. |
| `EMAP_URL`, `EFINANCE_URL` | The public hostnames already in use: `https://map.shso.online`, `https://finance.shso.online`. |
| `NEXT_PUBLIC_APP_ORIGIN` | `https://capital.shso.online` — fixed, once the cloudflared request (§1) is live. |
| Everything else | The template comments in `deploy/env/*.env.example` say what each one is; most are fixed values for this server (ports, `BIND_HOST`, `AUTH_MODE=ldap`, `DEV_AUTH=0`). |

Do not put real values in the repo's `deploy/env/*.env.example` — those stay
templates with `CHANGE-ME`.

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

`pnpm --filter @ecapital/api seed` loads the twelve org units, one building,
eight development users **and 43 fixture projects with twelve fixture
contractors** (`apps/api/src/db/seed-data.ts`, `seed-projects.ts`,
`seed-contracts.ts`, `seed-site.ts` — all idempotent). That fixture data is
exactly what a UAT environment needs and exactly what production must never
see: a board member or a real estates head must not find a made-up project
sitting in the live register.

- **UAT: run `seed`.** It gives testers real screens with real-looking data
  from the first sign-in, sample projects included.
- **Production: do NOT run `seed`.** This warning stands regardless of which
  decision above put a given deployment in "production": the twelve org
  units and the group→role mappings are the only pieces of the seed
  production needs, and they go in by hand (§5) or by trimming the seed to
  just the org-unit rows if that becomes a maintained option later — check
  `seed-data.ts` before assuming it already offers that split.
- **Production's real seed is the Capex Plan import**, `import:capex`
  (`apps/api/README.md` "Importing the Capex Plan"). That is what puts the
  113 real projects and their budget lines into the live register. Run
  `inspect`, then a dry run, then read the reconciliation report, then
  `--commit` — in that order, every time, per the README. Never run this
  against production data on a whim; it is a real import into the system of
  record.

---

## 5. Mapping AD groups to roles

There is **no admin screen for this today** — `apps/web/src/app/(app)/admin`
holds only the contractor register (`admin/contractors`). Role mapping is
SQL against `ecapital.role_mapping` until that screen exists; flag this as
a follow-up if it keeps happening by hand more than a few times.

The table keys on the AD group identifier in the column `group_id`
(migration `0007_active_directory_sign_in.sql` renamed it from the M0
`entra_group_id`; ADR-0018). Under `AUTH_MODE=ldap` it holds the AD group's
**distinguished name**, for example
`CN=eCapital-EstatesHead,OU=Groups,DC=ihcis,DC=local`. A null
`org_unit_id` means the mapping applies to every unit.

```sql
-- One group, one role, every unit:
insert into ecapital.role_mapping (group_id, role, org_unit_id, note)
values ('CN=eCapital-Admins,OU=Groups,DC=ihcis,DC=local', 'admin', null,
        'Central IT — added 2026-xx-xx');

-- One group, one role, scoped to a single unit (org_unit.id, not .code):
insert into ecapital.role_mapping (group_id, role, org_unit_id, note)
select 'CN=eCapital-NGH-Estates,OU=Groups,DC=ihcis,DC=local', 'estates_head',
       id, 'ΝΓΗ estates head — added 2026-xx-xx'
from ecapital.org_unit where code = 'NGH';

-- Check what is mapped so far:
select rm.role, coalesce(ou.code, '(all units)') as unit, rm.group_id, rm.note
from ecapital.role_mapping rm
left join ecapital.org_unit ou on ou.id = rm.org_unit_id
order by rm.role, unit;
```

Run these as the `ecapital` (owner) role — `psql "$MIGRATION_DATABASE_URL"`
from `/etc/ecapital/api.env`, or `sudo -u ecapital psql ecapital` on the
server. A row here is what ADR-0009 calls "an administrative act with an
audit row behind it" — it takes effect the next time that user signs in,
nothing needs restarting.

**A user in no mapped group gets no roles and sees nothing** — the safe
direction, per ADR-0009. If someone reports an empty screen after a
successful AD sign-in, check here first.

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
in-place-with-a-backup rather than a symlink swap.

If the md5 sums it prints do not match between local and remote, or a
health check fails, **stop** — do not tell anyone the release is done. An
empty value from a remote command means that command failed, not that the
file is empty or that "everything differs" (the same rule eFinance's own
notes give for `sudo md5sum` with no password).

After every release, run through §7 and archive the deploy checklist per
`docs/deploy-checklist.md`.

---

## 7. Smoke tests

Run these after every release, from a browser reaching
`https://capital.shso.online` (or `http://10.227.56.22:5005` directly over
the tunnel if cloudflared is not wired up yet):

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
ssh -t administrator@10.227.56.22 "sudo /opt/ecapital/deploy/rollback.sh <stamp>"
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

**API refuses to boot, journal says something about `DEV_AUTH`.**
`config.ts` refuses to start with `DEV_AUTH=1` while `NODE_ENV=production`
(ADR-0009) — that guard is doing its job. Fix: set `DEV_AUTH=0` in
`/etc/ecapital/api.env` (it should already be, from the template) and
restart.

**Port 5005 (or 5015) already in use.** Something else is bound to it —
check with `sudo ss -ltnp | grep -E ':5005|:5015'`. Nothing else on this
server should be using either port (§ports table above); if something is,
find out what before killing it.

**Postgres authentication failures.** Check the password in
`/etc/ecapital/api.env` matches what the role actually has
(`ALTER ROLE … PASSWORD …`, §3) — a mismatch here is the most common cause,
especially right after `install.sh` created roles with placeholder
passwords that were never changed. `sudo -u postgres psql -c "\du"` lists
the roles; it does not show passwords.

**Empty output from a privileged command.** Treat it as "the command
failed", never as "the answer is empty" or "everything differs" — the same
rule eFinance's CLAUDE.md gives for `sudo md5sum` with no password.
