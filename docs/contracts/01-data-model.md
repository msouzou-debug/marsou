# Contract 01: data model

Owner: orchestrator. Source: build brief v2, section 8. Models live in `ehr/models/`, one file per group below. SQLAlchemy 2 declarative style. Table names are singular, as listed.

Conventions: integer primary key `id` unless noted; timestamps in UTC as `DateTime(timezone=True)`; money as `Numeric(12, 2)`; enums stored as short strings and checked in Python against contract 02; no cascading deletes anywhere. Rows are never deleted by the app except drafts and their files before submission.

## People and access (`models/access.py`)

| Table | Columns |
|---|---|
| `user` | id, username (unique), full_name, email, password_hash (nullable when AD only), auth_source [`local`, `ad`], must_change_password, language [`el`, `en`], line_manager_user_id → user (nullable), is_active, out_of_office, out_of_office_from, out_of_office_to, created_at |
| `role_permission` | role, permission_key. Primary key on both |
| `role_assignment` | id, user_id → user, role, directorate_id → directorate (null for central roles, `viewer` and `admin`), substitute_user_id → user (nullable), active_from, active_to. One active holder per (role, directorate_id), except `requester`, which many people hold |
| `user_directorate` | user_id, directorate_id. Which Directorates' requests a user may see (the eFinance "ticked entities" pattern) |

Permission keys for this module: `request.create`, `request.view_own`, `request.view_directorate`, `request.view_all`, `request.act`, `audit.view`, `settings.manage`.

## Master lists (`models/master.py`)

| Table | Columns |
|---|---|
| `directorate` | id, code, name_el, name_en, has_sci_director, is_active |
| `facility` | id, directorate_id → directorate, code, name_el, name_en, is_active |
| `position` | id, category, title_el, title_en, is_active |
| `cost_centre` | id, code (unique), name_el, name_en, is_active |
| `oay_specialty` | id, name (English, as ΟΑΥ writes it), aliases_json, is_active |
| `public_holiday` | date (primary key), name_el, name_en |
| `setting` | key (primary key), value, updated_by, updated_at. Keys: `reminder_days`=2, `escalation_days`=5, `returned_timeout_days`=30, `max_file_mb`=20, `number_prefix`, `mail_backend` |

Inactive list rows stay selectable on old requests and are hidden on new ones.

## Requests (`models/request.py`)

| Table | Columns |
|---|---|
| `request` | id, number (unique, null while draft), status, current_step, step3_phase, returned_from_step, round, directorate_id, facility_id, cost_centre_id, category, position_id, positions_count, reason, oay_specialty_id (nullable), need_text, alternatives_text, absence_flag, absence_text, new_need_origin, new_need_cover_so_far, new_need_plan, external_funding_flag, external_funding_text, route_snapshot_json, created_by → user, created_at, submitted_at, closed_at, returned_at (set while `returned`, else null), withdrawal_warned (default false; reset on each return) |
| `request_leaver` | id, request_id, round, name, leave_date, employment [`okypy_contract`, `civil_servant`], annual_employer_cost (filled at step 4) |
| `request_action` | id, request_id, round, step, phase (`inputs` \| `decision`, step 3 only, else null), role, actor_user_id, on_behalf_of_user_id, redirect_reason, action, payload_json, comment, supersedes_action_id → request_action, is_superseded, created_at |
| `request_financials` | id, request_id, round, period [`prev_year`, `ytd`], visits, procedures, revenue, payroll_cost, headcount, oay_specialty_id, oay_data_month, payroll_to_month, source [`manual`, `provider`], source_snapshot_json. Unique on (request_id, round, period) |
| `request_document` | id, request_id, round, file_name, mime, size, storage_ref, sha256, uploaded_by, uploaded_at |
| `task` | id, request_id, round, step, phase (`inputs` \| `decision`, step 3 only, else null), role, assignee_user_id (nullable = unassigned), on_behalf_of_user_id, redirect_reason, status, may_replace, opened_at, clock_started_at, reminded_at, escalated_at, closed_at |
| `number_sequence` | year (primary key), last_value. Updated under a row lock in the same transaction as the submit |

`reason` values: `retirement`, `resignation`, `secondment_end`, `contract_end`, `new_need`, `other`. The first four are departures.

Revenue per €1 of payroll is not stored. It is `revenue / payroll_cost`, calculated where shown, blank when payroll is zero or missing.

## Audit (`models/audit.py`)

| Table | Columns |
|---|---|
| `audit_log` | id, at, user_id (null = system), event, request_id (nullable), object_type, object_id, detail_json, ip |

Append-only: the model exposes insert only, and the database user gets no UPDATE or DELETE on this table where the engine allows it. Events: every `request_action`, `document_view`, `document_download`, `task_redirected`, `setting_changed`, `list_changed`, `role_changed`, `password_changed`, `login`, `login_failed`, `out_of_office_changed`.

## ΟΑΥ data, only if eHR loads it (`models/oay.py`, Phase 5)

| Table | Columns |
|---|---|
| `oay_load` | id, month, report_type [`is_auditor`, `all_okypy`], file_hash (unique), loaded_by, loaded_at |
| `oay_activity` | id, load_id, month, facility_id, oay_specialty_id, visits, procedures, revenue |

## Indexes

`request(status, current_step)`, `request(directorate_id)`, `request(created_by)`, `task(assignee_user_id, status)`, `task(request_id)`, `request_action(request_id, created_at)`, `audit_log(request_id)`, `audit_log(at)`.

## Number search

Store `number` as issued. Store also `number_search`: upper-cased, with Greek letters that look like Latin ones mapped to Latin (Α→A, Β→B, Ε→E, Ζ→Z, Η→H, Ι→I, Κ→K, Μ→M, Ν→N, Ο→O, Ρ→P, Τ→T, Υ→Y, Χ→X) and dashes and spaces removed. Search input goes through the same function.

## Personal data

`request_leaver.name`, `leave_date`, `employment`, `annual_employer_cost` and free-text fields that may name people. Nothing here is copied to eFinance. No retention job runs until the DPO sets a period.
