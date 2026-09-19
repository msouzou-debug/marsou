-- 0014 — the eArchive outbox: the documents eCapital files with ΟΚΥπΥ's
-- protocol and records system, the queue that files them, and the events
-- eArchive sends back (eArchive brief of 19/09/2026; ADR-0023).
--
-- Three tables and one rule that ties them together.
--
--   1. `document` — CAPEX-01 §4 lists it and nothing had built it yet. It is
--      the operational copy of a file eCapital needs in order to send it, and
--      the pointer to where the file really lives once eArchive has filed it:
--      `protocol_id`, `protocol_number`, and the two markers eArchive can set
--      on it afterwards, `legal_hold` and `deleted_at`.
--   2. `dms_outbox` — one row per thing to file, written in the SAME
--      transaction as the document row. If the upload commits, the item is
--      queued; if the queue row cannot be written, the upload did not happen.
--      That is the whole of ADR-0023's first decision.
--   3. `dms_event` — what eArchive tells us afterwards: a protocol deleted, a
--      legal hold set or cleared. Unique on (event, protocol_id, at), which
--      is what makes the callback idempotent at the table and not only in the
--      controller.
--
-- NO PATIENT DATA. A document here is an award decision, a business case or
-- an approved variation: money, dates, a unit, a contractor and the Greek
-- title a clerk would write on the folder. There is nowhere to put a patient
-- name, an identifier, a diagnosis, an episode or an appointment, and the
-- metadata schema the API builds is strict — eArchive rejects a field it does
-- not know, so a field nobody agreed cannot be smuggled in either.
--
-- Row-level security and the audit trigger for all three tables are in this
-- same file (ADR-0008, ADR-0010, ADR-0011).

-- ---------------------------------------------------------------- enums --

do $$
begin
  -- What kind of paper this is. The three the API files today; PERMIT comes
  -- with M5 and PAYMENT_CERT later, and both are listed now so that adding
  -- them is a route and not a migration on a live database.
  if not exists (select 1 from pg_type t join pg_namespace n on n.oid = t.typnamespace
                 where n.nspname = 'ecapital' and t.typname = 'document_kind') then
    create type ecapital.document_kind as enum (
      'AWARD_DECISION', 'BUSINESS_CASE', 'VARIATION', 'PERMIT', 'PAYMENT_CERT', 'OTHER');
  end if;

  -- QUEUED  — waiting for its turn, or waiting for the token (NullClient).
  -- SENDING — claimed by the sender; a crash leaves it here and the claim
  --           function takes it back once the lease has run out.
  -- SENT    — eArchive answered 201, or 200 with Idempotency-Replayed.
  -- FAILED  — eArchive refused it and said why. Not retried; an
  --           administrator looks at it (and has had an email about it).
  -- HELD    — taken out of the queue by hand.
  if not exists (select 1 from pg_type t join pg_namespace n on n.oid = t.typnamespace
                 where n.nspname = 'ecapital' and t.typname = 'dms_outbox_status') then
    create type ecapital.dms_outbox_status as enum (
      'QUEUED', 'SENDING', 'SENT', 'FAILED', 'HELD');
  end if;

  -- The three events eArchive's brief names. An event it has not named is
  -- refused by the column's own type rather than stored as a string nobody
  -- can look up.
  if not exists (select 1 from pg_type t join pg_namespace n on n.oid = t.typnamespace
                 where n.nspname = 'ecapital' and t.typname = 'dms_event_kind') then
    create type ecapital.dms_event_kind as enum (
      'protocol.deleted', 'legal_hold.set', 'legal_hold.cleared');
  end if;
end $$;

-- ------------------------------------------------------------- document --

-- CAPEX-01 §4: `id, entity_type, entity_id, kind, title_el, mime, size,
-- sha256, version, object_key`. Everything after `object_key` below is the
-- eArchive contract: the protocol eArchive assigned, and the two things it
-- can tell us afterwards.
--
-- `org_unit_id` is not in §4's line and is here for the same reason it is on
-- every other child table (ADR-0010): the policy is a column comparison and
-- not a walk up a tree that would have to know about three parent types.
create table if not exists ecapital.document (
  id              uuid primary key default gen_random_uuid(),
  org_unit_id     text not null references ecapital.org_unit (id) on delete restrict,
  -- 'contract', 'project' or 'variation' today. Text and not an enum: the
  -- next kind of document hangs off a table that does not exist yet.
  entity_type     text not null,
  entity_id       uuid not null,
  kind            ecapital.document_kind not null,
  title_el        text not null,
  filename        text not null,
  mime            text not null,
  size            bigint not null,
  sha256          text not null,
  version         integer not null default 1,
  -- Where the bytes are, relative to DOCUMENT_STORE_DIR. eCapital keeps this
  -- copy because it has to have the bytes in hand to send them, and for no
  -- other reason: eArchive is the archive (INTEGRATION §6, ADR-0023).
  object_key      text not null unique,
  -- The eArchive key. Stable and unique per item: `award:<contract_id>`,
  -- `business_case:<project_code>`, `variation:<cap_ref>:<n>`. A corrected
  -- document is a NEW row with a NEW source_ref and a SUPERSEDES relation,
  -- never an edit of this one.
  source_ref      text unique,
  -- Filled from eArchive's 201. eCapital never invents a protocol number.
  protocol_id     text,
  protocol_number text,
  -- Set and cleared by eArchive's callback. While it is true, nothing local
  -- may treat this record as disposable.
  legal_hold      boolean not null default false,
  legal_hold_at   timestamptz,
  -- The tombstone. eArchive deleted the protocol; we hold no file copy of
  -- the archive by design, so what is left is this row with its source_ref,
  -- its protocol_number and the moment it went.
  deleted_at      timestamptz,
  uploaded_by     uuid references ecapital.app_user (id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  -- eArchive's limits, written here so a repair script cannot get past them.
  constraint document_size_positive check (size > 0),
  constraint document_size_within_limit check (size <= 50 * 1024 * 1024),
  constraint document_sha256_lowercase_hex check (sha256 ~ '^[0-9a-f]{64}$'),
  constraint document_title_length check (char_length(title_el) between 3 and 500),
  constraint document_version_positive check (version >= 1),
  -- A protocol is a pair: eArchive answers with both or with neither.
  constraint document_protocol_complete
    check ((protocol_id is null) = (protocol_number is null)),
  constraint document_legal_hold_dated check ((legal_hold is false) or (legal_hold_at is not null))
);
create index if not exists document_unit_idx on ecapital.document (org_unit_id);
create index if not exists document_entity_idx on ecapital.document (entity_type, entity_id);
create index if not exists document_protocol_idx on ecapital.document (protocol_id)
  where protocol_id is not null;
create index if not exists document_hold_idx on ecapital.document (legal_hold)
  where legal_hold;

comment on table ecapital.document is
  'A file eCapital holds because it has to send it to eArchive, and the pointer to the protocol eArchive filed it under. eArchive is the archive; this is the operational copy and the link (ADR-0023).';
comment on column ecapital.document.legal_hold is
  'eArchive put a legal hold on the protocol. While true, no local action may treat this record as disposable.';
comment on column ecapital.document.deleted_at is
  'eArchive deleted the protocol. The row stays as the tombstone — source_ref, protocol_number, deleted_at — because we keep no copy of the archive.';

-- ----------------------------------------------------------- dms_outbox --

-- One row per item to file. Written in the same transaction as the document
-- row it carries, by ecapital.dms_queue below.
create table if not exists ecapital.dms_outbox (
  id                 uuid primary key default gen_random_uuid(),
  -- The Idempotency-Key the sender builds is `ecapital:<id>`, so the id is
  -- what makes a retry after a dropped connection safe on eArchive's side.
  source_ref         text not null unique,
  -- award | business_case | variation | permit | payment_cert (≤40 in the
  -- brief's schema; the five values are shorter than that by a long way).
  source_module      text not null,
  document_id        uuid references ecapital.document (id) on delete set null,
  org_unit_id        text references ecapital.org_unit (id) on delete restrict,
  -- The `meta` part exactly as it will be sent: schema v1, strict, already
  -- built from the entity. Stored rather than rebuilt at send time, so what
  -- was queued is what goes and a later edit to a project does not silently
  -- change a document that has already been described.
  meta               jsonb not null,
  -- One entry per multipart file part: object_key, part_name, filename,
  -- mime, size, sha256, kind. The object keys are how the sender finds the
  -- bytes; everything else is what `meta.files[]` has to agree with.
  files              jsonb not null,
  status             ecapital.dms_outbox_status not null default 'QUEUED',
  attempts           integer not null default 0,
  next_attempt_at    timestamptz not null default now(),
  -- eArchive's own code on a refusal: SCHEMA_INVALID, SHA256_MISMATCH,
  -- MIME_REJECTED, DUPLICATE_SOURCE_REF and the rest, or a transport word
  -- when the connection never got that far.
  last_error_code    text,
  last_error_message text,
  protocol_id        text,
  protocol_number    text,
  created_at         timestamptz not null default now(),
  sent_at            timestamptz,
  constraint dms_outbox_attempts_non_negative check (attempts >= 0),
  constraint dms_outbox_files_are_a_list check (jsonb_typeof(files) = 'array'),
  constraint dms_outbox_meta_is_an_object check (jsonb_typeof(meta) = 'object'),
  constraint dms_outbox_module_known
    check (source_module in ('award', 'business_case', 'variation', 'permit', 'payment_cert')),
  constraint dms_outbox_sent_has_a_protocol
    check (status <> 'SENT' or (protocol_id is not null and protocol_number is not null)),
  constraint dms_outbox_protocol_complete
    check ((protocol_id is null) = (protocol_number is null))
);
-- The queue the sender drains, in the order it drains it.
create index if not exists dms_outbox_due_idx on ecapital.dms_outbox (next_attempt_at)
  where status in ('QUEUED', 'SENDING');
create index if not exists dms_outbox_status_idx on ecapital.dms_outbox (status, created_at desc);
create index if not exists dms_outbox_document_idx on ecapital.dms_outbox (document_id);

comment on table ecapital.dms_outbox is
  'The eArchive queue. A row is written in the same transaction as the document it describes, so a filed document and a queued item cannot come apart (ADR-0023).';

-- ------------------------------------------------------------ dms_event --

-- What eArchive tells us afterwards. The unique index is the idempotency:
-- the same event twice is one row, and the controller answers 200 both times.
create table if not exists ecapital.dms_event (
  id              uuid primary key default gen_random_uuid(),
  event           ecapital.dms_event_kind not null,
  protocol_id     text not null,
  protocol_number text,
  source_ref      text,
  -- When eArchive says it happened, and when we heard. Both, because the
  -- first is eArchive's clock and the second is ours.
  at              timestamptz not null,
  received_at     timestamptz not null default now(),
  constraint dms_event_once unique (event, protocol_id, at)
);
create index if not exists dms_event_source_ref_idx on ecapital.dms_event (source_ref)
  where source_ref is not null;
create index if not exists dms_event_received_idx on ecapital.dms_event (received_at desc);

comment on table ecapital.dms_event is
  'Callbacks from eArchive: protocol.deleted, legal_hold.set, legal_hold.cleared. Unique on (event, protocol_id, at), which is what makes POST /api/v1/dms/events idempotent.';

-- ------------------------------------------------- queue, in transaction --

-- The document row is written by the caller under their own policy; the
-- outbox row is not, because the outbox is not anybody's unit — it is a
-- service queue an administrator reads. SECURITY DEFINER writes it as the
-- owner, exactly as ecapital.queue_email does for the R31 warnings, and the
-- audit trigger still records the caller as the actor.
--
-- Called from inside the upload's transaction, so a failure here rolls the
-- document back with it. That is the point (ADR-0023).
create or replace function ecapital.dms_queue(
  p_source_ref    text,
  p_source_module text,
  p_document_id   uuid,
  p_org_unit_id   text,
  p_meta          jsonb,
  p_files         jsonb)
returns uuid
language plpgsql security definer set search_path = ecapital, pg_catalog as $$
declare
  v_id uuid;
begin
  insert into ecapital.dms_outbox
    (source_ref, source_module, document_id, org_unit_id, meta, files)
  values (p_source_ref, p_source_module, p_document_id, p_org_unit_id, p_meta, p_files)
  returning id into v_id;
  return v_id;
end $$;

-- The sender runs on a timer and not inside a request, so it has no caller
-- and no policy to run under. These four are how it touches the queue.
--
-- A claim is a lease: the row goes to SENDING with next_attempt_at pushed
-- fifteen minutes out, so a process that dies mid-upload does not strand its
-- items — the next drain picks them up once the lease has run out. eArchive's
-- Idempotency-Key is what makes that second attempt safe.
create or replace function ecapital.dms_claim_due(p_limit integer default 5)
returns setof ecapital.dms_outbox
language plpgsql security definer set search_path = ecapital, pg_catalog as $$
begin
  return query
  update ecapital.dms_outbox o
     set status = 'SENDING',
         next_attempt_at = now() + interval '15 minutes'
   where o.id in (
     select d.id from ecapital.dms_outbox d
      where d.status in ('QUEUED', 'SENDING')
        and d.next_attempt_at <= now()
      order by d.next_attempt_at
      limit greatest(p_limit, 1)
      for update skip locked)
  returning o.*;
end $$;

-- 201, or 200 with Idempotency-Replayed: the same answer either way. The
-- protocol goes on the outbox row and on the document row, and nothing else
-- of eArchive's response is kept (INTEGRATION §6).
create or replace function ecapital.dms_mark_sent(
  p_id uuid, p_protocol_id text, p_protocol_number text)
returns void
language plpgsql security definer set search_path = ecapital, pg_catalog as $$
declare
  v_document_id uuid;
begin
  update ecapital.dms_outbox
     set status = 'SENT',
         protocol_id = p_protocol_id,
         protocol_number = p_protocol_number,
         sent_at = now(),
         last_error_code = null,
         last_error_message = null,
         next_attempt_at = now()
   where id = p_id
  returning document_id into v_document_id;

  if v_document_id is not null then
    update ecapital.document
       set protocol_id = p_protocol_id,
           protocol_number = p_protocol_number,
           updated_at = now()
     where id = v_document_id;
  end if;
end $$;

-- A 4xx eArchive means: do not send this again. The row is FAILED with the
-- code, and an administrator gets a line in email_outbox — the same channel
-- the R31 budget warnings use, and for the same reason: there is no SMTP
-- server configured for eCapital and inventing one here would either send
-- mail nobody asked for or fail the write (ADR-0021 §, ADR-0023).
create or replace function ecapital.dms_mark_failed(
  p_id uuid, p_code text, p_message text)
returns void
language plpgsql security definer set search_path = ecapital, pg_catalog as $$
declare
  v_row   ecapital.dms_outbox%rowtype;
  v_admin record;
begin
  update ecapital.dms_outbox
     set status = 'FAILED',
         attempts = attempts + 1,
         last_error_code = p_code,
         last_error_message = left(coalesce(p_message, ''), 2000),
         next_attempt_at = now()
   where id = p_id
  returning * into v_row;
  if not found then
    return;
  end if;

  for v_admin in
    select u.email, u.name
      from ecapital.app_user u
      join ecapital.app_user_role r on r.app_user_id = u.id and r.role = 'admin'
     where u.is_active
  loop
    perform ecapital.queue_email(
      v_row.org_unit_id, v_admin.email, v_admin.name,
      'eCapital — το eArchive απέρριψε ένα έγγραφο',
      'eCapital — eArchive refused a document',
      format('Το eArchive απέρριψε το έγγραφο %s με κωδικό %s. Το έγγραφο δεν αρχειοθετήθηκε και δεν θα ξανασταλεί αυτόματα.',
             v_row.source_ref, p_code),
      format('eArchive refused document %s with code %s. It was not filed and will not be resent automatically.',
             v_row.source_ref, p_code),
      'dms_outbox', v_row.id::text);
  end loop;
end $$;

-- A 5xx, or a connection that was refused: it is eArchive that is not there,
-- not the document that is wrong. Back in the queue at the time the sender
-- worked out (1 min, 5, 15, 60, then hourly — never dropped).
create or replace function ecapital.dms_mark_retry(
  p_id uuid, p_code text, p_message text, p_next_attempt_at timestamptz)
returns void
language plpgsql security definer set search_path = ecapital, pg_catalog as $$
begin
  update ecapital.dms_outbox
     set status = 'QUEUED',
         attempts = attempts + 1,
         last_error_code = p_code,
         last_error_message = left(coalesce(p_message, ''), 2000),
         next_attempt_at = p_next_attempt_at
   where id = p_id;
end $$;

-- POST /admin/dms/outbox/:id/retry. An administrator has read the error and
-- says try again; the row goes back to the front of the queue with its
-- attempt count intact, because the count is the history and not the state.
create or replace function ecapital.dms_outbox_retry(p_id uuid)
returns boolean
language plpgsql security definer set search_path = ecapital, pg_catalog as $$
declare
  v_touched integer;
begin
  update ecapital.dms_outbox
     set status = 'QUEUED',
         next_attempt_at = now()
   where id = p_id and status <> 'SENT';
  get diagnostics v_touched = row_count;
  return v_touched > 0;
end $$;

-- ------------------------------------------------- the callback's writes --

-- POST /api/v1/dms/events. The controller has already checked the token and
-- refused anything carrying a public-edge header (ADR-0022's rule, this time
-- pointing inwards); what is left is to record the event once and apply it.
--
-- Returns true when this call is the one that recorded it, false when the
-- same event had already arrived. The controller answers 200 either way —
-- that is what idempotent means here.
create or replace function ecapital.dms_record_event(
  p_event           text,
  p_protocol_id     text,
  p_protocol_number text,
  p_source_ref      text,
  p_at              timestamptz)
returns boolean
language plpgsql security definer set search_path = ecapital, pg_catalog as $$
declare
  v_inserted integer;
begin
  insert into ecapital.dms_event (event, protocol_id, protocol_number, source_ref, at)
  values (p_event::ecapital.dms_event_kind, p_protocol_id, p_protocol_number, p_source_ref, p_at)
  on conflict on constraint dms_event_once do nothing;
  get diagnostics v_inserted = row_count;

  -- The effect is applied whether or not the row was new, so a replay of an
  -- event that arrived while the document row was still being written still
  -- leaves the marker in place. Every one of these is idempotent by itself.
  if p_event = 'protocol.deleted' then
    -- The tombstone: the row stays, with what it was filed as and when it
    -- went. We hold no copy of the archive, so there is nothing else to keep.
    update ecapital.document
       set deleted_at = coalesce(deleted_at, p_at),
           updated_at = now()
     where (protocol_id = p_protocol_id
            or (p_source_ref is not null and source_ref = p_source_ref))
       and deleted_at is null;
  elsif p_event = 'legal_hold.set' then
    update ecapital.document
       set legal_hold = true,
           legal_hold_at = coalesce(legal_hold_at, p_at),
           updated_at = now()
     where (protocol_id = p_protocol_id
            or (p_source_ref is not null and source_ref = p_source_ref))
       and legal_hold is false;
  elsif p_event = 'legal_hold.cleared' then
    update ecapital.document
       set legal_hold = false,
           legal_hold_at = null,
           updated_at = now()
     where (protocol_id = p_protocol_id
            or (p_source_ref is not null and source_ref = p_source_ref))
       and legal_hold is true;
  end if;

  return v_inserted > 0;
end $$;

-- ------------------------------------------------------ inherited units --

-- Nothing to inherit: `document` carries its own unit because it hangs off
-- three different parents (a contract, a project and a variation), and the
-- service copies the parent's unit onto it at insert. The WITH CHECK below
-- is what stops a caller putting one somewhere they may not write.

-- --------------------------------------------------------------- audit --

do $$
declare
  t text;
begin
  foreach t in array array['document', 'dms_outbox', 'dms_event']
  loop
    execute format('drop trigger if exists %I on ecapital.%I', t || '_audit', t);
    execute format(
      'create trigger %I after insert or update or delete on ecapital.%I
         for each row execute function ecapital.write_audit()', t || '_audit', t);
  end loop;
end $$;

-- ------------------------------------------------- row-level security --

-- Who may attach a document to something. The same shape as
-- ecapital.can_manage_cost: whoever may write the unit, and one of the roles
-- that owns the paperwork. The two read-only roles are already refused by
-- can_write_unit and are left out of the list again for the reader's sake.
create or replace function ecapital.can_manage_document(p_org_unit_id text) returns boolean
language sql stable parallel safe as $$
  select ecapital.can_write_unit(p_org_unit_id)
     and (ecapital.has_role('admin')
       or ecapital.has_role('estates_head')
       or ecapital.has_role('project_engineer')
       or ecapital.has_role('finance'))
$$;

do $$
declare
  t text;
begin
  foreach t in array array['document', 'dms_outbox', 'dms_event']
  loop
    execute format('alter table ecapital.%I enable row level security', t);
  end loop;
end $$;

-- A document belongs to the unit the thing it describes belongs to, and is
-- read by whoever may read that unit (ADR-0010).
drop policy if exists document_read on ecapital.document;
create policy document_read on ecapital.document
  for select using (ecapital.can_read_unit(org_unit_id));
drop policy if exists document_write on ecapital.document;
create policy document_write on ecapital.document
  for all
  using (ecapital.can_manage_document(org_unit_id))
  with check (ecapital.can_manage_document(org_unit_id));

-- The queue and the callbacks are the service's, not a unit's. Nobody writes
-- them through a policy at all: every write goes through one of the
-- SECURITY DEFINER functions above, which is what «service-only» means here.
-- An administrator and the auditor read them, as they do email_outbox.
drop policy if exists dms_outbox_read on ecapital.dms_outbox;
create policy dms_outbox_read on ecapital.dms_outbox
  for select using (ecapital.has_role('admin') or ecapital.has_role('auditor_readonly'));

drop policy if exists dms_event_read on ecapital.dms_event;
create policy dms_event_read on ecapital.dms_event
  for select using (ecapital.has_role('admin') or ecapital.has_role('auditor_readonly'));

-- R42: a document's own trail opens to whoever may read its unit, as every
-- other entity's does. The queue and the events carry no unit of anybody's,
-- so their trail is the administrator's and the auditor's.
drop policy if exists audit_log_read_document on ecapital.audit_log;
create policy audit_log_read_document on ecapital.audit_log
  for select using (entity_type = 'document' and ecapital.can_read_unit(org_unit_id));

drop policy if exists audit_log_read_dms on ecapital.audit_log;
create policy audit_log_read_dms on ecapital.audit_log
  for select using (
    entity_type in ('dms_outbox', 'dms_event')
    and (ecapital.has_role('admin') or ecapital.has_role('auditor_readonly')));

-- -------------------------------------------------------------- grants --

grant select, insert, update, delete on all tables in schema ecapital to ecapital_app;
grant usage, select on all sequences in schema ecapital to ecapital_app;
grant execute on all functions in schema ecapital to ecapital_app;

-- Same revoke as every migration before it: the grant above is written `on
-- all tables`, so say it again (R42).
revoke insert, update, delete on ecapital.audit_log from ecapital_app;
revoke all on ecapital.project_code_seq from ecapital_app;
revoke all on ecapital.contract_ref_seq from ecapital_app;
