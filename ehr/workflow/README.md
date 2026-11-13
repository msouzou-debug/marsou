# ehr.workflow: public API

Pure Python (3.10, standard library). No clock, I/O or framework. Contract: `docs/contracts/02-state-machine.md`.
All dataclasses are frozen and live in `ehr.workflow.model`. Sequences are tuples.

## Functions

- `route.compute_route(category, directorate_has_sci_director) -> dict` (contract section 2 shape; step 5 has `applies`).
  Constants: `CATEGORIES, ROLES, ACTIONS, STATUSES, MATERIAL_FIELDS, DEPARTURE_REASONS`.
- `engine.apply(state, action, directory, now, holidays=None, settings=None) -> Result`
- `assign.resolve_assignee(role, directorate_id, requester_id, directory) -> (assignee|None, on_behalf_of|None, reason|None)`
- `assign.reassign_for_out_of_office(user_id, requests, directory) -> (task_ops, events)` (C6; call after the directory shows them out)
- `timing.working_days_between(start, end, holidays)`, `timing.add_working_days(start, n, holidays)`
- `timing.due_notifications(tasks, returned_requests, now, holidays, settings) -> [Event]` (reminder_due, escalation_due, withdrawal_warning)
- `timing.due_withdrawals(returned_requests, now, holidays, settings) -> [request_id]`; then call `apply` with `NewAction(None, "withdraw", "system", system=True)` (T12)
- `tracker.tracker_view(state) -> [stop]`, `tracker.preview(route) -> [stop]`
- `numbering.format_number(prefix, year, value)`, `numbering.normalise_number(text)`

## Dataclasses (fields)

- `RequestState`: id, status, current_step, step3_phase, returned_from_step, round, category, directorate_id, created_by, route (dict), reason, leaver_ids, returned_at, withdrawal_warned, actions, tasks
- `ActionRecord`: id, round, step, phase, role, actor_user_id, on_behalf_of_user_id, redirect_reason, action, payload, comment, supersedes_action_id, is_superseded, created_at
- `TaskState`: id, request_id, round, step, phase, role, assignee_user_id, on_behalf_of_user_id, redirect_reason, status, may_replace, opened_at, clock_started_at, reminded_at, escalated_at, line_manager_id
- `NewAction`: actor_user_id, action, role, payload, comment, changed_fields (dict field -> new value, resubmit only), system (T12 only)
- `Directory`: holders and substitutes ({(role, directorate_id or None): user_id}), out_of_office (frozenset of user ids), line_managers ({user: manager})
- `Settings`: reminder_days=2, escalation_days=5, returned_timeout_days=30 (a plain dict with the same keys also works)
- `Result`: errors, status, current_step, step3_phase, round, returned_from_step, category, route, returned_at, closed_at, action, superseded_action_ids, task_ops, events; `.ok`
- `TaskOp`: op (`open pause resume close reassign allow_replace clear_replace`), role, task_id, assignee_user_id, on_behalf_of_user_id, redirect_reason, step, phase, round
- `Event`: kind, request_id, recipient_user_id (None = admin), data

## What the caller does with a Result

If `errors` is non-empty (codes of contract section 6, plus `invalid_payload` for a bad choice value) nothing changes. Otherwise, in one transaction:
write the request fields (status, current_step, step3_phase, round, returned_from_step, category, route as `route_snapshot_json`, returned_at); set `closed_at` if `closed_at` is set;
store `action` (new row; mark `superseded_action_ids` as superseded); apply `task_ops` (`open` = new task with opened_at and clock_started_at = now; `resume` = status open, clock_started_at = now, clear reminded_at and escalated_at; `allow_replace`/`clear_replace` set task.may_replace; `reassign` changes the assignee); then hand `events` to the notifier.
`returned_at` is None except right after a return, so storing it also resets the W5 warning flag.
Set `TaskState.line_manager_id` from the directory before calling `due_notifications`.

## Tracker stop

`{step, state, phase, people: [{role, state, actor_user_id, on_behalf_of_user_id, redirect_reason, replaced, phase}]}`.
Stop state: done, current, pending, not_applicable, stopped, paused, withdrawn. Person state: done, waiting, paused, negative, replaced.
Step 3 people come inputs first (`phase` "inputs"), then dir_exec (`phase` "decision"). Elsewhere `phase` is None.

## Example

```python
state = RequestState(id=1, status="draft", category="medical", directorate_id="D1", created_by="u1")
res = apply(state, NewAction("u1", "submit", "requester"), directory, now)
if res.ok:
    ...store res...
else:
    show(res.errors)  # keys error.<code>
```
