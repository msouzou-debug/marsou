"""The person page, the users list with filters, and waiting tasks that follow the role holders (contract 02, C8).
Invented sample data only."""
import json

import pytest

from ehire.extensions import db
from ehire.models import AuditLog, Directorate, RoleAssignment, Task, User
from ehire.services import role_admin as ra
from tests.notifications.nhelpers import as_user, create, mails, shown, uid
from tests.requests.flowhelpers import text


@pytest.fixture
def admin(seeded, client):
    as_user(client, "demo.admin")
    return client


def audits(event, **match):
    db.session.expire_all()
    rows = [json.loads(a.detail_json or "{}") for a in AuditLog.query.filter_by(event=event).order_by(AuditLog.id)]
    return [r for r in rows if all(r.get(k) == v for k, v in match.items())]


def did_of(code):
    return Directorate.query.filter_by(code=code).one().id


def active_holder(role, code=None):
    rows = ra.active_rows(role, did_of(code) if code else None)
    return (rows[0].user_id, rows[0].substitute_user_id) if rows else (None, None)


def row_of(username, role, code=None):
    return RoleAssignment.query.filter_by(user_id=uid(username), role=role,
                                          directorate_id=did_of(code) if code else None).one()


def person(client, username, lang="en"):
    return text(client.get("/settings/users/%d?lang=%s" % (uid(username), lang)))


def only_task(request_id):
    db.session.expire_all()
    return Task.query.filter_by(request_id=request_id, status="open").one()


def save_role(client, role, code, holder="", sub="", **extra):
    data = {"role": role, "directorate_id": str(did_of(code)) if code else "",
            "holder_id": str(uid(holder)) if holder else "", "substitute_id": str(uid(sub)) if sub else ""}
    return client.post("/settings/roles/save?lang=en", data=data | extra, follow_redirects=True)


def toggle(client, username):
    return client.post("/settings/users/%d/toggle?lang=en" % uid(username), follow_redirects=True)


# ---------------------------------------------------------------- the person page

def test_person_page_shows_holder_substitute_and_covers_for(admin):
    page = person(admin, "nic.accountant")
    assert "Directorate Accountant" in page and 'value="%d" selected' % uid("nic.deputy") in page
    deputy = person(admin, "nic.deputy")
    assert shown(deputy, "settings.person.covers_for", who=User.query.filter_by(username="nic.accountant").one().full_name)
    assert deputy.count("Stop covering") == 4  # accountant, Scientific Director, HR Officer, Executive Director
    assert shown(person(admin, "lim.deputy"), "settings.person.no_roles")
    assert admin.get("/settings/users/99999").status_code == 404


def test_person_page_says_when_the_account_is_switched_off(admin):
    assert not shown(person(admin, "nic.hr"), "settings.person.inactive_note")
    toggle(admin, "nic.hr")
    page = person(admin, "nic.hr")
    assert shown(page, "settings.person.inactive_note") and shown(page, "settings.person.add_inactive")


def test_add_replace_and_remove_from_the_person_page_agree_with_the_roles_page(admin):
    old = uid("nic.hr")
    data = {"role": "dir_hr_officer", "directorate_id": str(did_of("NIC")), "substitute_id": ""}
    # Another holder exists: refused, naming them, nothing changes.
    resp = admin.post("/settings/users/%d/roles/add?lang=en" % uid("nic.deputy"), data=data, follow_redirects=True)
    assert shown(text(resp), "settings.person.holder_exists", who=db.session.get(User, old).full_name)
    assert active_holder("dir_hr_officer", "NIC")[0] == old
    # With the box ticked it replaces; the roles page shows the new Κάτοχος selected on that row.
    admin.post("/settings/users/%d/roles/add" % uid("nic.deputy"), data=data | {"replace": "1"})
    assert active_holder("dir_hr_officer", "NIC")[0] == uid("nic.deputy")
    roles_page = text(admin.get("/settings/roles?lang=en"))
    row = roles_page.split('id="r-%d-dir_hr_officer"' % did_of("NIC"))[1].split("</form>")[0]
    assert 'value="%d" selected' % uid("nic.deputy") in row
    assert "Directorate HR Officer" not in person(admin, "nic.hr").split("Add a role")[0].split("Roles")[-1]
    # The reverse: set on the roles page, see it on the person page.
    save_role(admin, "dir_hr_officer", "NIC", holder="nic.exec", sub="nic.hr")
    assert "Directorate HR Officer" in person(admin, "nic.exec")
    assert shown(person(admin, "nic.hr"), "settings.person.covers_for", who=db.session.get(User, uid("nic.exec")).full_name)
    # Remove from the person page: the roles page lists the role as empty.
    row = row_of("nic.exec", "dir_hr_officer", "NIC")
    admin.post("/settings/users/%d/roles/%d/remove" % (uid("nic.exec"), row.id))
    assert active_holder("dir_hr_officer", "NIC") == (None, None)
    assert "#r-%d-dir_hr_officer" % did_of("NIC") in text(admin.get("/settings/roles?lang=en"))


def test_substitute_and_covers_for_are_the_same_rows(admin):
    row = row_of("nic.accountant", "dir_accountant", "NIC")
    admin.post("/settings/users/%d/roles/%d/substitute" % (uid("nic.accountant"), row.id),
               data={"substitute_id": str(uid("nic.exec"))})
    assert active_holder("dir_accountant", "NIC") == (uid("nic.accountant"), uid("nic.exec"))
    assert shown(person(admin, "nic.exec"), "settings.person.covers_for", who=db.session.get(User, uid("nic.accountant")).full_name)
    admin.post("/settings/users/%d/covers/%d/remove" % (uid("nic.exec"), row.id))
    assert active_holder("dir_accountant", "NIC") == (uid("nic.accountant"), None)
    assert admin.post("/settings/users/%d/covers/%d/remove" % (uid("nic.exec"), row.id)).status_code == 404  # no longer covering
    # A holder can't be their own substitute.
    resp = admin.post("/settings/users/%d/roles/%d/substitute?lang=en" % (uid("nic.accountant"), row.id),
                      data={"substitute_id": str(uid("nic.accountant"))}, follow_redirects=True)
    assert shown(text(resp), "settings.same_person")
    assert audits("role_changed", role="dir_accountant")[-1]["after"][0]["substitute_user_id"] is None


def test_adding_a_role_validates_on_the_server(admin):
    u = uid("lim.deputy")
    base = "/settings/users/%d/roles/add" % u
    admin.post(base, data={"role": "requester", "directorate_id": ""})  # Directorate missing
    admin.post(base, data={"role": "sci_director", "directorate_id": str(did_of("PHC"))})  # PHC has none
    admin.post(base, data={"role": "nonsense", "directorate_id": ""})
    assert not db.session.get(User, u).active_assignments()
    # A central role ignores the Directorate; requester, viewer and admin rows have no substitute.
    admin.post(base, data={"role": "ceo", "directorate_id": str(did_of("PHC"))})
    assert active_holder("ceo")[0] == uid("central.ceo")  # refused: someone else holds it
    admin.post(base, data={"role": "requester", "directorate_id": str(did_of("PHC")), "substitute_id": str(uid("nic.hr"))})
    admin.post(base, data={"role": "viewer"})
    page = person(admin, "lim.deputy")
    assert "Requester" in page and "Viewer" in page
    assert row_of("lim.deputy", "requester", "PHC").substitute_user_id is None


def test_next_goes_only_to_the_roles_page_or_a_person_page(admin):
    row = row_of("nic.accountant", "dir_accountant", "NIC")
    url = "/settings/users/%d/roles/%d/substitute" % (uid("nic.accountant"), row.id)
    for target, expected in (("/settings/roles", "/settings/roles"),
                             ("/settings/users/%d" % uid("nic.hr"), "/settings/users/%d" % uid("nic.hr")),
                             ("http://evil.example/x", "/settings/users/%d" % uid("nic.accountant")),
                             ("//evil.example", "/settings/users/%d" % uid("nic.accountant")),
                             ("/settings/users/1/../../logout", "/settings/users/%d" % uid("nic.accountant"))):
        resp = admin.post(url, data={"substitute_id": "", "next": target})
        assert resp.status_code == 302 and resp.headers["Location"].endswith(expected), target


# ---------------------------------------------------------------- the users list

def listed(client, query=""):
    page = text(client.get("/settings/users?lang=en" + query))
    return {u.username for u in User.query.all() if 'href="/settings/users/%d"' % u.id in page}, page


def test_users_list_shows_roles_and_filters(admin):
    admin.post("/settings/users/add", data={"username": "no.role", "full_name": "No Role", "temp_password": "abcdefgh1234"})
    names, page = listed(admin)
    assert {"nic.hr", "lim.deputy", "demo.admin"} <= names
    assert shown(page, "settings.users.no_role") and "Covering" in page and "Directorate HR Officer · NIC" in page
    assert listed(admin, "&q=NIC.SCI")[0] == {"nic.sci"}
    assert listed(admin, "&q=" + User.query.filter_by(username="central.ceo").one().full_name[:6])[0] == {"central.ceo"}
    assert listed(admin, "&role=ceo")[0] == {"central.ceo", "central.deputy"}  # the holder and the one covering
    assert listed(admin, "&role=requester&directorate=%d" % did_of("NIC"))[0] == {"nic.requester"}
    assert "nic.hr" in listed(admin, "&directorate=%d" % did_of("NIC"))[0]
    assert "nic.hr" not in listed(admin, "&directorate=central")[0] and "central.hr" in listed(admin, "&directorate=central")[0]
    toggle(admin, "nic.hr")
    assert listed(admin, "&status=inactive")[0] == {"nic.hr"}
    assert "nic.hr" not in listed(admin, "&status=active")[0]
    assert listed(admin, "&status=inactive&role=ceo")[0] == set()
    assert shown(listed(admin, "&q=zzzz")[1], "settings.users.none_found")
    assert listed(admin, "&role=bogus&directorate=x&status=y")[0] >= {"nic.hr", "demo.admin"}  # bad values are ignored


def test_users_list_keeps_the_pending_filter_and_add_form(admin):
    from tests.auth_ad.test_ad_login import make_ad_user

    make_ad_user("bob.ad", active=False)
    page = text(admin.get("/settings/users?lang=en"))
    assert 'action="/settings/users/add"' in page and 'name="q"' in page
    names, page = listed(admin, "&show=pending")
    assert names == {"bob.ad"} and 'name="show" value="pending"' in page
    assert listed(admin, "&show=pending&q=zzz")[0] == set()


def test_list_does_not_ask_the_database_per_person(admin):
    from sqlalchemy import event

    from ehire.extensions import db as _db

    count = []
    engine = _db.engine

    def counter(*a):
        count.append(1)

    event.listen(engine, "before_cursor_execute", counter)
    try:
        admin.get("/settings/users?lang=en")
    finally:
        event.remove(engine, "before_cursor_execute", counter)
    assert len(count) < 30 < User.query.count() * 2


# ---------------------------------------------------------------- guards

def test_guards_hold_on_the_person_page(admin):
    me = uid("demo.admin")
    row = row_of("demo.admin", "admin")
    resp = admin.post("/settings/users/%d/roles/%d/remove?lang=en" % (me, row.id), follow_redirects=True)
    assert shown(text(resp), "settings.admin_self_remove") and ra.active_admin_ids() == {me}
    resp = toggle(admin, "demo.admin")
    assert shown(text(resp), "settings.self_deactivate") and db.session.get(User, me).is_active


def test_the_last_active_administrator_stays_on_every_path(admin):
    me = uid("demo.admin")
    other = uid("nic.hr")  # somebody else acts: the signed-in admin is always one of the active ones
    row = row_of("demo.admin", "admin")
    assert ra.remove_multi(other, db.session.get(User, me), "admin").key == "settings.last_admin"
    assert ra.remove_assignment(other, row).key == "settings.last_admin"
    assert ra.toggle_account(other, db.session.get(User, me)).key == "settings.last_admin"
    assert db.session.get(User, me).is_active and ra.active_admin_ids() == {me}


# ---------------------------------------------------------------- waiting tasks follow the holders

def test_task_moves_when_the_holder_changes(admin):
    r = create(admin)
    assert only_task(r.id).assignee_user_id == uid("nic.accountant")
    as_user(admin, "demo.admin")
    before = len(mails(request_id=r.id))
    resp = save_role(admin, "dir_accountant", "NIC", holder="nic.hr")
    task = only_task(r.id)
    assert task.assignee_user_id == uid("nic.hr") and task.on_behalf_of_user_id is None
    assert "1 open task was moved to" in text(resp)
    assert [(m.event, m.to_user_id) for m in mails(request_id=r.id)[before:]] == [("task_opened", uid("nic.hr"))]
    moved = audits("task_redirected", cause="holder_changed")[-1]
    assert moved["from"] == uid("nic.accountant") and moved["to"] == uid("nic.hr")
    # The same save again moves nothing.
    save_role(admin, "dir_accountant", "NIC", holder="nic.hr")
    assert len(audits("task_redirected", cause="holder_changed")) == 1


def test_no_button_and_no_route_for_reassigning_any_more(admin):
    create(admin)
    as_user(admin, "demo.admin")
    save_role(admin, "dir_accountant", "NIC", holder="nic.hr")
    page = text(admin.get("/settings/roles?lang=en"))
    assert "reassign" not in page and "Move 1 open task" not in page
    assert admin.post("/settings/roles/reassign", data={"role": "dir_accountant"}).status_code in (404, 405)


def test_task_moves_when_the_substitute_changes_and_the_holder_is_out(admin):
    holder = User.query.filter_by(username="nic.accountant").one()
    holder.out_of_office = True
    db.session.commit()
    r = create(admin)
    task = only_task(r.id)
    assert (task.assignee_user_id, task.on_behalf_of_user_id) == (uid("nic.deputy"), uid("nic.accountant"))
    as_user(admin, "demo.admin")
    row = row_of("nic.accountant", "dir_accountant", "NIC")
    admin.post("/settings/users/%d/roles/%d/substitute" % (uid("nic.accountant"), row.id),
               data={"substitute_id": str(uid("nic.exec"))})
    task = only_task(r.id)
    assert (task.assignee_user_id, task.on_behalf_of_user_id) == (uid("nic.exec"), uid("nic.accountant"))
    assert task.redirect_reason == "out_of_office"


def test_task_stays_with_a_substitute_who_is_still_valid(admin):
    """Contract 02: coming back from out of office pulls nothing back, and a save that changes nothing moves nothing."""
    holder = User.query.filter_by(username="nic.accountant").one()
    holder.out_of_office = True
    db.session.commit()
    r = create(admin)
    assert only_task(r.id).assignee_user_id == uid("nic.deputy")
    holder.out_of_office = False
    db.session.commit()
    as_user(admin, "demo.admin")
    save_role(admin, "dir_accountant", "NIC", holder="nic.accountant", sub="nic.deputy")
    assert only_task(r.id).assignee_user_id == uid("nic.deputy")
    assert audits("task_redirected") == []


def test_task_moves_to_the_substitute_when_the_holder_is_switched_off(admin):
    r = create(admin)
    as_user(admin, "demo.admin")
    resp = toggle(admin, "nic.accountant")
    assert only_task(r.id).assignee_user_id == uid("nic.deputy")
    assert audits("task_redirected")[-1]["cause"] == "account_deactivated"
    assert "1 open task was moved to" in text(resp)


def test_a_switched_off_substitute_loses_their_tasks_too(admin):
    holder = User.query.filter_by(username="nic.accountant").one()
    holder.out_of_office = True
    db.session.commit()
    r = create(admin)
    assert only_task(r.id).assignee_user_id == uid("nic.deputy")
    as_user(admin, "demo.admin")
    toggle(admin, "nic.deputy")
    assert only_task(r.id).assignee_user_id == uid("nic.exec")  # the holder is out, so the line manager is next


def test_nobody_left_means_unassigned_until_someone_is_appointed(admin):
    r = create(admin)
    as_user(admin, "demo.admin")
    resp = save_role(admin, "dir_accountant", "NIC")  # no holder, no substitute
    assert only_task(r.id).assignee_user_id is None
    assert shown(text(resp), "settings.unassigned_now.one") and audits("task_redirected")[-1]["to"] is None
    assert "#r-%d-dir_accountant" % did_of("NIC") in text(admin.get("/settings/roles?lang=en"))
    save_role(admin, "dir_accountant", "NIC", holder="nic.hr")
    assert only_task(r.id).assignee_user_id == uid("nic.hr")


def test_switching_a_holder_on_again_picks_up_the_unassigned_task(admin):
    save_role(admin, "dir_accountant", "NIC", holder="nic.accountant")  # no substitute
    r = create(admin)
    as_user(admin, "demo.admin")
    toggle(admin, "nic.accountant")
    assert only_task(r.id).assignee_user_id is None
    toggle(admin, "nic.accountant")
    assert only_task(r.id).assignee_user_id == uid("nic.accountant")


def test_unassigned_tasks_tell_the_administrators(admin, seeded):
    save_role(admin, "dir_accountant", "NIC")
    r = create(admin)
    assert only_task(r.id).assignee_user_id is None
    assert [m.to_user_id for m in mails("task_unassigned", request_id=r.id)] == [uid("demo.admin")]


def test_the_requester_never_gets_their_own_task_when_appointed(admin):
    r = create(admin)  # made by nic.requester
    as_user(admin, "demo.admin")
    save_role(admin, "dir_accountant", "NIC", holder="nic.requester", sub="nic.deputy")
    task = only_task(r.id)
    assert task.assignee_user_id == uid("nic.deputy") and task.redirect_reason == "conflict_of_interest"
    save_role(admin, "dir_accountant", "NIC", holder="nic.requester")  # no substitute: the line manager is next
    assert only_task(r.id).assignee_user_id not in (None, uid("nic.requester"))


def test_a_switched_off_line_manager_is_never_given_a_task(admin):
    holder = User.query.filter_by(username="nic.accountant").one()
    holder.out_of_office, holder.line_manager_user_id = True, uid("nic.exec")
    db.session.commit()
    save_role(admin, "dir_accountant", "NIC", holder="nic.accountant")  # no substitute: the manager is next
    r = create(admin)
    assert only_task(r.id).assignee_user_id == uid("nic.exec")
    as_user(admin, "demo.admin")
    toggle(admin, "nic.exec")
    assert only_task(r.id).assignee_user_id is None
    r2 = create(admin)
    assert only_task(r2.id).assignee_user_id is None


# ---------------------------------------------------------------- a request submitted while the holder is off

def test_new_request_goes_to_the_substitute_when_the_holder_is_inactive(admin):
    toggle(admin, "nic.accountant")
    r = create(admin)
    assert only_task(r.id).assignee_user_id == uid("nic.deputy")


def test_new_request_is_unassigned_when_the_holder_is_inactive_and_there_is_no_substitute(admin):
    save_role(admin, "dir_accountant", "NIC", holder="nic.accountant")
    toggle(admin, "nic.accountant")
    r = create(admin)
    assert only_task(r.id).assignee_user_id is None


# ---------------------------------------------------------------- roles with no holder

def test_roles_page_lists_roles_with_no_holder_and_marks_a_switched_off_holder(admin):
    page = text(admin.get("/settings/roles?lang=en"))
    assert shown(page, "settings.roles.empty_title") and 'href="#r-%d-dir_exec"' % did_of("PHC") not in page
    assert 'href="#r-%d-dir_accountant"' % did_of("AMB") in page  # the sample Directorate with no accountant
    save_role(admin, "dir_exec", "NIC")
    assert 'href="#r-%d-dir_exec"' % did_of("NIC") in text(admin.get("/settings/roles?lang=en"))
    toggle(admin, "nic.hr")
    page = text(admin.get("/settings/roles?lang=en"))
    assert 'href="#r-%d-dir_hr_officer"' % did_of("NIC") in page and shown(page, "settings.roles.holder_inactive")


def test_roles_page_says_calmly_when_every_role_has_a_holder(admin):
    me = uid("demo.admin")
    for directorate in [None] + Directorate.query.all():
        for role in ra.roles_for(directorate):
            if not ra.active_rows(role, directorate.id if directorate else None):
                ra.set_single(me, role, directorate, User.query.filter_by(username="nic.deputy").one(), None)
    db.session.commit()
    page = text(admin.get("/settings/roles?lang=en"))
    assert shown(page, "settings.roles.empty_none") and 'href="#r-' not in page
