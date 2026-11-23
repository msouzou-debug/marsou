-- eCapital — SAP capital lines replace the ME2N and KSB1 extracts (ADR-0036).
--
-- SAP administration checked production on 20/11/2026: no WBS elements, no
-- capital internal orders, purchase orders for stock only. They built one
-- read instead, `sap_capex_lineitem_export` (also as a CSV or Excel file):
-- vendor lines on the capital GL accounts, with the vendor number and the
-- contract's CAP- reference. This migration gives the ledger the room for it:
--
--   1. `sap_report` gains CAPEX_LINES. ME2N and KSB1 stay in the enum so the
--      batches already imported keep their label; the API refuses them for
--      new uploads (errors.sapReportRetired).
--   2. `cost_matched_by` gains CONTRACT_REF (the line carried a CAP-
--      reference) and EFINANCE_INVOICE (vendor number, amount and date
--      matched an invoice eFinance booked).
--   3. `cost_txn` gains `vendor_no`, `contract_ref`, `invoice_ref` and
--      `efinance_invoice_id`, null on every row that is not a capital line.
--   4. `allocation_rule` accepts a vendor number as its key: SAP sends the
--      number only, by design (ADR-0036 §6), so a remembered allocation on a
--      capital line is keyed on the number and the normalised narrative.
--
-- `cost_txn_counts_as_spent` (0020) is not touched: a capital line is
-- SAP_EXTRACT or SAP_MCP like any SAP actual, so on a contract eFinance knows
-- it is reconciliation only, and on one it does not know it counts
-- (ADR-0036 §3).
--
-- NO PATIENT DATA. A vendor number, a contract reference, a supplier's
-- invoice number and an amount.
--
-- Written as plain SQL (ADR-0008). Idempotent: `add value if not exists`,
-- `add column if not exists`, `create index if not exists`, and the one
-- index that changes shape is dropped and created by name.

-- ---------------------------------------------------------------- enums --

-- PostgreSQL 16 allows `alter type … add value` inside the transaction
-- migrate.ts wraps every file in; what it refuses is using the new value
-- before that transaction commits (0009 explains the history). Nothing below
-- names any of the three new values as a literal.
alter type ecapital.sap_report add value if not exists 'CAPEX_LINES';
alter type ecapital.cost_matched_by add value if not exists 'CONTRACT_REF';
alter type ecapital.cost_matched_by add value if not exists 'EFINANCE_INVOICE';

-- ------------------------------------------------------------- cost_txn --

--   vendor_no            SAP's vendor number. The name shown beside it comes
--                        from eFinance's vendor list (`efinance_vendor`).
--   contract_ref         `contractReference` as SAP sent it: CAP-YYYY-NNNN,
--                        or whatever was typed in the field, or null.
--   invoice_ref          `reference`, the vendor's own invoice number.
--   efinance_invoice_id  the eFinance invoice the line was matched to by
--                        vendor, amount and date; null otherwise.
alter table ecapital.cost_txn
  add column if not exists vendor_no text,
  add column if not exists contract_ref text,
  add column if not exists invoice_ref text,
  add column if not exists efinance_invoice_id text
    references ecapital.efinance_invoice (id) on delete set null;

create index if not exists cost_txn_vendor_no_idx on ecapital.cost_txn (vendor_no);
create index if not exists cost_txn_contract_ref_idx on ecapital.cost_txn (contract_ref);
create index if not exists cost_txn_efinance_invoice_idx on ecapital.cost_txn (efinance_invoice_id);

comment on column ecapital.cost_txn.vendor_no is
  'SAP vendor number of a capital line (ADR-0036). Null on every other source.';
comment on column ecapital.cost_txn.contract_ref is
  'contractReference as SAP sent it on a capital line (ADR-0036): CAP-YYYY-NNNN, or null.';
comment on column ecapital.cost_txn.invoice_ref is
  'The vendor''s own invoice number on a capital line (SAP reference, ADR-0036).';
comment on column ecapital.cost_txn.efinance_invoice_id is
  'The eFinance invoice a capital line matched by vendor number, net amount and date (ADR-0036 §2).';

-- ------------------------------------------------------ allocation_rule --

-- A rule keyed by vendor number carries the number here and the display
-- name in vendor_name/vendor_norm as before. The unique key splits in two:
-- name rules stay unique on (vendor_norm, text_norm) among themselves, and
-- number rules are unique on (vendor_no, text_norm). Without the split a
-- number rule and a name rule for the same supplier would collide on the
-- name.
alter table ecapital.allocation_rule
  add column if not exists vendor_no text;

drop index if exists ecapital.allocation_rule_key;
create unique index allocation_rule_key
  on ecapital.allocation_rule (vendor_norm, text_norm)
  where vendor_no is null;
create unique index if not exists allocation_rule_vendor_no_key
  on ecapital.allocation_rule (vendor_no, text_norm)
  where vendor_no is not null;

comment on column ecapital.allocation_rule.vendor_no is
  'SAP vendor number a capital-line rule is keyed on (ADR-0036). Null for a rule keyed on the vendor name.';
