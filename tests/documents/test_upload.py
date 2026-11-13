"""Upload rules: type, magic bytes, size, empty files, names, hashes, storage layout."""
import hashlib
import os
import re
from urllib.parse import unquote

from ehr.extensions import db
from ehr.models import AuditLog, RequestDocument, Setting, get_setting
from tests.documents import samples
from tests.documents.dhelpers import draft, flashes, upload


def docs(rid):
    return RequestDocument.query.filter_by(request_id=rid).order_by(RequestDocument.id).all()


def test_several_files_one_refused_the_rest_kept(seeded, client, storage):
    req = draft(client)
    resp = upload(client, req.id, ("a.pdf", samples.pdf_bytes()), ("bad.exe", b"MZ" + b"\x00" * 50),
                  ("c.png", samples.png_bytes()), ("d.docx", samples.docx_bytes()))
    assert resp.status_code == 302 and resp.headers["Location"].endswith("/requests/%d/edit" % req.id)
    assert [d.file_name for d in docs(req.id)] == ["a.pdf", "c.png", "d.docx"]
    keys = [m["key"] if isinstance(m, dict) else m for _cat, m in flashes(client)]
    assert "docs.error.type" in keys and "docs.added.many" in keys
    assert AuditLog.query.filter_by(event="document_added").count() == 3
    page = client.get("/requests/%d/edit?lang=en" % req.id).get_data(as_text=True)
    assert "a.pdf" in page and "c.png" in page and ">bad.exe<" not in page


def test_all_allowed_types_are_accepted(seeded, client, storage):
    req = draft(client)
    files = [("a.pdf", samples.pdf_bytes()), ("b.doc", samples.doc_bytes()), ("c.docx", samples.docx_bytes()),
             ("d.xls", samples.xls_bytes()), ("e.xlsx", samples.xlsx_bytes()), ("f.png", samples.png_bytes()),
             ("g.jpg", samples.jpeg_bytes()), ("h.JPEG", samples.jpeg_bytes())]
    upload(client, req.id, *files)
    assert len(docs(req.id)) == len(files)


def test_type_and_magic_byte_mismatches_are_refused(seeded, client, storage):
    req = draft(client)
    upload(client, req.id,
           ("fake.pdf", b"<html><script>alert(1)</script></html>"),
           ("fake.png", b"MZ\x90\x00" + b"\x00" * 100),
           ("fake.jpg", samples.png_bytes()),
           ("fake.docx", samples.xlsx_bytes()),
           ("fake.xlsx", samples.docx_bytes()),
           ("fake.doc", samples.xls_bytes()),
           ("fake.xls", samples.doc_bytes()),
           ("plain.docx", b"just text"),
           ("page.html", b"<html></html>"),
           ("noext", samples.pdf_bytes()),
           ("script.svg", b"<svg xmlns='x'/>"))
    assert docs(req.id) == []
    assert os.listdir(str(storage / str(req.id))) == []  # nothing left behind


def test_empty_file_is_refused(seeded, client, storage):
    req = draft(client)
    upload(client, req.id, ("empty.pdf", b""))
    assert docs(req.id) == []
    assert "docs.error.empty" in [m["key"] if isinstance(m, dict) else m for _c, m in flashes(client)]


def test_size_limit_is_enforced_while_reading(seeded, client, storage):
    db.session.merge(Setting(key="max_file_mb", value="1"))
    db.session.commit()
    assert get_setting("max_file_mb") == "1"
    req = draft(client)
    big = samples.pdf_bytes() + b"0" * (1024 * 1024)
    upload(client, req.id, ("big.pdf", big), ("ok.pdf", samples.pdf_bytes()))
    assert [d.file_name for d in docs(req.id)] == ["ok.pdf"]
    flash = [m for _c, m in flashes(client) if isinstance(m, dict) and m["key"] == "docs.error.too_large"][0]
    assert flash["params"]["n"] == 1 and flash["params"]["name"] == "big.pdf"
    assert os.listdir(str(storage / str(req.id))) == [os.path.basename(docs(req.id)[0].storage_ref)]


def test_post_larger_than_the_cap_answers_with_a_message(seeded, client, storage):
    client.application.config["MAX_CONTENT_LENGTH"] = 2000
    req = draft(client)
    resp = upload(client, req.id, ("a.pdf", samples.pdf_bytes() + b"0" * 5000))
    assert resp.status_code == 302 and docs(req.id) == []


def test_row_and_file_on_disk(seeded, client, storage):
    req = draft(client)
    content = samples.pdf_bytes(3)
    upload(client, req.id, ("Σχέδιο θέσης ../../x.pdf", content))
    (doc,) = docs(req.id)
    assert doc.sha256 == hashlib.sha256(content).hexdigest()
    assert doc.size == len(content) and doc.mime == "application/pdf" and doc.round == 1
    assert doc.uploaded_by is not None and doc.uploaded_at is not None
    assert re.fullmatch(r"%d/%d-[0-9a-f]{16}\.bin" % (req.id, doc.id), doc.storage_ref)
    path = storage / doc.storage_ref
    assert path.read_bytes() == content
    assert hashlib.sha256(path.read_bytes()).hexdigest() == doc.sha256
    assert "/" not in doc.file_name and "\\" not in doc.file_name  # path parts dropped, Greek kept
    assert doc.file_name.endswith("x.pdf")


def test_stored_names_never_use_the_client_name(seeded, client, storage):
    req = draft(client)
    upload(client, req.id, ("secret-name.pdf", samples.pdf_bytes()))
    for root, _dirs, names in os.walk(str(storage)):
        assert not any("secret-name" in n for n in names)


def test_only_the_requester_of_a_draft_or_returned_request_may_upload(seeded, client, storage):
    from tests.documents.dhelpers import login_as
    req = draft(client)
    login_as(client, "lim.requester")
    assert upload(client, req.id, ("a.pdf", samples.pdf_bytes())).status_code == 404
    login_as(client, "nic.accountant")
    assert upload(client, req.id, ("a.pdf", samples.pdf_bytes())).status_code == 404
    client.post("/logout")
    assert upload(client, req.id, ("a.pdf", samples.pdf_bytes())).status_code == 302  # to sign-in
    assert docs(req.id) == []


def test_csrf_is_required(seeded, client, storage):
    client.application.config["CSRF_ENABLED"] = True
    req = draft_with_csrf(client)
    assert upload(client, req.id, ("a.pdf", samples.pdf_bytes())).status_code == 400


def draft_with_csrf(client):
    client.application.config["CSRF_ENABLED"] = False
    req = draft(client)
    client.application.config["CSRF_ENABLED"] = True
    return req
