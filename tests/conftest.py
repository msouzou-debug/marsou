import pytest

from ehr import create_app
from ehr.config import TestConfig
from ehr.extensions import db


@pytest.fixture
def app():
    app = create_app(TestConfig)
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
    from ehr.seed import seed_demo

    seed_demo()
    return app


def login(client, username, password="demo-1234", follow=False):
    """Sign in through the real form. Returns the response."""
    return client.post("/login", data={"username": username, "password": password}, follow_redirects=follow)
