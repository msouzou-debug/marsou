# Deployment runbook — ΤΑΕΠ costing module

For Τμήμα Πληροφορικής. Installs `taep.py` into eFinance, hospital by hospital.

Everything here assumes the ADR-001 stack: Flask, Gunicorn, MySQL in production,
`/opt/finance`, `finance.service`. Check `docs/adr/001-application-stack.md` first if
any of that has changed.

---

## Before you touch the server

**Never run eFinance's `deploy.sh`.** It does `cp -r . /opt/finance/` and will overwrite
the live `finance.db` and `settings.json`. It is a first-install script. eFinance's own
`CLAUDE.md` says this in its first five lines; it applies to us too. Deployment is
file by file.

Take a database backup. The module only adds tables, but a backup you did not take is
the one you will want.

---

## 1. Files to copy

Into `/opt/finance/`:

```
taep.py
templates/taep_new.html
templates/taep_costing.html
templates/taep_list.html
templates/taep_rates.html
templates/taep_rate_history.html
templates/taep_tariff.html
templates/taep_tariff_diff.html
templates/taep_readiness.html
seed/                       (the whole directory, including seed/source/)
tools/check_readiness.py    (the go-live check — see §6)
```

`seed/` must travel with the module: `seed(ctx)` reads the CSVs at boot. The files under
`seed/source/` are the authoritative workbooks and the generators in `tools/` read them;
they are not needed at runtime but belong with the code.

`check_readiness.py` is self-contained: it imports `taep.py` and nothing else from the
repository, so it runs wherever you put it. The other scripts in `tools/` are generators
for the documents and the seed files — they belong on a workstation, not the server.

No new Python packages are needed. Everything the module imports at runtime —
`flask`, `openpyxl`, `reportlab` — is already in eFinance's `requirements.txt`.

Do **not** copy `conftest.py`, `taep_harness.py`, `test_*.py`, `acceptance.py` or the rest
of `tools/` onto the production server. They are the test and build side.

## 2. Register the module

In `/opt/finance/app.py`, add `"taep"` to the `_MODULES` loop (at the time of writing,
`app.py:1363`):

```python
for _mod_name in ("boardpack", "vendors", "invoices", "requisitions",
                  "manual", "masterdata", "taep"):
```

`bankrec` and `oayrecon` were taken out of that list on 31/07/2026 — their tables are
still there. Do not add them back while adding ours.

The contract in eFinance's `DESIGN.md` does the rest: `SCHEMA_STATEMENTS` and
`ALTER_STATEMENTS` run under the `init_db` lock (`app.py:1453`), then `seed(ctx)`, then
`register(app, ctx)` (`app.py:4283`).

## 3. Add the permission keys

eFinance's `PERMISSIONS_CATALOG` (`app.py:718`) is a dict of category → list of
`(key, label)` tuples, so add a block rather than merging a dict. The labels are the ones
in `taep.PERMISSIONS_CATALOG_EL`:

```python
    "Κοστολόγηση ΤΑΕΠ": [
        ("taep.create", "ΤΑΕΠ — καταχώρηση και κοστολόγηση"),
        ("taep.finalise", "ΤΑΕΠ — οριστικοποίηση και εκτύπωση"),
        ("taep.cancel", "ΤΑΕΠ — ακύρωση κοστολόγησης"),
        ("taep.rates", "ΤΑΕΠ — διαχείριση τιμών και τιμοκαταλόγου"),
        ("taep.admin", "ΤΑΕΠ — διαχείριση συστήματος"),
    ],
```

Until they are there, a user without the key is flashed «Δεν έχετε δικαίωμα πρόσβασης.»
and redirected to the dashboard (`app.py:897`) — not a 403, and it looks like a broken
install rather than a permission the Μονάδα has not granted yet.

**Adding the keys to the catalogue is not a neutral act.** `_MODULE_KEYS` (`app.py:770`)
is computed from `PERMISSIONS_CATALOG`, and `DEFAULT_ROLE_PERMISSIONS` (`app.py:772`)
hands that whole list to `cfo` and `tester`. Both are `CENTRAL_ROLES`, so both would hold
`taep.create` across every hospital the moment the keys exist. The defaults apply only
where `perms_configured = 0` for that role (`app.py:856`), so check that column on this
installation before adding the keys.

**`admin` bypasses the check entirely** — `has_permission` returns `True` for the role
without consulting anything (`app.py:882`). An admin can therefore reach every screen and
issue a real costing number before the Μονάδα has granted anybody access. Numbers are
gapless and never reissued, so treat that as a reason to finish the readiness check
before anyone logs in, not as a convenience.

The brief's role names (`hospital_admin`, `rates_admin`, `system_admin`) do not exist in
eFinance. Its `ROLES` are `admin`, `clerk`, `accountant`, `chief_accountant`, `cfo`,
`group_cfo`, `ceo`, `board_viewer`, `cc_manager`, `fpa`, `vendor_master`, `viewer`,
`tester`. A mapping onto those, **for the Μονάδα to confirm — it is their decision, not
ours**:

| Key | Suggested role |
|---|---|
| `taep.create` | `clerk` |
| `taep.finalise` | `clerk` |
| `taep.cancel` | `admin` |
| `taep.rates` | `chief_accountant` |
| `taep.admin` | `admin` |

One warning on role choice: eFinance's `CENTRAL_ROLES` (`admin`, `chief_accountant`,
`cfo`, `group_cfo`, `ceo`, `board_viewer`, `fpa`, `tester`) see **every** entity. Granting
`taep.create` to any of them breaks the brief's rule that a Limassol clerk must never see
a Nicosia episode. `clerk` is not central, which is why it is the right home for the
costing permissions.

## 3a. The sidebar entry

Registering routes adds nothing to the menu. Every nav entry is a literal block in
`templates/base.html` gated by `has_permission(...)`, so a clerk has no way to reach
`/taep/nea` except by typing it.

For testing, leave `base.html` alone and type the URL. For rollout it needs a block gated
on `taep.create`, placed by whoever owns eFinance's templates.

`current_area()` (`app.py:2420`) returns `""` for a `/taep/` path because the prefix is
not in `AREAS`, so the sidebar renders with no area highlighted. Cosmetic; nothing breaks.
Our templates use only the `title` and `content` blocks, both of which eFinance's
`base.html` defines.

## 4. Check the hospital entities

The module keys episodes on eFinance's `entities.code`. `seed/taep_units.csv` maps each
ΤΑΕΠ unit to a host entity: NGH, LGH, LAR, PAP, FAM, CHR, TRD. If any of those codes
differ on this installation, fix the CSV before the first boot — not afterwards, because
episodes will already be keyed on the wrong code.

Μακάριος ΙΙΙ (ARC) deliberately hosts no unit yet. The paediatric unit moves there later;
see §7.

## 5. Restart and watch the log

```
sudo systemctl restart finance
sudo journalctl -u finance -n 50
```

Expect `Module «taep»: routes καταχωρήθηκαν`. If a module fails to register, eFinance
logs it and keeps running — so a silent absence of that line is the failure mode to look
for, not a crash.

## 6. Run the readiness check

```
cd /opt/finance
python3 check_readiness.py                                  # reads settings.json
FINANCE_DB=/opt/finance/finance.db python3 check_readiness.py   # or name the SQLite file
```

It resolves the database the same way eFinance does: `settings.json` with a `db_host`
means MySQL, otherwise the local `finance.db`. Or open `/taep/readiness` as a
system_admin. It exits non-zero on any blocker, so it can
gate a deploy script.

It checks this installation, not the code: that the tables exist, the master data loaded
at the expected counts, the weight matrix in the database still matches the algorithm,
every weight has an amount in force, no registration fee is unconfirmed, no rate periods
overlap, each unit has a unique number, no costing-number sequence has a gap, and no
episode is finalised without a number or holding one without being finalised.

**Do not let a clerk near it until this is clean.** An unconfirmed registration fee is a
blocker because the costings for that category will refuse to finalise, and a clerk
discovering that with a patient at the desk is the worst place to discover it.

## 7. Per-unit rollout

Eight units across seven hospitals:

| Number | Unit | Entity |
|---|---|---|
| 1054 | Γενικό Νοσοκομείο Λευκωσίας — ΤΑΕΠ ενηλίκων | NGH |
| 1106 | ΤΑΕΠ Παίδων Λευκωσίας | NGH (moves to ARC) |
| 1047 | Γενικό Νοσοκομείο Λεμεσού | LGH |
| 1048 | Γενικό Νοσοκομείο Λάρνακας | LAR |
| 1025 | Γενικό Νοσοκομείο Πάφου | PAP |
| 1049 | Γενικό Νοσοκομείο Αμμοχώστου | FAM |
| 1055 | Νοσοκομείο Τροόδους | TRD |
| 1026 | Νοσοκομείο Πόλης Χρυσοχού | CHR |

Each unit keeps its own gapless costing-number sequence. Nicosia General runs two, so
its clerks pick the unit on the entry screen.

**Start with one unit.** The brief requires a two-week parallel run against the current
manual pricing on every episode, with every difference investigated. The tool is not
right by default. Only widen once a fortnight has produced no unexplained difference.

**The paediatric relocation** is a data change, not a release. When ΤΑΕΠ Παίδων moves to
Μακάριος ΙΙΙ, close the current row and open a new one:

```sql
UPDATE taep_unit SET host_valid_to = '<the day before the move>'
 WHERE unit_code = 'NIC-PAED' AND host_valid_to IS NULL;

INSERT INTO taep_unit (unit_code, name_el, taep_number, host_entity_code,
                       host_valid_from, active)
VALUES ('NIC-PAED', 'ΤΑΕΠ Παίδων Λευκωσίας', '1106', 'ARC', '<the move date>', 1);
```

The number and the sequence are untouched — confirmed by the Μονάδα on 05/10/2026. Run
the readiness check afterwards.

## 8. Changing a rate

Through `/taep/rates`, never with SQL. The screen closes the current period and opens the
next, records who and from which document, and refuses to backdate into a closed period.

A direct `UPDATE` on `taep_rate` rewrites history and will make a past costing
irreproducible. MySQL cannot stop you — PostgreSQL's exclusion constraint does not exist
there, which is why `verify_rate_periods()` exists and why the rate screen shows its
findings at the top.

## 9. Rollback

The module adds tables and touches none of eFinance's own. To back it out:

1. Remove `taep` from the module list in `app.py`.
2. Restart.

Leave the tables. They hold issued costing numbers, and a number must never be reissued
even after a withdrawal and reinstall.

---

## What to watch in the first weeks

- `/taep/readiness` after every rate change and every unit added.
- The audit log for `FINALISED` entries without a matching `CALCULATED`.
- Clerks reporting that a calculation "disappeared" — that is the staleness rule working
  as designed, not a fault: changing a service after calculating deletes the result so a
  stale number cannot be shown.
- Any costing that refuses to finalise. The message names what is missing, and the answer
  is almost always a rate nobody has set yet.
