"""0006: request numbers of the shape EHIRE-<directorate>-<position>-<YYYYMMDD>-<NN>.

- `position.code`: short code (2 to 6 Latin capitals or digits), nullable. Old rows stay empty and use the code of
  their staff category when a number is issued.
- `number_counter`: one counter per number stem (PREFIX-DIR-POS-YYYYMMDD).
Nothing is renumbered and `number_sequence` is left in place. A database built by 0001 from the newest models
already has both, so each step checks first.
"""
from sqlalchemy import text

from ehire.migrations.helpers import has_column, has_table


def upgrade(connection):
    if not has_column(connection, "position", "code"):
        connection.execute(text("ALTER TABLE position ADD COLUMN code VARCHAR(6)"))
    if not has_table(connection, "number_counter"):
        connection.execute(text(
            "CREATE TABLE number_counter (stem VARCHAR(80) NOT NULL, last_value INTEGER NOT NULL, PRIMARY KEY (stem))"))
