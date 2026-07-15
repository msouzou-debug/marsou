# OKYpY Invoice Automation Agent (v1)

Daily agent for OKYpY accounts payable (roadmap streams Π3 + Π14): ingests
supplier invoices from a shared mailbox and a watched folder, extracts and
validates them, compares against vendor history, flags anomalies (IBAN change
= fraud flag, always CRITICAL), alerts the finance team, prepares park-ready
SAP batch files, and routes every invoice through a value-based approval chain
that always satisfies four-eyes. **Humans approve; the agent never does.**

The full build brief is `CLAUDE.md`. Companion repo: `../vendor-cleanup`
(must go first — see the go-live gate below).

## Status

Phases 0–4 implemented and tested (`tests/test_agent.py`, 22 tests):

- **Phase 0** — config loading + validation (a config that can't satisfy
  `four_eyes_minimum: 2` refuses to start), SQLite migrations, hash-chained
  audit log, `run_daily.py --now` clean empty run.
- **Phase 1** — Graph mailbox ingest (client-credentials; mockable client),
  watched-folder scan, zip unpacking, SHA-256 dedupe, archiving under
  `archive/{vendor}/{yyyy-mm}/{hash}.{ext}`, Processed/Failed moves.
- **Phase 2** — extraction: UBL 2.1 / Peppol BIS, UN/CEFACT CII, Factur-X/
  ZUGFeRD embedded XML, PDF text layer, OCR (degrades to review queue if the
  OCR stack is absent). Canonical record with per-field source + confidence;
  the 0.85 gate on critical fields routes to review. Validation: arithmetic,
  VAT number + rates, vendor master, duplicates, date window.
- **Phase 3** — history anomalies (price change, spend z-score,
  near-duplicates, IBAN mismatch CRITICAL, new vendor, sequence gaps/repeats,
  quantity spikes), CRITICAL email alerts + hold, daily digest, park-ready
  Excel per entity with control totals.
- **Phase 4** — approval engine (value-based chain, four-eyes extension rule,
  chain snapshot frozen at routing), Flask app (Greek labels), approve /
  reject-with-reason / delegate, reminders + escalation.
- **Phase 5** — `src/sap/bapi_adapter.py` is a documented stub; not started
  until IT delivers the SAP interface user and test client.

## Go-live gate (do not remove until met)

`shadow_mode: true` in `config/settings.yaml` keeps the agent to ingest +
extract + validate + analyze + report — **no park files**. Per the
vendor-cleanup brief §11, go-live requires: (a) all shared-IBAN duplicate
groups resolved, (b) `vendor_mapping.csv` published, (c) Stage 4 reading the
mapping (implemented — `src/analyze/history.py` folds merged accounts into
one baseline). Flip `shadow_mode: false` only when the gate is met.

## Usage

```bash
pip install -r requirements.txt

python run_daily.py --now        # one run now (scheduled: python run_daily.py)
python serve_approvals.py        # approval web app on 127.0.0.1:8091
python tests/test_agent.py       # the phase demos as tests
python tests/golden/generate_golden.py   # regenerate the synthetic golden set
```

Graph mailbox: fill `mailbox.tenant_id` / `client_id` in settings.yaml and put
`GRAPH_CLIENT_SECRET` in the environment (never in the repo). Until then the
mailbox is skipped and the watch folder still works.

## Golden set caveat

`tests/golden/` currently holds a **synthetic** set (15 files: UBL, CII, text
PDF, Factur-X) generated from real vendor-master records. §8 requires ≥50
real anonymized invoices covering the top 20 vendors before Phase 2 is called
done in production — collect them with the operator and replace/extend the
set; the test harness reads any `*.expected.json` pair dropped in that folder.

## Open questions for the operator (§12 — placeholders until answered)

1. Azure AD tenant + app registration + shared mailbox address.
2. UNC watch folder and archive/output roots.
3. Entities (company codes) and which source feeds which.
4. Vendor master refresh cadence (currently: the vendor-cleanup export).
5. Chart of accounts + cost centers to seed `gl_rules.yaml`.
6. Real names/emails per approval role + confirmation of € limits.
7. DPO decision on LLM fallback (off by default).
8. Recipients for the daily digest and CRITICAL alerts.
