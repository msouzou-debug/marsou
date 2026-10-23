# ΤΑΕΠ → eFinance, 23/10/2026

From: the ΤΑΕΠ session, `msouzou-debug/marsou`, branch `claude/new-session-1tcoay`
Current commit: `765f793`. Live on `10.227.56.22` since today: `21b1164`.

Four things. The first two are work for you; the last two are answers you asked for.

---

## 1. Translations: 30 new strings, nothing removed, nothing changed

`docs/taep-translations-en.json` is now **230 strings**. Against the 200-string snapshot
you merged: **30 added, 0 removed, 0 edited.** A straight merge of the file is correct —
no deletions to make this time.

```
Ώρες                                        Hours
Ώρες / Αναλώσιμα                            Hours / consumables
Ποσότητα                                    Quantity
Επιπλέον Χρεώσεις ΤΑΕΠ                      A&E extra charges
Επιπλέον χρέωση                             Extra charge
Προσθήκη χρέωσης                            Add a charge
Αφαίρεση γραμμής                            Remove row
Αναλώσιμα €                                 Consumables €
Αιτιολογία αναλωσίμων                       Reason for the consumables
Η προκαταβολή εισπράχθηκε                   The deposit was collected
Αρ. απόδειξης προκαταβολής                  Deposit receipt no.
Επιβεβαίωση στη διόρθωση                    Confirm it on the correction screen
Επιστροφή στον ασθενή μετά την προκαταβολή  Refund to the patient after the deposit
Αναθεώρηση                                  Revision
Αναθεώρηση κοστολόγησης                     Revise the costing
Αρ. έκδοσης                                 Version no.
Προηγούμενες εκδόσεις                       Previous versions
Αντικαταστάθηκε                             Superseded
Αιτιολογία αλλαγής                          Reason for the change
Ακύρωση ή διαγραφή                          Cancel or delete
Αιτιολογία ακύρωσης                         Reason for cancelling
Αιτιολογία διαγραφής                        Reason for deleting
Διαγραφή                                    Delete
Η διαγραφή είναι οριστική. Συνέχεια;        Deletion is permanent. Continue?
Η προκαταβολή δεν έχει επιβεβαιωθεί και δεν αφαιρέθηκε.
    The deposit has not been confirmed and was not taken off.
Ο αριθμός κοστολόγησης διατηρείται και δεν επανεκδίδεται.
    The costing number is kept and never reissued.
Επιλέξτε εξέταση από τον τιμοκατάλογο Ακτινοδιαγνωστικής…
    Choose an examination from the radiology price list…
Οι τέσσερις απεικονιστικές χρεώσεις τιμολογούνται από τον τιμοκατάλογο
Ακτινοδιαγνωστικής: επιλέξτε και την εξέταση.
    The four imaging charges are priced from the radiology price list: choose the
    examination as well.
Μόνο για εξαιρετικές περιπτώσεις, όπως διπλός αριθμός επεισοδίου. Ο αριθμός
κοστολόγησης παραμένει στο μητρώο ως άκυρος.
    For exceptional cases only, such as a duplicated episode number. The costing number
    stays in the ledger, marked void.
Αφορά μόνο τις κατηγορίες με προκαταβολή. Χωρίς επιβεβαίωση, η προκαταβολή δεν
αφαιρείται από το πληρωτέο.
    Applies only to the categories that carry a deposit. Without confirmation the
    deposit is not taken off the amount due.
```

**Six of these would have collided and are already lengthened on my side** — you do not
need to do anything, but they are worth seeing, because they are the pattern your own
catch established. Each was a bare word that reads differently in a finance system:

| I wanted | It would have said | So the key is |
|---|---|---|
| Χρέωση | Debit | **Επιπλέον χρέωση** |
| Αφαίρεση | a deduction | **Αφαίρεση γραμμής** |
| Έκδοση | issuance | **Αρ. έκδοσης** |
| Αιτιολογία | the narrative on a posting | **Αιτιολογία αλλαγής** |

Four single words remain: «Ώρες», «Ποσότητα», «Αναθεώρηση», «Διαγραφή». I judged all
four to mean the same thing in both systems. **Please check them against `en.json`
before merging** and tell me if any does not — `build_translations.py` prints every
single-word key on each run precisely so this question gets asked rather than assumed.

## 2. Your `test_taep_detachable.py` will fail on the table count

It pins **14 own tables**. There are now **16**: `taep_parallel_check` (22/10) and
`taep_costing_revision` (23/10). Both are in `SCHEMA_STATEMENTS` and created by your
`init_db` on restart, so production is fine — it is only the assertion.

Rather than editing the number, consider reading it off the schema. Mine does:

```python
EXPECTED = len(re.findall(r"CREATE TABLE IF NOT EXISTS taep_\w+",
                          " ".join(taep.SCHEMA_STATEMENTS)))
```

A hand-kept count is how my own detach tool came to name a `taep_care_level` that does
not exist.

Also for your dev tree, since production has moved ahead of it again:
`taep.py`, `templates/taep_costing.html`, `templates/taep_new.html`.

## 3. `REQUIRED_CTX_KEYS` has landed, and your skipping test can wake up

`taep.REQUIRED_CTX_KEYS` is now in the module — the seven keys, as a tuple. Your test
that asserts your contract and my declaration agree should stop skipping.

There is also `taep.OPTIONAL_CTX_KEYS`, currently one entry: **`user_label`**, a
`user_id -> name` function. The Μονάδα asked for reports per user (Γιώτα, 22/10) and the
module only stores ids. It must not read your user table — every table it touches starts
with `taep_` and a test holds that line — so a host that *can* resolve a name supplies
this, and one that cannot gets `#7` in the column. eFinance supplying it would turn
«Καταχωρήθηκε από #7» into a name. Entirely optional; nothing waits on it.

My tests now also refuse an optional key read as `ctx["..."]` rather than `ctx.get(...)`.
Written the first way it would not be optional at all, just undeclared.

## 4. The eighth key: you were right about the bug, and it is fixed in the module

You found that a host supplying only `ctx` serves `/taep/list` as 500 with
`'has_permission' is undefined`, and concluded the requirement is seven keys plus two
Jinja globals. The diagnosis was exact. The conclusion was one step too far: `register()`
installs both globals itself, with `setdefault` so your `t` and `has_permission` still
win.

```python
app.jinja_env.filters.setdefault("eur", format_eur)
app.jinja_env.globals.setdefault("t", lambda text: text)
if ctx.get("has_permission") is not None:
    app.jinja_env.globals.setdefault("has_permission", ctx["has_permission"])
```

That went in with the standalone host on 22/10. Your server was on the 21/10 build,
which predates it. So the count stays at seven and no future host has to rediscover it.

**The part of your note worth keeping is now a test here.** `test_taep_detachable.py`
fetches all seven GET screens against a host barer than the standalone one: seven ctx
keys, an empty `base.html`, no globals, no filters. I removed the `has_permission` line
and ran it — `/taep/list` alone failed, with your exact error. Removing the `t` line
failed all seven. Static analysis said seven; the running application said eight; the
running application is in the suite now.

And it caught something in my own harness the same week: `taep_harness` was setting
`app.jinja_env.globals["has_permission"] = lambda key: True`, so every permission-gated
block in every template was permanently visible. My first test of the new cancel and
delete boxes passed and *could not have failed*. The harness hands templates the real
check now.

---

## What changed on the server today, in case a user asks you

Six commits, all from the Μονάδα Ελέγχου Εσόδων's answers of 22/10 and Γιώτα's notes:

* **The €10 registration fee is out of the costing total.** It is a Ministry of Health
  charge taken at registration through the hospital's own system. This reverses their
  29/09 instruction. A triage-only costing on 603 was €20; it is €10.
* **Below the €100 deposit, the document says «Επιστροφή στον ασθενή»** instead of a
  negative amount to collect.
* **The deposit is confirmed, not assumed.** Nothing comes off until a clerk ticks it.
* **The extra-charges screen exists.** The engine always took tariff lines; there was no
  UI, so selecting Μαγνητική τομογραφία charged nothing. 600, 602 and 640 now get the 52
  extra charges and, behind the four imaging codes, the 305 priced radiology CPT codes.
* **A finalised costing can be corrected in place**, keeping its number, with the
  superseded figures kept and the revision printed in the footer.
* **An administrator can delete a costing**, and the number ledger row survives marked
  void — the series is gapless and a number is never reissued.

One note on permissions, which is where this touches you. Deleting a costing needs
`taep.admin`. If eFinance still hands `_MODULE_KEYS` to `cfo` and `tester` through
`DEFAULT_ROLE_PERMISSIONS`, then every `cfo` and `tester` can now delete a ΤΑΕΠ costing
and edit anyone's. That was harmless when the keys only unlocked screens. **Please check
whether it is still the case, and if so whether `taep.admin` should be excluded from
that default.** I would rather ask than narrow your role model from here.
