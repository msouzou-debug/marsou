-- 0032 — owner UAT of 25/11/2026, two findings in one file.
--
-- 1. RFIs: «the RFI opens but there is no button to close it, with or
--    without an update». An RFI is now answered with the day the answer
--    arrived (not only the moment somebody typed it), and it can be closed
--    with or without an answer:
--
--      * `answered_on` — the day the answer arrived, as the engineer says.
--        Not before the day the RFI was raised (this CHECK) and not after
--        today (the API; «today» moves with the clock). Null on an RFI
--        answered before 0032; the API reads the day of `answered_at` then.
--      * `closed_by`, `closed_at`, `closing_note` — who closed it, when, and
--        why. RULE (owner, UAT 25/11/2026): an RFI may be closed without an
--        answer (the question became moot, it was settled on site), and
--        then the closing note is required: a closed question with neither
--        an answer nor a reason is a question nobody can account for.
--
--    0006's `rfi_answered_before_closed` (no close before an answer) is
--    replaced by the rule above. An RFI closed before 0032 keeps its answer,
--    which it had to have; its `closed_at` is taken from `updated_at`,
--    because a closed RFI is not edited (UAT 25/11/2026) and filing evidence
--    against it does not touch the row, so the last change to it was the
--    close. Who closed it was not recorded and stays null.
--
-- 2. Contractors: who to write to. A contact person, an e-mail address and
--    a telephone on the contractor, so an RFI can prefill its recipient.
--    `contact_source` says who typed them: 'MANUAL' (a user, the default) or
--    'EFINANCE' (the vendor master, once eFinance sends `email` and `phone`
--    on GET /api/v1/master/vendors — today it does not). RULE: eFinance
--    fills a contact only where it is empty or where eFinance filled it
--    before; a contact a user typed is never overwritten.
--    `efinance_vendor` gains the two nullable columns to mirror them.
--
-- SECURITY: no bank details. eCapital never stores an IBAN or an account
-- number; the vendor mirror keeps exactly the fields listed here and nothing
-- eFinance might add next to them.
--
-- NO PATIENT DATA: the name, work e-mail and work telephone of a person at a
-- contractor; the text of a note about the works.
--
-- Row-level security: no policy is added, dropped or changed. The new
-- columns live on `rfi`, `contractor` and `efinance_vendor`, whose policies
-- already govern every column: the RFI log's writers answer and close
-- (`can_manage_site_log`), the register's keepers edit a contact
-- (`can_manage_contractor`), and the eFinance sync runs as the system.
--
-- Self-contained and idempotent: `add column if not exists`, `drop … if
-- exists` before every constraint, and every backfill guarded so a second
-- run finds nothing to do.

-- ================================================================ 1. RFIs --

alter table ecapital.rfi add column if not exists answered_on date;
alter table ecapital.rfi add column if not exists closed_by uuid
  references ecapital.app_user (id) on delete restrict;
alter table ecapital.rfi add column if not exists closed_at timestamptz;
alter table ecapital.rfi add column if not exists closing_note text;

comment on column ecapital.rfi.answered_on is
  'The day the answer arrived, as recorded by the engineer. Not before the day the RFI was raised, not after today (API). Null on answers recorded before 0032: the day of answered_at is used.';
comment on column ecapital.rfi.closed_by is
  'Who closed the RFI. Null on RFIs closed before 0032.';
comment on column ecapital.rfi.closed_at is
  'When the RFI was closed. Backfilled from updated_at for RFIs closed before 0032.';
comment on column ecapital.rfi.closing_note is
  'Why it was closed. Optional on an answered RFI, required on one closed without an answer (owner, UAT 25/11/2026).';

-- The backfills, before the constraints that read them.
update ecapital.rfi
   set closed_at = updated_at
 where status = 'CLOSED' and closed_at is null;

alter table ecapital.rfi drop constraint if exists rfi_answered_before_closed;

-- ANSWERED means there is an answer; 0006's `rfi_answer_complete` still
-- says the three answer columns come together.
alter table ecapital.rfi drop constraint if exists rfi_answered_has_answer;
alter table ecapital.rfi add constraint rfi_answered_has_answer
  check (status <> 'ANSWERED' or answered_at is not null);

-- RULE (owner, UAT 25/11/2026): closed with an answer, or with a reason.
alter table ecapital.rfi drop constraint if exists rfi_closed_answer_or_note;
alter table ecapital.rfi add constraint rfi_closed_answer_or_note
  check (status <> 'CLOSED'
      or answered_at is not null
      or (closing_note is not null and char_length(btrim(closing_note)) >= 1));

-- The closing columns belong to a closed RFI and to nothing else.
alter table ecapital.rfi drop constraint if exists rfi_closing_only_when_closed;
alter table ecapital.rfi add constraint rfi_closing_only_when_closed
  check (status = 'CLOSED' or (closed_at is null and closed_by is null and closing_note is null));

alter table ecapital.rfi drop constraint if exists rfi_closing_note_length;
alter table ecapital.rfi add constraint rfi_closing_note_length
  check (closing_note is null or char_length(btrim(closing_note)) between 1 and 4000);

-- RULE (owner, UAT 25/11/2026, the site-log date rule): the answer did not
-- arrive before the question was asked. Both read as calendar days in
-- Nicosia; «not after today» is the API's.
alter table ecapital.rfi drop constraint if exists rfi_answered_on_not_before_raised;
alter table ecapital.rfi add constraint rfi_answered_on_not_before_raised
  check (answered_on is null or answered_on >= (raised_at at time zone 'Europe/Nicosia')::date);

alter table ecapital.rfi drop constraint if exists rfi_answered_on_with_answer;
alter table ecapital.rfi add constraint rfi_answered_on_with_answer
  check (answered_on is null or answered_at is not null);

-- ========================================================= 2. Contractors --

alter table ecapital.contractor add column if not exists contact_name text;
alter table ecapital.contractor add column if not exists contact_email text;
alter table ecapital.contractor add column if not exists contact_phone text;
alter table ecapital.contractor add column if not exists contact_source text not null default 'MANUAL';
alter table ecapital.contractor add column if not exists contact_synced_at timestamptz;

comment on column ecapital.contractor.contact_name is
  'The person to write to at the contractor. Free text.';
comment on column ecapital.contractor.contact_email is
  'Their work e-mail. Prefills an RFI''s recipient; eCapital sends no e-mail.';
comment on column ecapital.contractor.contact_phone is
  'Their work telephone, as written.';
comment on column ecapital.contractor.contact_source is
  'MANUAL: typed by a user, never overwritten by a sync. EFINANCE: filled from the eFinance vendor master and kept up to date by it.';
comment on column ecapital.contractor.contact_synced_at is
  'When the eFinance sync last wrote the contact. Null on a MANUAL contact.';

alter table ecapital.contractor drop constraint if exists contractor_contact_source_known;
alter table ecapital.contractor add constraint contractor_contact_source_known
  check (contact_source in ('MANUAL', 'EFINANCE'));

alter table ecapital.contractor drop constraint if exists contractor_contact_name_length;
alter table ecapital.contractor add constraint contractor_contact_name_length
  check (contact_name is null or char_length(btrim(contact_name)) between 1 and 200);

-- The same plain shape check as the RFI's recipient address (0030); the
-- API's zod check is the stricter of the two.
alter table ecapital.contractor drop constraint if exists contractor_contact_email_shape;
alter table ecapital.contractor add constraint contractor_contact_email_shape
  check (contact_email is null
      or (char_length(contact_email) <= 254
          and contact_email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'));

-- A telephone as people write it: digits, spaces, +, -, ., /, brackets.
alter table ecapital.contractor drop constraint if exists contractor_contact_phone_shape;
alter table ecapital.contractor add constraint contractor_contact_phone_shape
  check (contact_phone is null
      or (char_length(contact_phone) between 3 and 40
          and contact_phone ~ '^[0-9+()./ -]+$'
          and contact_phone ~ '[0-9]'));

-- ----------------------------------------------------- the vendor mirror --

alter table ecapital.efinance_vendor add column if not exists email text;
alter table ecapital.efinance_vendor add column if not exists phone text;

comment on column ecapital.efinance_vendor.email is
  'The vendor''s e-mail from SAP''s address data (ADR6-SMTP_ADDR), once eFinance sends it. Null today.';
comment on column ecapital.efinance_vendor.phone is
  'The vendor''s telephone from SAP''s address data (ADRC-TEL_NUMBER), once eFinance sends it. Null today.';
