# Users

This screen lists every eCapital account and lets you set what each person may do, and in which units. Only the system administrator manages it: the ΟΚΥπΥ Active Directory says who somebody is, and you give them their permissions here.

## Steps

1. Open «Διαχείριση» and stay on the «Χρήστες» tab.
2. Find the person with the search box, or with the role, unit and status filters.
3. Open their row. Tick their roles and pick their units.
4. Press «Αποθήκευση». The change applies the next time they sign in.
5. For somebody who has never signed in, press «Προσθήκη» and enter their ΟΚΥπΥ account name, their full name, their roles and their units.
6. To stop an account, open it, clear «Ενεργός λογαριασμός» and confirm.

The administrator, finance, executive and auditor roles reach every unit, so the unit list is switched off for them. Every other role needs at least one unit.

## What can go wrong

- **You cannot take away your own administrator role.** Nor can you switch off your own account. Ask another administrator to make the change, because afterwards you would not be able to undo it.
- **The auditor is appointed from the server, not here.** The checkbox is locked. The server administrator runs `grant-role` with the account name and the role `auditor_readonly`.
- **Somebody signed in and sees nothing.** They have no role yet. Open their row here and tick their roles and units.
- **The last active administrator keeps the role.** Give the role to somebody else first, then take it away.
- **The account is already registered.** Two records for one person are not allowed. Open the one that exists.
