# Users

This screen lists every eCapital account and lets you set what each person may do, and in which units. Only the system administrator manages it: the ΟΚΥπΥ Active Directory says who somebody is, and you give them their permissions here.

## Steps

1. Open «Διαχείριση» and stay on the «Χρήστες» tab.
2. Find the person with the search box, or with the role, unit and status filters.
3. Open their row. Tick their roles and pick their units. Under each role, one line says what it gives; the «Τι βλέπει κάθε ρόλος» link opens the full «Ρόλοι και δικαιώματα» table in a new tab.
4. For a work permit approver, add the areas and units they approve for under «Χώροι και ρόλοι έγκρισης». The section offers what the roles ticked on the sheet allow, even before they are saved.
5. Press «Αποθήκευση». Roles, units, account status and approver scopes are saved together; if anything is refused, nothing is saved. A change of roles applies the next time they sign in.
6. For somebody who has never signed in, press «Προσθήκη» and enter their ΟΚΥπΥ account name, their full name, their roles and their units.
7. To stop an account, open it, clear «Ενεργός λογαριασμός» and confirm. The approval lines waiting on them move at once to the next approver in the unit, or wait with no approver if there is nobody else. The same happens when you take away the role a line needs. Their scopes stay saved, so they count again if the account is switched back on or gets the role back.
8. While the server works with eCapital passwords (the transitional setting, before Active Directory), open the account and, under «Κωδικός eCapital», type a password of at least 8 characters and press «Ορισμός κωδικού». Hand it to the person in person or by phone. A change of password is done the same way. The block is not shown when sign-in goes through Active Directory.

The administrator, finance, executive and auditor roles reach every unit, so the unit list is switched off for them. Every other role needs at least one unit.

## What can go wrong

- **You cannot take away your own administrator role.** Nor can you switch off your own account. Ask another administrator to make the change, because afterwards you would not be able to undo it.
- **The auditor is appointed from the server, not here.** The checkbox is locked. The server administrator runs `grant-role` with the account name and the role `auditor_readonly`.
- **Somebody signed in and sees nothing.** They have no role yet. Open their row here and tick their roles and units.
- **The last active administrator keeps the role.** Give the role to somebody else first, then take it away.
- **The save is refused over an approver scope.** The roles you ticked do not allow the scope you added. Tick the role on the same sheet and press «Αποθήκευση» again.
- **The account is already registered.** Two records for one person are not allowed. Open the one that exists.
