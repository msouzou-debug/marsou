import re

from ehr.models import AuditLog


def _token(client):
    html = client.get("/login").get_data(as_text=True)
    return re.search(r'name="csrf_token" value="([^"]+)"', html).group(1)


def test_csrf_enforced_when_enabled(seeded, client):
    client.application.config["CSRF_ENABLED"] = True
    data = {"username": "demo.admin", "password": "demo-1234"}
    assert client.post("/login", data=data).status_code == 400
    assert client.post("/login", data={**data, "csrf_token": "wrong"}).status_code == 400
    token = _token(client)
    assert client.post("/login", data={**data, "csrf_token": token}).status_code == 302
    assert client.post("/logout").status_code == 400
    # sign-in starts a fresh session, so the old token no longer works
    assert client.post("/logout", headers={"X-CSRF-Token": token}).status_code == 400
    fresh = re.search(r'name="csrf_token" value="([^"]+)"', client.get("/settings").get_data(as_text=True))
    assert client.post("/logout", data={"csrf_token": fresh.group(1)}).status_code == 302


def test_csrf_off_in_testing_config(seeded, client):
    assert client.post("/login", data={"username": "demo.admin", "password": "demo-1234"}).status_code == 302


def test_csrf_cannot_be_disabled_outside_testing(seeded, client):
    app = client.application
    app.config["TESTING"] = False
    app.config["CSRF_ENABLED"] = False
    assert client.post("/login", data={"username": "demo.admin", "password": "demo-1234"}).status_code == 400
