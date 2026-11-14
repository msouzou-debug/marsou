"""Scenario 8: out of office. Tasks move to the substitute, who acts on the holder's behalf."""
from datetime import date, timedelta

from ehr.models import AuditLog, RequestAction, RoleAssignment, Task, User
from ehr.services.request_dates import format_date
from tests.notifications.nhelpers import act, as_user, create, mails, reload, step2, uid
from tests.requests.flowhelpers import actions_of, text


def ooo(client, user, state="on", **fields):
    as_user(client, user)
    data = {"state": state}
    data.update(fields)
    return client.post("/me/out-of-office", data=data)


def open_assignee(rid, role="dir_accountant"):
    return reload(rid) and [t for t in Task.query.filter_by(request_id=rid, role=role, status="open")][0]


def test_switching_on_moves_open_tasks_to_the_substitute_and_tells_them(seeded, client):
    r = create(client)
    assert open_assignee(r.id).assignee_user_id == uid("nic.accountant")
    before = len(mails(request_id=r.id))
    resp = ooo(client, "nic.accountant")
    assert resp.status_code == 302
    task = open_assignee(r.id)
    assert (task.assignee_user_id, task.on_behalf_of_user_id, task.redirect_reason) == (
        uid("nic.deputy"), uid("nic.accountant"), "out_of_office")
    new = mails(request_id=r.id)[before:]
    assert [(m.event, m.to_user_id) for m in new] == [("task_opened", uid("nic.deputy"))]  # nothing to the holder
    events = [(a.event, a.user_id) for a in AuditLog.query.order_by(AuditLog.id).all()
              if a.event in ("out_of_office_changed", "task_redirected")]
    assert events == [("task_redirected", uid("nic.accountant")), ("out_of_office_changed", uid("nic.accountant"))]
    user = User.query.filter_by(username="nic.accountant").one()
    assert user.out_of_office is True
    page = text(client.get("/requests?lang=en"))
    assert "nic.deputy" not in page


def test_the_substitute_acts_and_both_people_are_recorded(seeded, client):
    r = create(client)
    ooo(client, "nic.accountant")
    assert act(client, "nic.accountant", r.id, "check", position="yes", funds="yes").status_code == 302
    assert reload(r.id).current_step == 2  # the holder has nothing to act on any more
    from tests.requests.flowhelpers import fin_fields
    resp = act(client, "nic.deputy", r.id, "check", position="yes", funds="yes", **fin_fields())
    assert resp.status_code == 302 and reload(r.id).current_step == 3
    last = [a for a in actions_of(r.id) if a.action == "check"][0]
    assert last.actor_user_id == uid("nic.deputy") and last.on_behalf_of_user_id == uid("nic.accountant")
    assert last.redirect_reason == "out_of_office"


def test_the_list_page_shows_the_control_and_its_state(seeded, client):
    as_user(client, "nic.accountant")
    page = text(client.get("/requests?lang=en"))
    assert 'action="/me/out-of-office"' in page and "Out of office" in page and "I am out of office" in page
    assert User.query.filter_by(username="nic.deputy").one().full_name in page
    ooo(client, "nic.accountant", date_to=format_date(date.today() + timedelta(days=3)))
    page = text(client.get("/requests?lang=en"))
    assert "I am back" in page and format_date(date.today() + timedelta(days=3)) in page
    assert 'name="date_from"' not in page
    ooo(client, "nic.accountant", state="off")
    assert User.query.filter_by(username="nic.accountant").one().out_of_office is False
    assert "I am out of office" in text(client.get("/requests?lang=en"))


def test_no_substitute_means_no_switch(seeded, client):
    RoleAssignment.query.filter_by(user_id=uid("nic.accountant"), role="dir_accountant").one().substitute_user_id = None
    from ehr.extensions import db
    db.session.commit()
    as_user(client, "nic.accountant")
    page = text(client.get("/requests?lang=en"))
    assert "You have no substitute" in page and "I am out of office" not in page
    assert ooo(client, "nic.accountant").status_code == 302
    assert User.query.filter_by(username="nic.accountant").one().out_of_office is False


def test_only_approver_holders_have_the_control(seeded, client):
    as_user(client, "nic.requester")
    assert "/me/out-of-office" not in text(client.get("/requests?lang=en"))
    assert ooo(client, "nic.requester").status_code == 404
    as_user(client, "nic.deputy")  # a substitute holds no role of their own
    assert ooo(client, "nic.deputy").status_code == 404


def test_new_tasks_follow_the_flag_and_the_date_window(seeded, client):
    today = date.today()
    holder = lambda: User.query.filter_by(username="nic.accountant").one()
    # The window has not started: the holder is treated as present.
    r1 = create(client)
    ooo(client, "nic.accountant", date_from=format_date(today + timedelta(days=2)))
    assert open_assignee(r1.id).assignee_user_id == uid("nic.accountant")  # not out yet, so nothing moved
    assert create(client) and open_assignee(r1.id + 1).assignee_user_id == uid("nic.accountant")
    # The window has ended: present again, nothing to switch off by hand.
    ooo(client, "nic.accountant", state="off")
    ooo(client, "nic.accountant", date_from=format_date(today - timedelta(days=9)),
        date_to=format_date(today - timedelta(days=2)))
    r2 = create(client)
    assert open_assignee(r2.id).assignee_user_id == uid("nic.accountant")
    assert holder().out_of_office is True  # the flag is still set; the dates decide
    # Inside the window: the substitute, and the holder is told for information.
    ooo(client, "nic.accountant", state="off")
    ooo(client, "nic.accountant", date_from=format_date(today - timedelta(days=1)),
        date_to=format_date(today + timedelta(days=1)))
    r3 = create(client)
    task = open_assignee(r3.id)
    assert (task.assignee_user_id, task.on_behalf_of_user_id) == (uid("nic.deputy"), uid("nic.accountant"))
    assert [m.to_user_id for m in mails("task_redirected", request_id=r3.id)] == [uid("nic.accountant")]
    assert [m.to_user_id for m in mails("task_opened", request_id=r3.id)] == [uid("nic.deputy")]
    # The switch with a window that includes today also moved the open tasks that were still with the holder.
    assert open_assignee(r1.id).assignee_user_id == uid("nic.deputy")


def test_switching_off_moves_nothing_back(seeded, client):
    r = create(client)
    ooo(client, "nic.accountant")
    ooo(client, "nic.accountant", state="off")
    assert open_assignee(r.id).assignee_user_id == uid("nic.deputy")


def test_a_substitute_who_made_the_request_is_skipped(seeded, client):
    from ehr.extensions import db
    r = create(client)  # made by nic.requester
    RoleAssignment.query.filter_by(user_id=uid("nic.accountant"), role="dir_accountant").one().substitute_user_id = \
        uid("nic.requester")
    db.session.commit()
    ooo(client, "nic.accountant")
    task = open_assignee(r.id)
    # Next candidate after holder and substitute: the holder's line manager.
    assert task.assignee_user_id == uid("nic.exec") and task.redirect_reason == "conflict_of_interest"
    assert [m.to_user_id for m in mails("task_opened", request_id=r.id)][-1] == uid("nic.exec")


def test_bad_dates_and_csrf(seeded, client):
    resp = ooo(client, "nic.accountant", date_from="31/02/2026")
    assert resp.status_code == 302 and User.query.filter_by(username="nic.accountant").one().out_of_office is False
    resp = ooo(client, "nic.accountant", date_from="10/05/2027", date_to="01/05/2027")
    assert User.query.filter_by(username="nic.accountant").one().out_of_office is False
    seeded.config["CSRF_ENABLED"] = True
    assert client.post("/me/out-of-office", data={"state": "on"}).status_code == 400
