# Contract 03: routes and forms

Owner: orchestrator. Built by: `forms-ui`, `documents`, `notifications`. Source: build brief v2, sections 9, 11 and 12.

Server-rendered pages. Forms post back with a CSRF token. After a successful post, redirect (no repeated submits on refresh). A route never holds a business rule: it gathers input, calls the engine (contract 02) and stores the result in one transaction.

## 1. Routes

| Method and path | Permission | Does | Phase |
|---|---|---|---|
| GET `/healthz` | none | Health check | 0 |
| GET, POST `/login` | none | Sign in. `next` must be a path inside the app | 1 |
| POST `/logout` | signed in | Sign out | 1 |
| GET, POST `/password` | signed in | Forced change on first sign-in (local accounts) | 1 |
| GET `/` | signed in | Redirects to `/requests` | 1 |
| GET `/requests?tab=mine\|waiting\|all&q=` | signed in | List. `waiting` = my open tasks. `all` limited by what the user may see | 1 |
| GET `/requests/new` | `request.create` | Empty form | 1 |
| POST `/requests` | `request.create` | Save draft or submit (`intent=draft\|submit`) | 1 |
| GET `/requests/route-preview?directorate_id=&category=` | `request.create` | HTML fragment of the tracker for the form | 1 |
| GET `/requests/options?list=facility\|position&directorate_id=&category=` | `request.create` | JSON for dependent lists | 1 |
| GET `/requests/<id>` | may see this request | Request page. `?do=review` scrolls to the action card | 1, 2 |
| GET, POST `/requests/<id>/edit` | requester, status `draft` or `returned` | Edit draft, or correct and resubmit | 1, 2 |
| POST `/requests/<id>/action` | assignee of an open task | Any approver action, including return | 2 |
| POST `/requests/<id>/withdraw` | requester | Withdraw | 2 |
| POST `/requests/<id>/documents` | requester, status `draft` or `returned` | Upload | 3 |
| POST `/requests/<id>/documents/<doc_id>/remove` | requester, document from the current unsubmitted round | Remove before submitting | 3 |
| GET `/requests/<id>/documents/<doc_id>` | may see this request | Viewer page | 3 |
| GET `/requests/<id>/documents/<doc_id>/file?download=1` | may see this request | The file, or its PDF conversion. Writes an audit row | 3 |
| POST `/me/out-of-office` | holds an approver role | Switch on or off, optional dates | 4 |
| GET `/requests/export.xlsx` | `request.view_all` or `request.view_directorate` | The list as Excel | 6 |
| GET `/audit` | `audit.view` | Read-only log with filters | 6 |
| GET, POST `/settings/...` | `settings.manage` | Lists, role holders, substitutes, line managers, holidays, timings | 1 (lists), 4 (rest) |

Language: `?lang=el|en` on any page sets it, stores it on the user and returns to the same page.

## 2. Who may see a request

| Who | Sees |
|---|---|
| Requester | Requests they created |
| Holder or substitute of a Directorate role | Requests of that Directorate |
| Holder or substitute of a central role, `viewer`, `admin` | All |
| Anyone with a task on it (including by redirection) | That request |

Anything else answers 404, not 403, so numbers can't be probed. Open point for the owner: whether the requester sees each approver's comment or only each step's outcome. Until decided, the requester sees outcomes and the comment on a return, rejection or withdrawal.

## 3. Request form fields

Names are the form field names and the model attributes. "Shown when" fields are left out of the page when they don't apply, and ignored if posted.

| Field | Type | Required | Shown when |
|---|---|---|---|
| `directorate_id` | select | yes | always. Locked after first submission |
| `facility_id` | select, filtered by Directorate | yes | always |
| `cost_centre_id` | select with search | yes | always |
| `category` | select | yes | always |
| `position_id` | select, filtered by category | yes | always |
| `positions_count` | integer ≥ 1 | yes | always |
| `oay_specialty_id` | select with search | yes | category `medical` or `allied` |
| `reason` | select | yes | always |
| `leavers[n].name`, `.leave_date`, `.employment` | repeatable group, 1 to `positions_count` | yes | reason is a departure |
| `need_text` | textarea | yes | always |
| `alternatives_text` | textarea | yes | always |
| `new_need_origin`, `new_need_cover_so_far` | textarea | yes | reason `new_need` |
| `new_need_plan` | textarea | yes | reason `new_need` and category `medical` or `allied` |
| `absence_flag` | no / yes | yes | always |
| `absence_text` | text | if yes | `absence_flag` yes |
| `external_funding_flag` | no / yes | yes | category `medical` or `allied` |
| `external_funding_text` | text | if yes | `external_funding_flag` yes |
| `documents` | files, several | no | always |
| `resubmit_note` | textarea | yes | resubmission only |

A draft saves with any fields filled. Submit validates everything. Validation runs on the server; the browser only helps. Dates are typed and shown as `ηη/μμ/εεεε`.

## 4. Action payloads (`POST /requests/<id>/action`)

Common fields: `action`, `comment`. `payload_json` stores exactly these keys.

| Role | `action` | Payload |
|---|---|---|
| dir_accountant | `check` | `position`: `yes` \| `no` \| `arranged_centrally`; `funds`: `yes` \| `no`; when financials are required: `oay_specialty_id` and, for each of `prev_year` and `ytd`: `visits`, `procedures`, `revenue`, `payroll_cost`, `headcount`; `payroll_to_month` |
| sci_director, medical_director, nursing_director | `opinion` | `opinion`: `positive` \| `negative` |
| dir_hr_officer | `check` | `documentation`: `complete` \| `incomplete` |
| dir_exec, ceo | `approve` or `reject` | none |
| fin_mgmt_head | `check` | `credit`: `yes` \| `no`; `commitment_article` |
| central_hr_officer | `check` | `leaver_costs`: {leaver_id: amount} (departures only); `new_hire_cost` (annual, for all posts) |
| any assignee | `return` | none (comment required) |

Amounts are typed as `1.234,56` and stored as decimals. With the manual activity provider the Λογιστής types `visits`, `procedures` and `revenue`; with a data provider they arrive filled and the posted values for those three are ignored in favour of the provider's snapshot.

## 5. Request page order

1. Number, status chip, position and count, facility.
2. Tracker and status line.
3. Action card, if the viewer has an open task. On a phone the key lines of the request sit above it.
4. Request details.
5. Supporting documents, grouped by round.
6. Checks and opinions so far (latest value per role, marker if replaced).
7. History (every action, oldest first).

## 6. Engine errors on screen

The route maps each error code of contract 02, section 6, to the string key `error.<code>` and shows it at the top of the form with the fields kept as typed. `not_your_task` after someone else already acted shows the request's current state instead of an error page.

## 7. Email

One layout. Subject: `[<number>] <position> · <facility>`. One button: «Προβολή αιτήματος» → absolute URL of `/requests/<id>?do=review`. No other link changes state. Templates per event of contract 02, section 7.
