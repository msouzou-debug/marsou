# Core: models, sign-in, permissions, numbering, settings

Import models from `ehr.models` (access, master, request, audit). Tables follow contract 01.

## Models and key attributes
- `User`: username, full_name, auth_source, must_change_password, language, line_manager_user_id, is_active,
  out_of_office(+_from/_to). Methods: `roles()`, `permissions()`, `has_permission(key)`.
- `RoleAssignment`: user_id, role, directorate_id (null for central/viewer/admin), substitute_user_id, active_from/to.
  `requester` is held by many people per Directorate, so there is no unique constraint on (role, directorate).
- `RolePermission`, `UserDirectorate` (counts only for users with `request.view_directorate`).
- Lists: `Directorate`, `Facility`, `Position` (title_el/title_en), `CostCentre`, `OaySpecialty` (name), `PublicHoliday`,
  `Setting` (`get_setting(key, default)`). Each list row has `name(lang)`, except OaySpecialty (`name`).
- `Request` (all contract columns plus `number_search`, filled automatically on insert/update from `number`),
  `RequestLeaver`, `RequestAction`, `RequestFinancials`, `RequestDocument`, `Task`, `NumberSequence`.
  Phase 2 columns: `Request.returned_at` (set while returned), `Request.withdrawal_warned`; `Task.phase` and
  `RequestAction.phase` (`inputs` | `decision`, step 3 only; None elsewhere). Rows are stored from the engine result, never derived.
  Leavers and financials carry a `round`; the current ones are those with `round == Request.round`.
  Relationships on Request: directorate, facility, cost_centre, position, oay_specialty, creator, leavers, actions, tasks.
- `MailOutbox` (`ehr/models/mail.py`): one row per email, state `queued|sent|failed`, `attempts`, `last_error`. Written by `ehr.services.notify.notify(events, actor_user_id)` in the caller's transaction; sent by `flask send-mail` (`ehr.mail.outbox.flush`).
- `AuditLog`: append-only (update or delete raises). Constants: `ROLES`, `CENTRAL_ROLES`, `DIRECTORATE_ROLES`, `PERMISSIONS`,
  `CATEGORIES`, `REASONS`, `DEPARTURE_REASONS`, `REQUEST_STATUSES`.

## Helpers
- `from ehr.auth import current_user, login_required, permission_required(key), can_see_request(user, req),
  visible_requests_query(user), safe_next(target, default)`.
  `visible_requests_query` returns a chainable `Query` (drafts only for their creator). Unseen request: `abort(404)`.
  `permission_required` answers 404 (not 403) when the permission is missing.
- `from ehr.models import audit`: `audit(event, user_id=None, request_id=None, object_type=None, object_id=None, detail=None)`
  adds a row to the session; the caller commits in the same transaction. `detail` is a dict.
- `from ehr.services.numbering import next_number`: `next_number(db.session, year)`; call inside the submit transaction.
- Templates: `t(key, **p)`, `lang`, `lang_url(code)`, `csrf_token()`, `current_user()`, `can(permission_key)`.
  Every POST form needs `<input type="hidden" name="csrf_token" value="{{ csrf_token() }}">` (or header `X-CSRF-Token`).
- Flash: `flash("string.key", "success"|"danger")`, or with parameters `flash_key("string.key", "success", n=3)` from
  `ehr.services.request_flash` (stores key + params; base.html translates at render time in the viewer's language).
- `GET /` redirects to `/requests` when `ehr/blueprints/requests.py` exists and exports `bp`; otherwise shows home.html.
- CLI: `flask init-db`, `flask seed-demo` (idempotent). Data: `ehr/seed_data.json`.

## Test fixtures (tests/conftest.py)
`app` (in-memory SQLite, tables created, CSRF off), `client`, `seeded` (runs the seed), and
`login(client, username, password="demo-1234")`. Set `app.config["CSRF_ENABLED"] = True` to test CSRF.

## Demo users (password `demo-1234`, never forced to change)
Directorates: `nic` Nicosia, `lim` Limassol-Paphos, `phc` Primary Health Care. Usernames `<d>.<role>`:
`requester`, `accountant` (dir_accountant), `sci` (sci_director, not in phc), `hr` (dir_hr_officer), `exec` (dir_exec),
`deputy` (substitute of all that Directorate's holders except requester). Requesters have no substitute.
Central: `central.finmgmt`, `central.hr`, `central.medical`, `central.nursing`, `central.ceo`, `central.deputy`
(substitute of all central holders). Also `demo.viewer` and `demo.admin` (admin, English).
Line managers: Directorate users report to `<d>.exec`; `<d>.exec` and central users report to `central.ceo`.
`lar` (Larnaca – Famagusta) has `lar.accountant`, `lar.hr`, `lar.exec`, `lar.deputy` and `lar.sci`, who holds both `requester` and
`sci_director` (substitute `lar.deputy`, line manager `lar.exec`) to show the conflict-of-interest redirect.
Directorates `mh`, `amb` exist with facilities but have no users. Only requesters and Directorate roles hold `request.create`.
`flask seed-cases` adds invented sample requests by driving the engine (idempotent). `flask run-timers [--at ISO]` queues reminders, escalations and warnings and applies T12 (`ehr/scheduler/`); `flask send-mail` sends the queue.
