# Build brief for Claude Code — OKYpY Invoice Automation Agent (v1)

You are building the first production automation of the OKYpY (State Health Services Organisation, Cyprus) roadmap: streams Π3 (AI invoice processing) and Π14 (revenue/spend assurance) for the accounts-payable side. Read this whole file before writing code. Ask the operator the questions in §12 before Phase 1.

## 1. Mission

A daily agent that ingests supplier invoices from a mailbox and a network folder, extracts and validates their data, compares them against each vendor's history, flags errors and anomalies, alerts the finance team, prepares park-ready SAP entries, and routes each invoice through a value-based approval chain that always satisfies the four-eyes principle. Humans approve; the agent never does.

## 2. Fixed context — do not re-decide these

- Runs on an **on-prem Windows or Linux server/VM** inside the OKYpY network. No invoice content leaves the network except where §9 explicitly allows.
- Email source is a **dedicated Microsoft 365 shared mailbox** (e.g. `invoices@okypy.org.cy`) read via **Microsoft Graph API** with application permissions (client-credentials flow, `Mail.ReadWrite` scoped to that mailbox only).
- Second source is a **watched network folder** (UNC path) where scanned paper invoices land from the copiers.
- Target ERP is **SAP ECC 6.0**. Integration is **phased**: v1 produces a validated, park-ready batch file that a clerk reviews and uploads/keys; v2 (separate phase, needs an SAP interface user from IT) parks directly via `BAPI_INCOMINGINVOICE_PARK` for PO invoices and `BAPI_ACC_DOCUMENT_POST` in park/hold mode for FI invoices. Build v1 so v2 is a new output adapter, not a rewrite.
- Approval chain and value limits live in **`config/settings.yaml`** and must be changeable without touching code.
- Everything the agent does is written to an **append-only audit log**. Retention: 6 years minimum (Cyprus tax records requirement) — make it a config value.

## 3. Tech stack — keep it boring

Python 3.11+. SQLite for state (one server, modest volume ~400–500 invoices/day peak). `msal` + `requests` for Graph. `lxml` for XML invoices. `pdfplumber` for text-layer PDFs, `pytesseract` + `pdf2image` for scanned ones. `openpyxl` for the SAP park file and reports. `Flask` + `waitress` for the approval web app. `APScheduler` (or OS cron/Task Scheduler) for the daily run. No message queues, no containers unless IT asks.

## 4. Repository layout

```
invoice-agent/
  config/
    settings.yaml        # mailbox, folders, schedule, approval chain, thresholds, entities
    vendors.yaml         # per-vendor overrides: default GL, cost center, expected IBAN(s), tax code
    gl_rules.yaml        # keyword/vendor-category → GL account + cost center mapping rules
  src/
    ingest/              # graph_mail.py, folder_watch.py, dedupe.py
    extract/             # xml_ubl.py, xml_cii.py, pdf_text.py, pdf_ocr.py, normalize.py
    validate/            # arithmetic.py, vat.py, master_data.py, duplicates.py
    analyze/             # history.py, anomalies.py
    sap/                 # park_file.py (v1), bapi_adapter.py (v2 stub with interface spec)
    approvals/           # engine.py, webapp.py, notifications.py
    audit/               # log.py (append-only, hash-chained)
    reports/             # daily_digest.py, monthly_summary.py
  db/                    # sqlite database + migrations
  archive/               # original files: archive/{vendor}/{yyyy-mm}/{hash}.{ext}
  tests/
    golden/              # 50+ real anonymized invoices with expected extraction JSON
  run_daily.py
  CLAUDE.md              # this file
```

## 5. Pipeline — the daily run

Runs every morning (config: `schedule.daily_at`, default 06:30) plus on demand (`python run_daily.py --now`).

**Stage 1 — Ingest.** Pull unread messages from the shared mailbox; save every attachment of type pdf/xml/p7m/zip (unzip). Scan the watch folder for new files. Compute SHA-256 per file; skip hashes already in the DB (dedupe). File the original under `archive/{vendor}/{yyyy-mm}/` once the vendor is known. Mark the email as processed by moving it to a `Processed` (or `Failed`) subfolder — never delete.

**Stage 2 — Extract.** Try in this order: (a) structured XML — EN 16931 syntaxes UBL 2.1 and UN/CEFACT CII, plus Peppol BIS 3.0; (b) PDF with embedded XML (Factur-X/ZUGFeRD); (c) PDF text layer; (d) OCR. Normalize into one canonical record: vendor name, vendor VAT no., invoice number, invoice date, due date, currency, net per VAT rate, VAT amounts, gross total, IBAN, PO number if present, line items (description, qty, unit price, line total). Every field carries a `source` (xml/text/ocr) and a `confidence`. Records below the confidence threshold (config, default 0.85 on any critical field) go to the human review queue, never onward.

**Stage 3 — Validate.** Hard failures stop the invoice and queue it for review: arithmetic doesn't add up (net + VAT ≠ gross, line sums ≠ totals); VAT number fails checksum/format; VAT rate not in the Cyprus set (config: 19/9/5/3/0); vendor not in the vendor master (from `vendors.yaml` / periodic SAP vendor export); duplicate invoice number for the same vendor; invoice date in the future or > config months in the past.

**Stage 4 — Analyze vs history.** Using all prior invoices in the DB for that vendor: unit-price change beyond `thresholds.price_change_pct` (default 10%) for recurring items; monthly spend for the vendor or cost center beyond `thresholds.spend_zscore` (default 2.5) vs the trailing 12 months; near-duplicates (same vendor + same amount within `thresholds.dup_window_days`, different invoice number); **IBAN differs from the vendor's known IBAN(s) — this is a fraud flag, always CRITICAL**; first invoice ever from a new vendor; gaps or repeats in the vendor's invoice number sequence; quantity spikes on recurring lines. Each finding gets severity INFO / WARNING / CRITICAL.

**Stage 5 — Alert.** CRITICAL findings trigger an immediate email to the roles listed in `settings.alerts.critical_to` (and stop the invoice until a human clears the flag in the web app). Everything else is collected into one **daily digest email**: invoices received, extracted, parked-ready, queued for review, all findings, top movers vs last month. Plain, scannable HTML — no dashboards in v1.

**Stage 6 — Prepare SAP entries.** For each clean invoice, build the park-ready record: company code (entity), vendor account, document/posting date, reference, currency, gross, VAT code, and per-line GL account + cost center from `gl_rules.yaml` (vendor default first, then keyword rules, else the review queue — never guess silently). Output one Excel batch file per entity per day: `output/park/{entity}_{yyyy-mm-dd}.xlsx`, columns matching the FV60/MIR7 entry order (finalize with the chief accountant in Phase 3), one row per line item, plus a control-totals header. The clerk reviews and enters/uploads; the batch file name and hash go into the audit log.

**Stage 7 — Approval routing.** See §6. Parking preparation (Stage 6) and approval (Stage 7) run in parallel — an invoice may be parked in SAP but is only released for payment when its approval chain is complete.

## 6. Approval engine — four eyes, value-based, config-driven

The chain is defined entirely in `settings.yaml`:

```yaml
approval:
  four_eyes_minimum: 2        # NEVER allow fewer distinct approvers than this
  self_approval: forbidden    # requester/extractor can never be an approver
  chain:                      # cumulative: an invoice needs every step whose limit it exceeds is wrong —
                              # it needs all steps UP TO the first limit that covers its value
    - role: clerk             # prepares/confirms — counts as eyes #1
      approve_up_to: 0        # 0 = preparer only, never sole approver
    - role: accountant
      approve_up_to: 2000
    - role: chief_accountant
      approve_up_to: 10000
    - role: cfo
      approve_up_to: 50000
    - role: group_cfo
      approve_up_to: 200000
    - role: ceo
      approve_up_to: .inf
  users:                      # role → list of AD emails; any listed user can act for the role
    clerk: [a.clerk@okypy.org.cy]
    accountant: [b.acc@okypy.org.cy]
    chief_accountant: [c.chief@okypy.org.cy]
    cfo: [d.cfo@okypy.org.cy]
    group_cfo: [e.gcfo@okypy.org.cy]
    ceo: [f.ceo@okypy.org.cy]
  reminder_after_hours: 24
  escalate_after_hours: 72    # notify the next role up + the digest
```

Routing rule: an invoice of gross value V requires sequential approval from every chain role from `clerk` up to and including the **first role whose `approve_up_to` ≥ V** — and if that yields fewer than `four_eyes_minimum` distinct people, extend one more step up. Example with the defaults: a €1.500 invoice needs clerk (preparer) + accountant; €30.000 needs clerk + accountant + chief accountant + CFO; €500.000 goes all the way to CEO.

Mechanics: approvers get an email with the invoice summary, key findings, and a link to the Flask web app (AD-authenticated via Graph if feasible; otherwise per-user tokens). Approve / reject-with-reason / delegate. Every action stamps user, timestamp, and invoice hash into the audit log. Rejection returns the invoice to the review queue with a notification to the preparer. Changing `settings.yaml` limits takes effect on the next run — active chains finish under the rules they started with (store the chain snapshot on the invoice).

## 7. Database (SQLite, migrations from day one)

Tables: `invoices` (canonical record + status: ingested → extracted → validated → analyzed → park_ready → parked → approved → rejected → on_hold), `invoice_lines`, `files` (hash, path, source, mailbox message id), `vendors` (incl. known IBANs, first_seen), `findings` (invoice id, rule, severity, cleared_by/at), `approvals` (invoice id, step, role, user, action, at, chain_snapshot), `audit_log` (append-only; each row carries the SHA-256 of the previous row so tampering is detectable), `settings_history` (every config change: who, when, diff).

## 8. Extraction quality — the golden set

Before Phase 2 is called done: collect ≥50 real invoices covering the top 20 vendors by count, all formats (UBL, CII, text PDF, scanned PDF), Greek and English. Store each with a hand-verified expected JSON in `tests/golden/`. CI target: 100% on structured XML, ≥95% field accuracy on text PDFs, ≥90% on OCR — anything below routes to human review, so accuracy failures degrade to workload, never to wrong postings.

## 9. LLM use — explicit boundary

Deterministic parsing first; it covers XML and most text PDFs. An LLM (Claude API) may be used ONLY as fallback extractor for unstructured/scanned PDFs and ONLY if `settings.llm_fallback.enabled: true`. Before enabling in production, the DPO must sign off, since invoice content then leaves the network to the API. Mask what isn't needed (strip bank account digits except last 4 from the prompt; never send the approval users list). Log every LLM call (invoice hash, model, purpose) in the audit log. The LLM proposes field values with confidence; it never validates itself — Stage 3 rules always run after.

## 10. Security

Dedicated AD service account, least privilege: read/move on the one mailbox, read on the watch folder, write on archive/output. Secrets in the OS keystore or a `.env` outside the repo — never committed. The Flask app binds to the internal interface only, HTTPS with an internal cert. Role separation in code: ingest/extract runs cannot write approval records. Weekly encrypted backup of the SQLite DB and archive to the location IT designates.

## 11. Build phases — each ends with a working demo

**Phase 0 (skeleton):** repo, config loading + validation, DB migrations, audit log, dry-run of the daily scheduler. Demo: `run_daily.py --now` logs a clean empty run.
**Phase 1 (ingest):** Graph mailbox + folder watch, dedupe, archiving, Processed/Failed mailbox moves. Demo: drop 10 mixed files + 5 emails, all archived and registered exactly once; rerun produces zero duplicates.
**Phase 2 (extract + validate):** all four extraction paths, canonical record, validation rules, review queue (simple list in the web app). Demo: golden set passes the §8 targets.
**Phase 3 (analyze + alert + park file):** history rules, severities, digest email, CRITICAL alerts, park-ready Excel per entity — column layout signed off by the chief accountant. Demo: replay 3 months of real invoices; anomaly findings reviewed with the accountant for false-positive rate; a real park file entered successfully in FV60.
**Phase 4 (approvals):** engine, web app, notifications, reminders/escalation, settings snapshot per invoice. Demo: €1.500 / €30.000 / €500.000 test invoices route to the correct chains; a 1-approver configuration is rejected by config validation (four-eyes).
**Phase 5 (SAP BAPI, later):** implement `bapi_adapter.py` against the interface user IT provides; park directly; the batch file remains as fallback. Not started until IT delivers credentials and a test client.

Do not start a phase before the previous one's demo passes. Commit per feature; meaningful messages; tests run in CI (even if CI is just a pre-commit script).

## 12. Ask the operator before Phase 1

1. Azure AD tenant ID, app registration (or who registers it), and the shared mailbox address.
2. UNC path of the watch folder and the archive/output root.
3. List of entities (SAP company codes) and which mailbox/folder feeds which.
4. Current SAP vendor master export (vendor account, name, VAT no., IBAN) — needed for Stage 3/4; agree the refresh cadence.
5. The chart-of-accounts extract for expense GLs + cost center list, to seed `gl_rules.yaml`.
6. Who fills each approval role today (names/emails), and confirmation of the € limits (the defaults above are placeholders).
7. Whether the DPO allows LLM fallback (§9) at go-live or later.
8. Where the daily digest and CRITICAL alerts should go.

## 13. Out of scope for v1 — don't build

Payment execution (bank files), PO three-way matching beyond capturing the PO number, vendor portal, mobile app, multi-language UI (web app is Greek labels / English logs), dashboards beyond the digest, and any write access to SAP.
