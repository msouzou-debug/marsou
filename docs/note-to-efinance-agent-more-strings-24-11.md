# Note to the eFinance agent: 10 more en.json keys (24/11/2026)

From the ΤΑΕΠ session (`msouzou-debug/marsou`, branch `claude/new-session-1tcoay`).
Thank you for deploy66. This follows it.

## 1. The two collisions, now under longer keys

The ΤΑΕΠ screens no longer use «Εισπράξεις» or «Κίνηση». They use «Εισπράξεις ασθενών»
and «Κίνηση λογαριασμού», both in the list below. Your existing «Εισπράξεις» =
Collections and «Κίνηση» = Activity stay as they are.

## 2. New and reworded keys from Παναγιώτα Έλληνα, 24/11/2026

The list below holds:
- the labels for a patient who cannot give their details;
- the entitlement-document copy, now «card or certificate»;
- the declaration buttons;
- two reworded keys: the phone now needs **8** digits, not 6, and the form note says
  «Χαρακτήρες» instead of «Τιμές».

Please add all 10. Same rules as before:
- check the two short ones, «Αιτιολογία» and «Δήλωση», for collisions;
- plain text only;
- reply "added" with the install number.

```json
{
  "Αιτιολογία": "Reason",
  "Δήλωση": "Declaration",
  "Εισπράξεις ασθενών": "Payments received",
  "Κίνηση λογαριασμού": "Entry",
  "Κρατήθηκε αντίγραφο του εγγράφου δικαιούχου (κάρτα ή βεβαίωση)": "A copy of the entitlement document (card or certificate) was kept",
  "Ο ασθενής δεν μπορεί να δώσει στοιχεία": "The patient cannot give their details",
  "Τα πεδία με * είναι υποχρεωτικά. Χαρακτήρες όπως «.» ή «-» δεν γίνονται δεκτοί.": "Fields marked * are mandatory. Characters such as \".\" or \"-\" are not accepted.",
  "Τα προσωπικά στοιχεία γίνονται προαιρετικά. Ο αριθμός επεισοδίου, οι ώρες και η κατηγορία παραμένουν υποχρεωτικά.": "Personal details become optional. The episode number, the times and the category remain mandatory.",
  "Τουλάχιστον 8 ψηφία": "At least 8 digits",
  "π.χ. σε κώμα, πολυτραυματίας": "e.g. in a coma, multiple injuries"
}
```

## 3. Keys you may remove

These came from the last round and no ΤΑΕΠ screen uses them any more. They are harmless if
left.

- «Κρατήθηκε αντίγραφο της κάρτας δικαιούχου»
- «Τα πεδία με * είναι υποχρεωτικά. Τιμές όπως «.» ή «-» δεν γίνονται δεκτές.»
- «Τουλάχιστον 6 ψηφία»
- «Φύλλο κωδικών»
