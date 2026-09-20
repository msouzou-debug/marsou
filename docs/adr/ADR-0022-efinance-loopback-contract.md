# ADR-0022 — The eFinance loopback contract, and bypassing the Squid proxy

**Status:** proposed · 19/09/2026

## Context

The eFinance session that checked the live server on 19/09/2026 agreed, in
principle, how eCapital will read eFinance's master data, budget position
and invoice/requisition status, and how it will later push contract
commitments back. Both applications run on `10.227.56.22`, so the natural
shape is a loopback HTTP contract rather than anything crossing the public
hostnames — the same reasoning that already puts eCapital's own API on
`127.0.0.1:5015`, reached only by its own web app on the same host.

Two host-level facts shape this contract and are recorded here because
nothing else in the repo owns them:

1. **The host runs a corporate Squid proxy.** `/etc/environment` sets
   `http_proxy` for interactive shells, but systemd units do not inherit
   `/etc/environment`. Left alone, a loopback call from eCapital's API
   (running under systemd) can still be routed through Squid, which
   answers with a fake `503` for a destination it has no business proxying
   — the same failure mode `docs/deploy/RUNBOOK-10.227.56.22.md` already
   documents for `curl` run by hand.
2. **A loopback request should never carry a public-edge header.**
   `CF-Connecting-IP`, `X-Forwarded-For`, `X-Real-IP`, `Forwarded` and
   `CF-Ray` only mean something on a request that crossed Cloudflare or a
   reverse proxy. A request to `127.0.0.1:5004` carrying any of them either
   came through something it should not have, or is trying to spoof a
   caller identity eFinance's audit log would otherwise trust.

This is recorded as a **proposed** ADR, not accepted, because the contract
itself is still a draft: eFinance has not yet published its own integration
record confirming the routes, and nothing here is built yet. It exists so
the decision has one place to live while both teams finish agreeing it,
rather than only in a meeting note.

## Decision

### Transport and security

- eFinance serves the contract on `http://127.0.0.1:5004` — loopback only.
  eCapital is the **only** caller; nothing about this contract is exposed
  beyond that one process-to-process hop.
- Authentication is one bearer token, `EFINANCE_TOKEN`, issued by eFinance
  and stored in `/etc/ecapital/api.env` (`deploy/env/api.env.example` has
  it as `CHANGE-ME`, never a real value in the repo).
- eFinance refuses, with `403`, any request carrying `CF-Connecting-IP`,
  `X-Forwarded-For`, `X-Real-IP`, `Forwarded` or `CF-Ray`. A legitimate
  call from eCapital never has a reason to carry one.
- Errors are one envelope, `{"error":{"code","message"}}`. Money is
  2-decimal strings, never floats. Timestamps are ISO 8601 UTC. Paging is
  `limit`/`cursor`.

### Routes (draft — see `docs/INTEGRATION-eFinance-eMAP-eCapital.md` §5/§6 for the full list)

Reads: `/api/v1/master/{entities,cost-centres,budget-codes?kind=capex,vendors}`,
`/api/v1/budget/position?year=&entity=&code=`,
`/api/v1/capital/invoices?ref=CAP-…|updated_since=`,
`/api/v1/capital/requisitions?…`.

An invoice's `ledger` is `in_flight | booked | rejected`. **eCapital's spent
ledger counts only `booked`** — the other two states are visible for
context and must never be summed into spend.

Write, later: `PUT /api/v1/capital/contracts/{cap_ref}` with `cap_ref,
project_ref, title, entity_code, budget_code, vendor_code, current_value,
status (active|closed), updated_at`. eFinance answers `409` if the same
`cap_ref` already exists under a different `entity_code` or `budget_code`.

### Ownership split

- **eCapital owns:** planning, contract commitment, retention,
  certification.
- **eFinance owns:** execution against budget codes.
- **eCapital never writes to `budget_allocations`.** That table is
  eFinance's alone; this contract gives eCapital no path into it, read or
  write. The boundary mirrors the one eFinance already holds against eMAP
  (`docs/INTEGRATION-eFinance-eMAP-eCapital.md` §8: "no writes to
  eFinance's tables, ever").

### Bypassing Squid: `NO_PROXY` on both systemd units

Both `deploy/systemd/ecapital-api.service` and `ecapital-web.service` set:

```
Environment=NO_PROXY=127.0.0.1,localhost
```

This is unconditional, not specific to the eFinance contract — it applies
to any loopback call either process makes, including eCapital's own API on
`5015` and, once built, the eFinance calls above. Without it, the first
symptom is a `503` that looks like it came from eFinance or from eCapital's
own API, when the actual cause is Squid answering on a destination it was
never meant to proxy. `docs/deploy/RUNBOOK-10.227.56.22.md` §10 has this as
a named troubleshooting entry so it is not re-diagnosed from scratch each
time.

## Consequences

- Nothing here is live. It is proposed so the shape is written down once,
  in one place, while eFinance finishes its own integration record —
  moving this ADR to accepted is the trigger for building against it.
- The forwarded-header refusal means eCapital's HTTP client for this
  contract must not blindly forward any header it received on an unrelated
  inbound request; it constructs the outbound call from scratch.
- If eFinance's published contract ends up differing from this draft in
  routes, envelope shape or the write route's conflict rule, this ADR is
  superseded by a new one recording what was actually built, rather than
  silently edited — ADRs are not edited after acceptance, and a proposed
  one that turns out wrong is superseded the same way.

## Addendum, 20/09/2026 — the two-code model: eFinance keeps its own keys

ADR-0024 §2 kept the six codes eFinance and eCapital now disagree on (`PAP`, `LGH` unchanged, `TRD`, `ARC`, `CHR`, `MH`, `HC`) as a document, "until eFinance aligns". **eFinance has told this deployment it will not**: those strings are foreign keys across twelve of eFinance's own tables and in SAP, and renaming them is not a change eFinance can make without a data-migration project of its own. eCapital carries both codes permanently instead — this is the owner decision that makes that the design, not a stopgap.

### `org_unit.efinance_code`, alongside `entity_code`, not instead of it

Migration `0018_cns_unit_and_efinance_codes.sql` adds `org_unit.efinance_code` (nullable, unique text) and backfills it from `entity_code` through the mapping ADR-0024's addendum records: `NGH`→`NGH`, `LAR`→`LAR`, `PAF`→`PAP`, `LGH`→`LGH`, `KYP`→`TRD`, `NAM`→`ARC`, `POL`→`CHR`, `FAM`→`FAM`, `MHS`→`MH`, `PHC`→`HC`, `HQ`→`HQ`, `CNS`→`CNS`.

`entity_code` keeps meaning what ADR-0024 made it mean and does not move again: it is eCapital's own key, eArchive's site abbreviation, the string a document's `source_ref` and a project's code prefix are both built from. `efinance_code` is the other system's own key, exposed as `efinanceCode` on the shared `OrgUnit` schema and on `GET /org-units`, and nowhere else does the codebase read the raw column — `OrgUnitsService.efinanceCodeFor(orgUnitId)` is the one seam, added for the future SAP actuals / spent-ledger reader this contract's `GET /api/v1/capital/invoices` and `GET /api/v1/capital/requisitions` routes will eventually back (INTEGRATION doc §5), which has to send eFinance's key, not ours, once it is built.

### The write route's body: `entity_code` in eArchive form, eFinance translates

The draft write route above, `PUT /api/v1/capital/contracts/{cap_ref}`, carries `entity_code` in its body. That field is filled from eCapital's own `org_unit.entity_code` — eArchive's abbreviation — **not** `efinance_code`. eFinance is the one that knows both of its own keys are the same place; asking eCapital to send eFinance's code back to eFinance would make eCapital responsible for a translation it has no authority over, the same reasoning ADR-0024 §1 gave for choosing eArchive's abbreviation as the shared axis in the first place. eFinance's `409` conflict rule (same `cap_ref`, different `entity_code` or `budget_code`) reads the body's `entity_code` in that form and translates at its own boundary, exactly as its 203 operational budget codes and its own entity table already do internally.

`EFinanceBudgetCodeReader` is unaffected by any of this — a budget code carries no entity, so there is no code on that route for the two-code model to touch.

### Why this belongs here and not only in ADR-0024

ADR-0024 owns the fact of the two columns (§1's rule, and its own addendum recording the mapping and the CNS unit alongside it). This ADR owns the *contract* the two columns exist to serve — which of the two eFinance actually expects on the wire, and why the write route's body is not the column a naive reading of "the eFinance code" would reach for. Read ADR-0024's addendum for the column; read this one for what goes over the loopback connection.
