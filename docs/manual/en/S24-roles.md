# Roles and permissions

This screen shows, in one table, what each of the eight roles sees and does in each part of eCapital, and that table is the rule the system applies. The system administrator, who changes the levels, and the head of estates, who gets asked what a role includes, can open it.

## Steps

1. Open «Διαχείριση» and choose the «Ρόλοι και δικαιώματα» tab, the second one after «Χρήστες».
2. Read the key above the table. Each cell holds one of five levels: «Πλήρης» (full control, settings included), «Εγκρίνει» (decides), «Γράφει» (creates and changes), «Βλέπει» (reads only) and «—» (the area is not shown).
3. Find the row you need. Rows are grouped the way the menu is: portfolio, projects, contracts, cost, shutdowns and permits, assets, maintenance, reports, administration, audit trail.
4. The first row, «Μονάδες», says whether the role sees only its own units or all of them.
5. Select a role's name in the header to highlight its column. Select it again to clear the highlight. Hover over the short name to see the full one.
6. Under the table, «Τι δεν αλλάζει από τον πίνακα» lists the limits nobody changes, and «Σημειώσεις ανά ρόλο» says what a cell cannot, for example that nobody approves what they submitted themselves.
7. For paper or a PDF, press «Εκτύπωση / PDF». The table prints landscape on A4, with the key.

On a phone, and on a tablet narrower than 1024 px, the table becomes one card per role, listing each area and the role's level in it. The areas the role cannot see are listed together at the end of the card.

## Changing a level (administrator)

1. On a desktop, or a tablet 1024 px wide or more, every cell that can change is a list. Open the list in the cell for the role and the row, and pick the new level. A changed cell has a heavy border.
2. Change as many cells as you need. A bar at the bottom counts the changes not yet saved.
3. Press «Αποθήκευση» in the bar. «Οι αλλαγές αποθηκεύτηκαν» confirms it. «Ακύρωση» throws the changes away and leaves the table as it was.
4. To put the whole table back to its original levels, press «Επαναφορά προεπιλογών» at the top right and confirm in the dialog.

A change applies from each user's next request: when they open or reload a page they gain or lose the matching buttons, and the database applies the new level on every save. Nobody has to sign out. Every change, the reset included, is recorded in the audit trail with your name and the time, and the time of the last change shows under the introduction.

Cells with a lock have limits. Hover over the lock to see why. There are five limits and they do not change:

- the Auditor and the Executive never go above «Βλέπει»;
- the audit trail is only ever read;
- the Administrator always sees every area;
- the Administrator always keeps full control of users, so nobody is locked out;
- only the Administrator manages users, roles and this table.

The table does not change access by unit, nor the rule that nobody approves what they submitted themselves. A person's roles are changed on the «Χρήστες» tab. The notes per role describe the defaults.

## What can go wrong

- **"You do not have access to this page".** Only the system administrator and the head of estates can open it. The head of estates sees the table without lists, read only.
- **The save is refused: the role cannot take that level.** The level breaks one of the five limits. The message names the row; pick one of the levels the list offers.
- **Somebody does not see the change yet.** Ask them to reload the page. Where the system runs on more than one server, the change reaches all of them within half a minute.
- **Somebody holds two roles and you do not know which column applies.** Roles add up: they get the highest level any of them gives. But if one of the two is Executive or Auditor, the account changes nothing.
- **The table says «Γράφει» but the person is told they may not.** Check that the record belongs to one of their units, and that they are not trying to approve something they submitted themselves. A handover defect also needs «Γράφει» on «Στοιχεία σύμβασης».
- **The printout comes out portrait.** Choose landscape in the browser's print dialog.
