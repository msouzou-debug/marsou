from datetime import date

import pytest

from ehr.services.request_dates import format_date, format_datetime, parse_date


def test_parse_and_format_round_trip():
    assert parse_date("05/03/2027") == date(2027, 3, 5)
    assert format_date(date(2027, 3, 5)) == "05/03/2027"
    assert format_date(None) == ""


@pytest.mark.parametrize("text", ["5/3/2027", " 05-03-2027 ", "05.03.2027"])
def test_parse_accepts_short_forms(text):
    assert parse_date(text) == date(2027, 3, 5)


@pytest.mark.parametrize("text", ["", "2027-03-05", "31/02/2027", "05/13/2027", "5/3/27", "abc", "05/03/1800"])
def test_parse_rejects_bad_input(text):
    with pytest.raises(ValueError):
        parse_date(text)


def test_format_datetime():
    from datetime import datetime
    # naive values are UTC; shown in Cyprus time (winter: +2 hours)
    assert format_datetime(datetime(2027, 3, 5, 9, 7)) == "05/03/2027 11:07"
