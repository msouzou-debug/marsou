# Bank Reconciliation Tool

A **single-file HTML tool** for monthly bank reconciliations with a full audit
trail exported to Excel. It runs entirely in your browser — no installation, no
server, and **no data ever leaves your machine**.

## Quick start

1. Download / open [`bank-reconciliation.html`](bank-reconciliation.html) in any
   modern browser (Chrome, Edge, Firefox — just double-click the file).
2. Fill in the reconciliation details (entity, bank account, period, your name)
   and the two closing balances (per bank statement and per SAP GL account).
3. Load the three inputs:
   - **Bank statement** for the month (`.xlsx`, `.xls`, `.csv` or `.txt`)
   - **SAP bank movements** for the month (e.g. FBL3N / FAGLL03 export)
   - **Previous month's reconciliation report** — the Excel file this tool
     exported last month (skip on the first run)
4. Map the columns (date, description, reference, amount — auto-guessed from
   the headers), click **Load rows**.
5. Click **Run auto-match**, then clear the remainder manually by ticking items
   on both sides and clicking **Match selected** (many-to-many is supported).
6. Check the reconciliation summary, then click
   **Export reconciliation report (.xlsx)**.

## The exported Excel report (the audit trail)

| Sheet | Contents |
|---|---|
| `Summary` | Balances, adjusted balances, unreconciled difference, reconciled / not-reconciled status, and sign-off block (prepared / reviewed / approved) |
| `Matched Items` | Every matched group with match method (auto rule or manual), who matched it, and the exact timestamp |
| `Open Items - Bank` | Bank statement lines not yet posted in SAP (carried forward to next month) |
| `Open Items - SAP` | SAP postings not yet on the bank statement — outstanding payments, deposits in transit (carried forward) |
| `Audit Trail` | Chronological log of every action: files loaded (with column mapping used), auto-match runs and their parameters, manual matches/unmatches, and the export itself |
| `_RECON` | Machine-readable carry-forward data — **do not edit**. This is what lets next month's reconciliation import the open items losslessly |

**Keep every month's exported report.** It is both your audit evidence and the
input for the following month — open items are brought forward automatically
and keep a `B/F <period>` tag showing which month they originated in.

## How matching works

Amounts are normalised on load so that **positive = money into the bank
account** on both sides (works with single signed-amount columns or separate
debit/credit columns; a "flip signs" checkbox covers unusual exports).

Auto-match runs five passes over the open items:

1. **Reference + amount** (1-to-1) — references are normalised (case,
   punctuation and leading zeros ignored, so `INV-000123` matches `inv123`)
2. **Reference group** (many-to-many) — all open items sharing one reference
   are matched as a group when the two sides' totals agree, e.g. several bank
   receipts against one SAP lump-sum posting with the same reference
3. **Amount + date proximity** (1-to-1) — same amount within the configurable
   date tolerance (default 5 days), closest date wins
4. **Sum combination** (many-to-1, both directions) — finds up to
   *Max combined items* (default 4) on one side that add up to a single item
   on the other side, within the date tolerance — e.g. two salary batches on
   the statement matching one SAP payroll posting, or several SAP vendor
   payments matching one bulk bank debit
5. **Unique amount** (1-to-1) — amounts that appear exactly once on each side

Anything left is matched manually (1-to-1, 1-to-many or many-to-many). If the
selected totals differ, the tool warns and flags the difference in the export.

The reconciliation proof:

```
Adjusted bank balance = statement balance + open SAP items
Adjusted SAP balance  = GL balance       + open bank items
Unreconciled difference = adjusted bank − adjusted SAP   (target: 0.00)
```

## Sample files

`samples/` contains a sample bank statement (debit/credit layout with metadata
rows before the header) and a sample SAP line-item export (signed amounts) to
try the tool with — including a split payroll (two bank debits that auto-match
against a single SAP posting).

## Notes

- Works offline; the Excel engine ([SheetJS Community Edition](https://sheetjs.com),
  Apache-2.0) is embedded in the HTML file.
- Handles European (`1.234,56`) and US (`1,234.56`) number formats, negative
  amounts in parentheses or with trailing minus, Excel serial dates, and
  DMY / MDY / YMD date strings (auto-detected, with a manual override).
- Header rows are auto-detected even when the statement has metadata lines
  above the column headers; you can override the header row number.
