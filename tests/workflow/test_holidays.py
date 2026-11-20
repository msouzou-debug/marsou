from datetime import date

import pytest

from ehire.workflow.holidays import FIXED, MOVABLE, holidays_of, orthodox_easter


@pytest.mark.parametrize("year,easter", [(2026, date(2026, 4, 12)), (2027, date(2027, 5, 2)), (2028, date(2028, 4, 16)),
                                         (2025, date(2025, 4, 20)), (2024, date(2024, 5, 5))])
def test_orthodox_easter(year, easter):
    assert orthodox_easter(year) == easter
    assert easter.weekday() == 6  # always a Sunday


def test_the_2026_list():
    got = {key: day for key, day in holidays_of(2026)}
    assert got == {
        "new_year": date(2026, 1, 1), "epiphany": date(2026, 1, 6), "green_monday": date(2026, 2, 23),
        "greek_independence": date(2026, 3, 25), "cyprus_national_day": date(2026, 4, 1),
        "good_friday": date(2026, 4, 10), "easter_monday": date(2026, 4, 13), "easter_tuesday": date(2026, 4, 14),
        "labour_day": date(2026, 5, 1), "pentecost_monday": date(2026, 6, 1), "assumption": date(2026, 8, 15),
        "cyprus_independence": date(2026, 10, 1), "ohi_day": date(2026, 10, 28), "christmas_eve": date(2026, 12, 24),
        "christmas": date(2026, 12, 25), "boxing_day": date(2026, 12, 26)}
    days = [d for _, d in holidays_of(2026)]
    assert days == sorted(days)
    assert len(got) == len(FIXED) + len(MOVABLE)
