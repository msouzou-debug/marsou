-- eCapital — signing in against the ΟΚΥπΥ Active Directory (ADR-0018).
--
-- eCapital is being deployed onto a server that already runs eMAP and
-- eFinance, both of which authenticate against Active Directory `ihcis.local`
-- with an LDAP simple bind. Two columns change so eCapital can do the same:
--
--   1. role_mapping.entra_group_id → role_mapping.group_id. The column held
--      an Entra object id; it now holds either that or an Active Directory
--      group DN. Same semantics — "the directory group that grants this
--      role" — so it is a rename, not a second column.
--   2. app_user.auth_source. Which directory the row came from, so an
--      operator can tell a seeded development account from a real AD one
--      without guessing from the subject.
--
-- NO PATIENT DATA. Nothing below can hold a patient fact: a directory group
-- and the name of a directory.

-- ------------------------------------------------ role_mapping.group_id --

alter table ecapital.role_mapping rename column entra_group_id to group_id;

comment on column ecapital.role_mapping.group_id is
  'The directory group that grants this role: an Entra ID object id in oidc mode, an Active Directory group DN in ldap mode. Same semantics either way — matched literally against the groups the token or the bind hands back. ADR-0018.';

-- --------------------------------------------------- app_user.auth_source --

alter table ecapital.app_user
  add column if not exists auth_source text not null default 'oidc';

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'app_user_auth_source_check') then
    alter table ecapital.app_user
      add constraint app_user_auth_source_check check (auth_source in ('dev', 'ldap', 'oidc'));
  end if;
end $$;

comment on column ecapital.app_user.auth_source is
  'Where this account came from: dev (seeded stub), ldap (an Active Directory bind) or oidc (Entra ID). ADR-0018.';

-- -------------------------------------------------------------- grants --

grant select, insert, update, delete on all tables in schema ecapital to ecapital_app;
grant usage, select on all sequences in schema ecapital to ecapital_app;
grant execute on all functions in schema ecapital to ecapital_app;

-- Said again for the same reason 0002, 0003 and 0006 say it: the grant above
-- is written `on all tables`, and the application reads the audit log and can
-- neither write to it nor take anything out of it (R42).
revoke insert, update, delete on ecapital.audit_log from ecapital_app;
revoke all on ecapital.project_code_seq from ecapital_app;
