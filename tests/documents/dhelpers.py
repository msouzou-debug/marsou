from io import BytesIO

from ehr.models import Request
from tests.conftest import login
from tests.requests.flowhelpers import as_user
from tests.requests.helpers import full_form


def draft(client, username="nic.requester"):
    as_user(client, username)
    resp = client.post("/requests", data=full_form(intent="draft"))
    assert resp.status_code == 302
    req = Request.query.order_by(Request.id.desc()).first()
    assert req.status == "draft"
    return req


def upload(client, rid, *files, **kwargs):
    """files: (name, bytes) pairs, all posted under the same field."""
    data = {"documents": [(BytesIO(content), name) for name, content in files]}
    return client.post("/requests/%d/documents" % rid, data=data, content_type="multipart/form-data", **kwargs)


def flashes(client):
    with client.session_transaction() as s:
        return list(s.get("_flashes", []))


def login_as(client, username):
    client.post("/logout")
    return login(client, username)
