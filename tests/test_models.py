import pytest

from daspani.models import TableRow, normalize_month, parse_amount


@pytest.mark.parametrize("raw,expected", [
    ("1.234,56", 1234.56),
    ("1,234.56", 1234.56),
    ("1234.56", 1234.56),
    ("1234,5", 1234.5),
    ("12.345", 12345.0),        # ευρωπαϊκός διαχωριστής χιλιάδων
    ("0,00", 0.0),
    ("-", 0.0),
    ("", 0.0),
    (None, 0.0),
    ("-123,45", -123.45),
    ("(123,45)", -123.45),
    ("€ 1.000,00", 1000.0),
    (1234.559, 1234.56),
])
def test_parse_amount(raw, expected):
    assert parse_amount(raw) == expected


def test_parse_amount_invalid():
    with pytest.raises(ValueError):
        parse_amount("abc")


@pytest.mark.parametrize("raw,expected", [
    ("ΑΠΡΙΛΙΟΣ", "ΑΠΡΙΛΙΟΣ"),
    ("ΑΠΡΙΛΙΟΥ", "ΑΠΡΙΛΙΟΣ"),
    ("Απριλίου 2026", "ΑΠΡΙΛΙΟΣ"),
    ("ΦΕΒΡΟΥΑΡΙΟΥ", "ΦΕΒΡΟΥΑΡΙΟΣ"),
    ("κάτι άλλο", None),
])
def test_normalize_month(raw, expected):
    assert normalize_month(raw) == expected


def test_aka_norm_and_analogia():
    row = TableRow(aka="00123 456", name="ΑΝΑΛΟΓΙΑ ΜΙΣΘΟΥ ΠΑΠΑΔΟΠΟΥΛΟΣ")
    assert row.aka_norm == "123456"
    assert row.is_analogia
    assert not TableRow(aka="1", name="ΓΕΩΡΓΙΟΥ ΑΝΔΡΕΑΣ").is_analogia
