# ADR-0033 — The role matrix is the rule, and the administrator edits it

**Status:** accepted · 08/10/2026

## Context

Owner, 08/10/2026: «The admin should be able to adjust the roles and
permissions for each role.»

Until now the S24r matrix (`packages/shared/src/role-matrix.ts`) described
rules that lived three times over: the role lists inside the
`ecapital.can_*` SQL functions behind the row policies (ADR-0010), the API's
`@Roles(...)` decorators and `roles.includes(...)` checks, and the 33 `can*`
helpers in `apps/web/src/auth/roles.ts`. A test kept the web helpers and the
table in step; nothing kept the three copies in step with each other, and
the table itself could not be changed by anybody but a developer.

## Decision

1. **One table, `ecapital.role_permission (role, area_key, level)`**,
   migration `0023_role_permissions.sql`. One row per role and per row of
   the matrix, CHECKs on the eight roles, the five levels and the 36 area
   keys (the shared `MatrixArea` is the mirror and a test pins the two lists
   equal). Seeded from `ROLE_MATRIX` *in the migration*, `on conflict do
   nothing`, so a deployment keeps what its administrator set when the
   migration runs again. Every change is in the audit trail through the
   ordinary trigger (ADR-0011); `id` is the generated `role:area_key`, and a
   BEFORE trigger stamps `updated_at` and `updated_by` from the request.
   Every signed-in user reads the table; only `has_role('admin')` writes it.

2. **The database asks the table.** `ecapital.allowed(area, level)` is true
   when any role in `app.roles` holds at least that level on that area; no
   row is NONE. Every `ecapital.can_*` function that carried a role list now
   carries an `allowed` call instead (map below), keeping its floor
   (`can_write_unit`) and any rule that is not a role list. Contracts, BoQ,
   variations, RFIs and site instructions, which all borrowed
   `can_manage_project`, get functions of their own on their own rows
   (`can_manage_contract`, `can_manage_variation`, `can_manage_site_log`).

3. **The API asks the same table, from memory.** `PermissionsService` loads
   it at start-up, after every change this process makes, and again on the
   first request that finds its copy older than thirty seconds — which is
   how a change made through a second API process arrives. Every role-gated
   route carries `@Needs(area, level)` (or `@NeedsAny` for a route that two
   rows serve) instead of `@Roles(...)`; the services that asked
   `roles.includes(...)` ask `permissions.allowedHere(area, level)`. A copy
   that is wrong for up to thirty seconds is still refused by the row
   policy underneath, which reads the table live.

4. **The web asks the same table, through the session.** `GET /me` carries
   `permissions`, the caller's effective level on every area. The web reads
   the full matrix, `GET /admin/roles/permissions`, next to `/me` on every
   request (`getSession`), and every helper in `apps/web/src/auth/roles.ts`
   keeps its name and signature but answers `levelAtLeast(roles, area,
   level)` over that matrix. `RoleMatrixSync` puts the same matrix into the
   browser's copy before the page renders. A matrix that does not load
   leaves the defaults in place rather than signing anybody out.

5. **Routes.** `GET /admin/roles` already answers the role catalogue the
   users screen reads (ADR-0020), so the matrix is
   `GET /admin/roles/permissions` (any signed-in user — the head of estates
   reads the roles tab). `PUT /admin/roles/:role` takes the whole column for
   one role and writes only the cells that move; `POST /admin/roles/reset`
   puts every column back to `ROLE_MATRIX`. Both writes are
   `@Roles("admin")`, an identity check: a matrix that could grant the right
   to change the matrix could be used to take it.

6. **A change applies at the next request.** It is not in the token: the
   token carries roles, and the levels are read when the request is
   answered.

## The guardrails — the only things the administrator cannot change

Enforced by the BEFORE trigger `ecapital.role_permission_guard`
(`restrict_violation`), refused by the API with 422
`errors.rolePermissionGuardrail` naming the row, described by
`levelBounds` in the shared package, and drawn on the roles tab as a locked
cell with the reason as its tooltip. A test walks every cell of all three.

| Key | Rule |
|---|---|
| `readOnlyRoles` | `auditor_readonly` and `executive_readonly` never above READ |
| `auditTrailRead` | the audit trail row is NONE or READ for every role |
| `adminReads` | `admin` never below READ on any row |
| `adminUsers` | `admin` never below MANAGE on users, so nobody locks the way in |
| `usersAdminOnly` | users is NONE for every other role |

The fifth is one more than the brief listed. The user and role routes stay
the administrator's by identity (below), so a users cell for another role
would promise something no route would honour; locking it at NONE keeps the
table truthful.

## What stays written out, and why

- **Unit membership.** `can_read_unit` and `can_write_unit` decide which rows
  a caller reaches at all. The matrix decides what they may do there.
  Reading is unit membership: the read policies did not change.
- **The two read-only roles.** `can_write_unit` refuses them whatever the
  matrix holds, and the guardrail keeps them at READ in the table too. The
  web helpers say the same: from WRITE up, an account holding either role
  is refused.
- **Segregation of duties.** The requester never decides their own permit
  (409), the raiser never decides their own variation, the creator never
  approves their own certificate (CHECK constraint and service). Only the
  role lists around them moved.
- **The administrator's identity.** `app_user`, `app_user_role`,
  `role_mapping`, the password table, the users and roles routes, the
  role-matrix writes, the approver-scope editor, the eArchive queue retry,
  blacklisting a contractor, an administrator deciding a permit line on a
  missing approver's behalf, and an administrator editing a variation that
  is not theirs: `has_role('admin')` or `@Roles("admin")`, as before.
- **The server's own timers.** The eFinance push and sync and the
  maintenance sweep run as `admin` with nobody behind them. They set
  `app.system`, and `allowed` and `PermissionsService` let them through
  whatever the admin column says: they are code, not a role.
- **Rules with no row.** The ICRA matrix edition (`can_manage_icra_matrix`:
  admin, or a clinical approver holding the `INFECTION_CONTROL` capacity),
  the risers' feeds (`can_manage_system_feed`), §9's narrow read for a
  clinical approver and the approval routing (`clinical_approver_only`,
  `permit_visible_to_clinician`, `permit_actionable_by`), and closing a
  permit (the clinical owner's signature). These follow approval
  capacities, not roles; a row for them is a later decision.
- **Read routes.** The SAP import list and the replacement forecast keep
  answering what the row policies let the caller read; the matrix's NONE on
  those rows hides the screen and the nav entry, not the data. The routes
  the matrix gates at READ are the reports, the accruals and the audit log.

## The map

| Function or route | Row and level |
|---|---|
| `can_manage_project`, project, milestones, risks, issues, notes | projectRecords WRITE |
| phase forward / back (`POST /projects/:id/phase`) | projectPhase WRITE / MANAGE |
| `set_approved_budget`, the approved-budget rule | approvedBudget APPROVE |
| `can_manage_contract` (contract, BoQ) | contractRecords WRITE |
| `can_manage_site_log` (RFIs, site instructions) | rfisInstructions WRITE |
| `can_manage_variation`; raise, edit, submit / decide | variationSubmit WRITE / variationDecide APPROVE |
| `can_manage_defect` | defects WRITE, and contractRecords WRITE for a handover or survey defect |
| payment certificate create / engineer / finance steps | paymentCertCreate WRITE / paymentCertEngineer APPROVE / paymentCertFinance APPROVE |
| `can_manage_cost` | any of forecastWarnings, sapImport, budgetLines WRITE or the three certificate rows |
| `can_manage_budget_line`, budget codes | budgetLines WRITE |
| SAP import, commit, `import_batch` / `import_exception` writes | sapImport WRITE |
| allocate and skip in the queue, `can_allocate_unallocated` | sapImport WRITE or forecastWarnings WRITE (R14: engineers allocate) |
| forecast inputs; dismiss a warning | forecastWarnings WRITE; or budgetLines WRITE |
| accruals | accruals READ |
| `can_manage_permit`; submit / reject / start | permitRequest or permitOperate WRITE; permitRequest WRITE / APPROVE, permitOperate WRITE |
| deciding a clinical line | permitClinical APPROVE, and the line must be yours |
| `can_manage_asset`; `can_record_asset_reading`; asset documents | assetRegister WRITE; assetCondition WRITE; assetDocuments WRITE |
| `can_manage_document` | contractRecords WRITE, paymentCertFinance APPROVE or assetDocuments WRITE |
| `can_raise_work_order`, notes on an order | workOrderRaise WRITE |
| `can_work_work_order` | workOrderWork WRITE |
| `can_manage_maintenance_contract` | maintenanceAgreement MANAGE |
| `can_manage_backlog` / to a project | backlog WRITE / backlogToProject APPROVE |
| reports | reports READ |
| `can_manage_contractor` | contractors MANAGE |
| eFinance push, sync, mirror writes | efinance MANAGE |
| `GET /audit-log`, the eArchive queue list | auditTrail READ |

## Consequences

- With the defaults the behaviour is the one before, with two exceptions
  where the API had been wider than the table and the screens: the head of
  estates no longer runs a SAP import or commits one (sapImport is NONE for
  the role; the screen never offered it), and an engineer or a clinical
  approver no longer reads the accruals through the API (accruals NONE).
  Finance no longer uploads an asset's papers (assetDocuments READ); a
  contract's and a certificate's papers are unchanged.
- Every policy that asked a role list now runs a lookup on a 288-row table
  by primary key. The function is STABLE and SECURITY DEFINER; at the
  register's sizes the cost does not show in the suites.
- The roles tab is now the place access is changed, and its notes describe
  the defaults. A role's note that says «only finance» is true until the
  administrator says otherwise, and the trail says when they did.
