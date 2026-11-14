import pytest

from tests.documents.conftest import FakeConverter


@pytest.fixture
def fake_converter(app):
    conv = FakeConverter()
    app.extensions["ehr_converter"] = conv
    return conv
