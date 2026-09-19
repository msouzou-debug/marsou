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
| eCapital web (Next.js) | `5013` | `127.0.0.1` — nginx reverse-proxies `capital.shso.online` to this port |
| eCapital API (NestJS) | `5015` | `127.0.0.1` — reached only by the web app, server-side |
| PostgreSQL 16.14 | `5432` | `127.0.0.1` — already installed on this host, shared with BedMan and eArchive |

Port `5014` is reserved by the host owner and must never be used. Ports
`5000`-`5006`, `5010`-`5012` and `5055` are already taken by other services on
this host. Both eCapital processes bind to loopback only; nginx and
cloudflared, already running on this host and its cloudflared box, handle
public exposure — see `docs/deploy/RUNBOOK-10.227.56.22.md` and
`deploy/cloudflared-request.md`.
