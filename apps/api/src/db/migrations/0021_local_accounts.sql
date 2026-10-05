-- 0021 — local accounts (ADR-0030): a password eCapital holds itself, for
-- the period the ΟΚΥπΥ Active Directory is not reachable from the server.
--
-- One table, apart from app_user on purpose:
--
--   * app_user's audit trigger copies the whole row into audit_log
--     (0001, write_audit). A hash column on app_user would land in every
--     audit row of every rename and deactivation. Here the audit row says
--     that a password was set, by whom and when, and nothing else.
--   * `select *` on app_user, in the API and in anybody's psql, keeps
--     returning what it always did: a name and a work address.
--
-- The hash is scrypt (apps/api/src/auth/password.ts). Nothing in this file
-- or in the application can read a password back.
--
-- NO PATIENT DATA. A password belongs to a staff account.

-- --------------------------------------------------- app_user.auth_source --
-- 0007 closed the column to dev | ldap | oidc. `local` joins them: a row
-- written or last signed in through eCapital's own password table.
alter table ecapital.app_user drop constraint if exists app_user_auth_source_check;
alter table ecapital.app_user
  add constraint app_user_auth_source_check check (auth_source in ('dev', 'ldap', 'oidc', 'local'));

comment on column ecapital.app_user.auth_source is
  'Where this account came from: dev (seeded stub), ldap (an Active Directory bind), oidc (Entra ID) or local (eCapital''s own password, ADR-0030). ADR-0018.';

-- ------------------------------------------------------ app_user_password --

create table if not exists ecapital.app_user_password (
  app_user_id   uuid primary key references ecapital.app_user (id) on delete cascade,
  password_hash text not null,
  updated_at    timestamptz not null default now()
);

comment on table ecapital.app_user_password is
  'ADR-0030: the scrypt hash of an account''s eCapital password, used only while AUTH_MODE=local. Never the password.';

-- -------------------------------------------------------------- audit --
-- Redacted: the row that goes into audit_log carries the account id and the
-- time, never the hash. Same SECURITY DEFINER shape as write_audit, so the
-- application role still cannot forge an audit row directly.
create or replace function ecapital.write_password_audit() returns trigger
language plpgsql security definer set search_path = ecapital, pg_catalog as $$
declare
  v_before jsonb;
  v_after  jsonb;
  v_ip     text := nullif(current_setting('app.ip', true), '');
begin
  if tg_op in ('DELETE', 'UPDATE') then
    v_before := jsonb_build_object('id', old.app_user_id, 'updated_at', old.updated_at);
  end if;
  if tg_op in ('INSERT', 'UPDATE') then
    v_after := jsonb_build_object('id', new.app_user_id, 'updated_at', new.updated_at);
  end if;

  insert into ecapital.audit_log (actor_id, entity_type, entity_id, action, before, after, at, ip, org_unit_id)
  values (
    ecapital.current_actor_id(),
    tg_table_name,
    coalesce(v_after ->> 'id', v_before ->> 'id'),
    tg_op::ecapital.audit_action,
    v_before,
    v_after,
    now(),
    case when v_ip is null then null else v_ip::inet end,
    null);

  return null;
end $$;

drop trigger if exists app_user_password_audit on ecapital.app_user_password;
create trigger app_user_password_audit
  after insert or update or delete on ecapital.app_user_password
  for each row execute function ecapital.write_password_audit();

-- ------------------------------------------------- row-level security --
-- The administrator sets and clears passwords (ADR-0020's screen), and that
-- is the only policy: no other role reads this table through the
-- application. The sign-in itself reads the hash over the owner connection,
-- the way the Active Directory bind writes app_user over it
-- (auth.service.ts).
alter table ecapital.app_user_password enable row level security;

drop policy if exists app_user_password_write on ecapital.app_user_password;
create policy app_user_password_write on ecapital.app_user_password
  for all using (ecapital.has_role('admin')) with check (ecapital.has_role('admin'));

-- The same table grant 0001 gives every table of the schema to the
-- application role; a table created after it needs its own line. The row
-- policy above is what decides who gets through.
grant select, insert, update, delete on ecapital.app_user_password to ecapital_app;
