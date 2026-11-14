# Contract 04: string keys

Owner: orchestrator. Built by: `strings`. Files: `ehr/i18n/el.json`, `ehr/i18n/en.json`.

Rules:

- Dotted lower-case keys: `<area>.<thing>[.<variant>]`. Both files hold exactly the same keys; a test checks it.
- Templates and code use `t('key')`. No Greek literal outside the JSON files.
- Where Greek is given below it is fixed: it comes from the UI brief, section 9, and the `okypy-greek-terms` glossary. Where only English is given, `strings` writes the Greek with the Greek skills loaded and reports anything not covered by the glossary.
- Placeholders use `{name}`. Counts that change the Greek ending get two keys: `.one` and `.many`.
- This list covers Phases 1 and 2. The orchestrator adds the keys for a phase before that phase starts.

## Fixed terms

| Key | Greek | English |
|---|---|---|
| `app.name` | eHR | eHR |
| `module.position_approval` | Έγκριση Θέσεων | Position Approval |
| `list.title` | Αιτήματα θέσεων | Position requests |
| `list.new` | Νέο αίτημα | New request |
| `list.tab.waiting` | Περιμένουν εμένα | Waiting for me |
| `list.tab.mine` | Τα αιτήματά μου | My requests |
| `list.tab.all` | Όλα | All |
| `status.in_progress` | Σε εξέλιξη | In progress |
| `status.returned` | Επιστράφηκε | Returned |
| `status.approved` | Εγκρίθηκε | Approved |
| `status.rejected` | Απορρίφθηκε | Rejected |
| `status.withdrawn` | Αποσύρθηκε | Withdrawn |
| `statusline.waiting_on` | Περιμένει: {who} | Waiting on: {who} |
| `statusline.days.one` | 1 ημέρα | 1 day |
| `statusline.days.many` | {n} ημέρες | {n} days |
| `statusline.reminded` | στάλθηκε υπενθύμιση | reminder sent |
| `statusline.escalated` | κλιμακώθηκε στον προϊστάμενο | escalated to the line manager |
| `statusline.returned` | Επιστράφηκε στον αιτητή | Returned to requester |
| `action.title` | Η ενέργειά σας | Your action |
| `action.view_request` | Προβολή αιτήματος | View request |
| `action.approve` | Έγκριση | Approve |
| `action.reject` | Απόρριψη | Reject |
| `action.return` | Επιστροφή στον αιτητή | Return to requester |
| `action.resubmit` | Επανυποβολή | Resubmit |
| `action.withdraw` | Απόσυρση αιτήματος | Withdraw request |
| `action.save_draft` | Αποθήκευση ως πρόχειρο | Save draft |
| `action.add_leaver` | Προσθήκη ατόμου που αποχώρησε | Add leaver |
| `action.keep_answer` | Διατήρηση της απάντησής μου | Keep my answer |
| `opinion.positive` | Θετική | Positive |
| `opinion.negative` | Αρνητική | Negative |
| `documentation.complete` | Πλήρης | Complete |
| `documentation.incomplete` | Ελλιπής | Incomplete |
| `docs.title` | Υποστηρικτικά έγγραφα | Supporting documents |
| `docs.view` | Προβολή | View |
| `page.checks` | Έλεγχοι και γνωμοδοτήσεις | Checks and opinions |
| `page.history` | Ιστορικό | History |
| `tracker.title` | Η διαδρομή αυτού του αιτήματος | The route of this request |
| `tracker.not_applicable` | Δεν εφαρμόζεται | Not applicable |
| `tracker.on_hold` | Σε αναμονή | On hold |
| `ooo.label` | Είμαι εκτός γραφείου | I am out of office |
| `ooo.substitute` | Αναπληρωτής | Substitute |
| `field.cost_centre` | Κέντρο κόστους | Cost centre |
| `field.oay_specialty` | Ειδικότητα ΟΑΥ | HIO specialty |
| `step.1` | Υποβολή | Submission |
| `step.2` | Θέσεις και κονδύλι | Posts and funds |
| `step.3` | Απόφαση Διεύθυνσης | Directorate decision |
| `step.4` | Κεντρικός έλεγχος | Central check |
| `step.5` | Γνωμοδότηση ειδικότητας | Specialty opinion |
| `step.6` | Απόφαση ΓΕΔ | CEO decision |
| `role.requester` | Αιτητής | Requester |
| `role.dir_accountant` | Λογιστής Διεύθυνσης | Directorate Accountant |
| `role.sci_director` | Επιστημονικός Διευθυντής | Scientific Director |
| `role.dir_hr_officer` | Λειτουργός Ανθρώπινου Δυναμικού Διεύθυνσης | Directorate HR Officer |
| `role.dir_exec` | Εκτελεστικός Διευθυντής Διεύθυνσης | Directorate Executive Director |
| `role.fin_mgmt_head` | Προϊστάμενος Μονάδας Οικονομικής Διαχείρισης | Head of Financial Management Unit |
| `role.central_hr_officer` | Λειτουργός Ανθρώπινου Δυναμικού, Κεντρική Διοίκηση | HR Officer, Central Administration |
| `role.medical_director` | Ιατρικός Διευθυντής ΟΚΥπΥ | SHSO Medical Director |
| `role.nursing_director` | Νοσηλευτικός Διευθυντής ΟΚΥπΥ | SHSO Nursing Director |
| `role.ceo` | Γενικός Εκτελεστικός Διευθυντής | Chief Executive Officer |
| `category.medical` | Ιατρικό | Medical |
| `category.nursing` | Νοσηλευτικό | Nursing |
| `category.allied` | Παραϊατρικό | Allied health |
| `category.admin` | Διοικητικό / Γραμματειακό | Administrative / Secretarial |
| `category.other` | Άλλο | Other |
| `reason.retirement` | Αφυπηρέτηση | Retirement |
| `reason.resignation` | Παραίτηση | Resignation |
| `reason.secondment_end` | Τερματισμός απόσπασης | End of secondment |
| `reason.contract_end` | Διακοπή συμβολαίου | End of contract |
| `reason.new_need` | Νέα ανάγκη | New need |
| `reason.other` | Άλλος λόγος | Other reason |
| `field.directorate` | Διεύθυνση | Directorate |
| `field.facility` | Νοσοκομείο ή Δομή | Hospital or facility |
| `field.category` | Κατηγορία προσωπικού | Staff category |
| `field.position` | Τίτλος θέσης | Position title |
| `field.positions_count` | Αριθμός θέσεων | Number of posts |
| `field.reason` | Λόγος | Reason |
| `field.leaver_name` | Ποιος αποχώρησε | Who left |
| `field.leave_date` | Ημερομηνία αποχώρησης | Leaving date |
| `field.employment` | Καθεστώς | Employment status |
| `employment.okypy_contract` | Συμβόλαιο ΟΚΥπΥ | SHSO contract |
| `employment.civil_servant` | Δημόσιος υπάλληλος | Civil servant |
| `field.need_text` | Γιατί χρειάζεται η θέση | Why the post is needed |
| `field.alternatives_text` | Γιατί δεν καλύπτεται διαφορετικά | Why it can't be covered another way |
| `field.new_need_origin` | Πώς προέκυψε η ανάγκη | How the need arose |
| `field.new_need_cover_so_far` | Πώς καλυπτόταν μέχρι τώρα | How it was covered until now |
| `field.new_need_plan` | Πλάνο εσόδων και εξόδων | Revenue and cost plan |
| `field.absence_flag` | Υπάρχει προσωπικό σε μακρά απουσία; | Is any staff member on long absence? |
| `field.external_funding_flag` | Καλύπτεται το κόστος από πηγή εκτός ΟΚΥπΥ; | Is the cost covered from outside SHSO? |
| `answer.yes` | Ναι | Yes |
| `answer.no` | Όχι | No |
| `answer.arranged_centrally` | Διευθετήθηκε από την Κεντρική Διοίκηση | Arranged by Central Administration |

English role names and "SHSO" for ΟΚΥπΥ are my translations. Confirm them with the owner or replace them with the organisation's official English titles.

## Keys for `strings` to write (English given, Greek to write)

| Key | English |
|---|---|
| `nav.language`, `nav.logout`, `nav.settings` | Language · Sign out · Settings |
| `login.title`, `login.username`, `login.password`, `login.submit`, `login.failed` | Sign in · Username · Password · Sign in · The username or password is wrong. Try again. |
| `password.title`, `password.new`, `password.repeat`, `password.submit`, `password.mismatch`, `password.too_short` | Choose a new password · New password · Repeat it · Save password · The two passwords don't match. · Use at least {n} characters. |
| `list.search` | Search by number |
| `list.col.number`, `list.col.position`, `list.col.facility`, `list.col.status` | Number · Position · Hospital or facility · Status |
| `list.empty.waiting`, `list.empty.mine`, `list.empty.all` | Nothing is waiting for you. · You haven't made a request yet. · No requests found. |
| `list.posts.one`, `list.posts.many` | 1 post · {n} posts |
| `form.title.new`, `form.title.edit`, `form.title.resubmit` | New request · Edit draft · Correct and resubmit |
| `form.submit` | Submit request |
| `form.section.post`, `form.section.reason`, `form.section.need`, `form.section.documents` | The post · Reason · The need · Supporting documents |
| `form.select.placeholder` | Choose… |
| `form.absence_detail`, `form.external_funding_detail` | Who and since when · Which source |
| `form.remove_leaver` | Remove |
| `form.resubmit_note` | What you changed or added |
| `form.returned_by`, `form.days_left.one`, `form.days_left.many` | Returned by {who} on {date} · 1 working day left before the request is withdrawn · {n} working days left before the request is withdrawn |
| `form.submitted` | Your request was submitted. Its number is {number}. |
| `form.draft_saved` | Draft saved. |
| `validation.required` | Fill in this field. |
| `validation.choose` | Choose one. |
| `validation.min_one` | Enter 1 or more. |
| `validation.date` | Enter the date as dd/mm/yyyy. |
| `validation.amount` | Enter an amount, for example 1.234,56. |
| `validation.leavers_max` | You can't add more people than posts. |
| `validation.summary` | Some fields need your attention. |
| `tracker.preview_title` | The route your request will follow |
| `tracker.acting_for` | {who}, for {holder} |
| `tracker.redirect.out_of_office`, `tracker.redirect.conflict_of_interest` | out of office · the holder made this request |
| `tracker.replaced` | An earlier answer is in the history |
| `tracker.stopped_here` | Stopped here |
| `page.details`, `page.round` | Request details · Round {n} |
| `card.comment`, `card.comment_required`, `card.send` | Comment · Comment (required) · Send |
| `card.position_available`, `card.funds_available` | Is a post available? · Are funds available? |
| `card.fin.title`, `card.fin.prev_year`, `card.fin.ytd`, `card.fin.visits`, `card.fin.procedures`, `card.fin.revenue`, `card.fin.payroll`, `card.fin.headcount`, `card.fin.ratio` | Financial data · Previous year · This year to date · Visits · Procedures · Revenue · Payroll cost · Headcount · Revenue per €1 of payroll |
| `card.fin.data_to`, `card.fin.payroll_period`, `card.fin.revision_note` | ΟΑΥ data to {month} · January to {month} · The latest ΟΑΥ months may still change. |
| `card.documentation` | Is the documentation complete? |
| `card.opinion` | Your opinion |
| `card.credit`, `card.commitment_article` | Is there credit? · Commitment article |
| `card.leaver_cost`, `card.new_hire_cost` | Annual employer cost of {name} · Annual employer cost of the new hires |
| `card.return.intro` | Send the request back to the requester for corrections or more documents. |
| `card.return.confirm` | Return the request to {who}? |
| `card.withdraw.confirm` | Withdraw this request? This can't be undone. |
| `card.replace.intro` | New material was added after your answer. Keep your answer or give a new one. |
| `done.check`, `done.opinion`, `done.approve`, `done.reject`, `done.return`, `done.resubmit`, `done.withdraw` | Your check was recorded. · Your opinion was recorded. · The request was approved. · The request was rejected. · The request was returned to the requester. · The request was resubmitted. · The request was withdrawn. |
| `history.submit`, `history.resubmit`, `history.check`, `history.opinion`, `history.approve`, `history.reject`, `history.return`, `history.withdraw`, `history.withdraw_system`, `history.superseded` | Submitted · Resubmitted · Check · Opinion · Approved · Rejected · Returned to requester · Withdrawn · Withdrawn automatically after {n} working days · Replaced by a later answer |
| `closed.rejected_at`, `closed.withdrawn_by_requester`, `closed.withdrawn_by_system` | Rejected at step {n}, {step}, by {who} · Withdrawn by the requester · Withdrawn automatically: it was not resubmitted in time |
| `error.not_your_task`, `error.request_closed`, `error.request_returned`, `error.wrong_step`, `error.comment_required`, `error.financials_required`, `error.commitment_article_required`, `error.leaver_costs_required`, `error.directorate_locked`, `error.not_requester`, `error.own_request` | This task isn't yours, or someone has already done it. · This request is closed. · The request is with the requester. You can act when it comes back. · The request has moved on. Reload the page. · Write a comment to explain. · Fill in the financial data. · Enter the commitment article. · Enter a cost for each person and for the new hires. · The Directorate can't be changed. Make a new request instead. · Only the requester can do this. · You can't act on your own request. |
| `error.404`, `error.500` | We couldn't find this page. · Something went wrong. Try again; if it keeps happening, tell the administrator. |
| `settings.title`, `settings.lists`, `settings.list.directorate`, `settings.list.facility`, `settings.list.position`, `settings.list.cost_centre`, `settings.list.oay_specialty` | Settings · Lists · Directorates · Hospitals and facilities · Positions · Cost centres · ΟΑΥ specialties |
| `settings.col.code`, `settings.col.name_el`, `settings.col.name_en`, `settings.col.state`, `settings.active`, `settings.inactive` | Code · Name (Greek) · Name (English) · State · Active · Inactive |
| `settings.add`, `settings.save`, `settings.deactivate`, `settings.activate`, `settings.saved` | Add · Save · Deactivate · Activate · Saved. |
| `settings.has_sci_director` | Has a Scientific Director |
| `settings.duplicate_code` | This code is already used. |
| `status.draft`, `tracker.state.done`, `tracker.state.current`, `tracker.state.pending`, `tracker.state.waiting`, `tracker.state.negative`, `form.date_hint`, `form.refresh_route` | Draft · Done · Current step · Pending · Waiting · Negative answer · dd/mm/yyyy · Update the route |
| `error.invalid_payload`, `system.auto_withdraw` | An answer is not valid. Check your choices. · The request was withdrawn automatically because it was not resubmitted in time. |
| `form.month_hint`, `validation.month`, `done.keep_answer` | mm/yyyy · Enter the month as mm/yyyy. · Your answer was kept. |
| `docs.add`, `docs.choose`, `docs.upload`, `docs.remove`, `docs.download`, `docs.empty` | Add documents · Choose files · Add the chosen files · Remove · Download · No documents. |
| `docs.allowed` | PDF, Word, Excel or images, up to {n} MB each. |
| `docs.count.one`, `docs.count.many`, `docs.added.one`, `docs.added.many`, `docs.removed` | 1 document · {n} documents · 1 document was added. · {n} documents were added. · The document was removed. |
| `docs.error.too_large`, `docs.error.type`, `docs.error.empty`, `docs.error.locked` | The file "{name}" is larger than {n} MB. Choose a smaller file. · The file "{name}" is not a PDF, Word, Excel or image file. · The file "{name}" is empty. · Documents can't be removed after the request is submitted. |
| `docs.draft_first` | Save the request as a draft first, then add documents. |
| `viewer.title`, `viewer.back`, `viewer.page`, `viewer.prev`, `viewer.next`, `viewer.zoom_in`, `viewer.zoom_out` | Document · Back to the request · Page {n} of {total} · Previous page · Next page · Zoom in · Zoom out |
| `viewer.loading`, `viewer.no_preview`, `viewer.converted` | Loading the document… · This file can't be shown here. Download it to open it. · Shown as PDF. Download gives you the original file. |

## Phase 4 keys (emails, out of office, settings)

One key per row. `strings` writes the Greek.

| Key | English |
|---|---|
| `mail.subject` | [{number}] {position} · {facility} |
| `mail.footer` | eHR sent this message automatically. Please don't reply to it. |
| `mail.requester` | Requester |
| `mail.comment` | Comment |
| `mail.waiting_on` | Waiting on |
| `mail.task_opened.label` | Waiting for you |
| `mail.task_opened.intro` | A position request is waiting for your action as {role}. |
| `mail.task_resumed.label` | Waiting for you again |
| `mail.task_resumed.intro` | The request was resubmitted and is waiting for your action again. |
| `mail.task_redirected.label` | For information |
| `mail.task_redirected.intro.out_of_office` | You are out of office, so {who} is acting on this request in your place. |
| `mail.task_redirected.intro.conflict_of_interest` | You made this request, so {who} is acting on it in your place. |
| `mail.task_unassigned.label` | No one to act |
| `mail.task_unassigned.intro` | Nobody can be given the {role} task on this request. Set a holder or a substitute in Settings. |
| `mail.request_submitted.label` | Submitted |
| `mail.request_submitted.intro` | Your request was submitted. Its number is {number}. |
| `mail.request_returned.label` | Returned to you |
| `mail.request_returned.intro` | {who} returned your request. Read the comment, correct the request and resubmit it. |
| `mail.request_resubmitted.label` | Resubmitted |
| `mail.request_resubmitted.intro` | The requester resubmitted the request you returned. |
| `mail.new_material.label` | New material |
| `mail.new_material.intro` | New material was added after your answer. Keep your answer or give a new one. |
| `mail.request_approved.label` | Approved |
| `mail.request_approved.intro` | Your request was approved. |
| `mail.request_rejected.label` | Rejected |
| `mail.request_rejected.intro` | Your request was rejected at step {n}, {step}. |
| `mail.request_withdrawn.label` | Withdrawn |
| `mail.request_withdrawn.intro` | The request was withdrawn. You don't need to do anything. |
| `mail.reminder_due.label` | Reminder |
| `mail.reminder_due.intro.one` | This request has been waiting for you for 1 working day. |
| `mail.reminder_due.intro.many` | This request has been waiting for you for {n} working days. |
| `mail.escalation_due.label` | Escalated, for information |
| `mail.escalation_due.intro` | {who} has had this request for {n} working days without acting. You are told for information. The task stays with {who}. |
| `mail.withdrawal_warning.label` | Will be withdrawn |
| `mail.withdrawal_warning.intro.one` | Your returned request will be withdrawn automatically in 1 working day if you don't resubmit it. |
| `mail.withdrawal_warning.intro.many` | Your returned request will be withdrawn automatically in {n} working days if you don't resubmit it. |
| `ooo.title` | Out of office |
| `ooo.on` | You are out of office. Your tasks go to {who}. |
| `ooo.off` | You are in the office. |
| `ooo.from` | From |
| `ooo.to` | To (optional) |
| `ooo.switch_on` | I am out of office |
| `ooo.switch_off` | I am back |
| `ooo.no_substitute` | You have no substitute. Ask the administrator to set one. |
| `ooo.saved_on` | You are now out of office. |
| `ooo.saved_off` | Welcome back. New tasks come to you again. |
| `ooo.moved.one` | 1 open task moved to {who}. |
| `ooo.moved.many` | {n} open tasks moved to {who}. |
| `settings.roles` | Role holders and substitutes |
| `settings.col.role` | Role |
| `settings.col.directorate` | Directorate |
| `settings.col.holder` | Holder |
| `settings.col.substitute` | Substitute |
| `settings.col.line_manager` | Line manager |
| `settings.none` | None |
| `settings.central` | Central |
| `settings.users` | Users |
| `settings.user.username` | Username |
| `settings.user.full_name` | Full name |
| `settings.user.email` | Email |
| `settings.user.language` | Language |
| `settings.user.temp_password` | Temporary password |
| `settings.user.temp_password_hint` | The user must change it at first sign-in. |
| `settings.user.duplicate` | This username is already used. |
| `settings.holidays` | Public holidays |
| `settings.col.date` | Date |
| `settings.remove` | Remove |
| `settings.timings` | Times and limits |
| `settings.reminder_days` | Reminder after (working days) |
| `settings.escalation_days` | Escalation after (working days) |
| `settings.returned_timeout_days` | Withdraw a returned request after (working days) |
| `settings.max_file_mb` | Largest file (MB) |
| `settings.number_invalid` | Enter a whole number, 1 or more. |
| `settings.outbox` | Email log |
| `settings.outbox.to` | To |
| `settings.outbox.subject` | Subject |
| `settings.outbox.when` | Created |
| `settings.outbox.state` | State |
| `settings.outbox.state.queued` | Waiting to be sent |
| `settings.outbox.state.sent` | Sent |
| `settings.outbox.state.failed` | Failed |
| `settings.outbox.empty` | No emails yet. |
| `settings.outbox.preview` | Show the email |
| `settings.same_person` | The holder and the substitute can't be the same person. |
| `settings.reassign` | Move {n} open tasks to the new holder |
| `settings.escalation_order` | Escalation must come after the reminder. |
| `settings.self_deactivate` | You can't deactivate your own account. |
| `settings.user.email_invalid` | Enter a valid email address. |
| `settings.holiday_duplicate` | This date is already a public holiday. |
| `ooo.invalid_dates` | The end date can't be before the start date. |
| `ooo.period` | From {from} to {to} |
| `ooo.since` | From {date} |
| `ooo.until` | Until {date} |

## Phase 5 and 6 keys (ΟΑΥ figures, audit view, Excel export, hardening)

One key per row. `strings` writes the Greek.

| Key | English |
|---|---|
| `card.fin.source.efinance` | From the ΟΑΥ data held in eFinance, to {month} |
| `card.fin.source.manual` | Typed by hand |
| `card.fin.unavailable` | The ΟΑΥ figures could not be loaded from eFinance. Type them. |
| `card.fin.no_data` | eFinance has no ΟΑΥ figures for this facility and specialty. Type them. |
| `card.fin.refresh` | Load the figures for this specialty |
| `settings.activity_provider` | Where the ΟΑΥ figures come from |
| `settings.activity_provider.manual` | The Directorate Accountant types them |
| `settings.activity_provider.efinance` | From eFinance. Typed only when eFinance has no figures |
| `settings.activity_provider.not_configured` | The link to eFinance is not set up on the server yet. |
| `nav.audit` | Audit log |
| `audit.title` | Audit log |
| `audit.filter.request` | Request number |
| `audit.filter.user` | User |
| `audit.filter.event` | Event |
| `audit.filter.from` | From |
| `audit.filter.to` | To |
| `audit.filter.apply` | Show |
| `audit.filter.all` | All |
| `audit.col.when` | When |
| `audit.col.user` | User |
| `audit.col.event` | Event |
| `audit.col.request` | Request |
| `audit.col.detail` | Detail |
| `audit.system` | System |
| `audit.empty` | No entries found. |
| `audit.page` | Page {n} of {total} |
| `audit.prev` | Previous |
| `audit.next` | Next |
| `list.export` | Export to Excel |
| `export.sheet.requests` | Requests |
| `export.sheet.summary` | Summary |
| `export.sheet.notes` | Notes |
| `export.col.number` | Number |
| `export.col.status` | Status |
| `export.col.step` | Step |
| `export.col.waiting_on` | Waiting on |
| `export.col.days_waiting` | Working days waiting |
| `export.col.requester` | Requester |
| `export.col.submitted` | Submitted |
| `export.col.closed` | Closed |
| `export.col.round` | Round |
| `export.col.documents` | Documents |
| `export.summary.by_status` | Requests by status |
| `export.summary.by_directorate` | Requests by Directorate |
| `export.summary.by_category` | Requests by staff category |
| `export.summary.count` | Requests |
| `export.summary.posts` | Posts |
| `export.summary.total` | Total |
| `export.summary.avg_days` | Average working days waiting, open requests |
| `export.notes.generated` | Exported on {date} by {who}. |
| `export.notes.rows` | Rows: the requests you may see, with the tab and search you had on the list. |
| `export.notes.formulas` | The Summary sheet is calculated by formulas from the Requests sheet. Change a row there and the summary follows. |
| `export.notes.days` | Working days waiting are counted on the export date and do not update. |
| `login.locked` | Too many failed attempts. Try again in {n} minutes. |
| `docs.error.unsafe` | The file "{name}" can't be accepted. Save it again from Word or Excel and try once more. |
