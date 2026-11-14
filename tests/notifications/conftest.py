import pytest

from ehr.mail.backends import InMemoryBackend


@pytest.fixture
def mem(app):
    """An in-memory mail backend. Sending only happens when a test flushes the outbox or turns on auto flush."""
    backend = InMemoryBackend()
    app.config["MAIL_BACKEND_OVERRIDE"] = backend
    return backend
