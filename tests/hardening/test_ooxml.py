"""Crafted zips: Office files are inspected before they are accepted or converted."""
import io
import os
import zipfile

import pytest

from ehr.documents import ooxml
from ehr.models import RequestDocument
from tests.documents import samples
from tests.documents.dhelpers import draft, flashes, upload

MB = 1024 * 1024


def keys(client):
    return [m[1]["key"] if isinstance(m[1], dict) else m[1] for m in flashes(client)]


def make_zip(entries, compression=zipfile.ZIP_DEFLATED):
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", compression) as zf:
        for name, data in entries:
            zf.writestr(name, data)
    return buf.getvalue()


def docx_with(extra):
    base = [("[Content_Types].xml", "<Types/>"), ("word/document.xml", "<w:document/>")]
    return make_zip(base + extra)


def check(data, tmp_path, limit=200 * MB):
    path = tmp_path / "f.zip"
    path.write_bytes(data)
    return ooxml.is_safe(str(path), limit)


def test_real_documents_pass(tmp_path):
    assert check(samples.docx_bytes(), tmp_path) and check(samples.xlsx_bytes(), tmp_path)


def test_compression_bomb_by_ratio(tmp_path):
    bomb = docx_with([("word/media/bomb.bin", b"\0" * (5 * MB))])  # 5 MB of zeros compresses about 1000:1
    assert not check(bomb, tmp_path)


def test_small_highly_compressible_entries_are_allowed(tmp_path):
    assert check(docx_with([("word/small.xml", b"a" * 500_000)]), tmp_path)  # under the 1 MB floor


def test_ratio_floor_boundary(tmp_path):
    just_over = docx_with([("word/x.bin", b"\0" * (MB + 1))])
    assert not check(just_over, tmp_path)


def test_total_uncompressed_size_over_the_limit(tmp_path):
    import random

    rnd = random.Random(1)
    noisy = bytes(rnd.getrandbits(8) for _ in range(300_000))  # does not compress, so the ratio rule is not what fires
    data = docx_with([("word/a.bin", noisy), ("word/b.bin", noisy), ("word/c.bin", noisy)])
    assert check(data, tmp_path, limit=2 * MB)
    assert not check(data, tmp_path, limit=800_000)


def test_too_many_entries(tmp_path):
    ok = docx_with([("word/e%d.xml" % i, "x") for i in range(1990)])
    assert check(ok, tmp_path)
    assert not check(docx_with([("word/e%d.xml" % i, "x") for i in range(2001)]), tmp_path)


@pytest.mark.parametrize("name", ["../evil.xml", "word/../../evil.xml", "/etc/passwd", "\\windows\\x.xml",
                                  "C:/x.xml", "word\\..\\evil.xml"])
def test_bad_entry_paths(name, tmp_path):
    assert not check(docx_with([(name, "x")]), tmp_path)


def test_dotted_names_that_are_not_traversal_are_fine(tmp_path):
    assert check(docx_with([("word/a..b.xml", "x"), ("word/.hidden", "x")]), tmp_path)


def test_duplicate_entry_names(tmp_path):
    import warnings

    buf = io.BytesIO()
    with warnings.catch_warnings():
        warnings.simplefilter("ignore")
        with zipfile.ZipFile(buf, "w") as zf:
            zf.writestr("[Content_Types].xml", "<Types/>")
            zf.writestr("word/document.xml", "a")
            zf.writestr("word/document.xml", "b")
    assert not check(buf.getvalue(), tmp_path)


def test_damaged_zip_and_wrong_crc(tmp_path):
    assert not check(b"PK\x03\x04 not really a zip", tmp_path)
    data = bytearray(docx_with([("word/big.xml", os.urandom(2000))]))
    data[data.index(b"word/big.xml") + 40] ^= 0xFF  # flip a byte in the stored data: CRC fails when streamed
    assert not check(bytes(data), tmp_path)


# ------------------------------------------------------------------ through the upload route and the viewer

def test_upload_refuses_a_bomb_with_the_unsafe_message(seeded, client, tmp_path):
    client.application.config["EHR_STORAGE_DIR"] = str(tmp_path / "s")
    req = draft(client)
    bomb = docx_with([("word/media/bomb.bin", b"\0" * (5 * MB))])
    upload(client, req.id, ("Evil file.docx", bomb))
    assert RequestDocument.query.filter_by(request_id=req.id).count() == 0
    msg = flashes(client)[-1][1]
    assert msg["key"] == "docs.error.unsafe" and msg["params"]["name"] == "Evil file.docx"
    left = [f for _, _, files in os.walk(tmp_path / "s") for f in files]
    assert left == []  # nothing stored, temp file removed


def test_upload_accepts_a_good_docx_and_xlsx_and_a_damaged_one_is_a_type_error(seeded, client, tmp_path):
    client.application.config["EHR_STORAGE_DIR"] = str(tmp_path / "s")
    req = draft(client)
    upload(client, req.id, ("ok.docx", samples.docx_bytes()), ("ok.xlsx", samples.xlsx_bytes()), ("junk.docx", b"junk bytes here"))
    assert RequestDocument.query.filter_by(request_id=req.id).count() == 2
    assert "docs.error.type" in keys(client)


def test_limit_follows_config(seeded, client, tmp_path):
    client.application.config["EHR_STORAGE_DIR"] = str(tmp_path / "s")
    client.application.config["EHR_MAX_UNZIPPED_MB"] = 1
    req = draft(client)
    import random

    rnd = random.Random(2)
    noisy = bytes(rnd.getrandbits(8) for _ in range(400_000))
    upload(client, req.id, ("big.docx", docx_with([("word/a.bin", noisy), ("word/b.bin", noisy), ("word/c.bin", noisy)])))
    assert RequestDocument.query.filter_by(request_id=req.id).count() == 0


def test_conversion_is_refused_for_an_unsafe_stored_file(seeded, client, tmp_path, fake_converter):
    from ehr.documents import storage

    client.application.config["EHR_STORAGE_DIR"] = str(tmp_path / "s")
    req = draft(client)
    upload(client, req.id, ("ok.docx", samples.docx_bytes()))
    doc = RequestDocument.query.filter_by(request_id=req.id).one()
    path = storage.abs_path(doc.storage_ref)
    with open(path, "wb") as fh:  # swap in a bomb behind the app's back, as an old file might be
        fh.write(docx_with([("word/media/bomb.bin", b"\0" * (5 * MB))]))
    with client.application.app_context():
        assert storage.ensure_pdf(doc) is None
    assert fake_converter.calls == []
