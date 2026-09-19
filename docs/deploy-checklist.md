# Deploy checklist

CAPEX-01 §14: "Every deployment, pilot included, runs `engineering:deploy-checklist`
first." That skill is not installed (ADR-0007), so this file is it, run by
hand, every release, no exceptions for a small one.

Copy the template below into `docs/deploy/releases/<tag>.md`, fill it in
**before** running `deploy/release.sh`, and finish filling it in as the
release goes out. `<tag>` is whatever identifies the release — a date stamp
(`2026-09-19`) or a git tag, whichever the team is using; be consistent.
A release with no checklist on file did not, for this purpose, happen.

---

## Template

```markdown
# Release <tag> — deploy checklist

Date: <YYYY-MM-DD>
Operator: <name>
Environment: <UAT | production>
Release stamp (from deploy/release.sh): <YYYYMMDD-HHMMSS>

## Before release.sh

- [ ] **Migrations rehearsed on a copy.** Ran the pending migration(s)
      against a restored copy of production, not against production
      directly. On this server that copy is the restore-drill database
      (`docs/deploy/RUNBOOK-10.227.56.22.md` §9) — restore the latest
      nightly dump into it by hand if the monthly timer's copy is stale,
      apply the migration, confirm it runs clean.
      Result: <clean / errors, and what they were>

- [ ] **Rollback path written down**, specific to this release, not just
      "run rollback.sh". Note here anything that makes this release harder
      than usual to roll back — a migration with no natural inverse, a
      change to seeded reference data, anything `rollback.sh`'s own
      warning about migrations applies to.
      Rollback notes: <...>

- [ ] **Backup verified.** Confirmed a recent, restorable backup exists
      before shipping anything — `ls -la /var/backups/ecapital`, and the
      last line of `/var/log/ecapital/backup.log` says `OK`.
      Last good backup: <filename, timestamp>

- [ ] **Feature flags listed** — every one, current value, and whether this
      release changes it:
      | Flag | Value | Changed this release? |
      |---|---|---|
      | `AUTH_MODE` | | |
      | `DEV_AUTH` | | |
      | `NEXT_PUBLIC_DEV_AUTH` | | |
      | `EMAP_URL` | | |
      | `EFINANCE_URL` | | |
      | Seed: UAT sample data — yes/no | | |

- [ ] **Greek/English parity check passed.** `pnpm check:i18n` — every
      screen string exists in both `el` and `en`.
      Result: <pass / fail, and what failed>

- [ ] **BLOCKING, owned by IT: LDAP reachable.** As of 19/09/2026,
      `ihcis.local` does not resolve from `10.227.56.22` and neither 389 nor
      636 answer. This release cannot go live against real accounts until
      IT supplies the domain controllers' IPs or FQDNs, opens 636 (LDAPS)
      from `10.227.56.22`, and gives a read-only bind account. Do not tick
      this box until all three are confirmed working.
      Result: <not ready / confirmed working, DC address used>

- [ ] **e2e passed.** `pnpm --filter @ecapital/web e2e` (or the current
      equivalent) — and `pnpm lint`, `pnpm typecheck`, `pnpm test`,
      `pnpm check:help` as the ordinary CI gate, not skipped because the
      change looked small.
      Result: <pass / fail, and what failed>

## The release

- [ ] `deploy/release.sh` completed without a reported failure.
- [ ] md5 sums matched on both sides (script output).
- [ ] `GET /health` (127.0.0.1:5015) returned healthy.
- [ ] `/sign-in` (127.0.0.1:5013) returned 200.
- [ ] Smoke tests from the runbook §7 passed: sign-in, unit switcher, S01,
      create a project, `/contracts?q=CAP-…`.

## After

- [ ] This file committed at `docs/deploy/releases/<tag>.md`.
- [ ] Anything unusual noted here, even if the release otherwise succeeded.

Notes:
<...>
```
