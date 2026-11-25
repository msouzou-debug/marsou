-- 0030 — two owner decisions of 25/11/2026, in one file.
--
-- 1. RFIs: who the question went to, and the evidence that it went.
--    eCapital sends no e-mail (owner decision): the engineer sends the RFI
--    from Outlook and files the sent message, and later the reply, here. So
--    an RFI gains the recipient's name (free text; required on a new RFI by
--    the API, nullable here because every RFI before today has none), an
--    optional e-mail address, and the day it was sent. The files are ordinary
--    `document` rows (entity_type 'rfi', kind RFI_EVIDENCE) queued for
--    eArchive like every other paper (ADR-0023).
--
-- 2. Assets: SAP's fixed-asset class (owner decision: one register for every
--    SAP class, no second tool). A reference table of the sixteen classes
--    SAP uses, a nullable `asset.sap_asset_class` pointing at it, and a
--    backfill of the existing register from eCapital's own `asset_class`
--    using the default mapping the form also prefills with
--    (packages/shared/src/asset.ts `SAP_ASSET_CLASS_BY_ASSET_CLASS`).
--
-- NO PATIENT DATA: a person's name and work address at a contractor or a
-- designer, a date, a file of correspondence about the works; an accounting
-- class.
--
-- Self-contained and idempotent: `if not exists`, `create or replace`,
-- `drop … if exists` before every constraint, trigger and policy, and an
-- `on conflict` seed. The backfill only touches rows that have no SAP class
-- yet, so running it twice changes nothing the second time.

-- ================================================================ 1. RFIs --

alter table ecapital.rfi add column if not exists recipient_name text;
alter table ecapital.rfi add column if not exists recipient_email text;
alter table ecapital.rfi add column if not exists sent_on date;

comment on column ecapital.rfi.recipient_name is
  'Who the RFI was sent to: the designer''s or the contractor''s person, free text. Required by the API on an RFI raised from 0030 on; null on older rows.';
comment on column ecapital.rfi.recipient_email is
  'The address the engineer sent the RFI to from Outlook. eCapital sends no e-mail (owner decision 25/11/2026); this is a record, not a mailing list.';
comment on column ecapital.rfi.sent_on is
  'The day the RFI left by e-mail. Not before the day it was raised in eCapital and not after today (the API checks today; this column checks the first half).';

alter table ecapital.rfi drop constraint if exists rfi_recipient_name_length;
alter table ecapital.rfi add constraint rfi_recipient_name_length
  check (recipient_name is null or char_length(btrim(recipient_name)) between 1 and 200);

-- A plain shape check: something@something.something, no spaces. The API's
-- zod e-mail check is the stricter of the two; this keeps a repair script
-- from writing a name into the address column.
alter table ecapital.rfi drop constraint if exists rfi_recipient_email_shape;
alter table ecapital.rfi add constraint rfi_recipient_email_shape
  check (recipient_email is null
      or (char_length(recipient_email) <= 254
          and recipient_email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'));

-- RULE (owner, UAT 25/11/2026, the site-log date rule): the day it was sent
-- is not before the day it was raised, both read as calendar days in
-- Nicosia. «Not after today» moves with the clock and is the API's.
alter table ecapital.rfi drop constraint if exists rfi_sent_not_before_raised;
alter table ecapital.rfi add constraint rfi_sent_not_before_raised
  check (sent_on is null or sent_on >= (raised_at at time zone 'Europe/Nicosia')::date);

-- The evidence is a document of its own kind, so the eArchive folder does not
-- file a sent e-mail as «OTHER». Nothing below reads the new label (0009 and
-- 0017 record why the ALTER is safe inside the transaction).
alter type ecapital.document_kind add value if not exists 'RFI_EVIDENCE';

-- Who may file it: whoever may write the RFI log (`rfisInstructions` WRITE in
-- a unit they may write, ecapital.can_manage_site_log, 0023). That is not the
-- same set can_manage_document names — a project engineer who raises RFIs is
-- not necessarily one who files award decisions — so, like the work-order
-- photograph in 0022, this adds one narrow case: insert only, an RFI's
-- evidence, by whoever may write the RFI. Every other document keeps exactly
-- the policies 0014 and 0023 gave it, and reading stays `document_read`.
drop policy if exists document_insert_rfi on ecapital.document;
create policy document_insert_rfi on ecapital.document
  for insert with check (
    entity_type = 'rfi'
    -- Compared as text: PostgreSQL refuses to use an enum label inside the
    -- transaction that added it.
    and kind::text = 'RFI_EVIDENCE'
    and ecapital.can_manage_site_log(org_unit_id));

-- eArchive's queue names the module every item comes from. The full list,
-- 0022's plus this one.
alter table ecapital.dms_outbox drop constraint if exists dms_outbox_module_known;
alter table ecapital.dms_outbox add constraint dms_outbox_module_known
  check (source_module in ('award', 'business_case', 'variation', 'permit',
                           'payment_cert', 'asset_document', 'work_order_document',
                           'rfi_document'));

-- ===================================================== 2. SAP asset class --

create table if not exists ecapital.sap_asset_class (
  -- SAP's own six-digit class, «111020». Text: a code, never a quantity.
  code       text primary key,
  name_el    text not null,
  name_en    text not null,
  active     boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint sap_asset_class_code_shape check (code ~ '^[0-9]{6}$'),
  constraint sap_asset_class_name_el_length check (char_length(btrim(name_el)) between 2 and 120),
  constraint sap_asset_class_name_en_length check (char_length(btrim(name_en)) between 2 and 120)
);

comment on table ecapital.sap_asset_class is
  'SAP''s fixed-asset classes (owner decision 25/11/2026: one register, all SAP classes). Reference data, read by every signed-in user; asset.sap_asset_class points here.';

insert into ecapital.sap_asset_class (code, name_el, name_en) values
  ('111020', 'Κτήρια', 'Buildings'),
  ('111025', 'Βελτιώσεις κτηρίων', 'Buildings Improvements'),
  ('111030', 'Ιατρικός εξοπλισμός', 'Medical Equipment'),
  ('111032', 'Μηχανήματα εκτυπώσεων', 'Printing Machineries'),
  ('111040', 'Μηχανήματα και εξοπλισμός', 'Machinery & Equipment'),
  ('111042', 'Κλιματισμός', 'Air-conditioning'),
  ('111046', 'Ασθενοφόρα', 'Ambulance Vehicles'),
  ('111048', 'Λοιπά οχήματα', 'Other Vehicles'),
  ('111050', 'Ηλεκτρονικοί υπολογιστές και λοιπά', 'Computer and Other'),
  ('111052', 'Ηλεκτρονικός εξοπλισμός', 'Electronic equipment'),
  ('111054', 'Εξοπλισμός γραφείου', 'Office Equipment'),
  ('111056', 'Τηλεπικοινωνιακός εξοπλισμός', 'Telecommunication equipment'),
  ('111058', 'Ασφάλεια και φύλαξη', 'Safety and security'),
  ('111062', 'Ηλεκτρομηχανολογικά', 'Mechanical & Electrical'),
  ('111066', 'Λογισμικό', 'Computer Software'),
  ('111120', 'Πάγια υπό κατασκευή', 'Asset Under Construction')
on conflict (code) do nothing;

alter table ecapital.asset
  add column if not exists sap_asset_class text
    references ecapital.sap_asset_class (code) on delete restrict;
create index if not exists asset_sap_class_idx on ecapital.asset (sap_asset_class)
  where sap_asset_class is not null;
comment on column ecapital.asset.sap_asset_class is
  'SAP fixed-asset class (ecapital.sap_asset_class). Prefilled from asset_class by the default mapping and overridable; null where nobody has said (OTHER has no default).';

-- The default mapping, as SQL, for the backfill. The same table as
-- `SAP_ASSET_CLASS_BY_ASSET_CLASS` in packages/shared/src/asset.ts; OTHER
-- maps to nothing, so its rows stay null until somebody chooses.
create or replace function ecapital.default_sap_asset_class(p_class ecapital.asset_class)
returns text
language sql immutable parallel safe as $$
  select case p_class::text
    when 'BUILDING_FABRIC' then '111020'
    when 'HVAC'            then '111042'
    when 'ELECTRICAL'      then '111062'
    when 'MEDICAL_GAS'     then '111062'
    when 'WATER'           then '111062'
    when 'FIRE'            then '111058'
    when 'LIFT'            then '111040'
    when 'BIOMEDICAL'      then '111030'
    when 'IT'              then '111050'
    else null
  end
$$;

-- The backfill. Only rows with no SAP class yet, so a second run, or a run
-- after somebody has chosen a class by hand, changes nothing. The audit
-- trigger records it as an UPDATE like any other change to the register.
update ecapital.asset
   set sap_asset_class = ecapital.default_sap_asset_class(asset_class)
 where sap_asset_class is null
   and ecapital.default_sap_asset_class(asset_class) is not null;

drop trigger if exists sap_asset_class_audit on ecapital.sap_asset_class;
create trigger sap_asset_class_audit
  after insert or update or delete on ecapital.sap_asset_class
  for each row execute function ecapital.write_audit();

-- Reference data, the budget_code discipline (0013): every signed-in role
-- reads it, because every asset form and filter offers the same sixteen rows
-- whichever unit the caller works in. Only the administrator changes it.
alter table ecapital.sap_asset_class enable row level security;

drop policy if exists sap_asset_class_read on ecapital.sap_asset_class;
create policy sap_asset_class_read on ecapital.sap_asset_class
  for select using (true);

drop policy if exists sap_asset_class_write on ecapital.sap_asset_class;
create policy sap_asset_class_write on ecapital.sap_asset_class
  for all
  using (ecapital.has_role('admin'))
  with check (ecapital.has_role('admin'));

drop policy if exists audit_log_read_sap_asset_class on ecapital.audit_log;
create policy audit_log_read_sap_asset_class on ecapital.audit_log
  for select using (
    entity_type = 'sap_asset_class'
    and (ecapital.has_role('admin') or ecapital.has_role('auditor_readonly')));

-- --------------------------------------------------------------- grants --

grant select, insert, update, delete on ecapital.sap_asset_class to ecapital_app;
grant execute on function ecapital.default_sap_asset_class(ecapital.asset_class) to ecapital_app;
