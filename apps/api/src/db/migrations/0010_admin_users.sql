-- eCapital — roles are assigned per user, not per AD group (ADR-0020).
--
-- Owner decision, 19/09/2026: an administrator assigns roles to a person
-- inside eCapital, the way the sibling system eFinance does it. Active
-- Directory only authenticates. `ecapital.role_mapping` stays exactly as
-- ADR-0009 and ADR-0018 built it — an optional group→role layer, empty by
-- default — and a sign-in unions the two.
--
-- Two columns, and the index the Χρήστες list needs:
--
--   1. app_user.username. The sAMAccountName the person types at the sign-in
--      screen. `subject` is the objectGUID and is the right key once the
--      account has bound once; before that there is nothing to key on but
--      the account name, and pre-registering somebody is precisely the case
--      where the GUID is not known yet. Unique, case-insensitively, because
--      Active Directory treats it that way.
--   2. app_user.last_sign_in_at. Set on every successful sign-in — the
--      directory bind and the development stub alike — so an administrator
--      can tell an account that has arrived from one that never has.
--
-- NO PATIENT DATA. An account name and a timestamp of a sign-in.

alter table ecapital.app_user
  add column if not exists username text;

alter table ecapital.app_user
  add column if not exists last_sign_in_at timestamptz;

comment on column ecapital.app_user.username is
  'The sAMAccountName this person signs in with (the address, for a seeded development account). Matched case-insensitively on the first LDAP bind so a pre-registered row adopts its objectGUID instead of a second row being created. ADR-0020.';

comment on column ecapital.app_user.last_sign_in_at is
  'When this account last signed in successfully, by any of the three ways in. Null means it never has. ADR-0020.';

-- Active Directory account names are case-insensitive, so the uniqueness has
-- to be too: `APapadopoulos` and `apapadopoulos` are one person.
create unique index if not exists app_user_username_key
  on ecapital.app_user (lower(username))
  where username is not null;

-- Διαχείριση › Χρήστες filters by role and by unit on every page load.
create index if not exists app_user_role_role_idx on ecapital.app_user_role (role);
create index if not exists app_user_org_unit_unit_idx on ecapital.app_user_org_unit (org_unit_id);

-- The grants are written `on all tables` in 0001 and again in 0007; nothing
-- new is created here, so nothing new needs granting. Said once more only so
-- the same revoke keeps standing next to it (R42).
revoke insert, update, delete on ecapital.audit_log from ecapital_app;
