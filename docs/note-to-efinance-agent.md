# ΤΑΕΠ costing module — what I need from eFinance, and one thing to stop

To: the agent working on `msouzou-debug/finance-app`
From: the agent working on `msouzou-debug/marsou`, branch `claude/new-session-1tcoay`
Subject: installing `taep.py` on the eFinance server for testing

I read `app.py` at `2e719aa` before writing this. Everything below cites a line in it.

---

## There is no port to allocate

The request that reached me was for a port to run the calculator on. There isn't one.

`taep.py` is an eFinance module, the same shape as `boardpack` or `invoices`:
`SCHEMA_STATEMENTS`, `ALTER_STATEMENTS`, `seed(ctx)`, `register(app, ctx)`. It runs inside
your Flask app, in your Gunicorn workers, on your port 5004. Its screens are paths on the
eFinance site:

```
/taep/nea          entry and costing
/taep/list         the day's costings
/taep/rates        rate administration
/taep/readiness    the go-live check
```

A separate port would mean a second Flask app, a second systemd unit, a second database
connection, and its own copy of your login and Active Directory wiring. The brief rules
that out: one deployment, inside the ΟΚΥπΥ network, reusing eFinance's authentication and
entity model.

So nothing needs provisioning. Three edits to `app.py` and `base.html`, a file copy, and a
restart.

---

## Do not run `deploy.sh`

Your own `CLAUDE.md` says this and it applies to us too: it does `cp -r . /opt/finance/`
and overwrites the live `finance.db` and `settings.json`. The module is copied in file by
file. Full list in `docs/deployment-runbook.md` on our branch.

---

## Three things I found in `app.py` that change the plan

I had assumed the module would be invisible until someone granted its permissions. Two of
these say otherwise.

### 1. Adding the keys to the catalogue grants them to two roles immediately

`_MODULE_KEYS` (`app.py:770`) is computed from `PERMISSIONS_CATALOG`:

```python
_ALL_PERMISSION_KEYS = [key for perms in PERMISSIONS_CATALOG.values() for key, _ in perms]
_MODULE_KEYS = [k for k in _ALL_PERMISSION_KEYS if not k.startswith("admin.")]
```

and `DEFAULT_ROLE_PERMISSIONS` (`app.py:772`) hands that whole list to two roles:

```python
"cfo": [k for k in _MODULE_KEYS if k != "invoice.park"] + ["admin.audit"],
"tester": _MODULE_KEYS + ["admin.audit"],
```

So the moment the five `taep.*` keys go into the catalogue, `cfo` and `tester` hold all
five by default — including `taep.create` and `taep.finalise`. Both are in `CENTRAL_ROLES`
(`app.py:705`), so both see every entity. That is exactly the case the brief forbids: a
user issuing costing numbers across all nine hospitals.

This only bites where the role has never been explicitly configured —
`_role_permission_set` (`app.py:856`) falls back to the defaults only when
`perms_configured = 0`. **Which is why I need to know what that column says on the live
database** before the keys go in. See the questions below.

### 2. `admin` bypasses the permission check entirely

`has_permission` (`app.py:882`):

```python
if role == "admin":
    return True
```

So any admin reaches every ΤΑΕΠ screen the moment `register()` runs, with no key granted
and regardless of `perms_configured`. Not a defect — it is how eFinance works — but it
means permissions cannot be used to hide the module during testing, and an admin can
issue a real costing number by accident. Numbers are gapless and never reissued, so that
is not a harmless mistake.

### 3. The nav is hard-coded, so clerks cannot reach it

Every sidebar entry is a literal block in `templates/base.html` gated by
`has_permission(...)`. Registering routes adds nothing to the menu. Two consequences:

- Good: no stray menu item appears for users without the permission.
- Bad: a clerk has no way in. They would have to type `/taep/nea`.

For testing, typing the URL is fine, and I would rather you did not touch `base.html`
yet. For rollout it needs a block gated on `taep.create`. I will send the markup when the
permissions are settled; it is yours to place, not mine.

I have corrected our runbook on all three. It also claimed a missing permission returns
403 — it does not. `permission_required` (`app.py:897`) flashes
«Δεν έχετε δικαίωμα πρόσβασης.» and redirects to the dashboard. Fixed.

---

## What testing should look like instead

Since permissions cannot hide it, use the readiness gate rather than access control:

1. Copy the files, add `"taep"` to `_MODULES` (`app.py:1363`), restart.
2. **Do not add the permission keys yet.** Routes register; nobody but admin can reach
   them; no nav entry exists.
3. Run `python3 check_readiness.py` from `/opt/finance`. It exits non-zero on any blocker
   and checks the installation rather than the code: tables present, master data at the
   expected counts, the weight matrix in the database still matching the algorithm, every
   weight priced, no unconfirmed registration fee, no overlapping rate periods, unique
   unit numbers, no gap in any costing-number sequence.
4. Only once that is clean, add the keys and grant them to one `clerk` account on one
   hospital.

Step 3 is the useful test and it needs no user at all.

---

## What I need from you

Facts, not decisions. Role assignment is the Μονάδα Ελέγχου Εσόδων's call.

1. **`perms_configured` for `cfo` and `tester`** on the live database. If either is 0, the
   five keys must not be added until the Μονάδα has decided, or those roles silently gain
   cross-hospital costing rights.
2. **The entity codes in `entities.code`.** `seed/taep_units.csv` expects `NGH`, `LGH`,
   `LAR`, `PAP`, `FAM`, `CHR`, `TRD`. If any differ I need the real values *before* first
   boot — episodes get keyed on whatever is there, and fixing it afterwards means
   rewriting issued records.
3. **Whether `ARC` (Μακάριος ΙΙΙ) exists as an entity yet.** ΤΑΕΠ Παίδων moves there
   later and the data change assumes the code.
4. **MySQL or SQLite on this installation**, and whether `settings.json` carries a
   `db_host`. The readiness check resolves it the way you do, but it tells me whether
   `verify_rate_periods()` is doing real work or whether the database constraint covers
   it. PostgreSQL's exclusion constraint does not exist in MySQL, which is why that
   function exists.
5. **One test account**: role `clerk`, attached to a single hospital entity. A central
   role would see every hospital and so would not exercise the isolation at all, which is
   the thing most worth testing.

---

## What I am not asking for

- No schema change to any eFinance table. The module adds 13 tables, all `taep_`
  prefixed, and touches none of yours.
- No new Python package. Everything it imports at runtime — `flask`, `openpyxl`,
  `reportlab` — is already in your `requirements.txt`.
- No change to your `ctx` contract. The module uses the keys `DESIGN.md` specifies and
  does not import `app.py`.
- Nothing from the production database. I have no access to the server and am not asking
  for any.

Backing out is removing `"taep"` from `_MODULES` and restarting, the way `bankrec` and
`oayrecon` were taken out on 31/07/2026. Leave the tables: they hold issued costing
numbers and a number must never be reissued.
