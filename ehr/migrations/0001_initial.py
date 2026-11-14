"""Baseline: the schema as of Phase 6.

On a new database this creates every table from the current models. On a database made earlier by `flask init-db`
(before migrations existed) every table is already there and nothing changes; the migration only records
version 1. Later migrations are real changes (add a column, add a table) and must check before they act, see
README.md: a new database gets the newest models from this baseline and then runs the later migrations on top.
"""
from ehr.extensions import db


def upgrade(connection):
    from ehr import models  # noqa: F401  registers every table on db.metadata

    db.metadata.create_all(connection, checkfirst=True)
