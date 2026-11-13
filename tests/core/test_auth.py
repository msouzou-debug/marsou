import pytest

from ehr.extensions import db
from ehr.models import AuditLog, User
from ehr.auth import hash_password, safe_next
from tests.conftest import login


def test_login_success_audited_and_lands_home(seeded, client):
    r = login(client, "lim.requester")
    assert r.status_code == 302 and r.headers["Location"] == "/"
    assert AuditLog.query.filter_by(event="login").count() == 1
    assert client.get("/", follow_redirects=False).status_code in (200, 302)


def test_login_failure_audited(seeded, client):
    r = login(client, "lim.requester", password="wrong")
    assert r.status_code == 200 and "alert-danger" in r.get_data(as_text=True)
    assert AuditLog.query.filter_by(event="login_failed").count() == 1
    assert client.get("/settings").status_code == 302  # still signed out


def test_unknown_and_inactive_user_fail(seeded, client):
    assert login(client, "nobody").status_code == 200
    User.query.filter_by(username="lim.requester").one().is_active = False
    db.session.commit()
    assert login(client, "lim.requester").status_code == 200
    assert AuditLog.query.filter_by(event="login_failed").count() == 2


def test_ad_user_cannot_sign_in_yet(seeded, client):
    User.query.filter_by(username="lim.requester").one().auth_source = "ad"
    db.session.commit()
    assert login(client, "lim.requester").status_code == 200


@pytest.mark.parametrize("target,ok", [
    ("/requests/5", True), ("/requests?tab=all", True), ("", False), (None, False),
    ("https://evil.example/", False), ("//evil.example/", False), ("/\\evil.example", False),
    ("javascript:alert(1)", False), ("requests", False), ("/a\r\nSet-Cookie: x=1", False),
])
def test_safe_next(target, ok):
    assert (safe_next(target, "DEFAULT") == target) is ok


def test_login_follows_safe_next_only(seeded, client):
    r = client.post("/login", data={"username": "demo.admin", "password": "demo-1234", "next": "/settings"})
    assert r.headers["Location"] == "/settings"
    client.post("/logout")
    r = client.post("/login", data={"username": "demo.admin", "password": "demo-1234", "next": "https://evil.example/"})
    assert r.headers["Location"] == "/"


def test_login_required_redirects_with_next(seeded, client):
    r = client.get("/settings/position")
    assert r.status_code == 302 and "next=/settings/position" in r.headers["Location"]


def test_logout_is_post_only(seeded, client):
    login(client, "demo.admin")
    assert client.get("/logout").status_code == 405
    assert client.post("/logout").status_code == 302
    assert client.get("/settings").status_code == 302


def test_forced_password_change(seeded, client):
    u = User.query.filter_by(username="lim.requester").one()
    u.must_change_password = True
    db.session.commit()
    r = login(client, "lim.requester")
    assert "/password" in r.headers["Location"]
    # every other page is held back
    assert "/password" in client.get("/settings").headers["Location"]
    r = client.post("/password", data={"password": "abc", "repeat": "abc"})
    assert r.status_code == 200 and "alert-danger" in r.get_data(as_text=True)
    r = client.post("/password", data={"password": "longenough1", "repeat": "different1"})
    assert r.status_code == 200 and "alert-danger" in r.get_data(as_text=True)
    r = client.post("/password", data={"password": "longenough1", "repeat": "longenough1"})
    assert r.status_code == 302
    db.session.expire_all()
    u = User.query.filter_by(username="lim.requester").one()
    assert not u.must_change_password
    client.post("/logout")
    assert login(client, "lim.requester", password="longenough1").headers["Location"] == "/"


def test_language_stored_on_user_and_loaded_at_login(seeded, client):
    login(client, "lim.requester")
    client.get("/login?lang=en")
    db.session.expire_all()
    assert User.query.filter_by(username="lim.requester").one().language == "en"
    client.post("/logout")
    assert 'lang="en"' in client.get("/login").get_data(as_text=True)  # kept after sign-out
    other = client.application.test_client()
    login(other, "lim.requester")
    assert 'lang="en"' in other.get("/login").get_data(as_text=True)


def test_language_switch_keeps_page(seeded, client):
    login(client, "demo.admin")
    html = client.get("/settings/position?x=1").get_data(as_text=True)
    assert "/settings/position?x=1&amp;lang=en" in html
