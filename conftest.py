"""
pytest fixtures. The environment itself lives in taep_harness.py, so the acceptance
document generator runs against exactly the same setup the tests do.
"""
import pytest

import taep
import taep_harness


# Kept as a module-level name because the tests import it directly.
_make_db = taep_harness.make_db


@pytest.fixture
def ctx(tmp_path):
    """A module ctx with the schema created but no master data loaded."""
    return taep_harness.make_ctx(tmp_path, seed=False)


@pytest.fixture
def seeded(tmp_path):
    """ctx with the master data loaded."""
    return taep_harness.make_ctx(tmp_path, seed=True)


@pytest.fixture
def app(seeded, tmp_path):
    """A real Flask app with the module registered, standing in for eFinance."""
    return taep_harness.make_app(seeded, tmp_path)


@pytest.fixture
def client(app):
    """A logged-in clerk at Nicosia General."""
    test_client = app.test_client()
    with test_client.session_transaction() as sess:
        sess["user_id"] = 1
        sess["hospital_code"] = "NGH"
    return test_client
