"""Cyprus time: stored in UTC, shown in Europe/Nicosia (summer time included), working days by local calendar day."""
from datetime import date, datetime, timezone
from types import SimpleNamespace

import pytest

from ehr import create_app, localtime
from ehr.config import TestConfig
from ehr.extensions import db
from ehr.services.request_dates import format_date, format_datetime
from ehr.workflow import timing
from ehr.workflow.model import Settings, TaskState
from tests.audit.test_audit_view import add, body, get
from tests.requests.flowhelpers import as_user, create, text

UTC = timezone.utc


def test_winter_and_summer_timestamps_render_two_and_three_hours_ahead(app):
    assert format_datetime(datetime(2026, 1, 15, 12, 0, tzinfo=UTC)) == "15/01/2026 14:00"  # UTC+2
    assert format_datetime(datetime(2026, 7, 15, 12, 0, tzinfo=UTC)) == "15/07/2026 15:00"  # UTC+3
    assert format_datetime(datetime(2026, 7, 15, 12, 0)) == "15/07/2026 15:00"  # naive means UTC (as SQLite returns it)
    # the changeover days of 2026: 29 March and 25 October
    assert format_datetime(datetime(2026, 3, 29, 0, 59, tzinfo=UTC)) == "29/03/2026 02:59"
    assert format_datetime(datetime(2026, 3, 29, 1, 0, tzinfo=UTC)) == "29/03/2026 04:00"
    assert format_datetime(datetime(2026, 10, 25, 0, 59, tzinfo=UTC)) == "25/10/2026 03:59"
    assert format_datetime(datetime(2026, 10, 25, 1, 0, tzinfo=UTC)) == "25/10/2026 03:00"
    assert format_datetime(None) == "" and format_date(None) == ""


def test_the_date_part_of_a_timestamp_is_the_cyprus_day(app):
    assert format_date(datetime(2026, 3, 4, 22, 30, tzinfo=UTC)) == "05/03/2026"
    assert format_date(datetime(2026, 7, 4, 20, 59, tzinfo=UTC)) == "04/07/2026"
    assert format_date(datetime(2026, 7, 4, 21, 0, tzinfo=UTC)) == "05/07/2026"


def test_a_date_only_value_does_not_shift(app):
    assert format_date(date(2027, 3, 1)) == "01/03/2027"
    assert format_datetime(date(2027, 3, 1)) == "01/03/2027"
    assert localtime.local_date(date(2027, 3, 1)) == date(2027, 3, 1)


def test_leave_date_on_the_request_page_is_not_shifted(seeded, client):
    req = create(client, reason="resignation")
    leaver = req.leavers[0]
    assert leaver.leave_date == date(2027, 3, 1)
    as_user(client, "nic.requester")
    assert "01/03/2027" in text(client.get("/requests/%d?lang=en" % req.id))


def test_the_filters_and_the_history_use_cyprus_time(seeded, client, app):
    req = create(client)
    req.created_at = datetime(2026, 7, 15, 12, 0, tzinfo=UTC)
    for a in req.actions:
        a.created_at = datetime(2026, 7, 15, 12, 0, tzinfo=UTC)
    db.session.commit()
    as_user(client, "nic.requester")
    page = text(client.get("/requests/%d?lang=en" % req.id))
    assert "15/07/2026 15:00" in page and "15/07/2026 12:00" not in page
    flt = app.jinja_env.filters
    assert flt["ehr_datetime"](datetime(2026, 1, 15, 12, 0, tzinfo=UTC)) == "15/01/2026 14:00"
    assert flt["ehr_date"](datetime(2026, 1, 15, 23, 0, tzinfo=UTC)) == "16/01/2026"


def test_the_zone_is_configurable():
    class Utc(TestConfig):
        EHR_TIMEZONE = "UTC"

    app = create_app(Utc)
    with app.app_context():
        assert format_datetime(datetime(2026, 7, 15, 12, 0, tzinfo=UTC)) == "15/07/2026 12:00"


def test_start_up_fails_clearly_without_the_zone():
    class Missing(TestConfig):
        EHR_TIMEZONE = "Nowhere/Land"

    with pytest.raises(RuntimeError) as err:
        create_app(Missing)
    assert "Nowhere/Land" in str(err.value) and "tzdata" in str(err.value) and "UTC" in str(err.value)


# ------------------------------------------------------------------ audit date filter

@pytest.mark.parametrize("day, inside, outside", [
    # winter, UTC+2: 23:30 on the 5th is 21:30 UTC; 00:30 on the 6th is 22:30 UTC on the 5th
    ("05/03/2026", datetime(2026, 3, 5, 21, 30, tzinfo=UTC), datetime(2026, 3, 5, 22, 30, tzinfo=UTC)),
    # summer, UTC+3: 23:30 on the 5th is 20:30 UTC; 00:30 on the 6th is 21:30 UTC on the 5th
    ("05/07/2026", datetime(2026, 7, 5, 20, 30, tzinfo=UTC), datetime(2026, 7, 5, 21, 30, tzinfo=UTC)),
])
def test_audit_to_date_means_that_day_in_cyprus(seeded, client, day, inside, outside):
    add("inside_event", at=inside)
    add("outside_event", at=outside)
    html = body(get(client, "demo.admin", "?to=" + day.replace("/", "%2F")).get_data(as_text=True))
    assert "inside_event" in html and "outside_event" not in html
    html = body(get(client, "demo.admin", "?from=%s&to=%s" % (day, day)).get_data(as_text=True))
    assert "inside_event" in html and "outside_event" not in html


def test_audit_from_date_starts_at_cyprus_midnight(seeded, client):
    add("early_event", at=datetime(2026, 3, 4, 21, 30, tzinfo=UTC))  # 23:30 on the 4th in Cyprus
    add("late_event", at=datetime(2026, 3, 4, 22, 30, tzinfo=UTC))  # 00:30 on the 5th in Cyprus
    html = body(get(client, "demo.admin", "?from=05/03/2026").get_data(as_text=True))
    assert "late_event" in html and "early_event" not in html


def test_audit_view_shows_cyprus_times(seeded, client):
    add("summer_event", at=datetime(2026, 7, 5, 20, 30, tzinfo=UTC))
    assert "05/07/2026 23:30" in get(client, "demo.admin", "?event=summer_event").get_data(as_text=True)


def test_day_start_utc(app):
    assert localtime.day_start_utc(date(2026, 1, 10)) == datetime(2026, 1, 9, 22, 0, tzinfo=UTC)
    assert localtime.day_start_utc(date(2026, 7, 10)) == datetime(2026, 7, 9, 21, 0, tzinfo=UTC)


# ------------------------------------------------------------------ working days by Cyprus calendar day

def test_working_days_use_the_cyprus_calendar_day(app):
    tz = localtime.zone()
    # Sunday 23:30 UTC is Monday 01:30 in Cyprus (winter)
    sun_late = datetime(2026, 11, 8, 23, 30, tzinfo=UTC)
    tue = datetime(2026, 11, 10, 10, 0, tzinfo=UTC)
    assert timing.working_days_between(sun_late, tue, (), tz) == 1  # Tuesday only: Monday is the start day
    assert timing.working_days_between(sun_late, tue) == 2  # by UTC date it would wrongly count Monday too
    # the end side: Monday 22:30 UTC is already Tuesday 00:30 in Cyprus
    fri = datetime(2026, 11, 6, 10, 0, tzinfo=UTC)
    mon_late = datetime(2026, 11, 9, 22, 30, tzinfo=UTC)
    assert timing.working_days_between(fri, mon_late, (), tz) == 2
    assert timing.working_days_between(fri, mon_late) == 1
    # a task opened at 23:30 UTC on Friday is Saturday 01:30 in Cyprus: the clock starts on a day off
    fri_late = datetime(2026, 11, 6, 23, 30, tzinfo=UTC)
    assert timing.working_days_between(fri_late, datetime(2026, 11, 9, 8, 0, tzinfo=UTC), (), tz) == 1
    # naive values (as read from SQLite) are UTC
    assert timing.working_days_between(datetime(2026, 11, 8, 23, 30), tue, (), tz) == 1


def task(**kw):
    base = dict(id=1, request_id=7, role="sci_director", assignee_user_id="u1", status="open",
                opened_at=None, clock_started_at=None, line_manager_id="m1")
    base.update(kw)
    return TaskState(**base)


def test_the_reminder_fires_on_the_cyprus_day(app):
    tz = localtime.zone()
    opened = datetime(2026, 11, 2, 22, 30, tzinfo=UTC)  # Monday 22:30 UTC is Tuesday 00:30 in Cyprus
    t = task(opened_at=opened, clock_started_at=opened)
    before = datetime(2026, 11, 4, 21, 30, tzinfo=UTC)  # Wednesday 23:30 in Cyprus: 1 working day
    after = datetime(2026, 11, 4, 22, 30, tzinfo=UTC)  # Thursday 00:30 in Cyprus: 2 working days
    assert timing.due_notifications([t], [], before, set(), Settings(), tz) == []
    assert [e.kind for e in timing.due_notifications([t], [], after, set(), Settings(), tz)] == ["reminder_due"]
    # counting by UTC date would have fired an hour too early
    assert [e.kind for e in timing.due_notifications([t], [], before, set(), Settings())] == ["reminder_due"]


def test_the_request_page_counts_days_waiting_in_cyprus_time(app):
    from ehr.services.request_view import status_line

    opened = datetime(2026, 11, 8, 23, 30, tzinfo=UTC)  # Sunday UTC, Monday in Cyprus
    t = SimpleNamespace(status="open", clock_started_at=None, opened_at=opened, role="dir_accountant",
                        assignee_user_id=1, reminded_at=None, escalated_at=None)
    req = SimpleNamespace(status="in_progress", tasks=[t])
    now = datetime(2026, 11, 10, 10, 0, tzinfo=UTC)
    assert status_line(req, set(), now, {})["waiting"][0]["days"] == 1


def test_days_left_counts_from_the_cyprus_day(app, seeded):
    from ehr.services.request_view import days_left

    req = SimpleNamespace(status="returned", returned_at=datetime(2026, 11, 8, 23, 30, tzinfo=UTC))
    assert days_left(req, set(), datetime(2026, 11, 10, 10, 0, tzinfo=UTC)) == 29  # 30 - 1 (Tuesday)


def test_the_timing_module_stays_pure():
    import ehr.workflow.timing as mod

    assert "zoneinfo" not in open(mod.__file__, encoding="utf-8").read()


def test_today_is_the_cyprus_date(app, monkeypatch):
    monkeypatch.setattr(localtime, "now", lambda: datetime(2026, 11, 6, 23, 30, tzinfo=UTC))
    assert localtime.today() == date(2026, 11, 7)
