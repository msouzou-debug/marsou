"""Settings pages added in Phase 4: access, validation and audit."""
import json
from datetime import date

import pytest

from ehr.extensions import db
from ehr.models import (AuditLog, MailOutbox, PublicHoliday, RoleAssignment, Setting, Task, User, get_setting)
from tests.conftest import login
from tests.notifications.nhelpers import KNOWN_MISSING, act, as_user, create, mails, shown, uid
from tests.requests.flowhelpers import text

GETS = ["/settings/roles", "/settings/users", "/settings/holidays", "/settings/timings", "/settings/outbox",
        "/settings/outbox/1"]
POSTS = [("/settings/roles/save", {"role": "ceo"}), ("/settings/roles/reassign", {"role": "ceo"}),
         ("/settings/roles/requester/add", {"directorate_id": "1", "user_id": "1"}),
         ("/settings/roles/requester/remove", {"directorate_id": "1", "user_id": "1"}),
         ("/settings/users/add", {"username": "x.y", "full_name": "X", "temp_password": "abcdefgh"}),
         ("/settings/users/1/edit", {"full_name": "X"}), ("/settings/users/1/toggle", {}),
         ("/settings/holidays/add", {"date": "01/01/2027", "name_el": "a", "name_en": "b"}),
         ("/settings/holidays/2026-01-01/remove", {}), ("/settings/timings", {"reminder_days": "1"})]


def audits(event, **match):
    db.session.expire_all()
    rows = [json.loads(a.detail_json or "{}") | {"_obj": a.object_id, "_user": a.user_id}
            for a in AuditLog.query.filter_by(event=event).order_by(AuditLog.id)]
    return [r for r in rows if all(r.get(k) == v for k, v in match.items())]


@pytest.fixture
def admin(seeded, client):
    as_user(client, "demo.admin")
    return client


@pytest.mark.parametrize("who", ["nic.requester", "nic.exec", "central.ceo", "demo.viewer"])
def test_non_admins_get_404_everywhere(seeded, client, who):
    create(client)  # so that the outbox and a request exist
    as_user(client, who)
    for path in GETS:
        assert client.get(path).status_code == 404, path
    for path, data in POSTS:
        assert client.post(path, data=data).status_code == 404, path


def test_signed_out_goes_to_sign_in(seeded, client):
    assert client.get("/settings/roles").status_code == 302


def test_admin_pages_open_and_index_links_them(admin):
    for path in GETS[:5]:
        assert admin.get(path + "?lang=en").status_code == 200, path
    page = text(admin.get("/settings?lang=en"))
    for path in ("/settings/roles", "/settings/users", "/settings/holidays", "/settings/timings", "/settings/outbox"):
        assert 'href="%s"' % path in page


# ---------------------------------------------------------------- times and limits

def test_timings_validate_and_audit(admin):
    base = {"reminder_days": "3", "escalation_days": "6", "returned_timeout_days": "40", "max_file_mb": "25"}
    for bad in ("0", "-1", "x", "", "2.5"):
        resp = admin.post("/settings/timings?lang=en", data=dict(base, returned_timeout_days=bad))
        assert resp.status_code == 400 and shown(text(resp), "settings.number_invalid")
    resp = admin.post("/settings/timings?lang=en", data=dict(base, reminder_days="6"))
    assert resp.status_code == 400 and shown(text(resp), "settings.escalation_order")
    assert get_setting("reminder_days") == "2"  # nothing was saved
    assert admin.post("/settings/timings", data=base).status_code == 302
    assert [get_setting(k) for k in base] == ["3", "6", "40", "25"]
    changed = audits("setting_changed")
    assert {a["_obj"]: (a["before"], a["after"]) for a in changed} == {
        "reminder_days": ("2", "3"), "escalation_days": ("5", "6"), "returned_timeout_days": ("30", "40"),
        "max_file_mb": ("20", "25")}
    n = len(changed)
    assert admin.post("/settings/timings", data=base).status_code == 302 and len(audits("setting_changed")) == n


def test_changed_timings_drive_the_timers(admin, seeded):
    from tests.notifications.nhelpers import at, run_timers
    admin.post("/settings/timings", data={"reminder_days": "1", "escalation_days": "3", "returned_timeout_days": "30",
                                          "max_file_mb": "20"})
    r = create(admin)
    for t in r.tasks:
        t.opened_at = t.clock_started_at = at("2026-03-02T09:00:00")
    db.session.commit()
    assert run_timers(seeded, at("2026-03-03T09:00:00"))["reminders"] == 1


# ---------------------------------------------------------------- holidays

def test_holidays_add_list_remove_and_audit(admin):
    page = text(admin.get("/settings/holidays?year=2029&lang=en"))
    assert "01/01/2029" not in page
    assert admin.post("/settings/holidays/add", data={"date": "25/03/2029", "name_el": "Test A", "name_en": "Test day"}).status_code == 302
    assert db.session.get(PublicHoliday, date(2029, 3, 25)).name_en == "Test day"
    page = text(admin.get("/settings/holidays?year=2029&lang=en"))
    assert "25/03/2029" in page and "Test day" in page and "2029" in page
    assert audits("setting_changed", action="add")[-1]["_obj"] == "2029-03-25"
    assert "25/03/2029" not in text(admin.get("/settings/holidays?year=2028&lang=en"))
    for bad in ("2029-03-25", "31/02/2029", "", "x"):
        resp = admin.post("/settings/holidays/add", data={"date": bad, "name_el": "a", "name_en": "b"}, follow_redirects=True)
        assert shown(text(resp), "validation.date"), bad
    resp = admin.post("/settings/holidays/add", data={"date": "25/03/2029", "name_el": "a", "name_en": "b"}, follow_redirects=True)
    assert PublicHoliday.query.filter_by(date=date(2029, 3, 25)).count() == 1
    resp = admin.post("/settings/holidays/add", data={"date": "26/03/2029", "name_el": "", "name_en": "b"})
    assert db.session.get(PublicHoliday, date(2029, 3, 26)) is None
    assert admin.post("/settings/holidays/2029-03-25/remove").status_code == 302
    assert db.session.get(PublicHoliday, date(2029, 3, 25)) is None
    assert audits("setting_changed", action="remove")[-1]["name_en"] == "Test day"
    assert admin.post("/settings/holidays/2029-03-25/remove").status_code == 404


# ---------------------------------------------------------------- users

NEW = {"username": "new.person", "full_name": "New Person", "email": "new.person@example.invalid", "language": "en",
       "temp_password": "temp-pass-1"}


def test_add_user_with_a_hashed_temporary_password(admin):
    assert admin.post("/settings/users/add", data=NEW).status_code == 302
    user = User.query.filter_by(username="new.person").one()
    assert user.must_change_password is True and user.is_active and user.language == "en" and user.auth_source == "local"
    assert user.password_hash and "temp-pass-1" not in user.password_hash
    row = audits("user_changed", action="add")[-1]
    assert row["after"]["email"] == "new.person@example.invalid" and "temp-pass-1" not in json.dumps(row)
    # The new user is sent to change the password at first sign-in.
    admin.post("/logout")
    assert login(admin, "new.person", "temp-pass-1").status_code == 302
    resp = admin.get("/requests")
    assert resp.status_code == 302 and "/password" in resp.headers["Location"]


@pytest.mark.parametrize("change,message", [
    ({"username": "NIC.REQUESTER"}, "settings.user.duplicate"), ({"username": ""}, "validation.required"),
    ({"username": "a b"}, "validation.required"), ({"full_name": ""}, "validation.required"),
    ({"email": "not-an-address"}, "settings.user.email_invalid"), ({"language": "fr"}, "validation.choose"),
    ({"temp_password": "short"}, "password.too_short"), ({"line_manager_user_id": "9999"}, "validation.choose")])
def test_add_user_validation(admin, change, message):
    before = User.query.count()
    resp = admin.post("/settings/users/add?lang=en", data=dict(NEW, **change), follow_redirects=True)
    assert User.query.count() == before
    assert shown(text(resp), message, n=8)


def test_edit_user_and_deactivate(admin):
    target = User.query.filter_by(username="nic.hr").one()
    boss = uid("central.hr")
    resp = admin.post("/settings/users/%d/edit" % target.id, data={
        "full_name": "Renamed Person", "email": "renamed@example.invalid", "language": "en",
        "line_manager_user_id": str(boss)})
    assert resp.status_code == 302
    db.session.expire_all()
    target = db.session.get(User, target.id)
    assert (target.full_name, target.email, target.language, target.line_manager_user_id) == (
        "Renamed Person", "renamed@example.invalid", "en", boss)
    assert audits("user_changed", action="edit")[-1]["before"]["full_name"] != "Renamed Person"
    # A user cannot be their own line manager.
    admin.post("/settings/users/%d/edit" % target.id, data={"full_name": "R", "language": "el", "line_manager_user_id": str(target.id)})
    assert db.session.get(User, target.id).full_name == "Renamed Person"
    assert admin.post("/settings/users/%d/toggle" % target.id).status_code == 302
    assert db.session.get(User, target.id).is_active is False
    assert audits("user_changed", action="deactivate")
    assert admin.post("/settings/users/%d/toggle" % target.id).status_code == 302
    assert db.session.get(User, target.id).is_active is True


def test_an_admin_cannot_deactivate_themselves(admin):
    me = User.query.filter_by(username="demo.admin").one()
    resp = admin.post("/settings/users/%d/toggle?lang=en" % me.id, follow_redirects=True)
    assert shown(text(resp), "settings.self_deactivate")
    assert db.session.get(User, me.id).is_active is True
    assert not audits("user_changed", action="deactivate")


def test_a_deactivated_user_cannot_sign_in_and_gets_no_mail(admin):
    target = User.query.filter_by(username="nic.accountant").one()
    admin.post("/settings/users/%d/toggle" % target.id)
    admin.post("/logout")
    assert admin.post("/login", data={"username": "nic.accountant", "password": "demo-1234"}).status_code == 200
    r = create(admin)
    assert not mails(to="nic.accountant", request_id=r.id)


# ---------------------------------------------------------------- role holders

def role_of(role, directorate_code=None):
    from ehr.models import Directorate
    did = Directorate.query.filter_by(code=directorate_code).one().id if directorate_code else None
    return [a for a in RoleAssignment.query.filter_by(role=role, directorate_id=did) if a.is_active_on()], did


def test_change_holder_and_substitute_with_audit(admin):
    rows, did = role_of("dir_hr_officer", "NIC")
    old_holder = rows[0].user_id
    new = uid("nic.deputy")
    resp = admin.post("/settings/roles/save", data={"role": "dir_hr_officer", "directorate_id": str(did),
                                                    "holder_id": str(new), "substitute_id": str(uid("nic.exec"))})
    assert resp.status_code == 302
    rows, _ = role_of("dir_hr_officer", "NIC")
    assert [(a.user_id, a.substitute_user_id) for a in rows] == [(new, uid("nic.exec"))]
    row = audits("role_changed", role="dir_hr_officer")[-1]
    assert row["before"][0]["user_id"] == old_holder and row["after"][0]["user_id"] == new
    assert User.query.filter_by(username="nic.hr").one().roles() == set()  # the old holder lost the role
    # And back: the old assignment row is reused, not duplicated.
    admin.post("/settings/roles/save", data={"role": "dir_hr_officer", "directorate_id": str(did), "holder_id": str(old_holder)})
    assert RoleAssignment.query.filter_by(user_id=old_holder, role="dir_hr_officer", directorate_id=did).count() == 1
    assert [a.user_id for a in role_of("dir_hr_officer", "NIC")[0]] == [old_holder]


def test_holder_and_substitute_must_differ_and_must_be_active_users(admin):
    rows, did = role_of("dir_exec", "NIC")
    data = {"role": "dir_exec", "directorate_id": str(did), "holder_id": str(uid("nic.hr")), "substitute_id": str(uid("nic.hr"))}
    resp = admin.post("/settings/roles/save?lang=en", data=data, follow_redirects=True)
    assert shown(text(resp), "settings.same_person")
    assert [a.user_id for a in role_of("dir_exec", "NIC")[0]] == [rows[0].user_id]
    User.query.filter_by(username="nic.hr").one().is_active = False
    db.session.commit()
    assert admin.post("/settings/roles/save", data=dict(data, substitute_id="")).status_code == 404
    assert admin.post("/settings/roles/save", data={"role": "requester", "directorate_id": str(did)}).status_code == 404
    assert admin.post("/settings/roles/save", data={"role": "sci_director", "directorate_id": str(
        role_of("dir_exec", "PHC")[1])}).status_code == 404  # PHC has no Scientific Director


def test_removing_a_holder_ends_the_assignment(admin):
    rows, did = role_of("dir_hr_officer", "NIC")
    admin.post("/settings/roles/save", data={"role": "dir_hr_officer", "directorate_id": str(did), "holder_id": ""})
    assert role_of("dir_hr_officer", "NIC")[0] == []


def test_requesters_are_a_list(admin):
    from ehr.models import Directorate
    did = Directorate.query.filter_by(code="NIC").one().id
    extra = uid("nic.sci")
    admin.post("/settings/roles/requester/add", data={"directorate_id": str(did), "user_id": str(extra)})
    assert extra in [a.user_id for a in role_of("requester", "NIC")[0]] and len(role_of("requester", "NIC")[0]) == 2
    assert "request.create" in db.session.get(User, extra).permissions()
    admin.post("/settings/roles/requester/remove", data={"directorate_id": str(did), "user_id": str(extra)})
    assert extra not in [a.user_id for a in role_of("requester", "NIC")[0]]
    assert len(audits("role_changed", role="requester")) == 2
    page = text(admin.get("/settings/roles?lang=en"))
    assert "Requester" in page


def test_changing_a_holder_does_not_reroute_but_offers_the_open_tasks(admin, seeded):
    r = create(admin)
    assert Task.query.filter_by(request_id=r.id).one().assignee_user_id == uid("nic.accountant")
    as_user(admin, "demo.admin")
    rows, did = role_of("dir_accountant", "NIC")
    admin.post("/settings/roles/save", data={"role": "dir_accountant", "directorate_id": str(did),
                                              "holder_id": str(uid("nic.hr")), "substitute_id": ""})
    db.session.expire_all()
    task = Task.query.filter_by(request_id=r.id).one()
    assert task.assignee_user_id == uid("nic.accountant")  # R4: nothing moved by itself
    page = text(admin.get("/settings/roles?lang=en"))
    assert shown(page, "settings.reassign", n=1)
    before = len(mails(request_id=r.id))
    assert admin.post("/settings/roles/reassign", data={"role": "dir_accountant", "directorate_id": str(did)}).status_code == 302
    db.session.expire_all()
    task = Task.query.filter_by(request_id=r.id).one()
    assert task.assignee_user_id == uid("nic.hr") and task.on_behalf_of_user_id is None
    assert [(m.event, m.to_user_id) for m in mails(request_id=r.id)[before:]] == [("task_opened", uid("nic.hr"))]
    assert audits("task_redirected", cause="holder_changed")[-1]["to"] == uid("nic.hr")
    assert audits("role_changed", action="reassign_open_tasks")[-1]["moved"] == 1
    assert not shown(text(admin.get("/settings/roles?lang=en")), "settings.reassign", n=1)
    # Pressing it again changes nothing.
    admin.post("/settings/roles/reassign", data={"role": "dir_accountant", "directorate_id": str(did)})
    assert audits("role_changed", action="reassign_open_tasks")[-1]["moved"] == 0


def test_the_reassign_button_respects_conflict_of_interest(admin, seeded):
    r = create(admin)  # made by nic.requester
    as_user(admin, "demo.admin")
    rows, did = role_of("dir_accountant", "NIC")
    admin.post("/settings/roles/save", data={"role": "dir_accountant", "directorate_id": str(did),
                                              "holder_id": str(uid("nic.requester")), "substitute_id": ""})
    admin.post("/settings/roles/reassign", data={"role": "dir_accountant", "directorate_id": str(did)})
    db.session.expire_all()
    task = Task.query.filter_by(request_id=r.id).one()
    assert task.assignee_user_id != uid("nic.requester")  # the requester never gets their own request


# ---------------------------------------------------------------- email log

def test_outbox_lists_newest_first_with_state(admin):
    r = create(admin)
    as_user(admin, "demo.admin")
    first = mails(request_id=r.id)[0]
    first.state, first.attempts, first.last_error = "failed", 5, "Refused by test"
    db.session.commit()
    page = text(admin.get("/settings/outbox?lang=en"))
    assert page.index('outbox/%d"' % mails(request_id=r.id)[-1].id) < page.index('outbox/%d"' % first.id)
    assert shown(page, "settings.outbox.state.failed") and shown(page, "settings.outbox.state.queued") and "Refused by test" in page
    assert shown(page, "settings.outbox.preview") and "nic.accountant@example.invalid" in page


def test_the_email_preview_is_sandboxed(admin):
    r = create(admin)
    as_user(admin, "demo.admin")
    row = mails("task_opened", "nic.accountant", r.id)[0]
    row.html = row.html.replace("</body>", '<script>alert(1)</script><img src="http://evil.invalid/x.png"></body>')
    db.session.commit()
    resp = admin.get("/settings/outbox/%d" % row.id)
    page = text(resp)
    assert resp.status_code == 200 and "<iframe" in page and " sandbox " in page.replace("sandbox=", "sandbox ") or " sandbox" in page
    assert 'sandbox srcdoc="' in page or 'sandbox="" srcdoc="' in page
    srcdoc = page.split('srcdoc="', 1)[1].split('"', 1)[0]
    assert "<" not in srcdoc and "&lt;script&gt;" in srcdoc  # the stored HTML is escaped into the attribute
    assert "allow-" not in page
    # cid: does not resolve in a browser: the preview points the logo at the app's own static file.
    assert "cid:" not in srcdoc and "/static/img/okypy_logo_mail.png" in srcdoc
    assert admin.get("/static/img/okypy_logo_mail.png").status_code == 200
    csp = resp.headers["Content-Security-Policy"]
    assert "default-src 'self'" in csp and "img-src 'self'" in csp and "http" not in csp and "form-action 'none'" in csp
    assert resp.headers["X-Content-Type-Options"] == "nosniff" and resp.headers["Cache-Control"] == "private, no-store"
    assert admin.get("/settings/outbox/99999").status_code == 404


def test_post_forms_need_csrf(admin, seeded):
    seeded.config["CSRF_ENABLED"] = True
    for path, data in POSTS:
        assert admin.post(path, data=data).status_code == 400, path
