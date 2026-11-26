-- 0034 — owner request of 26/11/2026: «site instructions need same facility
-- to send e-mails as RFI».
--
-- A site instruction gains what an RFI gained in 0030: who it was sent to,
-- the address used, the day it left, and the correspondence filed against
-- it. eCapital still sends no e-mail (owner decision 25/11/2026): the
-- engineer sends the instruction from Outlook — as an .eml draft the browser
-- builds, or a mailto link — and files the letter here.
--
--   * `recipient_name` — free text, nullable. An instruction goes to the
--     contractor the contract already names; the screen prefills the
--     contractor's contact and the API does not require it.
--   * `recipient_email` — the address used in Outlook, nullable.
--   * `sent_on` — the day it left. Not before the day it was issued (this
--     CHECK) and not after today (the API; «today» moves with the clock).
--   * The files are ordinary `document` rows (entity_type 'site_instruction',
--     kind SITE_INSTRUCTION_EVIDENCE) queued for eArchive like every other
--     paper (ADR-0023), under their own module `site_instruction_document`.
--
-- Row-level security: one narrow insert policy is added, the same shape as
-- 0030's `document_insert_rfi` — a site instruction's evidence, by whoever may
-- write the site instruction log (`ecapital.can_manage_site_log`, the policy
-- `site_instruction_write` already uses since 0023). Every other document
-- keeps exactly the policies 0014 and 0023 gave it, and reading stays
-- `document_read` (whoever may read the unit), as for the instruction itself
-- (`site_instruction_read`). Nothing is dropped or widened.
--
-- NO PATIENT DATA: a person's name and work address at a contractor, a date,
-- a file of correspondence about the works.
--
-- Self-contained and idempotent: `add column if not exists`, `drop … if
-- exists` before every constraint and policy, `add value if not exists`.
-- Depends on nothing after 0032.

alter table ecapital.site_instruction add column if not exists recipient_name text;
alter table ecapital.site_instruction add column if not exists recipient_email text;
alter table ecapital.site_instruction add column if not exists sent_on date;

comment on column ecapital.site_instruction.recipient_name is
  'Who the instruction was sent to: the contractor''s person, free text. Optional; null on instructions before 0034.';
comment on column ecapital.site_instruction.recipient_email is
  'The address the engineer sent the instruction to from Outlook. eCapital sends no e-mail (owner decision 25/11/2026); this is a record, not a mailing list.';
comment on column ecapital.site_instruction.sent_on is
  'The day the instruction left by e-mail. Not before the day it was issued and not after today (the API checks today; this column checks the first half).';

alter table ecapital.site_instruction drop constraint if exists site_instruction_recipient_name_length;
alter table ecapital.site_instruction add constraint site_instruction_recipient_name_length
  check (recipient_name is null or char_length(btrim(recipient_name)) between 1 and 200);

-- The same plain shape check as 0030's on the RFI; the API's zod check is
-- the stricter of the two.
alter table ecapital.site_instruction drop constraint if exists site_instruction_recipient_email_shape;
alter table ecapital.site_instruction add constraint site_instruction_recipient_email_shape
  check (recipient_email is null
      or (char_length(recipient_email) <= 254
          and recipient_email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'));

-- RULE (owner, 26/11/2026, the RFI's rule): sent not before the day it was
-- issued, both read as calendar days in Nicosia.
alter table ecapital.site_instruction drop constraint if exists site_instruction_sent_not_before_issued;
alter table ecapital.site_instruction add constraint site_instruction_sent_not_before_issued
  check (sent_on is null or sent_on >= (issued_at at time zone 'Europe/Nicosia')::date);

-- The evidence is a document of its own kind, so the eArchive folder does not
-- file a sent instruction as «OTHER». Nothing below reads the new label as an
-- enum (0009 and 0017 record why the ALTER is safe inside the transaction).
alter type ecapital.document_kind add value if not exists 'SITE_INSTRUCTION_EVIDENCE';

drop policy if exists document_insert_site_instruction on ecapital.document;
create policy document_insert_site_instruction on ecapital.document
  for insert with check (
    entity_type = 'site_instruction'
    -- Compared as text: PostgreSQL refuses to use an enum label inside the
    -- transaction that added it.
    and kind::text = 'SITE_INSTRUCTION_EVIDENCE'
    and ecapital.can_manage_site_log(org_unit_id));

-- eArchive's queue names the module every item comes from. The full list:
-- 0030's, and this one.
alter table ecapital.dms_outbox drop constraint if exists dms_outbox_module_known;
alter table ecapital.dms_outbox add constraint dms_outbox_module_known
  check (source_module in ('award', 'business_case', 'variation', 'permit',
                           'payment_cert', 'asset_document', 'work_order_document',
                           'claim_document', 'rfi_document',
                           'site_instruction_document'));
