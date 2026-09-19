# eCapital

Capital-projects and maintenance system for ΟΚΥπΥ (Cyprus State Health
Services Organisation) — the capital works register: projects, milestones,
risks and issues, construction contracts and variations, and (from M2
onward) assets and maintenance. Sibling application to eFinance and eMAP.

Start with `docs/briefs/README.md` for the specification, `CONVENTIONS.md`
for how code here is written, and `docs/adr/` for the decisions made along
the way.

## Layout

- `apps/web` — Next.js frontend
- `apps/api` — NestJS backend, PostgreSQL 16, row-level security
- `packages/shared` — schemas and types shared between them
- `docs/` — briefs, ADRs, the user manual
- `deploy/` — the deployment kit for the ΟΚΥπΥ server

## Deploying

eCapital deploys to the same on-prem Ubuntu server as eMAP, eQuality, DIAS
and eFinance, following the estate's existing pattern (systemd, not
Docker). The deployment kit is `deploy/`:

- **First-time server setup:** `deploy/install.sh`
- **Every release:** `deploy/release.sh`
- **Full walkthrough:** `docs/deploy/RUNBOOK-10.227.56.22.md`
- **Before every release, including the pilot:** `docs/deploy-checklist.md`
- **How eCapital fits with eFinance and eMAP:**
  `docs/INTEGRATION-eFinance-eMAP-eCapital.md`

| App | Port | Bound to |
|---|---|---|
| eCapital web (Next.js) | `5005` | `0.0.0.0` — cloudflared's target for `capital.shso.online` |
| eCapital API (NestJS) | `5015` | `127.0.0.1` — reached only by the web app, server-side |
| PostgreSQL 16 | `5432` | `localhost` |
