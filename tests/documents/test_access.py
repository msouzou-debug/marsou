"""Who can view and download, audit rows, headers, Greek names, conversion."""
import os
from urllib.parse import unquote

import pytest

from ehr.extensions import db
from ehr.models import AuditLog, RequestDocument
from tests.documents import samples
from tests.documents.dhelpers import draft, login_as, upload
from tests.requests.flowhelpers import act, create


def submitted_with_doc(client, name="plan.pdf", content=None):
    req = draft(client)
    upload(client, req.id, (name, content or samples.pdf_bytes()))
    doc = RequestDocument.query.filter_by(request_id=req.id).one()
    from tests.requests.helpers import full_form
    resp = client.post("/requests/%d/edit" % req.id, data=full_form(intent="submit"))
    assert resp.status_code == 302
    return req.id, doc.id


def urls(rid, did):
    base = "/requests/%d/documents/%d" % (rid, did)
    return [base, base + "/file", base + "/file?download=1"]


def test_requester_and_directorate_approver_can_open_everything(seeded, client, storage):
    rid, did = submitted_with_doc(client)
    for user in ("nic.requester", "nic.accountant", "central.ceo"):
        login_as(client, user)
        for url in urls(rid, did):
            assert client.get(url).status_code == 200, (user, url)


@pytest.mark.parametrize("user", ["lim.requester", "lim.accountant", "lim.hr", "demo.viewer"])
def test_other_people_get_404_or_the_viewer_if_allowed(seeded, client, storage, user):
    rid, did = submitted_with_doc(client)
    login_as(client, user)
    expected = 200 if user == "demo.viewer" else 404  # the viewer role sees all requests
    for url in urls(rid, did):
        assert client.get(url).status_code == expected, (user, url)


def test_signed_out_is_sent_to_sign_in(seeded, client, storage):
    rid, did = submitted_with_doc(client)
    client.post("/logout")
    for url in urls(rid, did):
        resp = client.get(url)
        assert resp.status_code == 302 and "/login" in resp.headers["Location"]


def test_draft_documents_are_private_to_the_creator(seeded, client, storage):
    req = draft(client)
    upload(client, req.id, ("a.pdf", samples.pdf_bytes()))
    did = RequestDocument.query.filter_by(request_id=req.id).one().id
    for user in ("nic.accountant", "central.ceo", "demo.admin"):
        login_as(client, user)
        for url in urls(req.id, did):
            assert client.get(url).status_code == 404


def test_a_document_of_another_request_answers_404(seeded, client, storage):
    rid, did = submitted_with_doc(client)
    other = draft(client)
    for url in urls(other.id, did):
        assert client.get(url).status_code == 404
    assert client.get("/requests/%d/documents/99999" % rid).status_code == 404
    assert client.get("/requests/99999/documents/%d" % did).status_code == 404


def test_views_and_downloads_write_audit_rows(seeded, client, storage):
    rid, did = submitted_with_doc(client)
    login_as(client, "nic.accountant")
    client.get("/requests/%d/documents/%d" % (rid, did))
    client.get("/requests/%d/documents/%d/file?via=viewer" % (rid, did))  # what the viewer page loads: no second row
    views = AuditLog.query.filter_by(event="document_view").all()
    assert len(views) == 1 and views[0].request_id == rid and views[0].object_id == str(did)
    assert views[0].user_id is not None
    client.get("/requests/%d/documents/%d/file?download=1" % (rid, did))
    downloads = AuditLog.query.filter_by(event="document_download").all()
    assert len(downloads) == 1 and downloads[0].request_id == rid
    client.get("/requests/%d/documents/%d/file" % (rid, did))  # opened directly: counts as a view
    assert AuditLog.query.filter_by(event="document_view").count() == 2


def test_file_responses_are_safe(seeded, client, storage):
    rid, did = submitted_with_doc(client)
    for url in urls(rid, did)[1:]:
        r = client.get(url)
        assert r.headers["X-Content-Type-Options"] == "nosniff"
        assert "default-src 'none'" in r.headers["Content-Security-Policy"]
        assert "text/html" not in r.headers["Content-Type"]
        assert r.headers["Content-Type"].startswith("application/pdf")
        assert "no-store" in r.headers["Cache-Control"]
    inline = client.get(urls(rid, did)[1])
    assert inline.headers["Content-Disposition"].startswith("inline")
    assert client.get(urls(rid, did)[2]).headers["Content-Disposition"].startswith("attachment")


def test_greek_file_name_round_trips_in_content_disposition(seeded, client, storage):
    rid, did = submitted_with_doc(client, name="Έγγραφο αιτιολόγησης.pdf")
    r = client.get(urls(rid, did)[2])
    disposition = r.headers["Content-Disposition"]
    assert "filename*=UTF-8''" in disposition
    encoded = disposition.split("filename*=UTF-8''", 1)[1].split(";")[0]
    assert unquote(encoded) == "Έγγραφο αιτιολόγησης.pdf"
    assert r.data == samples.pdf_bytes()


def test_original_download_matches_what_was_uploaded(seeded, client, storage):
    rid, did = submitted_with_doc(client, name="pic.png", content=samples.png_bytes())
    r = client.get(urls(rid, did)[2])
    assert r.data == samples.png_bytes() and r.headers["Content-Type"] == "image/png"


# ------------------------------------------------------------------ conversion

def test_office_file_is_converted_once_and_cached(seeded, client, storage, fake_converter):
    rid, did = submitted_with_doc(client, name="budget.xlsx", content=samples.xlsx_bytes())
    page = client.get(urls(rid, did)[0] + "?lang=en").get_data(as_text=True)
    assert 'data-kind="pdf"' in page and "Shown as PDF" in page
    assert len(fake_converter.calls) == 1 and fake_converter.calls[0] == "document.xlsx"
    r = client.get(urls(rid, did)[1])
    assert r.headers["Content-Type"].startswith("application/pdf") and r.data.startswith(b"%PDF")
    assert len(fake_converter.calls) == 1  # second time: from the cache
    doc = db.session.get(RequestDocument, did)
    cached = storage / doc.storage_ref.replace(".bin", ".pdf")
    assert cached.exists()
    original = client.get(urls(rid, did)[2])
    assert original.data == samples.xlsx_bytes() and fake_converter.calls == ["document.xlsx"]


def test_conversion_failure_falls_back_to_download(seeded, client, storage, fake_converter):
    fake_converter.ok = False
    rid, did = submitted_with_doc(client, name="letter.docx", content=samples.docx_bytes())
    page = client.get(urls(rid, did)[0] + "?lang=en").get_data(as_text=True)
    assert 'data-kind="none"' in page and "be shown here" in page and "file?download=1" in page
    assert client.get(urls(rid, did)[1]).status_code == 404
    assert client.get(urls(rid, did)[2]).status_code == 200
    doc = db.session.get(RequestDocument, did)
    assert not (storage / doc.storage_ref.replace(".bin", ".pdf")).exists()


def test_no_converter_installed_falls_back(seeded, client, storage, monkeypatch):
    from ehr.documents.convert import NullConverter
    client.application.extensions["ehr_converter"] = NullConverter()
    rid, did = submitted_with_doc(client, name="letter.doc", content=samples.doc_bytes())
    page = client.get(urls(rid, did)[0] + "?lang=en").get_data(as_text=True)
    assert 'data-kind="none"' in page and "be shown here" in page
    assert client.get(urls(rid, did)[1]).status_code == 404


def test_converter_default_is_null_when_binary_is_missing(app):
    from ehr.documents.convert import NullConverter, default_converter
    conv = default_converter({"EHR_SOFFICE_BIN": "/nonexistent/soffice"})
    assert isinstance(conv, NullConverter) and not conv.available()


@pytest.mark.skipif(not any(os.access(os.path.join(p, "soffice"), os.X_OK)
                            for p in os.environ.get("PATH", "").split(os.pathsep)), reason="soffice not installed")
def test_real_libreoffice_conversion(tmp_path):
    import zipfile
    from ehr.documents.convert import LibreOfficeConverter
    src = tmp_path / "document.docx"
    with zipfile.ZipFile(str(src), "w") as zf:
        zf.writestr("[Content_Types].xml",
                    '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
                    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
                    '<Default Extension="xml" ContentType="application/xml"/>'
                    '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>')
        zf.writestr("_rels/.rels",
                    '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
                    '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>')
        zf.writestr("word/document.xml",
                    '<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">'
                    '<w:body><w:p><w:r><w:t>Sample line</w:t></w:r></w:p></w:body></w:document>')
    dst = tmp_path / "out.pdf"
    conv = LibreOfficeConverter()
    assert conv.available()
    assert conv.to_pdf(str(src), str(dst)) is True
    assert dst.read_bytes().startswith(b"%PDF")
