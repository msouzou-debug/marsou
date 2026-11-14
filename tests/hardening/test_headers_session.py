"""Security headers on every response, session cookie flags, idle and absolute timeouts, session rotation."""
import re
import time

import pytest

from ehr import create_app
from ehr.config import TestConfig
from ehr.extensions import db
from ehr.security import CSP
from tests.conftest import login
from tests.requests.flowhelpers import as_user


def check_headers(resp, html=True):
    h = resp.headers
    assert h["Content-Security-Policy"]
    assert h["X-Content-Type-Options"] == "nosniff"
    assert h["X-Frame-Options"] in ("DENY", "SAMEORIGIN")
    assert h["Referrer-Policy"] == "same-origin"
    assert "camera=()" in h["Permissions-Policy"]
    if html:
        assert "no-store" in h["Cache-Control"]


def test_csp_as_shipped():
    assert "default-src 'self'" in CSP and "script-src 'self'" in CSP
    assert "'unsafe-inline'" not in CSP.split("script-src")[1].split(";")[0]
    assert "worker-src 'self' blob:" in CSP and "img-src 'self' data: blob:" in CSP
    assert "frame-ancestors 'none'" in CSP and "object-src 'none'" in CSP and "form-action 'self'" in CSP


def test_every_get_page_sends_the_headers(seeded, client):
    """Walk every parameterless GET route as an admin and also signed out."""
    as_user(client, "demo.admin")
    paths = sorted({r.rule for r in client.application.url_map.iter_rules()
                    if "GET" in r.methods and not r.arguments and r.endpoint != "static"})
    assert "/audit" in paths and "/settings" in paths and "/login" in paths
    for path in paths:
        resp = client.get(path)
        check_headers(resp)
        assert resp.headers["X-Frame-Options"] == "DENY", path
    client.post("/logout")
    for path in ("/login", "/requests", "/audit", "/nope"):
        check_headers(client.get(path))


def test_error_and_redirect_responses_have_headers(seeded, client):
    check_headers(client.get("/does-not-exist"))
    check_headers(client.post("/login", data={"username": "x", "password": "y"}))


def test_static_files_are_not_forced_to_no_store(client):
    resp = client.get("/static/css/ehr.css")
    assert resp.status_code == 200 and resp.headers["X-Content-Type-Options"] == "nosniff"
    assert "no-store" not in resp.headers.get("Cache-Control", "")


def test_email_preview_keeps_its_own_csp_and_may_be_framed_by_this_site(seeded, client):
    from ehr.mail.outbox import flush  # noqa: F401
    from ehr.models import MailOutbox

    as_user(client, "demo.admin")
    row = MailOutbox(event="task_opened", subject="s", text="t", html="<p style=\"color:red\">hi</p>", to_email="a@example.invalid")
    db.session.add(row)
    db.session.commit()
    resp = client.get("/settings/outbox/%d" % row.id)
    assert resp.status_code == 200
    assert resp.headers["X-Frame-Options"] == "SAMEORIGIN"
    assert "img-src 'self'" in resp.headers["Content-Security-Policy"] and "frame-ancestors 'self'" in resp.headers["Content-Security-Policy"]
    assert "sandbox" in resp.get_data(as_text=True)
    assert client.get("/settings/outbox").headers["X-Frame-Options"] == "DENY"


def test_document_files_are_never_cached(seeded, client, tmp_path):
    from tests.documents import samples
    from tests.documents.dhelpers import draft, upload

    client.application.config["EHR_STORAGE_DIR"] = str(tmp_path / "s")
    req = draft(client)
    upload(client, req.id, ("a.pdf", samples.pdf_bytes(1, ["x"])))
    from ehr.models import RequestDocument

    doc = RequestDocument.query.filter_by(request_id=req.id).one()
    for url in ("/requests/%d/documents/%d/file" % (req.id, doc.id), "/requests/%d/documents/%d/file?download=1" % (req.id, doc.id)):
        resp = client.get(url)
        assert resp.status_code == 200 and "no-store" in resp.headers["Cache-Control"]
        assert resp.headers["X-Content-Type-Options"] == "nosniff"
        assert "default-src 'none'" in resp.headers["Content-Security-Policy"]
        assert resp.headers["X-Frame-Options"] == "DENY"


def test_hsts_only_when_https(seeded, client):
    assert "Strict-Transport-Security" not in client.get("/login").headers
    client.application.config["EHR_HTTPS"] = True
    resp = client.get("/login")
    assert resp.headers["Strict-Transport-Security"].startswith("max-age=")
    assert "includeSubDomains" not in resp.headers["Strict-Transport-Security"]  # shared host


# ----------------------------------------------------------------------------------------------- session

def cookie_header(resp):
    return [v for k, v in resp.headers.items() if k.lower() == "set-cookie" and v.startswith("ehr_session")]


def test_session_cookie_flags(seeded, client):
    resp = login(client, "nic.requester")
    cookie = cookie_header(resp)[0]
    assert "HttpOnly" in cookie and "SameSite=Lax" in cookie and "Secure" not in cookie
    assert "Expires=" in cookie  # permanent: the absolute lifetime is also the cookie's life


def test_secure_cookie_when_https(seeded):
    class Https(TestConfig):
        SESSION_COOKIE_SECURE = True

    app = create_app(Https)
    with app.app_context():
        db.create_all()
        from ehr.seed import seed_demo

        seed_demo()
        cookie = cookie_header(login(app.test_client(), "nic.requester"))[0]
        assert "Secure" in cookie
        db.session.remove()
        db.drop_all()


def set_stamps(client, **shift):
    with client.session_transaction() as s:
        for key, seconds in shift.items():
            s[key] = s[key] - seconds


def test_idle_timeout_signs_out(seeded, client):
    login(client, "nic.requester")
    assert client.get("/requests").status_code == 200
    set_stamps(client, _last=31 * 60)
    resp = client.get("/requests")
    assert resp.status_code == 302 and "/login" in resp.headers["Location"]
    with client.session_transaction() as s:
        assert "user_id" not in s


def test_activity_keeps_the_session_alive(seeded, client):
    login(client, "nic.requester")
    set_stamps(client, _last=20 * 60)
    assert client.get("/requests").status_code == 200  # refreshes _last
    set_stamps(client, _last=20 * 60)
    assert client.get("/requests").status_code == 200


def test_absolute_lifetime_signs_out_even_when_active(seeded, client):
    login(client, "nic.requester")
    set_stamps(client, _born=13 * 3600)
    assert client.get("/requests").status_code == 302
    login(client, "nic.requester")
    set_stamps(client, _born=11 * 3600)
    assert client.get("/requests").status_code == 200


def test_timeouts_are_configurable(seeded, client):
    client.application.config["SESSION_IDLE_MINUTES"] = 1
    login(client, "nic.requester")
    set_stamps(client, _last=90)
    assert client.get("/requests").status_code == 302


def test_expired_session_keeps_only_the_language(seeded, client):
    login(client, "nic.requester")
    client.get("/requests?lang=en")
    set_stamps(client, _last=3600)
    client.get("/requests")
    with client.session_transaction() as s:
        assert set(s.keys()) <= {"lang", "_csrf", "_flashes"}


def test_sign_in_rotates_the_session(seeded, client):
    client.application.config["CSRF_ENABLED"] = True
    html = client.get("/login").get_data(as_text=True)
    token = re.search(r'name="csrf_token" value="([^"]+)"', html).group(1)
    with client.session_transaction() as s:
        s["planted"] = "x"  # something an attacker set before sign-in
        before = s.get("_sid")
    client.post("/login", data={"username": "nic.requester", "password": "demo-1234", "csrf_token": token})
    with client.session_transaction() as s:
        assert "planted" not in s and "_csrf" not in s and s["_sid"] and s["_sid"] != before
        first = s["_sid"]
    client.post("/logout", data={"csrf_token": re.search(r'name="csrf_token" value="([^"]+)"', client.get("/requests").get_data(as_text=True)).group(1)})
    with client.session_transaction() as s:
        assert "user_id" not in s and "_sid" not in s and "_born" not in s
    login_again = client.get("/login").get_data(as_text=True)
    token = re.search(r'name="csrf_token" value="([^"]+)"', login_again).group(1)
    client.post("/login", data={"username": "nic.requester", "password": "demo-1234", "csrf_token": token})
    with client.session_transaction() as s:
        assert s["_sid"] != first
