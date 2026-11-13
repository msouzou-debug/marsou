# Contract 02: state machine and routing

Owner: orchestrator. Built by: `workflow-engine`. Source: build brief v2, sections 6, 7 and 11.
The engine lives in `ehr/workflow/` and is pure: no Flask, database, clock or network. Everything it needs comes in as arguments; everything it wants done goes out as data.

Rule ids (R1, T4, C2 and so on) are stable. Tests are named after them.

## 1. Vocabulary

| Thing | Values |
|---|---|
| Category | `medical`, `nursing`, `allied`, `admin`, `other` (Ιατρικό, Νοσηλευτικό, Παραϊατρικό, Διοικητικό / Γραμματειακό, Άλλο) |
| Request status | `draft`, `in_progress`, `returned`, `approved`, `rejected`, `withdrawn` |
| Step | 1 to 6 |
| Step 3 phase | `inputs` (parallel), then `decision` |
| Role | `requester`, `dir_accountant`, `sci_director`, `dir_hr_officer`, `dir_exec`, `fin_mgmt_head`, `central_hr_officer`, `medical_director`, `nursing_director`, `ceo` |
| Action | `submit`, `resubmit`, `check`, `opinion`, `approve`, `reject`, `return`, `withdraw` |
| Task status | `open`, `paused`, `closed` |
| Tracker stop state | `done`, `current`, `pending`, `not_applicable`, `stopped`, `paused`, `withdrawn` |
| Person state inside a stop | `done`, `waiting`, `paused`, `negative`, `replaced` |
| Redirect reason | `out_of_office`, `conflict_of_interest` |

## 2. Route

`compute_route(category, directorate_has_sci_director) -> Route`

| Id | Rule |
|---|---|
| R1 | `sci_director` is in step 3 inputs only if category is `medical`, `nursing` or `allied` **and** the Directorate has the role |
| R2 | Financial data is required at step 2 only if category is `medical` or `allied` |
| R3 | Step 5 goes to `medical_director` for `medical` or `allied`, to `nursing_director` for `nursing`, and does not apply otherwise |

Route shape, stored as `route_snapshot_json` at submission:

```json
{"financials_required": true,
 "steps": [
  {"step": 1, "roles": ["requester"]},
  {"step": 2, "roles": ["dir_accountant"]},
  {"step": 3, "inputs": ["sci_director", "dir_hr_officer"], "decision": "dir_exec"},
  {"step": 4, "inputs": ["fin_mgmt_head", "central_hr_officer"]},
  {"step": 5, "roles": ["medical_director"], "applies": true},
  {"step": 6, "roles": ["ceo"]}]}
```

| Id | Rule |
|---|---|
| R4 | The stored route decides who is asked. Later changes to rules or role holders do not reroute a request in progress. Only substitution (section 5) and a material change on resubmission (T9b) do |

## 3. Engine interface

```python
apply(state: RequestState, action: NewAction, directory: Directory, now: datetime) -> Result
```

- `RequestState`: the request fields the rules need (status, current_step, step3_phase, returned_from_step, round, category, directorate_id, created_by, route), its recorded actions and its tasks.
- `NewAction`: actor_user_id, action, role, payload, comment, changed_fields (resubmit only).
- `Directory`: for each role and Directorate, the holder, the substitute, who is out of office, and each person's line manager. Read from the database by the caller before the call.
- `Result`: either `errors` (list of error codes, nothing changes) or the new status, current_step, step3_phase, round, returned_from_step, the action record to store, `task_ops` (`open`, `pause`, `resume`, `close`, each with role, assignee, on_behalf_of, redirect_reason) and `events` for the notifier (section 7).

The caller stores the result in one database transaction. The engine never raises for a business rule; it returns an error code.

## 4. Transitions

Payload values are in contract 03, section 4.

| Id | From | Action, by | Condition | Result |
|---|---|---|---|---|
| T1 | `draft` | `submit`, requester | form valid | `in_progress`, step 2, round 1. Route stored. Task: `dir_accountant` |
| T2a | step 2 | `check`, dir_accountant | position is `yes` or `arranged_centrally`, funds `yes`; financials present if R2 | Step 3, phase `inputs`. Tasks: every role in step 3 inputs |
| T2b | step 2 | `check`, dir_accountant | position `no` or funds `no` | `rejected` at step 2 |
| T3a | step 3 `inputs` | `opinion`, sci_director | positive or negative | Recorded. If all inputs are in: phase `decision`, task `dir_exec` |
| T3b | step 3 `inputs` | `check`, dir_hr_officer | complete or incomplete | Recorded. If all inputs are in: phase `decision`, task `dir_exec` |
| T4a | step 3 `decision` | `approve`, dir_exec | | Step 4. Tasks: `fin_mgmt_head`, `central_hr_officer` |
| T4b | step 3 `decision` | `reject`, dir_exec | | `rejected` at step 3 |
| T5a | step 4 | `check`, fin_mgmt_head | credit `no` | `rejected` at step 4 at once. Every other open task closes |
| T5b | step 4 | `check`, fin_mgmt_head | credit `yes` | Recorded. If both inputs are in: T5d |
| T5c | step 4 | `check`, central_hr_officer | costs given | Recorded. If both inputs are in and credit is `yes`: T5d |
| T5d | step 4 | (follows T5b or T5c) | | Step 5 if it applies (task for its role), otherwise step 6 (task `ceo`) |
| T6 | step 5 | `opinion`, medical or nursing director | positive or negative | Step 6. Task `ceo` |
| T7a | step 6 | `approve`, ceo | | `approved` |
| T7b | step 6 | `reject`, ceo | | `rejected` at step 6 |
| T8 | `in_progress`, any step | `return`, the assignee of an open task | | `returned`, `returned_from_step` = current step. Every open task becomes `paused`, the returner's too |
| T9a | `returned` | `resubmit`, requester | no material field changed | `in_progress` at `returned_from_step`, same phase. Round + 1. Paused tasks resume with their clock restarted. People with a completed input in the current step and phase get `may_replace` (T10) |
| T9b | `returned` | `resubmit`, requester | a material field changed | `in_progress` at step 2. Round + 1. Route recomputed. Paused tasks close. Task: `dir_accountant`. Earlier actions from step 2 on are marked `superseded` and stay in the history |
| T10 | `in_progress` | `check` or `opinion`, by someone holding `may_replace` | same step and phase still open | New action with `supersedes_action_id`. `may_replace` is cleared. The step's rules run again on the new value (a new «Όχι» on credit rejects) |
| T11 | `in_progress` or `returned` | `withdraw`, requester | | `withdrawn`. Every task closes |
| T12 | `returned` | `withdraw`, system | returned for more than `returned_timeout_days` working days | `withdrawn`, with a system comment |

Material fields (T9b): category, facility, cost centre, position, positions count. These are what step 2 checked, so the check is done again. Διεύθυνση can never change.

Closing: `approved`, `rejected` and `withdrawn` set `closed_at`, close every task and accept no further action.

## 5. Who gets a task

`resolve_assignee(role, directorate_id, requester_id, directory) -> (assignee, on_behalf_of, redirect_reason)`

| Id | Rule |
|---|---|
| C1 | Default: the role holder |
| C2 | Holder is out of office: the substitute. `on_behalf_of` = holder, reason `out_of_office` |
| C3 | The candidate is the requester: skip to the next candidate. Order: holder, substitute, holder's line manager, that manager's line manager, and so on. Reason `conflict_of_interest` |
| C4 | A candidate who is out of office is skipped the same way |
| C5 | No candidate left: the task opens unassigned with event `task_unassigned`, shown to `admin` |
| C6 | When a holder switches out-of-office on, their open tasks move to the substitute by the same rules. Switching it off does not move tasks back |
| C7 | Only the current assignee of an open task can act on it. A paused or closed task accepts nothing |

## 6. Validation errors

| Code | When |
|---|---|
| `not_your_task` | Actor has no open task for this role on this request |
| `request_closed` | Status is approved, rejected or withdrawn |
| `request_returned` | Any approver action while status is `returned` |
| `wrong_step` | Action does not belong to the current step or phase |
| `comment_required` | Missing comment on: reject, return, withdraw, a negative opinion, «Ελλιπής», or any «Όχι» at steps 2 and 4 |
| `financials_required` | Step 2 without financial data when R2 applies |
| `commitment_article_required` | Step 4 credit `yes` without άρθρο δέσμευσης |
| `leaver_costs_required` | Step 4 HR input without a cost for each leaver (departure reasons only) or for the new hires |
| `directorate_locked` | Resubmit tries to change Διεύθυνση |
| `not_requester` | Submit, resubmit or withdraw by someone else |
| `own_request` | Actor is the requester and tries an approver action (defence in depth; C3 should prevent it) |

## 7. Events for the notifier

`task_opened`, `task_resumed`, `task_redirected`, `task_unassigned`, `request_submitted`, `request_returned`, `request_resubmitted`, `new_material` (to people holding `may_replace`), `request_approved`, `request_rejected`, `request_withdrawn`, `reminder_due`, `escalation_due`, `withdrawal_warning`.

Each event carries request id, recipient user id and the data the email needs. The engine decides who is told; the notifier decides how.

## 8. Time rules

All pure functions taking `now`, the holiday set and the settings.

| Id | Rule |
|---|---|
| W1 | A working day is Monday to Friday and not in `public_holiday` |
| W2 | A task's clock starts at `opened_at`, or at the last resume if it was paused. Paused time never counts |
| W3 | Reminder when the clock reaches `reminder_days` working days (default 2) with no action. Once per clock start |
| W4 | Escalation to the assignee's line manager at `escalation_days` (default 5). Once per clock start. The task stays with the assignee |
| W5 | Returned request: warning to the requester at half of `returned_timeout_days`, automatic withdrawal (T12) at the limit (default 30) |

## 9. Tracker view

`tracker_view(state) -> list of stops`, used by the request page, the list miniature and the form preview. For the preview it runs on a route computed from the form's current Directorate and category, with every stop `pending`.

Each stop: step, state, and for each role its person state, the acting person, `on_behalf_of` and `redirect_reason`. Templates render this and hold no rules.

## 10. Where this contract goes beyond the brief

These were needed to make the rules complete. The owner approved all five on 13/11/2026.

| Id | Decision taken here | Brief says |
|---|---|---|
| O1 | A material change on resubmission sends the request back to step 2 (T9b) | "Recompute the route" on a category change, without saying what happens to checks already done |
| O2 | A return pauses the returner's own task too; they act again after resubmission | Not stated |
| O3 | Inputs can be replaced only after a resubmission and only in the step that was returned (T10) | "May replace their input before the step closes" |
| O4 | Comment is required on a negative opinion, on «Ελλιπής» and on «Όχι» | Required only for reject and return |
| O5 | Escalation tells the line manager but does not move the task (W4) | "Escalation to the line manager" |
