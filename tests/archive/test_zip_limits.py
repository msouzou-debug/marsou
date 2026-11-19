"""More than 19 attachments: the zips respect eArchive's limits (answers of 16/11/2026). Sizes are crafted with small
limits set on both sides (eHire's module constants and the fake), so no test writes 50 MB."""
import hashlib
import os
import zipfile

import pytest

from ehire.archive import bundle, queue
from ehire.archive import meta as meta_mod
from ehire.documents import storage
from ehire.extensions import db
from ehire.models import AuditLog, RequestDocument
from tests.archive.ahelpers import create_with_leaver, row_of
from tests.archive.test_http_transport import make_due, submit_with
from tests.requests.flowhelpers import reload

ZIP = "Συνημμένα"


def add_sized(rid, sizes, name="doc-%02d.pdf"):
    """Documents of exact sizes (each with its own bytes, so each has its own hash)."""
    user = reload(rid).created_by
    for i, size in enumerate(sizes, 1):
        data = (b"%%PDF-1.4\n%d\n" % i + bytes([65 + i % 26]) * size)[:size]
        ref = "uploads/%d/sized-%d.pdf" % (rid, i)
        path = storage.abs_path(ref)
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, "wb") as fh:
            fh.write(data)
        db.session.add(RequestDocument(request_id=rid, round=1, file_name=name % i, mime="application/pdf",
                                       size=len(data), storage_ref=ref, sha256=hashlib.sha256(data).hexdigest(),
                                       uploaded_by=user))
    db.session.commit()


def setup(http, client, monkeypatch, fractions, total_factor=100, member_factor=1.0):
    """A request with documents of `fraction * P` bytes each, where P (the part limit) is a little above the size of
    the request PDF. Returns (request id, P)."""
    rid = create_with_leaver(client).id
    add_sized(rid, [1] * len(fractions), name="doc-%02d.pdf")  # placeholders so the PDF lists the documents
    submit_with(client, rid)
    row = row_of(rid, "submitted")
    assert queue.render_deposit(row.id)
    main = next(e for e in __import__("json").loads(row_of(rid, "submitted").manifest_json)["files"] if e["role"] == "request_pdf")
    part = main["size"] + 4000
    for doc, f in zip(RequestDocument.query.filter_by(request_id=rid).order_by(RequestDocument.id), fractions):
        size = int(part * f)
        data = (b"%%PDF-1.4\n" + bytes([65 + doc.id % 26]) * size)[:size]
        with open(storage.abs_path(doc.storage_ref), "wb") as fh:
            fh.write(data)
        doc.size, doc.sha256 = len(data), hashlib.sha256(data).hexdigest()
    db.session.commit()
    # the documents changed after the PDF listed them: render again so the manifest carries the new hashes
    row = row_of(rid, "submitted")
    row.pdf_storage_ref = row.pdf_sha256 = None
    db.session.commit()
    assert queue.render_deposit(row.id)
    main = next(e for e in __import__("json").loads(row_of(rid, "submitted").manifest_json)["files"] if e["role"] == "request_pdf")
    part = max(part, main["size"] + 200)
    monkeypatch.setattr(meta_mod, "MAX_PART_BYTES", part)
    monkeypatch.setattr(meta_mod, "MAX_FILE_BYTES", int(part * member_factor))
    monkeypatch.setattr(meta_mod, "MAX_DEPOSIT_BYTES", part * total_factor)
    http.part_limit, http.member_limit = part, int(part * member_factor)
    http.unpacked_limit = http.request_limit = part * total_factor
    return rid, part


def test_attachments_are_split_over_zips_each_within_the_part_limit(http, client, monkeypatch):
    rid, part = setup(http, client, monkeypatch, [0.3] * 22)
    assert queue.flush()["stored"] == 1
    sent = http.requests[0]
    files = sent["meta"]["files"]
    zips = [f for f in files if f["kind"] == "ATTACHMENT"]
    assert [f["filename"] for f in zips] == [ZIP + ".zip"] + ["%s (%d).zip" % (ZIP, n) for n in range(2, 9)]
    assert [f["part_name"] for f in files] == ["main"] + ["att%d" % n for n in range(1, 9)]
    assert all(f["mime"] == "application/zip" and f["size"] <= part for f in zips) and files[0]["size"] <= part
    assert len(zips) <= meta_mod.MAX_ATTACHMENTS
    assert all(len(data) <= part for data in sent["files"].values())
    members = [m for z in http.zips for m in z]  # in the order of the request's documents, none lost
    assert members == ["doc-%02d.pdf" % i for i in range(1, 23)]
    assert [len(z) for z in http.zips] == [3, 3, 3, 3, 3, 3, 3, 1]
    assert row_of(rid, "submitted").state == "stored"


def test_the_zips_are_identical_on_every_rebuild_and_the_size_is_the_built_size(http, client, monkeypatch):
    import time
    rid, part = setup(http, client, monkeypatch, [0.45] * 21)
    row = row_of(rid, "submitted")
    manifest, files = queue.files_of(row)
    m1, f1 = bundle.pack(row, manifest, files)
    time.sleep(1.1)
    m2, f2 = bundle.pack(row, manifest, files)
    zips1, zips2 = f1[1:], f2[1:]
    assert len(zips1) == 11 and [z.sha256 for z in zips1] == [z.sha256 for z in zips2]
    assert [z.path for z in zips1] == [z.path for z in zips2]
    for z in zips1:
        raw = open(z.path, "rb").read()
        assert hashlib.sha256(raw).hexdigest() == z.sha256 and len(raw) == z.size <= part
        with zipfile.ZipFile(z.path) as zf:
            assert {i.date_time for i in zf.infolist()} == {(1980, 1, 1, 0, 0, 0)}
    assert len({z.sha256 for z in zips1}) == 11 and len({z.path for z in zips1}) == 11
    # the planned size is the real size: a zip is full when one more member would not fit
    names = ["doc-%02d.pdf" % i for i in range(1, 22)]
    sizes = [e["size"] for e in manifest["files"] if e["role"] == "document"]
    groups = bundle.plan(names, sizes)
    for group, z in zip(groups, zips1):
        assert z.size == bundle.END_RECORD + sum(bundle.MEMBER_OVERHEAD + 2 * len(names[i]) + sizes[i] for i in group)


def test_a_retry_of_a_deposit_with_several_zips_replays_it(http, client, monkeypatch):
    rid, _ = setup(http, client, monkeypatch, [0.4] * 21)
    queue.flush()
    row_of(rid, "submitted").state = "queued"
    db.session.commit()
    assert queue.flush()["stored"] == 1
    assert [r["status"] for r in http.requests] == [201, 200] and len(http.filed) == 1
    assert http.requests[0]["files"] == http.requests[1]["files"]


def test_a_single_attachment_over_the_limit_cannot_be_sent_and_is_named(http, client, monkeypatch):
    rid, part = setup(http, client, monkeypatch, [0.1] * 19 + [1.2])
    queue.flush()
    row = row_of(rid, "submitted")
    assert row.state == "blocked" and row.error_code == "FILE_TOO_BIG" and http.requests == []
    assert "doc-20.pdf" in row.last_error and "MB" in row.last_error


def test_a_file_that_fits_alone_but_not_in_a_zip_with_its_headers_is_blocked_not_sent(http, client, monkeypatch):
    rid, part = setup(http, client, monkeypatch, [0.1] * 20)
    big = RequestDocument.query.filter_by(request_id=rid).order_by(RequestDocument.id).all()[3]
    data = b"x" * (part - 20)  # under the part limit, but the zip around it is not
    with open(storage.abs_path(big.storage_ref), "wb") as fh:
        fh.write(data)
    big.size, big.sha256 = len(data), hashlib.sha256(data).hexdigest()
    db.session.commit()
    row = row_of(rid, "submitted")
    row.pdf_storage_ref = row.pdf_sha256 = None
    db.session.commit()
    queue.flush()
    row = row_of(rid, "submitted")
    assert row.state == "blocked" and row.error_code == "FILE_TOO_BIG" and "doc-04.pdf" in row.last_error
    assert http.requests == []


def test_a_request_over_the_whole_limit_is_blocked_with_the_reason(http, client, monkeypatch):
    rid, part = setup(http, client, monkeypatch, [0.9] * 21, total_factor=5)
    queue.flush()
    row = row_of(rid, "submitted")
    assert row.state == "blocked" and row.error_code == "DEPOSIT_TOO_BIG" and "MB" in row.last_error
    assert http.requests == []


def test_more_zips_than_attachment_parts_is_blocked(http, client, monkeypatch):
    rid, part = setup(http, client, monkeypatch, [0.8] * 20)  # one per zip: 20 zips
    queue.flush()
    row = row_of(rid, "submitted")
    assert row.state == "blocked" and row.error_code == "DEPOSIT_TOO_BIG" and http.requests == []


def test_a_refused_part_from_eArchive_is_blocked_and_nothing_is_dropped(http, client, monkeypatch):
    rid, part = setup(http, client, monkeypatch, [0.3] * 22)
    http.part_limit = part // 2  # eArchive's limit is lower than eHire thinks
    queue.flush()
    row = row_of(rid, "submitted")
    assert row.state == "blocked" and row.error_code == "FILE_TOO_LARGE" and row.last_error.startswith("FILE_TOO_LARGE: ")
    assert http.requests[-1]["status"] == 413 and http.filed == {}
    assert AuditLog.query.filter_by(event="archive_blocked", request_id=rid).count() == 1
    http.part_limit = part
    row.state = "queued"
    db.session.commit()
    make_due()
    assert queue.flush()["stored"] == 1


def test_up_to_nineteen_attachments_still_go_singly_each_within_the_part_limit(http, client, monkeypatch):
    rid, part = setup(http, client, monkeypatch, [0.4] * 19)
    assert queue.flush()["stored"] == 1
    files = http.requests[0]["meta"]["files"]
    assert len(files) == 20 and {f["mime"] for f in files} == {"application/pdf"} and http.zips == []


def test_the_fake_enforces_the_part_limit_on_the_zip_and_the_unpacked_limits(http):
    import io
    from tests.archive.fake_earchive import Refusal

    def zipped(sizes):
        buf = io.BytesIO()
        with zipfile.ZipFile(buf, "w") as zf:
            for i, n in enumerate(sizes):
                zf.writestr("f%d.pdf" % i, b"x" * n)
        return buf.getvalue()

    def check(data, **limits):
        for k, v in limits.items():
            setattr(http, k, v)
        entry = {"kind": "ATTACHMENT", "part_name": "att1", "filename": "Συνημμένα.zip", "mime": "application/zip",
                 "size": len(data), "sha256": hashlib.sha256(data).hexdigest()}
        http._check_files({"files": [entry]}, {"att1": data})

    data = zipped([100, 100])
    check(data, part_limit=len(data), member_limit=100, unpacked_limit=200, request_limit=len(data))
    with pytest.raises(Refusal) as err:
        check(data, part_limit=len(data) - 1)
    assert (err.value.status, err.value.code) == (413, "FILE_TOO_LARGE")
    with pytest.raises(Refusal) as err:
        check(data, part_limit=len(data), member_limit=99)  # a file inside is too big
    assert err.value.status == 413 and "inside the zip" in err.value.message
    with pytest.raises(Refusal) as err:
        check(data, member_limit=100, unpacked_limit=199)  # the files together are too big
    assert err.value.status == 413 and "together" in err.value.message
    with pytest.raises(Refusal) as err:
        check(data, unpacked_limit=200, request_limit=len(data) - 1)
    assert err.value.status == 413
