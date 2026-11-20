import pytest
from flask.testing import FlaskClient

from ehire import create_app
from ehire.config import TestConfig
from ehire.extensions import db


class _Client(FlaskClient):
    """A GET with ?lang= answers with a redirect to the same page without it (contract 03). Most tests only want the
    page, so this client follows that one redirect. Tests of the redirect itself pass follow_lang=False."""

    def open(self, *args, **kwargs):
        follow = kwargs.pop("follow_lang", True)
        resp = super().open(*args, **kwargs)
        if (follow and resp.status_code == 302 and resp.request.method == "GET" and "lang=" in (resp.request.query_string or b"").decode()):
            return super().open(resp.headers["Location"], method="GET", headers=kwargs.get("headers"))
        return resp


@pytest.fixture
def app():
    app = create_app(TestConfig)
    app.test_client_class = _Client
    with app.app_context():
        db.create_all()
        yield app
        db.session.remove()
        db.drop_all()


@pytest.fixture
def client(app):
    return app.test_client()


@pytest.fixture
def seeded(app):
    from ehire.seed import seed_demo

    seed_demo()
    return app


def login(client, username, password="demo-1234", follow=False):
    """Sign in through the real form. Returns the response."""
    return client.post("/login", data={"username": username, "password": password}, follow_redirects=follow)
