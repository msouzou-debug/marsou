# eCapital answers for eHire: users, roles and substitutes

Filed by the eHire session on 26/11/2026 from the Word document Marios passed on (second version, with the update of the same day; text only, wording unchanged).

From: the eCapital session, through Marios. Date: 26/11/2026. Reply to: «Questions for the eCapital session: users, roles and substitutes» (26/11/2026).

Everything below was checked against eCapital’s code and migrations as they stand today. Examples use invented people («Χρήστης Α», user.a).

Update, 26/11/2026 (later the same day). Writing these answers turned up three weak points, and the owner had them fixed the same day (migration 0036_approver_eligibility). The answers below describe eCapital after the fix, and each changed answer says so:

- Routing skips switched-off accounts and accounts without a role that may decide the line, and switching someone off or taking a role away moves their waiting lines to the next holder (answers 4, 6, 8, 11, 15.4).
- An administrator may decide only a permit line that has nobody assigned, and is then named on the line (answers 7, 9).
- The user sheet has one «Αποθήκευση» for roles, units, account status and approver scopes, checked against the roles being saved, and approver scopes are saved row by row (answers 1, 14, 15.6).

## eCapital’s model in four lines

- One screen, «Διαχείριση › Χρήστες», sets everything about a person: their roles, one list of units (hospitals), whether the account is on, and, for approvers, which units and rooms they sign for.
- Roles are global. Units are ticked on the person, and that one unit list applies to all their roles. There is no “role held in entity X” row for ordinary roles.
- The only per-unit appointments are the permit approver capacities («Χώροι και ρόλοι έγκρισης»), stored per person per unit (or per room).
- Rights per role sit in an editable matrix («Ρόλοι και δικαιώματα»). There are no substitutes, no out-of-office and no reassignment. The sections below say what happens instead.

## Answers

### 1. Where roles are set

Only on the person. «Διαχείριση › Χρήστες», open the row, and the side sheet («Επεξεργασία χρήστη») has «Ρόλοι» (checkboxes), «Μονάδες» (multi-select) and «Ενεργός λογαριασμός». Approvers also get a section in the same sheet, «Χώροι και ρόλοι έγκρισης», split into «Ρόλοι ανά χώρο» and «Ρόλοι ανά μονάδα».

There is no page per role for putting people into roles. The «Ρόλοι και δικαιώματα» tab is per role, but it sets what each role may do, not who holds it. So the person page and the role page never write the same rows.

Routes: PATCH /admin/users/:id carries roles, units, name, active and, optionally, approverScopes. Since 26/11/2026 the sheet has one «Αποθήκευση» and sends all of it in that one request, in one transaction, so a refusal leaves nothing half-saved. PUT /admin/users/:id/approver-scopes still works for anything that calls it, but the screen no longer does.

### 2. Where roles are shown

The users list shows roles and units. Columns: «Όνομα», «Λογαριασμός», «Ρόλοι» (one chip per role, with the role’s description as a tooltip, or «Χωρίς ρόλο»), «Μονάδες» (unit codes, or «Όλες» for roles that reach every unit), «Τελευταία σύνδεση», «Κατάσταση» («Ενεργός» / «Ανενεργός»). Filters: «Αναζήτηση», «Ρόλος», «Μονάδα», «Κατάσταση».

The list does not show approver capacities. You see those only by opening the person.

### 3. Data model

All tables are in the ecapital schema:

- app_user: id, subject (AD objectGUID, or ad:<username> before the first sign-in), username, name, email, auth_source, is_active, last_sign_in_at, created_at, updated_at.
- app_user_role: app_user_id, role. The primary key is the pair. role is the enum app_role with nine values.
- app_user_org_unit: app_user_id, org_unit_id. One unit list per person, shared by all their roles.
- org_unit is the entity (a hospital or HQ). area holds the rooms, under building and floor.
- unit_approver: org_unit_id, user_id, approval_role. Who signs a permit line for a whole unit (TECHNICAL, SAFETY, HOSPITAL_DIRECTOR, NURSING, INFECTION_CONTROL).
- area_clinical_owner: area_id, user_id, org_unit_id, approval_role. Who signs for one room (WARD_MANAGER, NURSING, INFECTION_CONTROL).
- role_permission: role, area_key, level, updated_at, updated_by. The rights matrix (see 12).
- role_mapping: an optional AD group to role (and unit) layer. It is empty, and no screen edits it.

So the role is global and the entities are ticked on the user. Each role has a scope in code (ROLE_SCOPE in packages/shared/src/roles.ts): «Διαχειριστής», «Οικονομική Διεύθυνση», «Διοίκηση» and «Ελεγκτής» reach every unit, so the unit picker closes. All the other roles need at least one unit (errors.unitRequired).

A consequence: «Χρήστης Α» can’t be «Μηχανικός έργου» in one hospital and «Κλινικός εγκριτής» in another. Both roles apply to every unit on their list. The approver tables are the only place where something is held per unit.

### 4. One holder or many

There can be many, and how a task is handed out depends on what kind of task it is:

- Shared queues (variations, payment certificates). Everyone whose role has the right level in that unit sees the item in «Εγκρίσεις». The first one to act decides it.
- Permit approval lines. unit_approver and area_clinical_owner accept several people for the same unit and capacity, but the routing (resolveApprover, now in apps/api/src/permits/approver-resolver.ts) gives each line to one person: the earliest-created appointment, skipping the requester. Nobody else sees the line, and the screen never says which holder counts as “first”. Since 26/11/2026 the routing also skips a holder whose account is switched off or who no longer holds a role that may decide the line (TECHNICAL and SAFETY: «Εγκρίνων τεχνικών και ασφάλειας», «Κλινικός εγκριτής» or «Προϊστάμενος Τεχνικών Υπηρεσιών»; every other line: «Κλινικός εγκριτής»). A second holder gets lines when the first one is the requester, switched off or without the role.

### 5. Substitutes

Not built. eCapital has no substitute per person, per role or per period. No table and no screen exist for it.

### 6. Out of office

Not built. There is no absence switch or date range. The nearest things are the administrator stepping in on a permit line that has nobody assigned (see 11), and, since 26/11/2026, switching an account off, which moves that person’s waiting permit lines to the next holder (see 8). Neither covers someone who is away for a week and coming back: switching them off also stops them signing in.

### 7. Acting through a substitute

Not built. Nothing records «Χρήστης Β, αντί για Χρήστης Α». What does exist:

- When the administrator decides an unassigned permit line, the line’s approver_id becomes the administrator. The permit page then shows the administrator’s name, with no “on behalf of”.
- Every write lands in audit_log with the actor (see 14), so you can always see who actually acted.
- Fixed on 26/11/2026: the API used to let an administrator decide a line that was assigned to someone else, and the line then kept the assigned person’s id. It now refuses that with 403 errors.permitDecisionAssignedToOther («Η γραμμή έγκρισης περιμένει άλλο πρόσωπο και την αποφασίζει εκείνο. Ως διαχειριστής αποφασίζετε μόνο γραμμή χωρίς εγκρίνοντα.»), so a decided line always names the person who decided it.

### 8. Open tasks after a change

It depends on what changed. The approver is written to permit_approval.approver_id when the permit is submitted and is not looked up again at read time.

- The holder is switched off, or loses the role the line needs (changed 26/11/2026). In the same save, every waiting line of theirs on a permit in clinical review goes to the next eligible holder, by the same routing as a submission, or to nobody if there is none. A line with nobody shows «Δεν έχει οριστεί εγκρίνων…» and the administrator decides it. Each move is a row in audit_log (the administrator as actor, old and new approver in the images) and GET /permits/:id/audit reports it as permitLineReassigned (the permit page’s own timeline does not list it). Lines the person can still decide stay with them.
- Only their «Χώροι και ρόλοι έγκρισης» change (an appointment added or removed, the role kept). New submissions only; their waiting lines stay with them. There is no reassign button.

Otherwise a line only moves when the route is rebuilt, which happens when the permit is returned («Επιστροφή με σχόλια»), corrected and submitted again. Other ways out: the Προϊστάμενος or the administrator rejects the permit, which is final, or the holder decides it.

For the shared queues in 4 there is nothing to move. The new holder sees the items once they sign in with the new role.

Scope rows are not removed when an account is switched off or loses its role: switched back on, or given the role again, the person has their appointments back. Meanwhile the routing passes them over, and the editor lists the old scopes, says they bring no lines, and lets the administrator remove them in the same save. (Before 26/11/2026 the routing did not check is_active or the current roles, so such accounts still got new lines.)

### 9. Administrator and requests

Yes. The administrator can raise a permit request, a variation, a payment certificate or a fault call, and can decide variations and certificate steps. Those rights come from the administrator’s own column in the matrix (role_permission). They are not a second role, and they can be edited like any other column, within the guardrails.

Separately, the administrator may decide a permit line that has nobody assigned, and since 26/11/2026 only such a line: one assigned to someone else is refused (see 7). That one is an identity rule in code, not a matrix cell.

An account can also hold «Διαχειριστής» together with other roles. The rights add up.

### 10. Conflict of interest

Yes, and it applies to the administrator too. The rule cannot be changed from the matrix («Ούτε η πρόσβαση ανά μονάδα ούτε ο κανόνας ότι κανείς δεν εγκρίνει κάτι που υπέβαλε ο ίδιος αλλάζουν από εδώ»).

- Variations: CHECK (decided_by <> raised_by) on variation.
- Payment certificates: CHECK (approved_by <> created_by) on payment_cert.
- Permits: enforced in the service, not by a constraint.
- At routing time, if the natural approver is the requester, eCapital looks for another holder of the same capacity anywhere in the unit (anotherHolderInUnit, unit-wide appointments first).
- If there is none, the line is left unassigned. It is never handed to the requester.
- At decision time the requester gets 409 errors.permitSelfApproval, and the permit page shows «Δεν εγκρίνετε άδεια που ζητήσατε εσείς. Αναθέστε την έγκριση σε άλλο πρόσωπο.» instead of the buttons.
- An administrator who raised the permit cannot clear its unassigned lines either.

Note that “another holder anywhere in the unit” can mean a ward manager from a different ward signing for this one.

### 11. Empty roles

No screen lists the units or capacities that have no holder, so a gap is usually found when a permit stalls. When it happens:

- The permit routes anyway. The line is saved with no approver, PENDING, and the permit stays in clinical review (blocked).
- The permit page shows, in amber: «Δεν έχει οριστεί εγκρίνων για αυτόν τον ρόλο στη μονάδα. Ο διαχειριστής αποφασίζει στη θέση του ή ορίζει εγκρίνοντα από τη Διαχείριση χρηστών.»
- The administrator’s «Εγκρίσεις» shows every unassigned line of permits they did not raise, with a similar note. That was added after the owner’s UAT on 25/11/2026, when permits sat there unseen.
- Appointing someone afterwards does not pick up the waiting line, because of 8. The administrator decides it, or the permit goes back and is submitted again.
- Since 26/11/2026 a line also lands here when its holder is switched off or loses the role and there is no other eligible holder in the unit.

A user with no role at all shows «Χωρίς ρόλο» in the list.

### 12. Rights

Rights are editable, much like eFinance. role_permission holds one level per role per area:

- 9 roles × 37 areas.
- Five levels: NONE, READ, WRITE, APPROVE, MANAGE, shown as «—», «Βλέπει», «Γράφει», «Εγκρίνει», «Πλήρης».
- The administrator edits it on «Διαχείριση › Ρόλοι και δικαιώματα».
- «Επαναφορά προεπιλογών» puts the defaults from ROLE_MATRIX (packages/shared/src/role-matrix.ts) back.
- The database policies, the API guard and the web all read the same table.

Some cells are locked: the auditor and executive never go above «Βλέπει», the administrator keeps «Πλήρης» on users, and the audit trail is read-only. A trigger (role_permission_guard) and the API (422) enforce these locks.

The list of roles is fixed in code (the app_role enum). Adding one needs a release and a migration, as ADR-0039 did on 26/11/2026.

A user can hold several roles. There is no “main” role: all count equally and the highest level wins. The one exception is that holding «Διοίκηση» or «Ελεγκτής» makes the whole account read-only.

### 13. AD accounts

There is no approval page. A sign-in goes like this (apps/api/src/auth/auth.service.ts):

- First AD sign-in: eCapital creates the app_user row with no roles and no units (unless role_mapping matches, and it is empty). The person gets in and sees nothing. The server log records it. Nothing notifies the administrator, who then finds the person in «Χρήστες» («Χωρίς ρόλο», with a «Τελευταία σύνδεση» date) and sets roles and units there.
- Pre-registration: the administrator can press «Προσθήκη» first and enter the AD account name («Λογαριασμός», e.g. user.a), the name, roles and units. On the first sign-in eCapital matches that row by username and adopts the objectGUID, so the rights work from the very first sign-in. The account name is not checked against AD at that point, so a typo just leaves a row that never signs in.
- When changes take effect: roles and units are carried in the sign-in token, so a change applies at the person’s next sign-in (sessions last 8 hours; the manual says so). Switching an account off applies at its next request. Matrix changes apply at the next request.

The administrator role itself is bootstrapped from the server CLI (grant-admin). The auditor role is given or taken only by grant-role on the server, never from the screen (errors.auditorProtected).

### 14. Audit

Yes. Database triggers write it, and the application cannot write or edit the log itself (ADR-0011).

- Tables audited: app_user, app_user_role, app_user_org_unit, role_mapping, unit_approver, area_clinical_owner, permit_approval, role_permission. app_user_password is audited too, with the hash removed.
- Fields in audit_log: actor_id (the signed-in subject, or cli:<os user> for the server commands), entity_type (table name), entity_id, action (INSERT/UPDATE/DELETE), before and after (the whole row as JSON), at, ip, org_unit_id. Updates that change nothing are skipped.

Things to know:

- Saving a person rewrites their role and unit rows: it deletes all of them and inserts them again. So the log shows a DELETE and an INSERT per role even when nothing changed. Approver scopes were saved the same way until 26/11/2026; they are now written row by row, so the log shows only the scopes added or removed, and a kept appointment keeps its place in the earliest-first order.
- app_user_role has no id column, so its log rows have an empty entity_id. You find a person’s role history by the app_user_id inside before/after.
- There is no screen for the full log. GET /audit-log (administrator and auditor) is API only. Individual records (projects, permits and so on) show their own history, but the user sheet does not.

### 15. What we would change

These are eCapital’s own known weak points. Most came out of this week’s UAT.

- Approver capacities were tied to the clinical approver role until 26/11/2026. To sign the «Τεχνικές Υπηρεσίες» line for a unit, an estates officer had to be made «Κλινικός εγκριτής», which also let them sign the clinical lines. ADR-0039 added «Εγκρίνων τεχνικών και ασφάλειας». Old appointments still work through a fallback until the administrator moves them. Lesson: decide which role may hold which per-entity appointment before go-live.
- Closing a permit needed a signature nobody could reach from the screen. The API wants a clinical acceptance from someone holding «Προϊστάμενος θαλάμου», «Νοσηλευτική υπηρεσία» or «Έλεγχος λοιμώξεων» for the permit’s rooms or unit. The screen showed «Κλείσιμο» only to the engineer, the Προϊστάμενος and the administrator. With one role per account, nobody could close a permit. This is being changed now to a two-step handback and is not released yet.
- Matrix and screens disagree in places (UAT workbook, «Παραδοχές»):
- The engineer has «Βλέπει» on «Μητρώο αναδόχων», but the page opens only with «Πλήρης».
- The technician has «Γράφει» on «Ελλείψεις», but no screen lets them add one.
- Finance has «Εγκρίνει» on the approved budget, but no «Επεξεργασία» button.
- Lesson: if rights are editable, build every screen off the same table, and test each cell against a screen.
- The approver is frozen on the line at submission. Fixed in part on 26/11/2026: the routing now skips switched-off accounts and accounts without the role, and switching someone off or taking the role away moves their waiting lines to the next holder (see 8). Still missing: a holder who is only away, and a change of appointments alone, move nothing. eHire already has the substitute idea, so keep it.
- “First appointed wins” is invisible. Several people can hold the same capacity in a unit, but only the earliest one gets lines, and no screen says so. Either allow one holder plus a named substitute (as eHire does) or show the order.
- Two saves on one sheet. Fixed on 26/11/2026. Approver capacities used to save with their own button and were checked against the saved roles, so “tick the role and add the capacity in one go” gave an error («Δώστε πρώτα τον ρόλο και μετά τις αρμοδιότητες»). The sheet now has one «Αποθήκευση», one request and one transaction, checked against the ticked roles. Capacities still appear only after the account exists.
- There is no “who approves what in unit X” view and no list of empty capacities. The person view is good. The by-unit view eHire already has is the thing we lack.
- Two different moments when a change applies: roles at the next sign-in, the matrix at the next request. People ask “I gave them the role, why can’t they see it?”

## What eCapital does that eHire may want to copy / avoid

Copy - One person page that shows and edits roles, units, account on/off and approver appointments, plus a users list with «Ρόλοι» and «Μονάδες» columns and filters by role and unit. - A role catalogue in code that says whether a role is per unit or all units, so the screen opens or closes the unit picker by itself. - The four guard rules with plain sentences: no self-lockout, keep one active administrator, auditor set only from the server, unit roles need a unit. - Pre-registering an AD account by its account name, so rights work from the first sign-in. - The requester-never-decides rule, enforced in the routing and again at decision time, for the administrator too. - An unassigned task shown to the administrator with a sentence saying why, instead of sitting silently. - Audit by database trigger, with before/after images.

Avoid - Resolving the approver once and never again with no reassign path. Either resolve at read time or add a reassign action on holder change. (eCapital now moves the lines when a holder is switched off or loses the role, but not on any other change.) - Letting several holders exist when only the first one is used. - Routing to switched-off accounts or to accounts that lost the role. (eCapital did this until 26/11/2026.) - Separate save buttons for parts of the same person. (eCapital had two until 26/11/2026.) - An editable rights matrix that the screens don’t fully follow. - Delete-and-reinsert saves that fill the audit log with no-change pairs.
