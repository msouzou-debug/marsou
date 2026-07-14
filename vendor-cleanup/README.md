# OKYpY Vendor Master Cleanup

Cleans the SAP vendor master and keeps it clean: imports the SAP extracts,
detects duplicate and defective vendor records, queues them for human review
with a proposed action, records decisions under four-eyes, and exports an
action list for the SAP master-data team plus the clean `vendors_agent.csv`
the invoice agent consumes. **The app never writes to SAP** — its exports are
instructions, not transactions.

Companion to the Invoice Automation Agent; this app comes first in sequence
(the invoice agent must not go live on the dirty master — see §11 of the
build brief).

## Stack

Python 3.11+, SQLite, Flask + waitress, on-prem. Append-only hash-chained
audit log (`vendor_cleanup/audit.py` — same implementation as the invoice
agent; share the module).

## Setup

```bash
pip install -r requirements.txt
```

Edit `config/settings.yaml`: put the real reviewer / approver AD emails under
`roles:` (currently placeholders).

## Usage

```bash
# 1. drop the SE16N extracts into input/ — file names must contain
#    LFA1 / LFB1 / LFBK / TIBAN (CSV or XLSX). Alternatively a combined
#    vendors_agent.csv works. Optional: an FBL1N open-items export
#    (file name containing "fbl1n") enables the open-items hold rule.

# 2. import + detect (prints the console summary)
python -m vendor_cleanup import

# 3. run the review app (reviewer decides, approver confirms — four eyes)
python -m vendor_cleanup serve            # http://127.0.0.1:8090

# 4. write the four outputs to output/
python -m vendor_cleanup export

# 5. after the master-data team ticks applied rows in the action list:
python -m vendor_cleanup close-actions output/sap_actions_YYYY-MM-DD.xlsx

# integrity check of the audit log
python -m vendor_cleanup verify-audit
```

Monthly cadence: refresh the extracts in `input/`, re-run `import`. Resolved
groups stay resolved unless a member's name/VAT/IBAN changed (fingerprint);
worklist items that are no longer defective auto-close.

## Detection rules (§4 of the brief)

| Rule | Weight | Notes |
|---|---|---|
| Same IBAN, different supplier | 0.9 | whitelistable (factoring, ministry collection accounts) |
| Same VAT / same TIN | 0.95 | compared on the digit core, so `CY10012321Q` = `10012321Q` |
| Fuzzy name | 0.5–0.8 | uppercase, legal suffixes stripped, Greek→Latin transliterated, token-sorted, `token_sort_ratio ≥ 85` |
| Same telephone | 0.4 | supporting evidence only — never forms a group on its own |

Pairwise hits are union-found into groups; nothing is ever auto-merged.

## Outputs (`output/`)

1. `sap_actions_{date}.xlsx` — BLOCK/UPDATE rows for the master-data team,
   with survivor reference, standard note text, and an `Applied` tick column
   that closes the loop on re-import. BLOCKs for vendors with open items
   (when FBL1N is loaded) are held back until items clear.
2. `vendor_mapping.csv` — `old_supplier → surviving_supplier`, effective date.
   The invoice agent must load this in its Stage 4 anomaly baselines.
3. `vendors_agent.csv` — the clean file, survivors only. **Contract with the
   invoice agent — never change its columns without updating both repos.**
4. `progress_report.html` — the CFO's one-page view of cleanup progress.

## Tests

```bash
python tests/test_end_to_end.py
```

Runs the full cycle against the real extract in `input/`: Phase 1 acceptance
(finds ELYSEE/ELYSSE, the 100340/101762 VAT pair, ~290 shared-IBAN vendors,
exact worklist counts 155/219/65), the 10-group four-eyes demo with all four
outputs verified, ticked-action close, unmerge reversal, re-import
persistence, and audit-chain verification.

## Open questions for the operator (§10 — placeholders until answered)

1. Reviewer / approver names + AD emails → `config/settings.yaml`.
2. Can an FBL1N open-items export be provided, and how often?
3. Known legitimate shared-IBAN cases to seed the whitelist (the detected
   25-member group around the government collection IBAN is the obvious first
   candidate — see the Whitelist page).
4. Where the app runs (suggest: same on-prem VM as the invoice agent) and
   where `output/` should be reachable by the master-data team.
