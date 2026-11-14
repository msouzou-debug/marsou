"""Scenario 9: reminders, escalation, the returned-request warning and automatic withdrawal."""
import html
from datetime import datetime, timedelta, timezone

from ehr import i18n
from ehr.extensions import db
from ehr.models import PublicHoliday, Request, Task, User
from ehr.workflow import timing
from tests.notifications.nhelpers import act, as_user, at, create, mails, reload, run_timers, uid
from tests.requests.flowhelpers import step2
from tests.requests.test_return_replace_withdraw import resubmit

OPENED = at("2026-02-05T09:00:00")  # a Thursday
HOLIDAY = datetime(2026, 2, 9).date()  # the Monday after the weekend, a public holiday in these tests


def days_off():
    return {h.date for h in PublicHoliday.query}


def make_request(client):
    """A request whose step 2 task was opened on Thursday 5 February 2026."""
    r = create(client)
    for t in r.tasks:
        t.opened_at = t.clock_started_at = OPENED
    if db.session.get(PublicHoliday, HOLIDAY) is None:
        db.session.add(PublicHoliday(date=HOLIDAY, name_el="Test", name_en="Test day"))
    db.session.commit()
    return r


def test_one_reminder_at_two_working_days_and_one_escalation_at_five(seeded, client):
    r = make_request(client)
    assert HOLIDAY.weekday() == 0
    # Friday is day 1; Saturday, Sunday and the Monday holiday add nothing.
    assert run_timers(seeded, at("2026-02-09T18:00:00")) == {"reminders": 0, "escalations": 0, "warnings": 0, "withdrawn": 0}
    assert not mails("reminder_due")
    # Tuesday is day 2.
    assert run_timers(seeded, at("2026-02-10T09:00:00"))["reminders"] == 1
    reminder = mails("reminder_due", request_id=r.id)
    assert [m.to_user_id for m in reminder] == [uid("nic.accountant")]
    assert "2" in reminder[0].html
    assert run_timers(seeded, at("2026-02-10T15:00:00")) == {"reminders": 0, "escalations": 0, "warnings": 0, "withdrawn": 0}
    assert run_timers(seeded, at("2026-02-12T09:00:00"))["escalations"] == 0  # day 4
    assert run_timers(seeded, at("2026-02-13T09:00:00"))["escalations"] == 1  # day 5
    escalation = mails("escalation_due", request_id=r.id)
    assert [m.to_user_id for m in escalation] == [uid("nic.exec")]  # the assignee's line manager
    assert User.query.filter_by(username="nic.accountant").one().full_name in escalation[0].html
    assert run_timers(seeded, at("2026-02-16T09:00:00")) == {"reminders": 0, "escalations": 0, "warnings": 0, "withdrawn": 0}
    assert len(mails("reminder_due")) == 1 and len(mails("escalation_due")) == 1
    task = Task.query.filter_by(request_id=r.id).one()
    assert task.status == "open" and task.assignee_user_id == uid("nic.accountant")  # escalation leaves it in place


def test_without_the_holiday_the_same_dates_count_one_more_day(seeded, client):
    make_request(client)
    db.session.delete(db.session.get(PublicHoliday, HOLIDAY))
    db.session.commit()
    assert run_timers(seeded, at("2026-02-09T18:00:00"))["reminders"] == 1  # Fri + Mon = 2


def test_no_line_manager_sends_the_escalation_to_the_admins(seeded, client):
    r = make_request(client)
    User.query.filter_by(username="nic.accountant").one().line_manager_user_id = None
    db.session.commit()
    assert run_timers(seeded, at("2026-02-13T09:00:00"))["escalations"] == 1
    assert [m.to_user_id for m in mails("escalation_due", request_id=r.id)] == [uid("demo.admin")]


def test_paused_time_is_not_counted_and_the_clock_restarts_on_resume(seeded, client):
    r = create(client)
    step2(client, r.id)
    act(client, "nic.hr", r.id, "return", comment="Add the form.")
    assert reload(r.id).status == "returned"
    now = datetime.now(timezone.utc)
    later = timing.add_working_days(now, 10, days_off())  # ten working days pass while it is with the requester
    assert run_timers(seeded, later) == {"reminders": 0, "escalations": 0, "warnings": 0, "withdrawn": 0}
    assert not mails("reminder_due")
    resubmit(client, r.id)
    resumed = Task.query.filter_by(request_id=r.id, status="open").first().clock_started_at
    assert run_timers(seeded, now + timedelta(days=1))["reminders"] == 0  # the clock restarted when it was resumed
    resumed = resumed if resumed.tzinfo else resumed.replace(tzinfo=timezone.utc)
    due = timing.add_working_days(resumed, 2, days_off())
    assert run_timers(seeded, due)["reminders"] == 2  # sci and hr, one each
    assert sorted(m.to_user_id for m in mails("reminder_due", request_id=r.id)) == sorted([uid("nic.sci"), uid("nic.hr")])
    assert run_timers(seeded, due) == {"reminders": 0, "escalations": 0, "warnings": 0, "withdrawn": 0}


def test_withdrawal_warning_at_half_time_and_automatic_withdrawal_at_the_limit(seeded, client):
    r = create(client)
    act(client, "nic.accountant", r.id, "return", comment="Attach the paper.")
    returned = at("2026-01-12T10:00:00")
    reload(r.id).returned_at = returned
    db.session.commit()
    half = timing.add_working_days(returned, 15, days_off())
    assert run_timers(seeded, half - timedelta(days=3))["warnings"] == 0
    assert run_timers(seeded, half)["warnings"] == 1
    warning = mails("withdrawal_warning", request_id=r.id)
    assert [m.to_user_id for m in warning] == [uid("nic.requester")] and "15" in warning[0].html
    assert run_timers(seeded, half + timedelta(hours=2))["warnings"] == 0
    limit = timing.add_working_days(returned, 30, days_off())
    assert run_timers(seeded, limit)["withdrawn"] == 1
    assert reload(r.id).status == "withdrawn"
    gone = mails("request_withdrawn", request_id=r.id)
    assert [m.to_user_id for m in gone] == [uid("nic.requester")]
    assert i18n.translate("system.auto_withdraw", "el") in html.unescape(gone[0].html)  # the system comment, translated
    assert run_timers(seeded, limit + timedelta(days=1))["withdrawn"] == 0
    assert len(mails("request_withdrawn", request_id=r.id)) == 1


def test_run_timers_moves_tasks_when_an_out_of_office_window_starts(seeded, client):
    r = create(client)
    user = User.query.filter_by(username="nic.accountant").one()
    user.out_of_office = True  # switched on by hand, as if the window had just started
    db.session.commit()
    run_timers(seeded, datetime.now(timezone.utc))
    task = Task.query.filter_by(request_id=r.id).one()
    assert task.assignee_user_id == uid("nic.deputy") and task.redirect_reason == "out_of_office"
