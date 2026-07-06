from recon.numbers import find_amounts, format_eur, parse_amount


def test_greek_format():
    assert parse_amount("1.936.528,19") == 1936528.19
    assert parse_amount("1.061.728,70") == 1061728.70
    assert parse_amount("12.921,60") == 12921.60


def test_anglo_format():
    assert parse_amount("1,936,528.19") == 1936528.19
    assert parse_amount("131,284.66") == 131284.66


def test_plain_and_floats():
    assert parse_amount("1234.56") == 1234.56
    assert parse_amount("1234,56") == 1234.56
    assert parse_amount(1234.56) == 1234.56
    assert parse_amount(500000) == 500000.0


def test_trailing_minus_credit_notes():
    assert parse_amount("12.25-") == -12.25
    assert parse_amount("1,234.56-") == -1234.56
    assert find_amounts("CREDIT NOTE 12.25- EUR 12.25-") == [-12.25, -12.25]
    # a spaced dash is punctuation, not a sign
    assert find_amounts("22,101.00 - other")[0] == 22101.00


def test_edge_cases():
    assert parse_amount(None) == 0.0
    assert parse_amount("") == 0.0
    assert parse_amount("nan") == 0.0
    assert parse_amount(float("nan")) == 0.0
    assert parse_amount("€ 1.234,50") == 1234.50
    assert parse_amount("-1.234,50") == -1234.50
    assert parse_amount("(1.234,50)") == -1234.50


def test_format_eur():
    assert format_eur(1936528.19) == "1.936.528,19 €"
    assert format_eur(0) == "0,00 €"
    assert format_eur(-12.5) == "-12,50 €"


def test_find_amounts():
    line = "IS Ενδονοσοκομειακή Περίθαλψη 1.061.728,70"
    assert find_amounts(line) == [1061728.70]
    assert find_amounts("INV-77812 8.076 1,60 12.921,60") == [1.60, 12921.60]
