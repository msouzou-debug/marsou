"""0002: recompute request.number_search so Greek Theta is searchable as Latin U.

The search form maps look-alike Greek capitals to Latin ones. Theta (typed as U on a Latin keyboard) was missing,
so rows saved before this change hold a key with Theta in it. This rewrites the key for every request with a number.
The normalising function is copied here on purpose: a migration must keep doing what it did on the day it was written.
Greek code points are numbers, so the source holds no Greek literals.
"""
import unicodedata

from sqlalchemy import text

from ehr.migrations.helpers import has_column

_LOOKALIKES = {
    0x391: "A", 0x392: "B", 0x395: "E", 0x396: "Z", 0x397: "H", 0x398: "U", 0x399: "I", 0x39A: "K",
    0x39C: "M", 0x39D: "N", 0x39F: "O", 0x3A1: "P", 0x3A4: "T", 0x3A5: "Y", 0x3A7: "X",
}
_DASHES = {0x2D, 0x2010, 0x2011, 0x2012, 0x2013, 0x2014, 0x2212}


def _key(number):
    decomposed = unicodedata.normalize("NFD", number or "")
    out = []
    for ch in "".join(c for c in decomposed if not unicodedata.combining(c)).upper():
        if ch.isspace() or ord(ch) in _DASHES:
            continue
        out.append(_LOOKALIKES.get(ord(ch), ch))
    return "".join(out)


def upgrade(connection):
    if not (has_column(connection, "request", "number") and has_column(connection, "request", "number_search")):
        return
    rows = connection.execute(text("SELECT id, number, number_search FROM request WHERE number IS NOT NULL")).fetchall()
    for row_id, number, current in rows:
        key = _key(number)
        if key != current:
            connection.execute(text("UPDATE request SET number_search = :k WHERE id = :i"), {"k": key, "i": row_id})
