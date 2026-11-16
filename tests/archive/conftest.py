import shutil

import pytest

from ehr.documents.convert import Converter
from ehr.archive.transports import DepositFile, Transport  # noqa: F401


class HtmlConverter(Converter):
    """Stands in for LibreOffice: the 'PDF' is a PDF header followed by the HTML it was asked to convert."""

    def __init__(self, ok=True):
        self.ok = ok
        self.calls = 0

    def available(self):
        return True

    def to_pdf(self, src_path, dst_path):
        self.calls += 1
        if not self.ok:
            return False
        with open(src_path, "rb") as src, open(dst_path, "wb") as dst:
            dst.write(b"%PDF-1.4\n% fake\n" + src.read())
        return True


class RecordingTransport(Transport):
    name = "recording"
    delivers = True

    def __init__(self, fail=0):
        self.calls, self.fail = [], fail

    def deposit(self, manifest, files):
        self.calls.append((manifest, files))
        if self.fail:
            self.fail -= 1
            raise RuntimeError("eArchive is down")
        return "ref-%s" % manifest["folder"]


@pytest.fixture
def stor(app, tmp_path):
    app.config["EHR_STORAGE_DIR"] = str(tmp_path / "storage")
    return tmp_path / "storage"


@pytest.fixture
def conv(app):
    c = HtmlConverter()
    app.extensions["ehr_converter"] = c
    return c


@pytest.fixture
def transport(app):
    t = RecordingTransport()
    app.config["ARCHIVE_TRANSPORT_OVERRIDE"] = t
    return t


@pytest.fixture
def drop(app, tmp_path):
    path = tmp_path / "drop"
    path.mkdir()
    app.config["EHR_ARCHIVE_DROP_DIR"] = str(path)
    return path


needs_soffice = pytest.mark.skipif(shutil.which("soffice") is None and shutil.which("libreoffice") is None,
                                   reason="LibreOffice is not installed")
