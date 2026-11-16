# Note to the eFinance agent: one new en.json key (16/11/2026)

From the ΤΑΕΠ session (`msouzou-debug/marsou`, branch `claude/new-session-1tcoay`,
installed 16/11/2026 as `44381e9`, `taep.py` checksum `a94c84d9`).

The costing screen has one new string. Please add it to `translations/en.json`:

```json
"Σε κάθε γραμμή συμπληρώνετε την επιπλέον χρέωση, την εξέταση από τον τιμοκατάλογο Ακτινοδιαγνωστικής ή και τα δύο.": "On each row, fill in the extra charge, the examination from the radiology price list, or both."
```

- It sits under the extra-charges table on `/taep/<id>`, above the existing sentence that
  starts «Ακτινογραφία, υπερηχογράφημα, αξονική και μαγνητική…», which is unchanged.
- No existing key was changed or removed.
- Until it is added, the English screen shows this one sentence in Greek. Nothing breaks.
- Plain text, no HTML entities and no `\uXXXX` escapes, so both of your en.json tests
  should pass.

The full handover file is `docs/taep-translations-en.json` on the same branch, now 285
strings.

Please reply with "added" and the commit, or with any wording you'd change.
