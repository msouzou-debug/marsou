-- 0033 — a role of its own for the technical and safety approvers (ADR-0039).
--
-- Owner decision, 26/11/2026: a person was appointed TECHNICAL or SAFETY
-- approver for a unit only if they held `clinical_approver`, so estates staff
-- got clinical approval rights with it. They now get `technical_approver`
-- instead, «Εγκρίνων τεχνικών και ασφάλειας», and a row of the matrix that is
-- theirs: `permitTechnical`, «Έγκριση τεχνικών και ασφάλειας». Who may start
-- works (`permitOperate`) is unchanged, by the same decision.
--
-- What this file does:
--
--   1. Adds the value to `ecapital.app_role`. RULE (PostgreSQL): a value
--      added to an enum inside a transaction cannot be used before the
--      transaction commits, and the runner wraps each file in one. So nothing
--      below casts to or writes into an `app_role` column; the matrix table's
--      `role` is text (0023), which is why the seeding further down works.
--   2. Widens the two CHECK constraints on `ecapital.role_permission`
--      (`role_permission_role_known`, `role_permission_area_known`) to the new
--      role and the new area. packages/shared/src/auth.ts (`AppRole`) and
--      packages/shared/src/access.ts (`MatrixArea`) are the mirrors, and
--      test/permissions.test.ts pins both lists equal.
--   3. Seeds the defaults, `ROLE_MATRIX` in packages/shared/src/role-matrix.ts
--      cell for cell: the new row for every role (APPROVE for the new role,
--      the estates head and the administrator, READ for everybody else), and
--      the new role's column (what the clinical approver has by default, less
--      the clinical decision). `on conflict do nothing`, as 0023 did, so the
--      administrator's choices survive a re-run. The insert runs with no actor,
--      so 0023's guard trigger leaves `updated_at` null (still the default)
--      and its audit trigger records the seeding, exactly as 0023's own seed.
--
-- What this file does not do:
--
--   * Row-level security is not widened. A technical approver reads by unit,
--     like every unit role (`can_read_unit`), and writes a permit row only
--     through `permit_actionable_by`, which already says «an approver
--     appointed in this unit» without naming a role (0015), so an appointed
--     technical approver can decide the line the routing gave them and move
--     the permit's status with it. `ecapital.clinical_approver_only()` is left
--     as it is: somebody holding both approver roles stays on §9's narrow read,
--     which is the safer side.
--   * No appointment moves. A clinical approver who holds a TECHNICAL or
--     SAFETY line today keeps deciding it (apps/api/src/permits/line-needs.ts
--     accepts the clinical row on those lines too); the administrator moves
--     them to the new role on the «Χρήστες» screen when ready.
--   * No other role list needed changing: every `ecapital.can_*` function asks
--     the matrix through `ecapital.allowed()` since 0023, and the only other
--     place a role is spelled out is the enum itself.

-- ------------------------------------------------------------- the enum --

alter type ecapital.app_role add value if not exists 'technical_approver' after 'clinical_approver';

-- ------------------------------------------------- the matrix's checks --

alter table ecapital.role_permission
  drop constraint if exists role_permission_role_known,
  add constraint role_permission_role_known check (role in (
    'admin', 'estates_head', 'project_engineer', 'technician', 'finance',
    'clinical_approver', 'technical_approver', 'executive_readonly', 'auditor_readonly'));

alter table ecapital.role_permission
  drop constraint if exists role_permission_area_known,
  add constraint role_permission_area_known check (area_key in (
    'portfolio',
    'projectRecords', 'projectPhase', 'approvedBudget',
    'contractRecords', 'rfisInstructions', 'variationSubmit', 'variationDecide',
    'defects', 'paymentCertCreate', 'paymentCertEngineer', 'paymentCertFinance',
    'sapImport', 'budgetLines', 'accruals', 'forecastWarnings',
    'permitRequest', 'permitClinical', 'permitTechnical', 'permitOperate', 'permitCalendar',
    'assetRegister', 'assetCondition', 'assetDocuments', 'assetForecast', 'assetLabels',
    'workOrderRaise', 'workOrderWork', 'maintenanceAgreement', 'backlog',
    'backlogToProject', 'scorecard',
    'reports',
    'users', 'contractors', 'efinance',
    'auditTrail'));

-- ------------------------------------------------------------------ seed --

insert into ecapital.role_permission (role, area_key, level) values
  -- the new row, every role
  ('estates_head', 'permitTechnical', 'APPROVE'), ('project_engineer', 'permitTechnical', 'READ'),
  ('technician', 'permitTechnical', 'READ'), ('finance', 'permitTechnical', 'READ'),
  ('clinical_approver', 'permitTechnical', 'READ'), ('technical_approver', 'permitTechnical', 'APPROVE'),
  ('executive_readonly', 'permitTechnical', 'READ'), ('auditor_readonly', 'permitTechnical', 'READ'),
  ('admin', 'permitTechnical', 'APPROVE'),
  -- the new column: portfolio
  ('technical_approver', 'portfolio', 'READ'),
  -- projects
  ('technical_approver', 'projectRecords', 'READ'), ('technical_approver', 'projectPhase', 'READ'),
  ('technical_approver', 'approvedBudget', 'READ'),
  -- contracts
  ('technical_approver', 'contractRecords', 'READ'), ('technical_approver', 'rfisInstructions', 'READ'),
  ('technical_approver', 'variationSubmit', 'READ'), ('technical_approver', 'variationDecide', 'READ'),
  ('technical_approver', 'defects', 'READ'), ('technical_approver', 'paymentCertCreate', 'READ'),
  ('technical_approver', 'paymentCertEngineer', 'READ'), ('technical_approver', 'paymentCertFinance', 'READ'),
  -- cost
  ('technical_approver', 'sapImport', 'NONE'), ('technical_approver', 'budgetLines', 'READ'),
  ('technical_approver', 'accruals', 'NONE'), ('technical_approver', 'forecastWarnings', 'READ'),
  -- permits: the clinical decision is the one thing the column does not copy
  ('technical_approver', 'permitRequest', 'READ'), ('technical_approver', 'permitClinical', 'READ'),
  ('technical_approver', 'permitOperate', 'READ'), ('technical_approver', 'permitCalendar', 'READ'),
  -- assets
  ('technical_approver', 'assetRegister', 'READ'), ('technical_approver', 'assetCondition', 'READ'),
  ('technical_approver', 'assetDocuments', 'READ'), ('technical_approver', 'assetForecast', 'NONE'),
  ('technical_approver', 'assetLabels', 'READ'),
  -- maintenance: raises a fault call, as the clinical approver does (ADR-0031 §10)
  ('technical_approver', 'workOrderRaise', 'WRITE'), ('technical_approver', 'workOrderWork', 'READ'),
  ('technical_approver', 'maintenanceAgreement', 'READ'), ('technical_approver', 'backlog', 'READ'),
  ('technical_approver', 'backlogToProject', 'READ'), ('technical_approver', 'scorecard', 'READ'),
  -- reports
  ('technical_approver', 'reports', 'NONE'),
  -- admin
  ('technical_approver', 'users', 'NONE'), ('technical_approver', 'contractors', 'NONE'),
  ('technical_approver', 'efinance', 'NONE'),
  -- audit
  ('technical_approver', 'auditTrail', 'NONE')
on conflict (role, area_key) do nothing;

-- Said again for the reason every migration before it says it (R42).
revoke insert, update, delete on ecapital.audit_log from ecapital_app;
