import os

import pytest

from ehr.documents.convert import Converter, get_converter  # noqa: F401
from tests.documents.samples import pdf_bytes


class FakeConverter(Converter):
    """Writes a small PDF and counts how often it was asked."""

    def __init__(self, ok=True):
        self.ok = ok
        self.calls = []

    def available(self):
        return True

    def to_pdf(self, src_path, dst_path):
        self.calls.append(os.path.basename(src_path))
        if not self.ok:
            return False
        with open(dst_path, "wb") as fh:
            fh.write(pdf_bytes(1, ["Converted page"]))
        return True


@pytest.fixture
def storage(app, tmp_path):
    app.config["EHR_STORAGE_DIR"] = str(tmp_path / "storage")
    return tmp_path / "storage"


@pytest.fixture
def fake_converter(app):
    conv = FakeConverter()
    app.extensions["ehr_converter"] = conv
    return conv
