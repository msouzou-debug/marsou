# Deployment runbook — ΤΑΕΠ costing module

For Τμήμα Πληροφορικής. Installs `taep.py` into eFinance, hospital by hospital.

Everything here assumes the ADR-001 stack: Flask, Gunicorn, MySQL in production,
`/opt/finance`, `finance.service`. Check `docs/adr/001-application-stack.md` first if
any of that has changed. Note that `10.227.56.22` runs **SQLite**, not MySQL: there is
no `db_host` in its `settings.json`, which is also why gunicorn runs one worker.

## What is live on 10.227.56.22

Checked after each install, so the next person does not have to work it out. The
checksum is `sha256sum /opt/finance/taep.py`, first 8 bytes.

| Date | Commit | `taep.py` | What went in |
|---|---|---|---|
| 21/10/2026 | `45923d9` | `bac761fb` | First install: module, area, sidebar, glyph, 125 English descriptions |
| 22/10/2026 | `a8f0581` | `01812fed` | Parallel run `/taep/parallel` |
| 23/10/2026 | `21b1164` | `2e137d2c` | The 22/10 rulings — see below |

The 23/10 install carried six commits: the registration fee out of the total, a refund
reading as a refund, the bilingual service catalogue, the weight internals off the
screen and into the export, the extra-charges and radiology screen, the deposit
confirmation, own-costings-only editing, revision of a finalised costing, and
administrator deletion.

Verified at install: 16 ΤΑΕΠ tables including `taep_costing_revision`, readiness check
clean, checksum matched. Six `ALTER` statements applied on restart and the two from
September skipped as already present — rehearsed beforehand against a copy of the live
schema, not discovered on the night.

**Outstanding from that install**, reported by `tools/pre_deploy_check.py` and left for
the Μονάδα rather than migrated: one finalised costing whose stored total still includes
€10 of registration fee, and two on category 600 whose €100 deposit is no longer netted
off because nothing has confirmed it. All four finalised costings on the server are UAT
entries from 21/10. A stored total is what the patient was handed, so nothing recomputes
on its own: revising one is a per-case decision, now possible on the screen.

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
tools/backfill_service_english.py   (only for installations seeded before 21/10 — §6a)
```

`seed/` must travel with the module: `seed(ctx)` reads these nine CSVs at boot and
nothing else — `care_levels`, `countries`, `extra_charges`, `financial_categories`,
`radiology_tariff`, `services`, `taep_units`, `tariff`, `weight_matrix`.

Copy `seed/*.csv` rather than naming them, so a file added later is not left behind —
`countries.csv` was added after the first install and had to be copied separately.

**Do not copy `seed/source/` to the server.** Those are the authoritative workbooks the
generators in `tools/` read on a workstation. Nothing opens them at runtime, and they do
not belong on a production box.

`check_readiness.py` is self-contained: it imports `taep.py` and nothing else from the
repository, so it runs wherever you put it. The other scripts in `tools/` are generators
for the documents and the seed files — they belong on a workstation, not the server.

No new Python packages are needed. Everything the module imports at runtime —
`flask`, `openpyxl`, `reportlab` — is already in eFinance's `requirements.txt`.

Do **not** copy `conftest.py`, `taep_harness.py`, `test_*.py`, `acceptance.py` or the rest
of `tools/` onto the production server. They are the test and build side.

### How the files actually get there on this installation

> **21/10/2026 — `/tmp/deploy.sh` is no longer the deploy script.** The file at that path
> on `10.227.56.22` is now a DMS/eMetroon configuration script that rewrites
> `settings.json`. Running it would not deploy anything and would change the live
> database configuration. Everything in this subsection below is kept as the record of
> how the module was first installed; **use §1a instead.**

eFinance deploys **file by file** through a script that lives on the server at
`/tmp/deploy.sh` — not the `deploy.sh` in its repository, which is a first-install script
that would overwrite the live database. From a workstation with the `administrator`
password:

```
ssh -t administrator@10.227.56.22 "sudo bash /tmp/deploy.sh"
```

**That command alone will not install this module.** eFinance's `CLAUDE.md` §6 and its
TODO 1η.5 record the rule: a root-level `*.py` is copied **only if it already exists in
production**, so that one-off development scripts cannot leak onto the server. `taep.py`
is new, so it is skipped silently — which is exactly the failure that rule was added to
report after `error_digest.py` was nearly lost. A new module is passed as an argument:

```
ssh -t administrator@10.227.56.22 "sudo bash /tmp/deploy.sh taep.py"
```

Templates are copied when they changed **or are missing**, so the eight `taep_*.html`
files should travel on their own.

`seed/` and `check_readiness.py` are a different matter: the script's documented rules
cover root `*.py`, templates and `en.json`. A new directory is not mentioned. **Read
`/tmp/deploy.sh` before relying on it** — this runbook is written from eFinance's
documentation, not from the script itself. If it does not handle `seed/`, copy it by
hand:

```
scp -r seed administrator@10.227.56.22:/home/administrator/taep-seed
scp tools/check_readiness.py administrator@10.227.56.22:/home/administrator/
ssh -t administrator@10.227.56.22
  sudo cp -a /opt/finance /home/administrator/prod-backup-$(date +%Y%m%d-%H%M%S)
  sudo mkdir -p /opt/finance/seed
  sudo cp /home/administrator/taep-seed/*.csv /opt/finance/seed/
  sudo cp /home/administrator/check_readiness.py /opt/finance/
  sudo chown -R finance:finance /opt/finance/seed /opt/finance/check_readiness.py
```

The backup first is not optional. `administrator` is not in the `finance` group, so every
write to `/opt/finance` needs `sudo`.

## 1a. Copying an update onto the server (current method)

Every command below runs as the administrator, and every one of them starts with `ssh`
— they are server commands, not PowerShell commands. Paste them one at a time.

The server keeps a clone of this repository at `/home/administrator/marsou` and the live
copy is installed out of it. Nothing is ever edited in place under `/opt/finance`.

The clone was created on 22/10/2026 — the first deploy predated it, and the earlier
version of this section assumed it existed. The server reaches github.com (HTTP 200),
and the repository was public at that point, so no credentials were involved.

**When the repository goes private, that clone stops being able to fetch.** Installing
from the copy already on disk still works; `git fetch` will not. It then needs a
fine-grained token (repository access limited to `marsou`, Contents: Read-only), written
without putting it in the shell history or the process list:

```bash
sudo bash -c 'read -rsp "Token: " t; echo; printf "https://msouzou-debug:%s@github.com\n" "$t" > /root/.git-credentials; chmod 600 /root/.git-credentials; git config --global credential.helper store; echo written'
```

A deploy key is cleaner — read-only and scoped to the one repository — but needs outbound
SSH on port 22, which has not been tested from this server. HTTPS has.

```bash
ssh administrator@10.227.56.22

# Backup first. Not optional — this writes over the running application.
sudo cp -a /opt/finance /home/administrator/prod-backup-$(date +%Y%m%d-%H%M%S)

# Bring the clone up to date. If the server cannot reach GitHub, skip to the fallback.
sudo git -C /home/administrator/marsou fetch origin claude/new-session-1tcoay
sudo git -C /home/administrator/marsou checkout claude/new-session-1tcoay
sudo git -C /home/administrator/marsou reset --hard origin/claude/new-session-1tcoay
sudo git -C /home/administrator/marsou log --oneline -1
```

If the clone does not exist yet:

```bash
sudo git clone --branch claude/new-session-1tcoay \
     https://github.com/msouzou-debug/marsou.git /home/administrator/marsou
```

If the server cannot reach GitHub, copy from a workstation that can — from the
workstation, **not** over the ssh session:

```powershell
scp -r C:\path\to\marsou administrator@10.227.56.22:/home/administrator/marsou
```

Then install, which is the only step that touches `/opt/finance`:

Name the template files rather than globbing them when the command is issued from a
Windows workstation: `taep_*.html` can expand on the PowerShell side before ssh sees it.
From the server's own prompt the glob is fine.

```bash
cd /home/administrator/marsou
sudo install -o finance -g finance -m 644 taep.py              /opt/finance/taep.py
sudo install -o finance -g finance -m 644 templates/taep_*.html /opt/finance/templates/
sudo install -o finance -g finance -m 644 seed/*.csv            /opt/finance/seed/
sudo diff -q taep.py /opt/finance/taep.py && echo "taep.py ίδιο"
```

`seed/*.csv` is harmless to re-copy: the seed only loads a table that is empty.

## 1c. The ICD-10 catalogue, which is NOT in this repository

Every other seed file is in `seed/`. `seed/icd10.csv` is not, and it is in `.gitignore`
so it cannot be added by accident.

It holds the Μονάδα Ελέγχου Εσόδων's Greek translation of 10.560 ICD-10 diagnoses,
supplied 26/10/2026. **This repository is public.** The code can be read by anyone and
that is accepted; their translation work is theirs to publish or not, and nobody has
said it should be. So it travels to the server by hand, once.

If the file is absent the module still loads and eFinance still boots. The diagnosis
table stays empty, and `check_readiness.py` reports it as a **blocker** — correctly,
because a diagnosis is required to finalise, so an empty catalogue means no costing can
be completed.

### Putting it on the server

From a workstation that has the file:

```powershell
scp icd10.csv administrator@10.227.56.22:/home/administrator/
```

Then on the server:

```bash
sudo install -o finance -g finance -m 644 /home/administrator/icd10.csv \
     /opt/finance/seed/icd10.csv
sudo systemctl restart finance.service
```

The ordinary seed path loads it on the next start — nothing special, the same code that
loads the other seed files. Confirm:

```bash
sudo -u finance env FINANCE_DB=/opt/finance/finance.db \
     python3 /opt/finance/check_readiness.py
```

It is loaded once and then left alone: the seed fills a table only when it is empty, so
restarts and deploys do not touch it.

### If the Μονάδα sends a new version

They send a workbook, not a CSV. Convert it where the workbook already is — do not put
the workbook on the server:

```bash
python3 tools/build_icd10.py ICD10_version_2016_1.xlsx
```

That writes `seed/icd10.csv` and reports anything odd rather than repairing it. To
replace a catalogue already loaded, empty the table first — and only when nothing has
been recorded against the codes you are removing:

```bash
sudo -u finance python3 -c "import sqlite3;sqlite3.connect('/opt/finance/finance.db').execute('DELETE FROM taep_diagnosis').connection.commit()"
```

### Running the tests without it

`test_taep_diagnosis.py` skips itself when the file is absent, and says why. A clone
without the catalogue runs everything else.

## 1b. Deploying the parallel run (22/10/2026)

The parallel-run report is `/taep/parallel`. It adds one table, one template, six
changed templates and a sidebar link. No change to `app.py` — the module is already in
`_MODULES`.

```bash
ssh administrator@10.227.56.22
sudo cp -a /opt/finance /home/administrator/prod-backup-$(date +%Y%m%d-%H%M%S)

# 1. Files, per §1a
cd /home/administrator/marsou
sudo git fetch origin claude/new-session-1tcoay
sudo git reset --hard origin/claude/new-session-1tcoay
sudo install -o finance -g finance -m 644 taep.py               /opt/finance/taep.py
sudo install -o finance -g finance -m 644 templates/taep_*.html /opt/finance/templates/

# 2. The sidebar link. Idempotent, parses the result as Jinja, keeps a backup.
sudo python3 tools/add_parallel_nav.py

# 3. Restart. taep_parallel_check is created on startup by SCHEMA_STATEMENTS.
sudo systemctl restart finance.service
sleep 20
sudo journalctl -u finance.service --since "-2 min" --no-pager | tail -40

# 4. The tables. Note `sudo`, not `sudo -u finance`: the script lives under
#    /home/administrator, which is mode 700, so the finance user cannot read it —
#    "[Errno 13] Permission denied" on the script, not on the database. Both this and
#    pre_deploy_check.py open the database read-only, which is what makes running them
#    as root harmless: a read-write open as root would leave root-owned -wal and -shm
#    files beside finance.db and the service would then fail to write.
sudo python3 tools/show_taep_tables.py /opt/finance/finance.db

# 5. Nothing else broke. This one IS `-u finance`, because check_readiness.py lives in
#    /opt/finance and the finance user can read it.
sudo -u finance env FINANCE_DB=/opt/finance/finance.db \
     python3 /opt/finance/check_readiness.py
```

**Which user runs what.** Anything under `/home/administrator/marsou` runs as `sudo`
(root), because `finance` has no access to that directory. Anything already installed
under `/opt/finance` runs as `sudo -u finance`. Writing into `/opt/finance` is always
`install -o finance -g finance`, never a root-owned copy.

Then sign in as a user holding `taep.admin` and open `/taep/parallel`. On an empty
database it should say the run is blocked on all three counts — fourteen days, every
episode priced by hand, every difference explained — not show a pass.

**Rollback:** the restore is the backup directory from step 1 plus a restart. The new
table can stay; an unused table costs nothing and dropping it would lose any figures a
clerk had already typed.

**Translations.** `/taep/parallel` adds 23 Greek strings and the tariff screens changed
three more. They are in `docs/taep-translations-en.json` and belong in eFinance's
`translations/en.json`, which is theirs, not ours. Hand the file to the eFinance agent
rather than editing the dictionary — three of our words collide with theirs
(«Κωδικός» = Password, «Εισαγωγή» = Import, «Γραμμή» = invoice line) and that file is
keyed on the Greek.

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
        ("taep.view", "ΤΑΕΠ — αναζήτηση και προβολή κοστολόγησης"),
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
all six keys — `taep.create` and `taep.view` included — across every hospital the moment
the keys exist. The defaults apply only
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

| Key | Suggested role | What it allows |
|---|---|---|
| `taep.view` | `accountant` | Read only: the list, lookup by costing number, open a costing, reprint it. Writes nothing. For the cashier at the till. `viewer` is the alternative if the till staff should hold nothing else. |
| `taep.create` | `clerk` | Entry, service selection, calculation |
| `taep.finalise` | `clerk` | Issues the costing number |
| `taep.cancel` | `admin` | |
| `taep.rates` | `chief_accountant` | |
| `taep.admin` | `admin` | |

`taep.view` adds a second way into the read-only screens; it takes nothing away from
`taep.create`, which still reaches them. A reprint writes a `PRINTED` entry to the
activity log, so handing out a second priced document is accounted for even though it
changes no data and allocates no number.

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

## 6a. Backfilling English service descriptions

Only needed on an installation seeded before 21/10/2026. `seed()` loads a table only when
it is empty, so those databases hold 125 services with no English description. The
`ALTER` adds the column at boot; nothing fills it, and until it is filled a clerk
searching by the English term finds nothing — and the service codes are English.

Copy `tools/backfill_service_english.py` beside `check_readiness.py`, restart first so
the `ALTER` has run, then:

```
cd /opt/finance
python3 backfill_service_english.py              # says what it would do
python3 backfill_service_english.py --apply      # does it
```

It only writes rows that are empty, never touches the Greek, and is safe to run twice.
It stops with exit 2 and says to restart if the column is not there yet.

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

`/taep/parallel` keeps that score rather than leaving it to a spreadsheet somebody
maintains by hand. The clerk types the hand-priced figure into a box on the costing
screen once the costing is finalised; the report shows both figures side by side and
names what is still outstanding. It refuses to call the run complete until three things
are true at once: fourteen distinct days covered, every finalised episode carrying a
hand-priced figure, and every difference carrying a written explanation. Fourteen clean
days with one unexplained difference is not a pass, and the screen says so.

Differences are exact. A cent apart is a difference, because the point of pricing twice
is to find out where the two methods disagree.

`/taep/parallel/export` gives the Μονάδα a workbook where the difference column, the
counts and the totals are all live formulas — somebody auditing this is auditing our
arithmetic as much as the tool's, and a column of constants proves nothing.

**The paediatric relocation** is a data change, not a release. When ΤΑΕΠ Παίδων moves to
Μακάριος ΙΙΙ, close the current row and open a new one:

```sql
UPDATE taep_unit SET host_valid_to = '<the day before the move>'
 WHERE unit_code = 'NGH-PAED' AND host_valid_to IS NULL;

INSERT INTO taep_unit (unit_code, name_el, taep_number, host_entity_code,
                       host_valid_from, active)
VALUES ('NGH-PAED', 'ΤΑΕΠ Παίδων Λευκωσίας', '1106', 'ARC', '<the move date>', 1);
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
