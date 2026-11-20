"""Settings gaps closed on 20/11/2026: temporary password for a local user, Active Directory users added ahead of
their first sign-in, viewer and admin holders in Roles, the last-administrator rule, and the translated audit and
email-log texts."""
import json
import re
from pathlib import Path

import pytest

from ehire import i18n
from ehire.extensions import db
from ehire.models import AuditLog, LoginAttempt, MailOutbox, RoleAssignment, User, audit
from ehire.settings import import_xlsx
from tests.conftest import login
from tests.notifications.nhelpers import shown
from tests.requests.flowhelpers import text

ROOT = Path(__file__).resolve().parents[2]


def uid(name):
    return User.query.filter_by(username=name).one().id


def admin(client):
    login(client, "demo.admin")
    return client


def messages(client, url="/settings/users?lang=en"):
    return text(client.get(url))


def rows_for(event):
    db.session.expire_all()
    return AuditLog.query.filter_by(event=event).order_by(AuditLog.id).all()


# ------------------------------------------------------------------ 1. set a temporary password

def test_admin_sets_a_temporary_password_for_a_local_user(seeded, client):
    admin(client)
    target = User.query.filter_by(username="nic.requester").one()
    old = target.password_hash
    db.session.add_all([LoginAttempt(username="nic.requester", ip="203.0.113.5") for _ in range(3)])
    db.session.commit()
    r = client.post("/settings/users/%d/password" % target.id, data={"new_password": "Fresh-temp-1234"})
    assert r.status_code == 302
    db.session.expire_all()
    target = db.session.get(User, target.id)
    assert target.password_hash != old and target.must_change_password is True
    assert "Fresh-temp-1234" not in target.password_hash
    assert LoginAttempt.query.filter_by(username="nic.requester").count() == 0
    row = rows_for("password_changed")[-1]
    detail = json.loads(row.detail_json)
    assert row.user_id == uid("demo.admin") and row.object_id == str(target.id)
    assert detail["by"] == "admin" and detail["target_user_id"] == target.id and detail["attempts_cleared"] == 3
    assert "Fresh-temp-1234" not in json.dumps(detail)
    client.post("/logout")
    r = login(client, "nic.requester", "Fresh-temp-1234")
    assert r.status_code == 302 and "/password" in r.headers["Location"]  # forced to choose their own


def test_set_password_refusals(seeded, client):
    admin(client)
    me = User.query.filter_by(username="demo.admin").one()
    short = client.post("/settings/users/%d/password" % uid("nic.requester"), data={"new_password": "short"})
    assert short.status_code == 302 and not rows_for("password_changed")
    client.post("/settings/users/%d/password" % me.id, data={"new_password": "Another-long-1234"})  # own account
    assert not rows_for("password_changed") and db.session.get(User, me.id).must_change_password is False
    ad_user = User(username="ann.ad", full_name="Ann", auth_source="ad", password_hash=None, is_active=True)
    db.session.add(ad_user)
    db.session.commit()
    client.post("/settings/users/%d/password" % ad_user.id, data={"new_password": "Another-long-1234"})
    assert db.session.get(User, ad_user.id).password_hash is None and not rows_for("password_changed")
    page = messages(client)
    assert 'action="/settings/users/%d/password"' % uid("nic.requester") in page
    assert 'action="/settings/users/%d/password"' % me.id not in page
    assert 'action="/settings/users/%d/password"' % ad_user.id not in page
    assert client.post("/settings/users/9999/password", data={"new_password": "Another-long-1234"}).status_code == 404


def test_set_password_needs_the_settings_permission(seeded, client):
    login(client, "nic.requester")
    assert client.post("/settings/users/%d/password" % uid("nic.hr"), data={"new_password": "Another-long-1234"}).status_code == 404


# ------------------------------------------------------------------ 2. Active Directory users

def test_add_an_ad_user_ahead_of_the_first_sign_in(seeded, client):
    admin(client)
    r = client.post("/settings/users/add", data={"auth_source": "ad", "username": "  Ann.Ad ", "full_name": "Ann Ad",
                                                  "language": "el"})
    assert r.status_code == 302
    user = User.query.filter_by(username="ann.ad").one()  # stored as the sign-in page looks it up
    assert user.auth_source == "ad" and user.is_active and user.password_hash is None and not user.must_change_password
    detail = json.loads(rows_for("user_changed")[-1].detail_json)
    assert detail["auth_source"] == "ad" and "password" not in json.dumps(detail).lower().replace("must_change_password", "")


@pytest.mark.parametrize("typed", ["ann@corp.example", "CORP\\ann", "an n", "-ann"])
def test_an_ad_username_must_be_a_bare_account_name(seeded, client, typed):
    admin(client)
    before = User.query.count()
    resp = client.post("/settings/users/add?lang=en", data={"auth_source": "ad", "username": typed, "full_name": "X"},
                       follow_redirects=True)
    assert User.query.count() == before and "can only contain Latin letters" in text(resp)


def test_ad_duplicate_ignores_case_and_local_still_needs_a_password(seeded, client):
    admin(client)
    before = User.query.count()
    client.post("/settings/users/add", data={"auth_source": "ad", "username": "NIC.REQUESTER", "full_name": "X"})
    client.post("/settings/users/add", data={"auth_source": "local", "username": "new.local", "full_name": "X"})
    client.post("/settings/users/add", data={"auth_source": "bogus", "username": "new.other", "full_name": "X"})
    assert User.query.count() == before


def test_a_pre_added_ad_user_signs_in_without_waiting_for_activation(seeded, client, app):
    from tests.auth_ad.conftest import FakeDirectory

    app.extensions["ehire_ad"] = FakeDirectory({"ann.ad": ("Ad-Pass-1234", "Ann Directory", "ann@example.invalid")})
    app.config["EHIRE_AD_ENABLED"] = True
    admin(client)
    client.post("/settings/users/add", data={"auth_source": "ad", "username": "Ann.AD", "full_name": "Ann"})
    client.post("/logout")
    r = client.post("/login", data={"username": "ANN.ad", "password": "Ad-Pass-1234"})
    assert r.status_code == 302 and r.headers["Location"].endswith("/")
    assert User.query.filter_by(username="ann.ad").count() == 1 and not rows_for("ad_user_created")


def test_users_page_type_notice_and_pending_filter(seeded, client, app):
    from tests.auth_ad.test_ad_login import make_ad_user

    make_ad_user("bob.ad", active=False)
    make_ad_user("cy.ad", active=False)
    admin(client)
    page = messages(client)
    assert "Active Directory sign-in is not set up on the server yet" in page  # not configured, option still there
    assert '<option value="ad">' in page and "2 accounts waiting for activation" in page
    only = messages(client, "/settings/users?show=pending&lang=en")
    assert "bob.ad" in only and "cy.ad" in only and "nic.requester" not in only and "Show all users" in only
    bob = User.query.filter_by(username="bob.ad").one()
    client.post("/settings/users/%d/toggle" % bob.id)
    assert "1 account waiting for activation" in messages(client)
    app.config.update(EHIRE_AD_ENABLED=True, EHIRE_AD_SERVER="ad.example.invalid", EHIRE_AD_DOMAIN="corp.example.invalid")
    assert "not set up on the server yet" not in messages(client)
    app.config["EHIRE_AD_SERVER"] = ""
    assert "not set up on the server yet" in messages(client)


# ------------------------------------------------------------------ 3. viewer and admin holders, last admin

def holders(role):
    db.session.expire_all()
    return sorted(a.user.username for a in RoleAssignment.query.filter_by(role=role, directorate_id=None)
                  if a.is_active_on())


def test_roles_page_adds_and_removes_viewers_and_admins(seeded, client):
    admin(client)
    assert "Viewers and administrators" in messages(client, "/settings/roles?lang=en")
    for who, role in (("nic.hr", "viewer"), ("nic.exec", "viewer"), ("nic.hr", "admin")):
        assert client.post("/settings/roles/holder/add", data={"role": role, "user_id": str(uid(who))}).status_code == 302
    assert holders("viewer") == ["demo.viewer", "nic.exec", "nic.hr"] and holders("admin") == ["demo.admin", "nic.hr"]
    last = rows_for("role_changed")[-1]
    assert last.object_id == "admin" and json.loads(last.detail_json) == {
        "role": "admin", "directorate_id": None, "action": "add", "user_id": uid("nic.hr")}
    client.post("/settings/roles/holder/remove", data={"role": "viewer", "user_id": str(uid("nic.exec"))})
    client.post("/settings/roles/holder/remove", data={"role": "admin", "user_id": str(uid("nic.hr"))})
    assert holders("viewer") == ["demo.viewer", "nic.hr"] and holders("admin") == ["demo.admin"]
    assert json.loads(rows_for("role_changed")[-1].detail_json)["action"] == "remove"
    client.post("/settings/roles/holder/add", data={"role": "viewer", "user_id": str(uid("nic.exec"))})  # back again
    assert "nic.exec" in holders("viewer")
    assert client.post("/settings/roles/holder/add", data={"role": "ceo", "user_id": "1"}).status_code == 404
    assert client.post("/settings/roles/holder/remove", data={"role": "viewer", "user_id": "99999"}).status_code == 404


def test_an_admin_cannot_remove_their_own_admin_role_even_with_another_admin(seeded, client):
    admin(client)
    client.post("/settings/roles/holder/add", data={"role": "admin", "user_id": str(uid("nic.hr"))})
    resp = client.post("/settings/roles/holder/remove?lang=en", data={"role": "admin", "user_id": str(uid("demo.admin"))},
                       follow_redirects=True)
    assert shown(text(resp), "settings.admin_self_remove") and "demo.admin" in holders("admin")


def test_the_last_active_administrator_cannot_be_removed_or_deactivated(seeded, client):
    """Two administrators, A and B. A deactivates B's account. Now B is not active, so A is the only active one."""
    admin(client)  # A = demo.admin
    client.post("/settings/roles/holder/add", data={"role": "admin", "user_id": str(uid("nic.hr"))})  # B = nic.hr
    client.post("/logout")
    login(client, "nic.hr")  # B signs in and deactivates A: allowed, B stays
    assert client.post("/settings/users/%d/toggle" % uid("demo.admin")).status_code == 302
    assert User.query.filter_by(username="demo.admin").one().is_active is False
    from ehire.settings.roles import active_admin_ids

    assert active_admin_ids() == {uid("nic.hr")}
    # A is inactive but still holds the role: removing that role is fine, B stays the only active administrator.
    client.post("/settings/roles/holder/remove", data={"role": "admin", "user_id": str(uid("demo.admin"))})
    assert holders("admin") == ["nic.hr"]
    # B cannot deactivate themselves (own account) nor drop their own role.
    resp = client.post("/settings/roles/holder/remove?lang=en", data={"role": "admin", "user_id": str(uid("nic.hr"))},
                       follow_redirects=True)
    assert shown(text(resp), "settings.admin_self_remove") and holders("admin") == ["nic.hr"]


def test_the_last_admin_refusal_from_a_second_session(seeded, client, monkeypatch):
    """The guard itself. A signed-in administrator is always one of the active administrators, so to reach the
    last-administrator answer the acting user is swapped for a different person inside the two routes."""
    from ehire.settings import roles, users

    admin(client)
    other = User.query.filter_by(username="nic.hr").one()
    monkeypatch.setattr(users, "current_user", lambda: other)
    monkeypatch.setattr(roles, "current_user", lambda: other)
    target = uid("demo.admin")
    resp = client.post("/settings/users/%d/toggle?lang=en" % target, follow_redirects=True)
    assert shown(text(resp), "settings.last_admin") and db.session.get(User, target).is_active is True
    resp = client.post("/settings/roles/holder/remove?lang=en", data={"role": "admin", "user_id": str(target)},
                       follow_redirects=True)
    assert shown(text(resp), "settings.last_admin") and holders("admin") == ["demo.admin"]
    assert not [r for r in rows_for("user_changed") if '"deactivate"' in (r.detail_json or "")]
    # with a second active administrator the same two requests go through
    client.post("/settings/roles/holder/add", data={"role": "admin", "user_id": str(other.id)})
    client.post("/settings/roles/holder/remove", data={"role": "admin", "user_id": str(target)})
    assert holders("admin") == ["nic.hr"]


def test_import_never_leaves_no_active_administrator(seeded, app):
    sole = uid("demo.admin")
    chk = import_xlsx._Check()
    final = {u.username.lower(): u.is_active for u in User.query.all()}
    final["demo.admin"] = False
    import_xlsx._keep_an_administrator(chk, [{"row": 7, "cells": {"username": "demo.admin"}}], final)
    assert chk.errors == [("users", 7, "active", "import.err.last_admin", {})]
    # another active administrator added by the same file keeps the system covered
    chk = import_xlsx._Check()
    chk.ops.append(("role_holders", "add", ("admin", None, "nic.hr"), {"role": "admin", "username": "nic.hr"}))
    import_xlsx._keep_an_administrator(chk, [{"row": 7, "cells": {"username": "demo.admin"}}], final)
    assert chk.errors == []
    assert sole in __import__("ehire.settings.roles", fromlist=["x"]).active_admin_ids()


# ------------------------------------------------------------------ 5. wording

def test_plural_helper_and_singular_login_lock():
    assert i18n.plural_key("a.b", 1) == "a.b.one" and i18n.plural_key("a.b", 0) == "a.b.many"
    assert i18n.plural_key("a.b", 5) == "a.b.many"
    for lang in ("el", "en"):
        assert "1" in i18n.translate("login.locked.one", lang) and "{n}" in i18n.load(lang)["login.locked.many"]
    assert i18n.translate("login.locked.one", "el").endswith("σε 1 λεπτό.")


def test_the_login_lock_message_is_singular_for_one_minute(seeded, client):
    from datetime import timedelta

    from ehire.models import utcnow

    now = utcnow()
    for _ in range(5):
        db.session.add(LoginAttempt(username="nic.requester", ip="198.51.100.9", at=now - timedelta(minutes=14, seconds=40)))
    db.session.commit()
    page = text(client.post("/login?lang=en", data={"username": "nic.requester", "password": "x"}))
    assert "in 1 minute." in page


def test_reassign_forms_and_message(seeded):
    for lang in ("el", "en"):
        one, many = i18n.translate("settings.reassign.one", lang), i18n.translate("settings.reassign.many", lang, n=3)
        assert "1" in one and "3" in many and one != many
        assert i18n.translate("settings.reassigned.one", lang, who="X").count("1") == 1
    assert i18n.translate("settings.reassign.one", "el") == "Μεταφορά 1 ανοιχτής εργασίας στον νέο Κάτοχο"
    assert "substitute" not in i18n.translate("settings.reassigned.many", "en", n=2, who="X")
    assert "αναπληρωτή" not in i18n.translate("settings.reassigned.many", "el", n=2, who="X")


def test_the_email_log_translates_the_no_address_error(seeded, client):
    from tests.notifications.nhelpers import as_user
    from tests.requests.flowhelpers import create

    create(client)
    db.session.add(MailOutbox(event="task_opened", request_id=None, to_user_id=uid("nic.hr"), to_email=None, language="el",
                              subject="s", html="<p>x</p>", text="x", state="failed",
                              last_error="The recipient has no email address."))
    db.session.add(MailOutbox(event="task_opened", request_id=None, to_user_id=uid("nic.hr"), to_email=None, language="el",
                              subject="s2", html="<p>x</p>", text="x", state="failed", last_error="Server said 550 no"))
    db.session.commit()
    as_user(client, "demo.admin")
    el = text(client.get("/settings/outbox?lang=el"))
    assert "Ο παραλήπτης δεν έχει διεύθυνση email." in el and "The recipient has no email address." not in el
    assert "Server said 550 no" in el  # a server's own answer is shown as it is
    assert "The recipient has no email address." in text(client.get("/settings/outbox?lang=en"))


def test_audit_page_shows_translated_labels_and_keeps_the_raw_name(seeded, client):
    audit("role_changed", user_id=uid("demo.admin"), detail={"x": 1})
    audit("some_future_event", user_id=uid("demo.admin"))
    db.session.commit()
    admin(client)
    page = text(client.get("/audit?lang=el"))
    assert "Αλλαγή Κατόχου ρόλου" in page and "role_changed" in page  # label, with the raw name beside it
    assert '<option value="role_changed" >Αλλαγή Κατόχου ρόλου</option>' in page
    assert '<option value="some_future_event" >some_future_event</option>' in page  # no string: raw name
    en = text(client.get("/audit?lang=en&event=role_changed"))
    assert "Role holder changed" in en and 'value="role_changed" selected' in en


def test_every_audit_event_has_a_label_in_both_languages():
    """Events named in contract 01 and events written by the code each have `audit.event.<name>`."""
    contract = (ROOT / "docs/contracts/01-data-model.md").read_text(encoding="utf-8")
    line = next(l for l in contract.splitlines() if l.startswith("Append-only: the model exposes insert only"))
    listed = re.sub(r"\([^)]*\)", "", line.split("Events:", 1)[1].split("`notification_due` is no longer")[0])
    named = set(re.findall(r"`([a-z_]+)`", listed))
    written = set()
    for path in (ROOT / "ehire").rglob("*.py"):
        written |= set(re.findall(r"""\baudit\(\s*["']([a-z_]+)["']""", path.read_text(encoding="utf-8")))
    written.add("request_action")  # chosen by a conditional in services/request_flow.py
    events = {e for e in named | written if re.fullmatch(r"[a-z]+(_[a-z]+)*", e)}
    contract_events = {"request_action", "document_view", "document_download", "task_redirected", "setting_changed",
                       "list_changed", "role_changed", "password_changed", "login", "login_failed", "login_locked",
                       "login_unlocked", "out_of_office_changed", "mail_queued", "user_changed", "answer_kept",
                       "archive_queued", "archive_stored", "archive_failed", "archive_blocked", "archive_unblocked",
                       "archive_deferred", "archive_duplicate", "archive_event", "archive_event_ignored",
                       "archive_outcome", "archive_retry", "archive_pdf_view"}
    assert contract_events <= events
    for lang in ("el", "en"):
        table = i18n.load(lang)
        missing = sorted(e for e in events | {"notification_due"} if "audit.event." + e not in table)
        assert not missing, (lang, missing)


# ------------------------------------------------------------------ 5e/f

def test_home_empty_is_gone():
    assert "home.empty" not in i18n.load("el") and "home.empty" not in i18n.load("en")
    assert not (ROOT / "ehire/templates/home.html").exists()


def test_status_line_says_today_on_day_zero(seeded, client):
    from jinja2 import Environment

    page = (ROOT / "ehire/templates/requests/_status_line.html").read_text(encoding="utf-8")
    env = Environment()
    tpl = env.from_string(page)
    texts = {"statusline.waiting_on": "W {who}", "statusline.days.zero": "TODAY", "statusline.days.one": "ONE",
             "statusline.days.many": "MANY {n}", "role.ceo": "CEO"}
    out = {}
    for days in (0, 1, 2):
        html = tpl.render(line={"kind": "in_progress", "waiting": [{"role": "ceo", "who": None, "days": days,
                                                                    "reminded": False, "escalated": False}]},
                          t=lambda k, **p: texts[k].format(**p))
        out[days] = html
    assert "TODAY" in out[0] and "ONE" in out[1] and "MANY 2" in out[2]
    assert i18n.translate("statusline.days.zero", "el") == "σήμερα" and i18n.translate("statusline.days.one", "el") == "1 εργάσιμη ημέρα"
