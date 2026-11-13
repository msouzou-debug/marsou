from datetime import date
from decimal import Decimal

import pytest

from ehr.services.request_amounts import (format_amount, format_month, format_whole, parse_amount, parse_month,
                                          parse_whole, ratio)


@pytest.mark.parametrize("text,value", [("1.234,56", "1234.56"), ("1234,5", "1234.5"), ("1.234", "1234"), ("0", "0"),
                                        ("12", "12"), ("1.234.567,89", "1234567.89"), (" 800,00 ", "800.00"), ("0,5", "0.5")])
def test_parse_amount_accepts_the_greek_way(text, value):
    assert parse_amount(text) == Decimal(value)


@pytest.mark.parametrize("text", ["", "abc", "1234.56", "12.5", "1,234.56", "1,2,3", "-5", "1.23,4,5", "1,234", "12 ,3", "1..234", "1,"])
def test_parse_amount_refuses_ambiguous_or_wrong_text(text):
    with pytest.raises(ValueError):
        parse_amount(text)


def test_whole_numbers_only_for_counts():
    assert parse_whole("48.200") == 48200
    with pytest.raises(ValueError):
        parse_whole("12,5")
    assert parse_whole("12,00") == 12


def test_format_amount():
    assert format_amount(Decimal("1234.5")) == "1.234,50"
    assert format_amount(1234567.891) == "1.234.567,89"
    assert format_amount(Decimal("0")) == "0,00"
    assert format_amount(None) == "" and format_whole(48200) == "48.200"
    assert parse_amount(format_amount(Decimal("98765.43"))) == Decimal("98765.43")


def test_month_parsing_and_formatting():
    assert parse_month("09/2026") == date(2026, 9, 1) and parse_month("9-2026") == date(2026, 9, 1)
    for bad in ("", "13/2026", "00/2026", "2026/09", "09/26", "9/1/2026"):
        with pytest.raises(ValueError):
            parse_month(bad)
    assert format_month(date(2026, 9, 1)) == "09/2026" and format_month("2026-09-01") == "09/2026" and format_month(None) == ""


def test_ratio_is_blank_when_payroll_is_zero_or_missing():
    assert ratio(Decimal("100"), Decimal("40")) == Decimal("2.5")
    assert ratio(100, 0) is None and ratio(100, None) is None and ratio(None, 5) is None
