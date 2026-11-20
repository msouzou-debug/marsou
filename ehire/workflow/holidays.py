"""Cyprus public holidays as dates. Pure: no clock, no database, no I/O. The names live in `holiday_names.json`
next to this file (they are stored data, read by `flask load-holidays`).

Fixed dates repeat every year. The movable ones come from Orthodox Easter Sunday: Green Monday (Easter minus 48 days),
Good Friday (minus 2), Easter Monday (plus 1), Easter Tuesday (plus 2) and Pentecost Monday (plus 50).

Assumption: 24 December and Easter Tuesday are public-service holidays, not statutory ones for everybody. They are
included because the organisation works to the public-service calendar. An administrator can remove either in
Settings, Public holidays. Dates that the government moves by decree in a given year are not predicted here.
"""
from datetime import date, timedelta

FIXED = (  # (key, month, day)
    ("new_year", 1, 1),
    ("epiphany", 1, 6),
    ("greek_independence", 3, 25),
    ("cyprus_national_day", 4, 1),
    ("labour_day", 5, 1),
    ("assumption", 8, 15),
    ("cyprus_independence", 10, 1),
    ("ohi_day", 10, 28),
    ("christmas_eve", 12, 24),
    ("christmas", 12, 25),
    ("boxing_day", 12, 26),
)

MOVABLE = (  # (key, days from Orthodox Easter Sunday)
    ("green_monday", -48),
    ("good_friday", -2),
    ("easter_monday", 1),
    ("easter_tuesday", 2),
    ("pentecost_monday", 50),
)


def orthodox_easter(year):
    """Orthodox Easter Sunday of `year` as a Gregorian date. Meeus Julian algorithm, then the Julian-to-Gregorian
    shift for that century (13 days from 1900 to 2099)."""
    a, b, c = year % 4, year % 7, year % 19
    d = (19 * c + 15) % 30
    e = (2 * a + 4 * b - d + 34) % 7
    month, day = divmod(d + e + 114, 31)
    julian = date(year, month, day + 1)  # a day number that exists in both calendars for March and April
    return julian + timedelta(days=year // 100 - year // 400 - 2)


def holidays_of(year):
    """[(key, date)] for one year, sorted by date."""
    easter = orthodox_easter(year)
    rows = [(key, date(year, month, day)) for key, month, day in FIXED]
    rows += [(key, easter + timedelta(days=offset)) for key, offset in MOVABLE]
    return sorted(rows, key=lambda row: row[1])
