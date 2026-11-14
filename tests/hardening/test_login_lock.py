"""Sign-in protection: lock after repeated failures, no user enumeration, audit, CLI unlock."""
from datetime import timedelta

from ehr.auth import _check_credentials
from ehr.extensions import db
from ehr.models import AuditLog, LoginAttempt, User, utcnow
from tests.conftest import login


def fail(client, name="nic.requester", n=1, password="wrong-password"):
    resp = None
    for _ in range(n):
        resp = login(client, name, password=password)
    return resp


def test_five_failures_lock_the_username_for_fifteen_minutes(seeded, client):
    for _ in range(4):
        assert fail(client).status_code == 200
    fifth = fail(client)
    assert fifth.status_code == 429
    assert "15" in fifth.get_data(as_text=True)  # login.locked {n}
    # the right password is refused while locked, and no session starts
    right = login(client, "nic.requester")
    assert right.status_code == 429
    assert client.get("/requests").status_code == 302
    # other users are not affected
    assert login(client, "lim.requester").status_code == 302


def test_lock_ends_after_the_window(seeded, client):
    fail(client, n=5)
    assert login(client, "nic.requester").status_code == 429
    for row in LoginAttempt.query.all():
        row.at = utcnow() - timedelta(minutes=16)
    db.session.commit()
    assert login(client, "nic.requester").status_code == 302


def test_remaining_minutes_shrink(seeded, client):
    fail(client, n=5)
    for row in LoginAttempt.query.all():
        row.at = utcnow() - timedelta(minutes=10)
    db.session.commit()
    html = login(client, "nic.requester").get_data(as_text=True)
    assert ("5" in html) and ("15" not in html.split("alert-danger")[1].split("</div>")[0])


def test_successful_login_clears_the_counter(seeded, client):
    fail(client, n=4)
    assert login(client, "nic.requester").status_code == 302
    assert LoginAttempt.query.filter_by(username="nic.requester").count() == 0
    client.post("/logout")
    fail(client, n=4)
    assert login(client, "nic.requester").status_code == 302  # would be locked if the old four still counted


def test_lock_is_case_insensitive_and_covers_unknown_names_the_same_way(seeded, client):
    a = fail(client, "Nobody.Here", n=5)
    assert a.status_code == 429
    b = fail(client, "nobody.here")
    assert b.status_code == 429
    real = fail(client, "NIC.REQUESTER", n=5)
    assert real.status_code == 429  # same behaviour for a real user: nothing to tell them apart


def test_same_message_for_unknown_user_wrong_password_and_inactive(seeded, client):
    User.query.filter_by(username="lim.requester").one().is_active = False
    db.session.commit()
    pages = []
    for name in ("no.such.user", "nic.requester", "lim.requester"):
        r = login(client, name, password="bad-password")
        assert r.status_code == 200
        body = r.get_data(as_text=True)
        pages.append(body.split("alert-danger")[1].split("</div>")[0])
    assert len(set(pages)) == 1


def test_a_password_hash_check_runs_for_every_failure_path(seeded, monkeypatch):
    calls = []
    import ehr.auth as auth

    real = auth.check_password_hash
    monkeypatch.setattr(auth, "check_password_hash", lambda h, p: calls.append(1) or real(h, p))
    user = User.query.filter_by(username="nic.requester").one()
    assert _check_credentials(None, "x") is False
    assert _check_credentials(user, "wrong") is False
    inactive = User.query.filter_by(username="lim.requester").one()
    inactive.is_active = False
    assert _check_credentials(inactive, "x") is False
    ad = User.query.filter_by(username="lim.hr").one()
    ad.auth_source = "ad"
    assert _check_credentials(ad, "x") is False
    nohash = User.query.filter_by(username="lar.hr").one()
    nohash.password_hash = None
    assert _check_credentials(nohash, "x") is False
    assert len(calls) == 5


def test_locked_attempts_also_cost_a_hash_check(seeded, client, monkeypatch):
    fail(client, n=5)
    calls = []
    import ehr.auth as auth

    real = auth.check_password_hash
    monkeypatch.setattr(auth, "check_password_hash", lambda h, p: calls.append(1) or real(h, p))
    login(client, "nic.requester")
    assert calls


def test_audit_rows_login_failed_and_login_locked_once(seeded, client):
    fail(client, n=7)
    assert AuditLog.query.filter_by(event="login_failed").count() == 5  # locked attempts are not recorded again
    locked = AuditLog.query.filter_by(event="login_locked").all()
    assert len(locked) == 1 and locked[0].user_id == User.query.filter_by(username="nic.requester").one().id


def test_audit_never_keeps_a_typed_unknown_name_or_the_password(seeded, client):
    fail(client, "my-secret-Passw0rd!", n=1, password="another-Secret-123")
    row = AuditLog.query.filter_by(event="login_failed").one()
    text = row.detail_json or ""
    assert "Passw0rd" not in text and "another-Secret" not in text and "unknown_user" in text
    fail(client, "nic.requester", n=1, password="another-Secret-123")
    for r in AuditLog.query.all():
        assert "another-Secret" not in (r.detail_json or "")


def test_ip_ceiling_across_many_usernames(seeded, client):
    for i in range(19):
        assert login(client, "guess%d" % i, password="x").status_code == 200
    assert login(client, "guess19", password="x").status_code == 429
    assert login(client, "lim.requester").status_code == 429  # even a valid user from that address
    from ehr.models import AuditLog as A

    assert A.query.filter_by(event="login_locked").count() >= 1


def test_ip_lock_is_per_address(seeded, client):
    for i in range(20):
        client.post("/login", data={"username": "g%d" % i, "password": "x"}, environ_overrides={"REMOTE_ADDR": "10.0.0.5"})
    r = client.post("/login", data={"username": "lim.requester", "password": "demo-1234"}, environ_overrides={"REMOTE_ADDR": "10.0.0.6"})
    assert r.status_code == 302


def test_cli_unlock_user(seeded, client):
    fail(client, n=5)
    assert login(client, "nic.requester").status_code == 429
    runner = client.application.test_cli_runner()
    result = runner.invoke(args=["unlock-user", "NIC.requester"])
    assert result.exit_code == 0 and "Cleared 5" in result.output
    assert AuditLog.query.filter_by(event="login_unlocked").count() == 1
    assert login(client, "nic.requester").status_code == 302


def test_old_attempts_are_swept(seeded, client):
    fail(client, n=1)
    row = LoginAttempt.query.one()
    row.at = utcnow() - timedelta(days=2)
    db.session.commit()
    fail(client, "lim.requester", n=1)
    assert LoginAttempt.query.filter_by(username="nic.requester").count() == 0
