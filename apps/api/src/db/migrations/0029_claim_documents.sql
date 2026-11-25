-- 0029 — the papers of a claim (owner report, 25/11/2026; ADR-0035 §4).
--
-- ADR-0035 gave a claim «an optional document» and a single `document_id`
-- column to hold it, and nothing ever filled it: there was no upload. A
-- claim arrives as a letter or an e-mail, is answered, and often brings a
-- lawyer's letter after it, so one claim carries several papers. They are
-- `document` rows like every other paper eCapital files with eArchive
-- (ADR-0023), hung off the claim by `entity_type = 'contract_claim'` and the
-- claim's id, which is how a contract's, a project's and a variation's
-- papers already hang off theirs. No link table: what kind of paper it is
-- goes in `kind`, which is what that column is for.
--
-- Access is unchanged and not widened. A claim paper is read by whoever may
-- read the unit (`document_read`) and written by whoever may write contract
-- records there (`document_write` → `can_manage_document`, which already
-- names contractRecords WRITE, the permission that adds and edits a claim).
-- No policy is added, dropped or loosened here.
--
-- NO PATIENT DATA. A claim letter, a reply and a lawyer's letter are about a
-- contract, money and dates.

-- The three kinds of paper. Nothing below reads the new labels; the first
-- row that carries one is written by a request long after this has committed
-- (0009, 0017 and 0022 record why the ALTER is safe inside the transaction).
alter type ecapital.document_kind add value if not exists 'CLAIM_LETTER';
alter type ecapital.document_kind add value if not exists 'CLAIM_REPLY';
alter type ecapital.document_kind add value if not exists 'CLAIM_LEGAL_LETTER';

-- eArchive files them under `source_module: claim_document`.
alter table ecapital.dms_outbox drop constraint if exists dms_outbox_module_known;
alter table ecapital.dms_outbox add constraint dms_outbox_module_known
  check (source_module in ('award', 'business_case', 'variation', 'permit',
                           'payment_cert', 'asset_document', 'work_order_document',
                           'claim_document'));

comment on column ecapital.contract_claim.document_id is
  'ADR-0035''s single document, kept for the record. A claim''s papers are the document rows with entity_type = ''contract_claim'' and entity_id = this claim (0029).';
