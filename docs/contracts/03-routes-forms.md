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
| GET `/requests/options?list=facility\|position\|cost_centre&directorate_id=&category=` | `request.create` | JSON `{"options": [{"id", "label"}]}` for dependent lists. `cost_centre` takes `directorate_id` (one the user may choose, else empty) and returns that Directorate's active cost centres plus the unassigned ones, labelled `<code> <name>` with the code as stored | 1 |
| GET `/requests/<id>` | may see this request | Request page. `?do=review` scrolls to the action card | 1, 2 |
| GET, POST `/requests/<id>/edit` | requester, status `draft` or `returned` | Edit draft, or correct and resubmit | 1, 2 |
| POST `/requests/<id>/action` | assignee of an open task | Any approver action, including return | 2 |
| POST `/requests/<id>/withdraw` | requester | Withdraw | 2 |
| POST `/requests/<id>/documents` | requester, status `draft` or `returned` | Upload | 3 |
| POST `/requests/<id>/documents/<doc_id>/remove` | requester, document from the current unsubmitted round | Remove before submitting. Any other document: message `docs.error.locked`, nothing deleted | 3 |
| GET `/requests/<id>/documents/<doc_id>` | may see this request | Viewer page. Writes `document_view` | 3 |
| GET `/requests/<id>/documents/<doc_id>/file` | may see this request | Inline bytes: the PDF, the image, or the PDF conversion of an Office file (404 if none). `?via=viewer` (sent by the viewer page) skips the audit row, otherwise `document_view` | 3 |
| GET `/requests/<id>/documents/<doc_id>/file?download=1` | may see this request | The original file as attachment. Writes `document_download` | 3 |
| POST `/me/out-of-office` | holds an approver role | Switch on or off, optional dates | 4 |
| GET `/requests/export.xlsx` | `request.view_all` or `request.view_directorate` | The list as Excel | 6 |
| GET `/audit` | `audit.view` | Read-only log with filters | 6 |
| GET, POST `/settings/...` | `settings.manage` | Lists, role holders, substitutes, line managers, holidays, timings. The positions list has an optional `code` field (2 to 6 Latin letters or digits, saved upper-case) that goes into the request number; the Excel import's `positions` sheet has the same `code` column, optional so older files still import, and a blank cell keeps the stored code | 1 (lists), 4 (rest) |
| POST `/settings/users/add` | `settings.manage` | New user. `auth_source=local` needs a temporary password. `auth_source=ad` takes no password, stores the lowercased account name as the sign-in page looks it up, and is active at once | 4 |
| POST `/settings/users/<id>/password` | `settings.manage` | New temporary password for a local user other than the administrator themselves. Forces a change at next sign-in, clears the sign-in lock for the name, audits `password_changed` with `by: admin` | 4 |
| GET `/settings/users?show=pending` | `settings.manage` | Only the Active Directory accounts waiting for activation | 4 |
| POST `/settings/roles/holder/add`, `/settings/roles/holder/remove` | `settings.manage` | Holders of `viewer` and `admin` (many each, no Directorate). The last active administrator cannot be removed or deactivated, and nobody removes their own `admin` role | 4 |

Language: a GET with `?lang=el|en` stores the choice (session and user) and redirects to the same path without `lang`, other parameters kept. Other methods are not redirected. The target is always a path on this site.

## 2. Who may see a request

| Who | Sees |
|---|---|
| Requester | Requests they created |
| Holder or substitute of a Directorate role | Requests of that Directorate |
| Holder or substitute of a central role, `viewer`, `admin` | All |
| Anyone with a task on it (including by redirection) | That request |

Anything else answers 404, not 403, so numbers can't be probed. A missing permission on any page answers 404 as well. Open point for the owner: whether the requester sees each approver's comment or only each step's outcome. Until decided, the requester sees outcomes and the comment on a return, rejection or withdrawal.

## 3. Request form fields

Names are the form field names and the model attributes. "Shown when" fields are left out of the page when they don't apply, and ignored if posted.

| Field | Type | Required | Shown when |
|---|---|---|---|
| `directorate_id` | select | yes | always. Locked after first submission |
| `facility_id` | select, filtered by Directorate | yes | always |
| `cost_centre_id` | select, filtered by Directorate, with a type-to-find box (below) | yes | always |
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

**Cost-centre rule.** On first render and on a re-render after an error the list holds only the chosen Directorate's active cost centres and the unassigned ones (with no Directorate chosen, only the unassigned). `requests.js` reloads it from `/requests/options?list=cost_centre` when the Directorate changes; a chosen cost centre that is not in the new list is cleared, as the facility is. On save and on submit the cost centre must be active and belong to the request's Directorate or to none, otherwise the field error `validation.choose`. One exception: a draft or returned request keeps the cost centre it already has, and shows it selected, while its Directorate is unchanged; saving a draft unchanged is accepted, submitting is not unless it fits.

**Type to find.** Above the cost-centre select sits a text box (label «Αναζήτηση κέντρου κόστους») that filters the options by code or name as you type, ignoring case and Greek accents; the chosen option always stays. The number of matches is announced through an `aria-live` region. The box is hidden until the script runs, has no `name` and is never posted; without JavaScript the plain select works.
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

One layout. Subject: `[<number>] <position> · <facility>`, where the number looks like `EHIRE-NGH-NUR-20261120-01` (contract 01, Request number). One button: «Προβολή αιτήματος» → absolute URL of `/requests/<id>?do=review`. No other link changes state. Templates per event of contract 02, section 7.

## 8. Documents (as built, Phase 3)

- Storage: `EHIRE_STORAGE_DIR` (default `<instance>/storage`). File at `<request_id>/<document_id>-<random>.bin`, converted copy `<document_id>-<random>.pdf` beside it. `request_document.storage_ref` holds the relative path. The client's name is stored as text only (path parts, control characters and quotes removed; Greek kept) and sent with RFC 5987 `filename*`.
- Accepted: pdf, doc, docx, xls, xlsx, png, jpg, jpeg. The extension and a magic-byte check must agree (PDF header, PNG, JPEG, OLE2 with a WordDocument or Workbook/Book stream, ZIP with `[Content_Types].xml` and `word/` or `xl/`). The server sets the mime; never text/html.
- Limits: `max_file_mb` setting (default 20), checked while the file is read in 64 KB blocks. Empty files refused. `MAX_CONTENT_LENGTH` 120 MB for a whole post. Upload goes to a temp name and is renamed; a refused file leaves nothing. Each file in one post is accepted or refused on its own.
- Rounds: a document is tagged `request.round`, or `request.round + 1` while the request is returned (the engine raises the round on resubmission, so the tag is already right). Removable: any document of a draft; on a returned request only those with `round > request.round`. Removal deletes row and file and writes `document_removed`. Submitted rounds are never deleted.
- Response headers on files: `X-Content-Type-Options: nosniff`, `Content-Security-Policy: default-src 'none'; frame-ancestors 'none'; sandbox`, `Cache-Control: private, no-store`.
- Conversion: `Converter.to_pdf(src, dst) -> bool`. `LibreOfficeConverter` runs `soffice --headless --convert-to pdf` without a shell, with a timeout (`EHIRE_CONVERT_TIMEOUT`, 60 s) and a private profile folder; binary from `EHIRE_SOFFICE_BIN` or PATH. `NullConverter` when none is found. Done on first view, cached, reused. Failure: the viewer shows `viewer.no_preview` and the download button.
- Viewer: PDF.js 4.10.38 in `static/vendor/pdfjs/`, one page on a canvas at a time.

## 9. Added in Phases 5 and 6

- `GET /requests/export.xlsx`: built as described in section 1. Three sheets: requests (an Excel table), summary (formulas only) and notes. No leaver names, costs or comments. It shares one query with the list, so tab, search and visibility always match.
- `GET /audit`: read-only, 50 per page, filters by request number, user, event and dates.
- Step 2 financial table: the three ΟΑΥ lines come from the source chosen in Settings (`activity_provider`: `manual` or `efinance`). With `efinance` they are read-only and the server ignores posted values for them; with no figures or no connection the card falls back to typing. The eFinance endpoint is proposed in `05-efinance-activity-link.md`.
- A database behind the latest schema version answers 503 on every page until `flask upgrade-db` runs.
