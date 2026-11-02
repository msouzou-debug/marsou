# The 19 words to check against eFinance's en.json

`translations/en.json` is one global dictionary keyed on the Greek string, so a short
common word is shared with the rest of eFinance. Three collisions have already been
found this way: «Κωδικός» means Password there, «Εισαγωγή» means Import, and «Γραμμή»
means Row in the board pack rather than an invoice line. Those were caught before
merging and lengthened on our side.

These 19 are the ΤΑΕΠ keys short enough to be at risk. The list is "short enough to
collide", not "known to collide" — the check is a grep against the live file, which
cannot be read from the repository side.

For each: if the key already exists in en.json with the same meaning, drop ours. If it
exists with a different meaning, tell us and we lengthen the Greek on our side rather
than overwrite yours.

| Greek | Our English | Where it shows |
|---|---|---|
| Άλλο | Other | identification and sex dropdowns |
| Άρρεν | Male | sex dropdown |
| Ώρες | Hours | costing |
| Ακυρωμένο | Cancelled | status, all three screens |
| Αναθεώρηση | Revision | costing |
| ΔΕΑ | Alien Registration Certificate | identification dropdown |
| Διάγνωση | Diagnosis | costing, entry |
| Διαβατήριο | Passport | identification dropdown |
| Διαγραφή | Delete | costing |
| Εμφάνιση | Show | rates |
| Θήλυ | Female | sex dropdown |
| Κλιμάκιο | Tier | extra-charges diff |
| Νοσηλευτήριο | Hospital | entries list |
| Ομάδα | Group | extra-charges diff |
| Ποσότητα | Quantity | costing |
| Πρόχειρο | Draft | status, all three screens |
| Σήμερα | Today | rates |
| Ταυτότητα | ID card | identification dropdown |
| Υπολογισμένο | Calculated | status, all three screens |

## The four worth checking first

«Ομάδα», «Ποσότητα», «Διαγραφή» and «Εμφάνιση» are ordinary finance words that eFinance
very likely already uses. If «Ομάδα» is a user group there rather than a tariff group,
our column header reads wrong.

## Two more, added 02/11/2026

The ICD-10 field was rebuilt as a search box plus a dropdown, which brought two new
short keys. **Not yet checked against en.json:**

| Greek | Our English | Where it shows |
|---|---|---|
| Καθαρισμός | Clear | the button that empties the diagnosis search |
| αποτελέσματα | results | the count under that search box |

«Καθαρισμός» is the one to look at. eFinance may well use it for clearing a filter or a
form elsewhere, which would be the same meaning and fine — but if it means something
narrower there, say so and we lengthen ours.

`tools/build_translations.py` now lists only keys added since the last check, so this
section is what its report prints. Add them to the `CHECKED` set in that file once they
are confirmed.

## Answered, 30/10/2026

**All 19 checked against the live `en.json` — no collisions.** Nothing here needs
changing on our side; the keys can be merged as they stand.

**ΔΕΑ = Δελτίο Εγγραφής Αλλοδαπού**, confirmed. "Alien Registration Certificate" is the
Civil Registry and Migration Department's own English, so the value stands. It is no
longer flagged for Μονάδα review.

One left open, and it is a preference rather than a fault: **Ταυτότητα** is "ID card"
here. If eFinance renders it "Identity card" or "ID" elsewhere, match that instead, so
the same document is not called two things in one application.

## Why ten of them appeared only now

Ten are rendered through a Jinja filter or a loop variable — `t(episode.status |
status_el)`, `t(option)` — rather than `t('literal')`, so `tools/build_translations.py`
could not see them by scanning the templates and nobody noticed they had no English.
They are in the `RUNTIME` set there now, which keeps them out of the "no template uses
this" list and puts them into this one.

The full handover file is `docs/taep-translations-en.json`, 267 strings.
