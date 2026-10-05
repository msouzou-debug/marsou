# ADR-0030 — Local accounts: a password eCapital holds, until the directory is reachable

Date: 05/10/2026
Status: accepted
Owner decision: Marios, 05/10/2026 («add me as admin … so that I can add some users to test it and then we can trigger the active directory»)

## Context

eCapital runs on 10.227.56.22 since 02/10/2026 with `AUTH_MODE=ldap`, and
nobody can sign in: `ihcis.local` does not resolve from the server and 636
does not answer (runbook §1, request with IT since 02/10). The owner wants
people to try the screens with their own roles now, and wants to create those
people himself in Διαχείριση › Χρήστες, before Active Directory is wired.

The development stub (ADR-0009) is the wrong tool for that. It signs anybody
in as any of twelve seeded accounts with no password at all, and config.ts
refuses it in production for exactly that reason (ADR-0018 §5). That refusal
stands.

## Decision

A fourth `AUTH_MODE`, `local`: the sign-in screen asks for a username and a
password, and eCapital checks the password against a hash it holds itself.

1. **Same port as the directory.** `LocalDirectory` implements the
   `Directory` interface of ADR-0018 and is wired in `AuthModule` where the
   LDAP client is. `/auth/login`, the app_user upsert, the roles an
   administrator assigned, the session token, the cookie, the guard and the
   row policies are the ldap path, untouched.
2. **One table, apart from app_user.** `ecapital.app_user_password` holds
   an scrypt hash (Node's own crypto, parameters in the stored string). It
   is a separate table because app_user's audit trigger copies whole rows
   into audit_log; the password table has its own redacted trigger, so the
   audit row says a password was set, by whom and when, and nothing else.
3. **The administrator sets passwords in the screen.** `PUT
   /admin/users/:id/password`, admin only, eight characters at least,
   answered by the account with `hasPassword: true` and never the password.
   The sheet in S24 gets a password block in `local` mode only. There is no
   self-service change and no reset link: the owner hands a password over
   in person, which for a few weeks of UAT on fake data is the right size.
4. **The first account comes from the server.** `ecapital-set-password
   <name> --create-admin`, root-run, asks for the password twice with the
   echo off. It reuses `grant-admin` for the account and refuses to run
   unless `AUTH_MODE=local`.
5. **Adopted by Active Directory, not replaced.** A local account carries
   `subject = ad:<username>`, exactly like a pre-registered one (ADR-0020).
   The day `AUTH_MODE` goes back to `ldap`, the first bind finds the row by
   username, moves the subject onto the objectGUID, and the roles, units and
   history stay. The password table is simply never read again. A seeded
   account signing in by its address keeps its seeded subject the same way.
6. **The same 401 for everything.** Wrong password, unknown name, no
   password set, locked name: one answer, about the same time (a dummy hash
   is compared when there is nothing to compare against). Five failures in a
   row lock the name for fifteen minutes, in memory.
7. **Loud while on.** The API logs a warning at boot in `local` mode, and the
   runbook puts the switch back to `ldap` on the day IT answers.

## Consequences

- The route and the screen block exist only in `local` mode; in `dev`,
  `ldap` and `oidc` they answer 404 and are not drawn.
- `app_user.auth_source` gains the value `local`; the check constraint of
  0007 is widened (migration 0021).
- The password policy is a floor of eight characters and nothing else. The
  owner's first choice of password is his; the guide says to pick a long
  one and to hand it over by voice, not by email.
- Nothing here reaches eFinance, eArchive or eMAP, and nothing here is
  patient data.

## Rejected

- **`ALLOW_DEV_AUTH_IN_PRODUCTION=1`.** No password at all, every seeded
  account open to anybody who finds the hostname. Built as an escape hatch
  for an hour after a migration, not for weeks of UAT on a public hostname.
- **A hash column on app_user.** Would land in every audit row of the
  table.
- **bcrypt or argon2 from npm.** One more dependency to patch for a mode
  meant to be switched off; scrypt in Node's crypto is enough.
