"""Remove rules and rounds: nothing is deleted after submission; scenario 5 with documents."""
import os

from ehr.models import AuditLog, Request, RequestDocument
from tests.documents import samples
from tests.documents.dhelpers import draft, flashes, login_as, upload
from tests.requests.flowhelpers import act, as_user, create, reload
from tests.requests.helpers import full_form


def docs(rid):
    return RequestDocument.query.filter_by(request_id=rid).order_by(RequestDocument.id).all()


def remove(client, rid, did, **kw):
    return client.post("/requests/%d/documents/%d/remove" % (rid, did), **kw)


def test_remove_on_a_draft_deletes_row_and_file(seeded, client, storage):
    req = draft(client)
    upload(client, req.id, ("a.pdf", samples.pdf_bytes()), ("b.png", samples.png_bytes()))
    first, second = docs(req.id)
    path = storage / first.storage_ref
    assert path.exists()
    resp = remove(client, req.id, first.id)
    assert resp.status_code == 302 and resp.headers["Location"].endswith("/requests/%d/edit" % req.id)
    assert [d.id for d in docs(req.id)] == [second.id] and not path.exists()
    row = AuditLog.query.filter_by(event="document_removed").one()
    assert row.object_id == str(first.id) and row.request_id == req.id


def test_only_the_requester_may_remove(seeded, client, storage):
    req = draft(client)
    upload(client, req.id, ("a.pdf", samples.pdf_bytes()))
    did = docs(req.id)[0].id
    login_as(client, "lim.requester")
    assert remove(client, req.id, did).status_code == 404
    login_as(client, "nic.accountant")
    assert remove(client, req.id, did).status_code == 404
    assert len(docs(req.id)) == 1


def test_a_document_of_another_request_cannot_be_removed_through_this_one(seeded, client, storage):
    one = draft(client)
    upload(client, one.id, ("a.pdf", samples.pdf_bytes()))
    two = draft(client)
    did = docs(one.id)[0].id
    assert remove(client, two.id, did).status_code == 404
    assert len(docs(one.id)) == 1


def test_nothing_is_deleted_after_submission(seeded, client, storage):
    req = draft(client)
    upload(client, req.id, ("a.pdf", samples.pdf_bytes()))
    did = docs(req.id)[0].id
    client.post("/requests/%d/edit" % req.id, data=full_form(intent="submit"))
    assert reload(req.id).status == "in_progress"
    resp = remove(client, req.id, did)
    assert resp.status_code == 302 and "/edit" not in resp.headers["Location"]
    assert "docs.error.locked" in [m["key"] if isinstance(m, dict) else m for _c, m in flashes(client)]
    assert len(docs(req.id)) == 1 and (storage / docs(req.id)[0].storage_ref).exists()
    assert AuditLog.query.filter_by(event="document_removed").count() == 0
    assert upload(client, req.id, ("b.pdf", samples.pdf_bytes())).status_code == 404  # no uploads after submission


def test_returned_request_removes_only_documents_added_since_the_return(seeded, client, storage):
    req = draft(client)
    upload(client, req.id, ("old.pdf", samples.pdf_bytes()))
    client.post("/requests/%d/edit" % req.id, data=full_form(intent="submit"))
    old = docs(req.id)[0]
    assert act(client, "nic.accountant", req.id, "return", comment="Attach the plan.").status_code == 302
    as_user(client, "nic.requester")
    upload(client, req.id, ("new.pdf", samples.pdf_bytes()))
    old, new = docs(req.id)
    assert (old.round, new.round) == (1, 2)
    assert remove(client, req.id, old.id).status_code == 302
    assert len(docs(req.id)) == 2  # refused
    assert "docs.error.locked" in [m["key"] if isinstance(m, dict) else m for _c, m in flashes(client)]
    assert remove(client, req.id, new.id).status_code == 302
    assert [d.id for d in docs(req.id)] == [old.id]


def test_scenario_5_return_at_step_2_resubmit_with_a_new_document(seeded, client, storage):
    req = draft(client)
    upload(client, req.id, ("first.pdf", samples.pdf_bytes()))
    client.post("/requests/%d/edit" % req.id, data=full_form(intent="submit"))
    rid = req.id
    act(client, "nic.accountant", rid, "return", comment="Attach the job description.")
    assert reload(rid).status == "returned"

    as_user(client, "nic.requester")
    edit = client.get("/requests/%d/edit?lang=en" % rid).get_data(as_text=True)
    assert "first.pdf" in edit and 'name="documents"' in edit and "Round 1" in edit
    upload(client, rid, ("job-description.docx", samples.docx_bytes()))
    data = full_form(intent="resubmit", need_text="A corrected need.")
    data["resubmit_note"] = "Added the job description."
    resp = client.post("/requests/%d/edit" % rid, data=data)
    assert resp.status_code == 302
    r = reload(rid)
    assert (r.status, r.round) == ("in_progress", 2)
    assert [(d.file_name, d.round) for d in docs(rid)] == [("first.pdf", 1), ("job-description.docx", 2)]

    for user in ("nic.requester", "nic.accountant"):
        as_user(client, user)
        page = client.get("/requests/%d?lang=en" % rid).get_data(as_text=True)
        assert "first.pdf" in page and "job-description.docx" in page
        assert "Round 1" in page and "Round 2" in page and "2 documents" in page
