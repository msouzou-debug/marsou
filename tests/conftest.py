import pytest

from ehr import create_app
from ehr.config import TestConfig


@pytest.fixture
def client():
    return create_app(TestConfig).test_client()
