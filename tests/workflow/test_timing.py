from datetime import date, datetime

from ehr.workflow.model import RequestState, Settings, TaskState
from ehr.workflow.timing import (add_working_days, due_notifications, due_withdrawals,
                                 working_days_between)

MON = datetime(2026, 11, 2, 9, 0)


def test_W1_working_day_mon_to_fri_and_holidays():
    assert working_days_between(date(2026, 11, 2), date(2026, 11, 9)) == 5  # Tue..Mon
    assert working_days_between(date(2026, 11, 6), date(2026, 11, 8)) == 0  # Sat, Sun
    hol = {date(2026, 11, 4)}
    assert working_days_between(date(2026, 11, 2), date(2026, 11, 6), hol) == 3
    assert add_working_days(date(2026, 11, 6), 1) == date(2026, 11, 9)
    assert add_working_days(date(2026, 11, 2), 2, hol) == date(2026, 11, 5)
    assert add_working_days(MON, 1) == datetime(2026, 11, 3, 9, 0)
    assert working_days_between(MON, MON) == 0


def task(**kw):
    base = dict(id=1, request_id=7, role="sci_director", assignee_user_id="u1", status="open",
                opened_at=MON, clock_started_at=MON, line_manager_id="m1")
    base.update(kw)
    return TaskState(**base)


def test_W2_clock_starts_at_resume_and_paused_never_counts():
    now = datetime(2026, 11, 6, 9, 0)  # 4 working days after MON
    assert due_notifications([task(status="paused")], [], now, set(), Settings()) == []
    resumed = task(clock_started_at=datetime(2026, 11, 5, 9, 0))  # 1 working day
    assert due_notifications([resumed], [], now, set(), Settings()) == []
    only_opened = task(clock_started_at=None)
    kinds = [e.kind for e in due_notifications([only_opened], [], now, set(), Settings())]
    assert kinds == ["reminder_due"]


def test_W3_reminder_at_two_days_once():
    s = Settings()
    assert due_notifications([task()], [], datetime(2026, 11, 3, 9), set(), s) == []
    ev = due_notifications([task()], [], datetime(2026, 11, 4, 9), set(), s)
    assert [(e.kind, e.recipient_user_id, e.request_id) for e in ev] == [("reminder_due", "u1", 7)]
    assert due_notifications([task(reminded_at=MON)], [], datetime(2026, 11, 4, 9), set(), s) == []


def test_W3_holiday_delays_reminder():
    hol = {date(2026, 11, 3)}
    assert due_notifications([task()], [], datetime(2026, 11, 4, 9), hol, Settings()) == []


def test_W4_escalation_to_line_manager_once():
    s = Settings()
    now = datetime(2026, 11, 9, 9)  # 5 working days
    ev = due_notifications([task(reminded_at=MON)], [], now, set(), s)
    assert [(e.kind, e.recipient_user_id) for e in ev] == [("escalation_due", "m1")]
    assert due_notifications([task(reminded_at=MON, escalated_at=MON)], [], now, set(), s) == []
    assert due_notifications([task(line_manager_id=None, reminded_at=MON)], [], now, set(), s) == []


def test_W4_settings_can_be_a_dict():
    ev = due_notifications([task()], [], datetime(2026, 11, 3, 9), set(), {"reminder_days": 1})
    assert [e.kind for e in ev] == ["reminder_due"]


def returned(**kw):
    base = dict(id=9, status="returned", created_by="req1", returned_at=MON)
    base.update(kw)
    return RequestState(**base)


def test_W5_warning_at_half_and_withdrawal_at_limit():
    s = Settings()
    half = add_working_days(MON, 15)
    assert due_notifications([], [returned()], add_working_days(MON, 14), set(), s) == []
    ev = due_notifications([], [returned()], half, set(), s)
    assert [(e.kind, e.recipient_user_id) for e in ev] == [("withdrawal_warning", "req1")]
    assert due_notifications([], [returned(withdrawal_warned=True)], half, set(), s) == []
    assert due_withdrawals([returned()], add_working_days(MON, 29), set(), s) == []
    assert due_withdrawals([returned()], add_working_days(MON, 30), set(), s) == [9]
    assert due_withdrawals([returned(status="in_progress")], add_working_days(MON, 40), set(), s) == []
