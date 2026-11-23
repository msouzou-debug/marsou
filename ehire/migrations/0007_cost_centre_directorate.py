"""0007: each cost centre may belong to a Directorate (eFinance's entity).

- `cost_centre.directorate_id`: nullable, foreign key to `directorate`, indexed. Empty means the cost centre belongs
  to no particular Directorate and is offered for every Directorate. Existing rows stay empty.
Nothing is dropped. A database built by 0001 from the newest models already has the column and the index, so each
step checks first.
"""
from sqlalchemy import text

from ehire.migrations.helpers import has_column, has_index


def upgrade(connection):
    if not has_column(connection, "cost_centre", "directorate_id"):
        connection.execute(text(
            "ALTER TABLE cost_centre ADD COLUMN directorate_id INTEGER REFERENCES directorate (id)"))
    if not has_index(connection, "cost_centre", "ix_cost_centre_directorate_id"):
        connection.execute(text("CREATE INDEX ix_cost_centre_directorate_id ON cost_centre (directorate_id)"))
