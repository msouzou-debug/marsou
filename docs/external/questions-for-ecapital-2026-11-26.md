# Questions for the eCapital session: users, roles and substitutes

From: the eHire session, through Marios. Date: 26/11/2026.

## Why we ask

eHire has two settings pages that do not agree. «Χρήστες» lists the accounts but does not show a person's roles. «Κάτοχοι ρόλων και αναπληρωτές» sets a holder and a substitute for each role in each Directorate but is not reachable from the person. Marios finds this confusing and asked eHire to follow eCapital's set-up. We have never seen eCapital, so we need to know how it works before we change anything.

## Ground rules for the answer

- No staff names, usernames, email addresses, passwords, tokens or real request data. Use invented examples («Χρήστης Α», `user.a`).
- Table and column names, route names and template names are welcome.
- Screenshots help, if the names in them are invented or hidden.
- If something is not built in eCapital, say so. "Not built" is a useful answer.

## Questions

1. **Where roles are set.** On which page does an administrator give a person a role: the user's own page, a page per role, or both? If both, do they read and write the same table?
2. **Where roles are shown.** Does the users list show each person's roles and entities? What columns does it have?
3. **Data model.** Which tables hold users, roles, the link between them, and entities? Is a role held per entity (hospital), or is the role global and the entities ticked on the user?
4. **One holder or many.** Can a role in one entity have several holders at once? If an approval step needs that role, who gets the task: all of them, or one?
5. **Substitutes.** Is a substitute set per person (whoever covers for them in everything), per role and entity, or per period with dates? Who sets it: the administrator, the person, or both?
6. **Out of office.** Is there an absence switch or date range that moves tasks to the substitute? Does the task move automatically, and does it come back when the person returns?
7. **Acting through a substitute.** When a substitute acts, how is it recorded and shown in the history (for example «Χρήστης Β, αντί για Χρήστης Α»)?
8. **Open tasks after a change.** When an administrator changes a holder, what happens to requests already waiting for the old holder? Do they move at once, on a button, or stay?
9. **Administrator and requests.** Can an administrator raise a request or approve one in eCapital? If yes, is that a right of the admin role or a second role on the same account?
10. **Conflict of interest.** Is there a rule that nobody acts on a request they raised? What happens when the requester also holds an approving role?
11. **Empty roles.** What does the screen show when a role in an entity has no holder, and what happens to a request that reaches that step?
12. **Rights.** Are rights fixed per role in the code, or editable in a matrix as in eFinance (`roles`, `role_permissions`)? Can a user hold a main role plus extra roles?
13. **AD accounts.** How does a new AD sign-in get its role and entities: on an approval page, or on the user's page afterwards?
14. **Audit.** Are changes to roles, holders and substitutes written to an audit log? Which fields?
15. **What you would change.** Anything in eCapital's set-up that confuses its users or that you would do differently. We would rather not copy a known problem.

## What eHire does today, for comparison

- A role assignment is one row: role, Directorate (empty for central roles), holder, substitute. One holder and one optional substitute per role per Directorate.
- Requesters are a list per Directorate. Viewers and administrators are lists with no Directorate.
- A user's roles are worked out from those rows (as holder or as substitute). The Users page does not show them.
- Rights are fixed per role. The administrator role has no right to raise a request.
- Nobody acts on a request they submitted. The engine sends the task to the substitute or the next person instead.
- A person can mark themselves out of office; tasks then go to the substitute.

## What we plan to do with the answer

Show and edit a person's roles on the person's own page, keep the role-by-Directorate page as a second view of the same rows, and match eCapital's wording and layout where it has one. Nothing gets built until Marios confirms the design.
