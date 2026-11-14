# Migrations

`flask init-db` creates a new database and marks it as up to date. For a database that already exists, schema
changes go through numbered migrations.

- `schema_version` holds one row per applied migration (`version`, `name`, `applied_at`).
- `flask db-status` prints the current and the latest version.
- `flask upgrade-db` applies pending migrations in order, each in its own transaction, and records each one.
  Run it with the service stopped (deploy/README.md, upgrade steps). It is safe to run twice.
- The app answers 503 while the database is behind the code, and the gunicorn config refuses to start.

## Writing the next one

1. Copy `_template.py.txt` to `NNNN_short_name.py`, NNNN being the next number with no gap.
2. Write `upgrade(connection)`. Check with `helpers.has_column` and friends before changing anything.
3. Change the model and contract 01 to match.
4. Add a test in `tests/hardening/` that upgrades a database built at the previous version.

## 0001_initial

Creates every table from the current models if it is missing. A database made by the old `flask init-db` already has
them, so only the version row is added. This is why later migrations must check before acting: a brand-new database
is built from the newest models by 0001 and then meets the later migrations.

## SQLite is the production engine

Marios decided on 14/11/2026 that eHR follows eFinance: SQLite in WAL mode, one writer. Migrations 0001 to 0003 only create tables (`create_all(checkfirst=True)`), add rows, and rewrite one column's values, so they run unchanged on SQLite. The runner opens each migration in its own transaction (the app's engine already starts every transaction with `BEGIN IMMEDIATE`, see `ehr/dbsetup.py`), so a failed migration rolls back, DDL included. Run `flask upgrade-db` with the service stopped and after a `backup-db` (deploy/README.md).

**Changing a column on SQLite.** `ALTER TABLE ... ADD COLUMN` works (a new column must be nullable or have a constant default). `DROP COLUMN` works only for a plain column that no index, key or view uses. Changing a type, nullability, default or a constraint, and dropping a column that is used, are not possible in place. Use the "create new table, copy, rename" pattern inside one migration:

1. Check first (`helpers.has_column`), so a database that already has the change is left alone.
2. Create the new table under a temporary name with the final definition, copy the rows (`INSERT INTO new (...) SELECT ... FROM old`), `DROP TABLE old`, `ALTER TABLE new RENAME TO old`, then recreate the indexes. This ran correctly through `upgrade-db` on a scratch file (checked on 14/11/2026) for a table that no other table points at.
3. End with `PRAGMA foreign_key_check` and raise if it returns rows.
4. **A table that other tables reference does not work this way.** The connection has foreign keys ON, the `DROP TABLE` then fails ("FOREIGN KEY constraint failed"), and `PRAGMA defer_foreign_keys` did not rescue it either. SQLite's own recipe needs `PRAGMA foreign_keys=OFF`, which cannot be changed inside the runner's transaction. Do not improvise: that case needs the runner changed to switch foreign keys off outside the transaction for one migration, as a separate, tested piece of work.
5. Add the test from "Writing the next one" and try the migration on a copy of a real backup (`backup-db`) before the real run.

SQLite stores no time zone: the models use `DateTime(timezone=True)`, values are UTC. `user.username` is compared with `lower()` in code. The append-only rule for `audit_log` is enforced by the application (model events), not by database permissions, which SQLite does not have.

## If another engine is ever used

Run the whole test suite against it first. Check transactional DDL (MySQL rolls none back, which is why every migration checks before it acts), types and defaults in `ALTER TABLE`, and case rules for `user.username`. The SQLite-only pieces (`ehr/dbsetup.py`, the production file check, `flask backup-db`) switch themselves off or refuse on other engines.
