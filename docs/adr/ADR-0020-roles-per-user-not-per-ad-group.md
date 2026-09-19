# ADR-0020 — Roles are assigned per user, not per AD group

**Status:** accepted · 19/09/2026 · amends [ADR-0018](ADR-0018-active-directory-sign-in.md), builds on [ADR-0009](ADR-0009-entra-oidc-with-dev-stub.md) and [ADR-0010](ADR-0010-row-level-security-by-org-unit.md)

## Context

ADR-0009 decided that a directory group grants an eCapital role, through the `role_mapping` table. ADR-0018 kept that decision when it swapped Entra ID for the ΟΚΥπΥ Active Directory: the column changed name from `entra_group_id` to `group_id`, the semantics did not. Both ADRs ended on the same flag — *which ΟΚΥπΥ AD group grants which role is an administrator's decision at deployment, and nothing in this repository knows the real group names.*

That flag has now been answered, and the answer is that there are no group names to know.

- **eFinance, on the same server, does not work that way.** It authenticates against `ihcis.local` with a simple bind and then holds its roles locally, per application. AD says who somebody is; eFinance says what they may do. eCapital being the one application on that box with a different model is a cost paid by every administrator, every day, for no benefit.
- **A new group is a ticket to Central IT.** Creating and populating an AD group is somebody else's change, on somebody else's schedule. Appointing a project engineer at Λάρνακα should not wait on it, and in practice would not — it would be done by adding the person to a group that already exists and means something else.
- **There is nowhere to see who has what.** A group membership is visible in the AD console to people who have the AD console. An administrator of eCapital asked "who can approve a variation at Λεμεσός" has no way to answer from inside eCapital.

**Owner decision, 19/09/2026:** roles are assigned per user by an administrator inside the application, the way eFinance does it. Active Directory only authenticates.

## Decision

### The assignment is a row in `app_user_role`, written from a screen

Διαχείριση › Χρήστες (`/admin/users`) is the screen and `/admin/users` is the module behind it: list, search and filter the accounts; open one; tick the roles; pick the units; switch the account on or off. Administrator only, said twice — `@Roles("admin")` on the routes and the row policies on `app_user`, `app_user_role` and `app_user_org_unit`, which have said `admin` and nobody else since 0001. Every change goes through the audit triggers, so who granted what, when, and what it was before is already recorded and was not added for this (R42).

### `role_mapping` stays, as an optional layer

The table is not dropped and the code that reads it is not deleted. A sign-in takes the union: the roles an administrator assigned, plus whatever the caller's directory groups map to, and the same for units. On a fresh ΟΚΥπΥ database the table is empty and the union is the assignment.

Keeping it costs one query on a path that already runs one, and it buys two things. A deployment that would rather drive roles from AD can still do it, without a release. And the tests that ADR-0018 wrote for the mapping keep passing, which is the difference between a decision reversed and a decision made.

**A sign-in never deletes an assignment.** Before this ADR, `upsertUser` deleted every role and unit row and rewrote them from the directory answer, because the directory was the source of truth. It is not any more. The sign-in now refreshes who somebody is — their display name, their address, when they last arrived — and touches nothing about what they may do.

### Pre-registration, and how the objectGUID is adopted

`app_user.subject` is the AD `objectGUID` (ADR-0018). An account that has never signed in has not got one, and an administrator who waits for the first sign-in before assigning a role has made a new employee's first day in eCapital a blank screen.

So an administrator may pre-register an account by its `sAMAccountName`. The row carries `subject = 'ad:<username>'` and the account name in the new column `app_user.username`, unique case-insensitively because Active Directory is.

**RULE:** on an LDAP sign-in, when no row matches the objectGUID, the login matches on `username` and moves the subject onto the GUID. The row is adopted, not duplicated, and the roles set before the person ever signed in are the roles they have the moment they do.

`app_user.last_sign_in_at` is stamped by every successful sign-in, in all three modes, so the screen can tell an account that has arrived from one that never has.

### Four rules an administrator can break by accident

Each is a 422 with a sentence, shown inline in the sheet, and each is a `// RULE` in the service with a test of its own.

1. **`errors.selfLockout`** — you cannot take your own `admin` away and you cannot switch your own account off. Either needs a second administrator, or the server, to undo, and the person who did it is the person who can no longer undo it.
2. **`errors.lastAdmin`** — the change must leave at least one active administrator. Without one, nobody can assign a role again from inside the application.
3. **`errors.auditorProtected`** — CAPEX-01 §10 says the auditor "cannot be edited by admin". `auditor_readonly` is refused in both directions: an administrator can neither appoint the person who audits them nor remove them. The checkbox is shown, disabled, with a title saying where the role does come from.
4. **`errors.unitRequired`** — a role that works unit by unit needs at least one unit, or it grants nothing at all. Roles that reach every unit ignore the list the caller sent and carry all of them instead.

On the fourth: `admin`, `executive_readonly` and `auditor_readonly` see every unit through `ecapital.sees_all_units()` whatever their unit list says, but **`finance` does not** — it works across the organisation by carrying every unit id, which is how the seed has had it since ADR-0014. So "all units" is stored as every unit id rather than as an empty list. `packages/shared/roles.ts` publishes `ROLE_SCOPE` and `GET /admin/roles` serves it, so neither the screen nor anything else hardcodes which four they are.

**FLAG — not ours to decide.** Whether `finance` should become unit-scoped, so that a finance officer can be appointed per directorate rather than across the organisation, is an owner's decision. Today it is all units, per ADR-0014. If it changes, `ROLE_SCOPE` is the one line, plus a decision about the accounts that already carry every unit.

**FLAG — not built.** Pre-registration does not check that the `sAMAccountName` exists in Active Directory. It cannot: ADR-0018 deliberately left eCapital without a service bind account, so the only connection it ever makes to the directory is as the person signing in, and there is nobody to ask at pre-registration time. A typo therefore produces a row nobody ever signs in as — visible in the screen as an account with no last sign-in, and deletable. Checking it properly means a service account, one more credential on the server, and a successor to ADR-0018.

### The bootstrap CLI

A fresh database has no administrator in it and the screen is administrator-only, so there is no way in through the application. Two commands, run on the server over the migration connection:

```
pnpm --filter @ecapital/api grant-admin -- --username <sAMAccountName> [--name "…"] [--email …]
pnpm --filter @ecapital/api grant-role  -- --username <sAMAccountName> --role auditor_readonly [--revoke]
```

They create the account if it does not exist, pre-registered exactly as the screen would. `--role` refuses anything outside the eight. The work runs inside one transaction with `app.user_id` set to `cli:<os user>`, so the audit triggers record who ran it — there is no way to run either without leaving that trail, because the triggers are on the tables and not on a route.

`grant-role` is also the **only** way `auditor_readonly` moves in either direction. Appointing an auditor is a thing done on the server, with a shell, by somebody the organisation gave a shell to — not from inside the system being audited.

## Consequences

- An administrator can answer "who can approve a variation at Λεμεσός" from inside eCapital, and change the answer, without a ticket to Central IT.
- Active Directory's job shrinks to the one it is good at. No eCapital group has to exist in `ihcis.local` at all.
- Deactivating somebody takes effect at their next request: the login refuses them, and `GET /me` refuses the cookie they are already holding, which the web app's stale-cookie path already turns into a clean trip back to the sign-in screen (ADR-0013).
- The runbook's §5 is no longer a page of SQL. It is `grant-admin`, sign in, and use the screen.
- ADR-0018's manual deployment checks still stand, with one more: after the first AD sign-in, `app_user.subject` must have moved from `ad:<username>` to the objectGUID for a pre-registered account.
