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

## When the database engine is chosen

Tested on SQLite only. Before the first run on PostgreSQL, MySQL or SQL Server, check:

- **Transactional DDL.** PostgreSQL, SQL Server and SQLite roll DDL back with the migration (for SQLite the
  runner opens the transaction itself). MySQL does not: a failed migration can leave half a change, which is why
  every migration checks before it acts.
- **Types and defaults.** `ALTER TABLE ... ADD COLUMN` syntax, `NOT NULL` with a default, boolean and datetime
  types differ. Write each statement for the engine in use, or use `sqlalchemy.schema` constructs that render it.
- **Time zones.** The models use `DateTime(timezone=True)`. SQLite and MySQL store no zone; values are UTC.
- **Case rules.** `user.username` is compared with `lower()` in code. A case-insensitive collation (SQL Server,
  MySQL default) still works; check the unique index behaves as expected.
- **Append-only audit log.** Deny UPDATE and DELETE on `audit_log` to the application's database user.
- **Run the whole test suite against the new engine** (`EHR_DATABASE_URI` in a test config) before installing.
