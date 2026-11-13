from flask import Flask

from ehr.auth import permission_required
from tests.conftest import login


def test_settings_needs_permission(seeded, client):
    login(client, "lim.requester")
    assert client.get("/settings").status_code == 404
    login(client, "demo.admin")
    assert client.get("/settings").status_code == 200


def test_decorator_on_custom_route(seeded, client):
    @client.application.get("/_probe")
    @permission_required("audit.view")
    def probe():
        return "ok"

    assert client.get("/_probe").status_code == 302  # signed out
    login(client, "lim.hr")
    assert client.get("/_probe").status_code == 404
    login(client, "demo.admin")
    assert client.get("/_probe").data == b"ok"


def test_permissions_come_from_roles_including_substitute(seeded, app):
    from ehr.models import User

    assert User.query.filter_by(username="lim.requester").one().permissions() == {"request.create", "request.view_own"}
    deputy = User.query.filter_by(username="lim.deputy").one()
    assert "request.act" in deputy.permissions() and "request.view_directorate" in deputy.permissions()
    assert "settings.manage" not in deputy.permissions()
