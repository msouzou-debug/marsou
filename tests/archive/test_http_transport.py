"""The HTTP transport against a local fake of eArchive's ingest route (tests/archive/fake_earchive.py)."""
import hashlib
import json
import logging
import re
from datetime import datetime, timedelta, timezone

import pytest

from ehire.archive import meta as meta_mod
from ehire.archive import queue, transports
from ehire.archive.transports import ArchiveError, HttpTransport, check_url
from ehire.documents import storage
from ehire.extensions import db
from ehire.models import ArchiveDeposit, AuditLog, Facility, RequestDocument, Setting
from tests.archive.ahelpers import approve_all, create_with_leaver, deposits, kinds, rich_request, row_of
from tests.archive.fake_earchive import TOKEN, FakeEArchive, free_port
from tests.documents.samples import pdf_bytes
from tests.requests.flowhelpers import act, as_user, create, reload, text

META_NAMES = {"schema_version", "outbox_id", "sent_at", "source_system", "source_module", "source_ref", "sender_ref",
              "doc_type", "subject", "direction", "sender_name", "letter_date", "event_date", "category",
              "classification", "personal_data", "personal_data_category", "folder_hints", "attributes", "amount",
              "currency", "related", "approvals", "files"}


def make_due():
    ArchiveDeposit.query.update({"next_attempt_at": None})
    db.session.commit()


def add_documents(rid, n, name="supporting-%02d.pdf"):
    user = reload(rid).created_by
    for i in range(1, n + 1):
        data = pdf_bytes(1, ["Sample page %d" % i])
        ref = "uploads/%d/%d.pdf" % (rid, i)
        path = storage.abs_path(ref)
        import os
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, "wb") as fh:
            fh.write(data)
        db.session.add(RequestDocument(request_id=rid, round=1, file_name=(name % i) if "%" in name else name, mime="application/pdf",
                                       size=len(data), storage_ref=ref, sha256=hashlib.sha256(data).hexdigest(),
                                       uploaded_by=user))
    db.session.commit()


# ------------------------------------------------------------------ happy path and the meta

def test_submitted_then_decided_with_the_supersedes_link(http, client):
    rid = create(client).id
    counts = queue.flush()
    assert counts["stored"] == 1 and len(http.requests) == 1
    first = row_of(rid, "submitted")
    assert first.state == "stored" and first.protocol_number == "ΑΔ/2026/00001" and first.protocol_id == "p-0001"
    assert first.url.startswith("http://127.0.0.1:5011/protocols/") and first.archive_ref == first.protocol_number
    sent = http.requests[0]
    assert sent["meta"]["source_ref"] == "position_request:ΑΕΘ-2026-0001:submitted"
    assert "event_date" not in sent["meta"] and "related" not in sent["meta"] and "amount" not in sent["meta"]
    approve_all(client, rid)
    assert queue.flush()["stored"] == 1
    second = row_of(rid, "decided")
    assert second.state == "stored" and second.protocol_number == "ΑΔ/2026/00002"
    meta = http.requests[1]["meta"]
    assert meta["source_ref"] == "position_request:ΑΕΘ-2026-0001:decided"
    assert meta["related"] == [{"source_ref": "position_request:ΑΕΘ-2026-0001:submitted", "relation": "SUPERSEDES"}]
    assert meta["doc_type"] == "Αίτημα θέσης — εγκρίθηκε" and meta["event_date"]
    assert meta["amount"] == 50000.0 and meta["currency"] == "EUR"
    assert [r["status"] for r in http.requests] == [201, 201]
    assert AuditLog.query.filter_by(event="archive_stored").count() == 2


def test_the_meta_has_exactly_the_fields_of_the_note_and_no_personal_names(http, client):
    rid = rich_request(client)
    queue.flush()
    meta = http.requests[1]["meta"]
    assert set(meta) <= META_NAMES and set(meta) == META_NAMES - set()
    assert meta["schema_version"] == 1 and meta["outbox_id"] == row_of(rid, "decided").id
    assert re.match(r"^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\+0[23]:00$", meta["sent_at"])  # Cyprus offset
    assert (meta["source_system"], meta["source_module"], meta["direction"]) == ("eHire", "position_request", "INTERNAL")
    assert meta["sender_ref"] == "ΑΕΘ-2026-0001" and meta["classification"] == "HIGHLY_SENSITIVE"
    assert meta["personal_data"] is True and meta["personal_data_category"] == "Στοιχεία προσωπικού"
    assert meta["category"] == "Προσλήψεις" and meta["folder_hints"] == [{"hospital": "NGH"}]
    assert meta["sender_name"] == "Λευκωσίας" or meta["sender_name"]
    assert set(meta["attributes"]) == {"cost_centre", "staff_category", "position_title", "posts"}
    assert meta["attributes"]["posts"] == "2" and all(isinstance(v, str) and len(v) <= 300 for v in meta["attributes"].values())
    for name in ("Maria Test Leaver", "Andreas Sample Person", "Nic"):
        assert name not in meta["subject"]
    assert meta["subject"].startswith("Αίτημα για 2 θέσεις")
    approvals = meta["approvals"]
    assert approvals[0]["action"] == "Υποβλήθηκε" and approvals[0]["role"] == "Αιτητής"
    assert all(set(a) <= {"actor_name", "role", "action", "at", "comment"} for a in approvals)
    assert any("Αντικαταστάθηκε από μεταγενέστερη απάντηση" in a["action"] for a in approvals)
    assert [f["part_name"] for f in meta["files"]] == ["main", "att1", "att2"]
    assert [f["kind"] for f in meta["files"]] == ["MAIN", "ATTACHMENT", "ATTACHMENT"]
    assert all(set(f) == {"kind", "part_name", "filename", "mime", "size", "sha256"} for f in meta["files"])
    assert all(f["mime"] == "application/pdf" for f in meta["files"])
    assert meta["files"][0]["filename"] == "ΑΕΘ-2026-0001 — απόφαση.pdf"  # the title staff see, in Greek
    assert meta["files"][1]["filename"] == "job-description.pdf"
    assert set(http.requests[1]["files"]) == {"main", "att1", "att2"}


def test_the_headers_are_the_ones_the_note_asks_for_and_nothing_forwarded(http, client):
    rid = create(client).id
    queue.flush()
    h = http.requests[0]["headers"]
    assert h["authorization"] == "Bearer " + TOKEN and h["idempotency-key"] == "ehire:%d" % row_of(rid, "submitted").id
    assert h["content-type"].startswith("multipart/form-data; boundary=")
    assert not [k for k in h if k in ("x-forwarded-for", "x-real-ip", "forwarded") or k.startswith("cf-")]
    assert http.requests[0]["path"] == "/api/v1/ingest/documents"


def test_a_decided_request_without_a_submitted_deposit_sends_just_the_decided_one(http, client):
    rid = create(client).id
    ArchiveDeposit.query.filter_by(request_id=rid).delete()
    db.session.commit()
    assert act(client, "nic.accountant", rid, "check", position="no", funds="yes", comment="No post.").status_code == 302
    queue.flush()
    assert len(http.requests) == 1
    meta = http.requests[0]["meta"]
    assert meta["source_ref"].endswith(":decided") and "related" not in meta
    assert meta["doc_type"] == "Αίτημα θέσης — απορρίφθηκε" and "amount" not in meta


def _end_approved(client, rid):
    approve_all(client, rid)


def _end_rejected(client, rid):
    assert act(client, "nic.accountant", rid, "check", position="no", funds="yes", comment="No post.").status_code == 302


def _end_withdrawn(client, rid):
    as_user(client, "nic.requester")
    assert client.post("/requests/%d/withdraw" % rid, data={"comment": "Not needed."}).status_code == 302


def _end_system(client, rid):
    from ehire.services.request_flow import system_withdraw
    assert act(client, "nic.accountant", rid, "return", comment="Add the paper.").status_code == 302
    assert system_withdraw(reload(rid), datetime.now(timezone.utc) + timedelta(days=90)).ok


@pytest.mark.parametrize("end,status,doc_type", [
    (_end_approved, "approved", "Αίτημα θέσης — εγκρίθηκε"),
    (_end_rejected, "rejected", "Αίτημα θέσης — απορρίφθηκε"),
    (_end_withdrawn, "withdrawn", "Αίτημα θέσης — αποσύρθηκε"),
    (_end_system, "withdrawn", "Αίτημα θέσης — αποσύρθηκε"),
])
def test_every_outcome_is_deposited(http, client, end, status, doc_type):
    rid = create(client).id
    end(client, rid)
    assert reload(rid).status == status and kinds(rid) == ["submitted", "decided"]
    queue.flush()
    assert [d.state for d in deposits(rid)] == ["stored", "stored"]
    meta = http.requests[1]["meta"]
    assert meta["doc_type"] == doc_type and meta["event_date"]
    assert meta["related"][0]["relation"] == "SUPERSEDES"
    if end is _end_system:
        assert meta["approvals"][-1]["actor_name"] == "Σύστημα" and "αυτόματα" in meta["approvals"][-1]["action"]


# ------------------------------------------------------------------ retry and idempotency

def test_connection_refused_is_retried_with_the_same_key_and_never_filed_twice(app, seeded, stor, conv):
    port = free_port()
    app.config.update(EHIRE_ARCHIVE_URL="http://127.0.0.1:%d" % port, EHIRE_ARCHIVE_TOKEN=TOKEN)
    db.session.add(Setting(key="archive_transport", value="http"))
    db.session.commit()
    client = app.test_client()
    rid = create(client).id
    counts = queue.flush()
    assert counts["failed"] == 1
    row = row_of(rid, "submitted")
    assert (row.state, row.attempts, row.protocol_number) == ("queued", 1, None)
    assert "did not answer" in row.last_error and row.next_attempt_at is not None
    first_meta = row.meta_json
    before = queue.flush()  # not due yet: no new attempt
    assert before == {"rendered": 0, "stored": 0, "failed": 0, "waiting": 0}
    assert row_of(rid, "submitted").attempts == 1
    fake = FakeEArchive().start(port)
    try:
        make_due()
        assert queue.flush()["stored"] == 1
        row = row_of(rid, "submitted")
        assert row.state == "stored" and row.meta_json == first_meta and row.last_error is None
        assert fake.requests[0]["headers"]["idempotency-key"] == "ehire:%d" % row.id
        # The answer got lost on the way: the same deposit is sent again and eArchive replays its receipt.
        row.state = "queued"
        db.session.commit()
        assert queue.flush()["stored"] == 1
        assert [r["status"] for r in fake.requests] == [201, 200] and len(fake.filed) == 1
        assert row_of(rid, "submitted").protocol_number == "ΑΔ/2026/00001"
    finally:
        fake.stop()


def test_the_gaps_grow_and_the_item_is_never_dropped(app, seeded, stor, conv):
    app.config.update(EHIRE_ARCHIVE_URL="http://127.0.0.1:%d" % free_port(), EHIRE_ARCHIVE_TOKEN=TOKEN)
    db.session.add(Setting(key="archive_transport", value="http"))
    db.session.commit()
    rid = create(app.test_client()).id
    gaps = []
    for _ in range(12):
        make_due()
        queue.flush()
        row = row_of(rid, "submitted")
        gaps.append(row.next_attempt_at - datetime.now(timezone.utc).replace(tzinfo=None))
    assert row.state == "queued" and row.attempts == 12  # past the old limit of 10
    minutes = [round(g.total_seconds() / 60) for g in gaps]
    assert minutes[0] in (5, 4) and minutes[1] in (15, 14) and minutes[2] in (60, 59) and minutes[3] in (360, 359)
    assert minutes[-1] in (1440, 1439)


def test_a_timeout_is_a_temporary_failure(http, client, monkeypatch):
    monkeypatch.setattr(transports, "TIMEOUT_SECONDS", 0.3)
    http.script.append(("sleep", 1.0))
    rid = create(client).id
    queue.flush()
    row = row_of(rid, "submitted")
    assert row.state == "queued" and row.attempts == 1 and row.next_attempt_at is not None


# ------------------------------------------------------------------ every kind of answer

@pytest.mark.parametrize("answer", [(500, "INTERNAL", "Oops."), (502, "BAD_GATEWAY", "Restarting."),
                                    (503, "BUSY", "Try later.")])
def test_a_server_error_waits_and_retries(http, client, answer):
    http.script.append(answer)
    rid = create(client).id
    queue.flush()
    row = row_of(rid, "submitted")
    assert row.state == "queued" and row.attempts == 1 and row.next_attempt_at is not None
    make_due()
    queue.flush()
    assert row_of(rid, "submitted").state == "stored" and len(http.requests) == 2
    assert http.requests[0]["headers"]["idempotency-key"] == http.requests[1]["headers"]["idempotency-key"]


BLOCKING = [(409, "IDEMPOTENCY_MISMATCH", "Different content."), (400, "SCHEMA_INVALID", "Field x is wrong."),
            (400, "SHA256_MISMATCH", "File does not match."),
            (401, "UNAUTHORIZED", "Wrong token."), (403, "LOOPBACK_ONLY", "Not from here."),
            (403, "SERVICE_ONLY", "Service account only."), (403, "SOURCE_MISMATCH", "Wrong source."),
            (413, "TOO_LARGE", "Too big."), (413, "FILE_TOO_LARGE", "Part is over 50 MB."), (415, "MIME_REJECTED", "File type not allowed."),
            (400, "ARCHIVE_BAD_ZIP", "The zip is damaged."), (302, "MOVED", "Go elsewhere.")]


@pytest.mark.parametrize("answer", BLOCKING)
def test_a_refusal_blocks_the_deposit_and_an_admin_can_retry_it(http, client, answer):
    http.script.append(answer)
    rid = create(client).id
    queue.flush()
    row = row_of(rid, "submitted")
    assert row.state == "blocked" and row.protocol_number is None
    if answer[0] != 302:
        assert row.last_error == "%s: %s" % (answer[1], answer[2]) and row.error_code == answer[1]
    else:
        assert row.error_code == "REDIRECT_REFUSED"
    assert AuditLog.query.filter_by(event="archive_blocked", request_id=rid).count() == 1
    calls = len(http.requests)
    queue.flush()
    assert len(http.requests) == calls  # not retried unchanged
    as_user(client, "demo.admin")
    assert text(client.get("/settings?lang=en")).count('data-blocked-count="1"') == 1
    assert client.post("/settings/archive/%d/retry" % row.id).status_code == 302
    assert row_of(rid, "submitted").state == "queued"
    queue.flush()
    assert row_of(rid, "submitted").state == "stored" and len(http.requests) == calls + 1


def test_a_duplicate_source_ref_takes_the_number_from_error_details(http, client):
    http.script.append((409, "DUPLICATE_SOURCE_REF", "Already filed.",
                        {"protocol_id": "p-0042", "protocol_number": "ΑΔ/2026/00007"}))
    rid = create(client).id
    queue.flush()
    row = row_of(rid, "submitted")
    assert row.state == "stored" and row.protocol_number == "ΑΔ/2026/00007" and row.protocol_id == "p-0042"
    assert AuditLog.query.filter_by(event="archive_duplicate", request_id=rid).count() == 1
    queue.flush()
    assert len(http.requests) == 1


def test_a_duplicate_source_ref_without_details_falls_back_to_the_message(http, client):
    http.script.append((409, "DUPLICATE_SOURCE_REF", "source_ref is already filed as ΑΔ/2026/00007."))
    rid = create(client).id
    queue.flush()
    row = row_of(rid, "submitted")
    assert row.state == "stored" and row.protocol_number == "ΑΔ/2026/00007" and row.protocol_id is None
    assert AuditLog.query.filter_by(event="archive_duplicate", request_id=rid).count() == 1
    queue.flush()
    assert len(http.requests) == 1


def test_a_real_duplicate_from_the_fake_names_the_filed_number(http, client):
    rid = create(client).id
    queue.flush()
    first = row_of(rid, "submitted")
    first.state, first.meta_json, first.attempts = "queued", None, 0  # eHire lost its record of the answer
    db.session.commit()
    # A new key (different content), the same source_ref: eArchive says it is a duplicate.
    http.keys.clear()
    queue.flush()
    row = row_of(rid, "submitted")
    assert row.state == "stored" and row.protocol_number == "ΑΔ/2026/00001"


def test_a_200_that_is_not_a_replay_is_not_taken_as_filed(http, client):
    rid = create(client).id
    orig = HttpTransport._success
    try:
        HttpTransport._success = staticmethod(lambda status, headers, raw: orig(200, {}, raw))
        queue.flush()
    finally:
        HttpTransport._success = staticmethod(orig)
    assert row_of(rid, "submitted").state == "blocked"


def test_nothing_is_sent_without_the_token_or_when_the_transport_is_not_http(http, client, app):
    app.config["EHIRE_ARCHIVE_TOKEN"] = ""
    rid = create(client).id
    counts = queue.flush()
    assert counts["stored"] == 0 and http.requests == [] and row_of(rid, "submitted").state == "queued"
    app.config["EHIRE_ARCHIVE_TOKEN"] = TOKEN
    Setting.query.filter_by(key="archive_transport").one().value = "none"
    db.session.commit()
    queue.flush()
    assert http.requests == []
    Setting.query.filter_by(key="archive_transport").one().value = "http"
    db.session.commit()
    queue.flush()
    assert len(http.requests) == 1 and row_of(rid, "submitted").state == "stored"


def test_deposits_are_sent_one_at_a_time_in_order(http, client):
    a = create(client).id
    b = create(client, username="lim.requester", directorate_code="LIM").id
    queue.flush()
    assert [r["meta"]["outbox_id"] for r in http.requests] == [row_of(a, "submitted").id, row_of(b, "submitted").id]


# ------------------------------------------------------------------ site code

def test_a_facility_without_a_site_code_blocks_and_is_released_when_it_is_set(http, client):
    rid = create(client).id
    fac = reload(rid).facility
    fac.archive_site_code = None
    db.session.commit()
    queue.flush()
    row = row_of(rid, "submitted")
    assert row.state == "blocked" and row.error_code == "NO_SITE" and fac.name_el in row.last_error
    assert "κωδικό τοποθεσίας" in row.last_error and http.requests == []
    queue.flush()
    assert AuditLog.query.filter_by(event="archive_blocked", request_id=rid).count() == 1  # written once
    as_user(client, "demo.admin")
    html = text(client.get("/settings/facility?lang=en"))
    assert "eArchive site code" in html
    resp = client.post("/settings/facility/%d/edit" % fac.id, data={"name_el": fac.name_el, "name_en": fac.name_en,
                                                                     "archive_site_code": "ngh"})
    assert resp.status_code == 302
    db.session.expire_all()
    assert db.session.get(Facility, fac.id).archive_site_code == "NGH"
    edit = AuditLog.query.filter_by(event="list_changed", object_type="facility", object_id=str(fac.id)).one()
    assert '"archive_site_code": "NGH"' in edit.detail_json
    assert queue.flush()["stored"] == 1  # no button pressed
    row = row_of(rid, "submitted")
    assert row.state == "stored" and http.requests[0]["meta"]["folder_hints"] == [{"hospital": "NGH"}]
    assert AuditLog.query.filter_by(event="archive_unblocked", request_id=rid).count() == 1


def test_the_site_code_must_be_one_of_the_twelve(seeded, client):
    from ehire.models import ARCHIVE_SITE_CODES
    assert len(ARCHIVE_SITE_CODES) == 12 and "NGH" in ARCHIVE_SITE_CODES
    fac = Facility.query.first()
    as_user(client, "demo.admin")
    resp = client.post("/settings/facility/%d/edit" % fac.id, data={"name_el": fac.name_el, "name_en": fac.name_en,
                                                                     "archive_site_code": "XYZ"})
    assert resp.status_code == 302
    db.session.expire_all()
    assert db.session.get(Facility, fac.id).archive_site_code != "XYZ"
    resp = client.post("/settings/facility/%d/edit" % fac.id, data={"name_el": fac.name_el, "name_en": fac.name_en,
                                                                     "archive_site_code": ""})
    db.session.expire_all()
    assert db.session.get(Facility, fac.id).archive_site_code is None  # cleared on purpose


def test_the_demo_facilities_carry_plausible_codes(seeded):
    from ehire.models import ARCHIVE_SITE_CODES
    codes = {f.code: f.archive_site_code for f in Facility.query.all()}
    assert all(c in ARCHIVE_SITE_CODES for c in codes.values()), codes
    assert codes["NIC-H1"] == "NGH" and codes["PAF-H1"] == "PAP" and codes["MH-H1"] == "MH"


# ------------------------------------------------------------------ limits

def submit_with(client, rid):
    from ehire.services import request_flow
    from ehire.models import Request
    assert request_flow.submit(db.session.get(Request, rid), reload(rid).created_by, datetime.now(timezone.utc)).ok


def test_more_than_two_hundred_attachments_is_blocked_with_a_readable_reason(http, client):
    rid = create_with_leaver(client).id
    add_documents(rid, 201)
    submit_with(client, rid)
    queue.flush()
    row = row_of(rid, "submitted")
    assert row.state == "blocked" and row.error_code == "TOO_MANY_FILES" and "200" in row.last_error
    assert http.requests == []
    as_user(client, "demo.admin")
    html = text(client.get("/settings/archive?lang=en"))
    assert "Needs fixing" in html and "περισσότερα από 200 έγγραφα" in html


def test_nineteen_attachments_are_sent(http, client):
    rid = create_with_leaver(client).id
    add_documents(rid, 19)
    from ehire.services import request_flow
    from ehire.models import Request
    assert request_flow.submit(db.session.get(Request, rid), reload(rid).created_by, datetime.now(timezone.utc)).ok
    queue.flush()
    assert row_of(rid, "submitted").state == "stored" and len(http.requests[0]["meta"]["files"]) == 20


def test_a_file_over_the_limit_or_of_a_type_eArchive_refuses_is_blocked_before_sending(http, client, monkeypatch):
    # the reasons are Greek, from the string files
    rid = create_with_leaver(client).id
    add_documents(rid, 1)
    from ehire.services import request_flow
    from ehire.models import Request
    monkeypatch.setattr(meta_mod, "MAX_FILE_BYTES", 10)
    assert request_flow.submit(db.session.get(Request, rid), reload(rid).created_by, datetime.now(timezone.utc)).ok
    queue.flush()
    row = row_of(rid, "submitted")
    assert row.state == "blocked" and row.error_code == "FILE_TOO_BIG" and http.requests == []
    assert row.last_error.startswith("Το αρχείο «") and "είναι μεγαλύτερο από" in row.last_error
    monkeypatch.setattr(meta_mod, "MAX_FILE_BYTES", 50 * 1024 * 1024)
    monkeypatch.setattr(meta_mod, "ACCEPTED_EXTENSIONS", {"txt"})
    row.state = "queued"
    db.session.commit()
    queue.flush()
    row = row_of(rid, "submitted")
    assert row.error_code == "FILE_TYPE" and "δεν δέχεται" in row.last_error and ".pdf»" in row.last_error
    monkeypatch.setattr(meta_mod, "ACCEPTED_EXTENSIONS", {"pdf"})
    monkeypatch.setattr(meta_mod, "MAX_DEPOSIT_BYTES", 10)
    row_of(rid, "submitted").state = "queued"
    db.session.commit()
    queue.flush()
    row = row_of(rid, "submitted")
    assert row.error_code == "DEPOSIT_TOO_BIG" and "MB" in row.last_error


# ------------------------------------------------------------------ the token

def test_the_token_never_reaches_a_log_the_audit_a_last_error_or_a_page(http, client, caplog):
    caplog.set_level(logging.DEBUG)
    http.script.append((400, "SCHEMA_INVALID", "The token %s was seen in the body." % TOKEN))
    rid = create(client).id
    queue.flush()
    row = row_of(rid, "submitted")
    assert row.state == "blocked" and TOKEN not in row.last_error and "***" in row.last_error
    make_due()
    row.state = "queued"
    db.session.commit()
    queue.flush()
    approve_all(client, rid)
    queue.flush()
    http_down = http
    http_down.stop()
    row_of(rid, "decided").state = "queued"
    db.session.commit()
    queue.flush()
    assert TOKEN not in caplog.text
    assert not [a for a in AuditLog.query.all() if TOKEN in (a.detail_json or "")]
    assert not [d for d in ArchiveDeposit.query.all() if TOKEN in " ".join(
        str(getattr(d, c.name) or "") for c in ArchiveDeposit.__table__.columns)]
    as_user(client, "demo.admin")
    for page in ("/settings?lang=en", "/settings/archive?lang=en", "/requests/%d?lang=en" % rid,
                 "/settings/facility?lang=en"):
        assert TOKEN not in text(client.get(page))


def test_the_token_comes_from_the_environment_only(app):
    import os
    assert app.config["EHIRE_ARCHIVE_TOKEN"] == os.environ.get("EHIRE_ARCHIVE_TOKEN", "")
    assert not [s for s in Setting.query.all() if "token" in (s.key or "").lower()]


# ------------------------------------------------------------------ the address and proxies

@pytest.mark.parametrize("url", ["https://127.0.0.1:5011", "http://10.0.0.5:5011", "http://archive.example.invalid",
                                 "http://127.0.0.1.example.invalid:5011", "http://user:pw@127.0.0.1:5011",
                                 "http://127.0.0.1:5011/other", "ftp://127.0.0.1", "http://127.0.0.1:99999",
                                 "http://0.0.0.0:5011"])
def test_an_address_that_is_not_loopback_http_is_refused(url):
    with pytest.raises(ArchiveError):
        check_url(url)


@pytest.mark.parametrize("url,base", [("http://127.0.0.1:5011", "http://127.0.0.1:5011"),
                                      ("http://localhost:5011/", "http://localhost:5011"),
                                      ("http://[::1]:5011", "http://[::1]:5011"), ("", "http://127.0.0.1:5011")])
def test_loopback_addresses_are_accepted(url, base):
    assert check_url(url) == base


def test_the_app_refuses_to_start_with_a_remote_archive_address(monkeypatch):
    from ehire import create_app
    from ehire.config import TestConfig

    class Bad(TestConfig):
        EHIRE_ARCHIVE_URL = "http://archive.example.invalid:5011"
    with pytest.raises(ArchiveError):
        create_app(Bad)


def test_the_cli_refuses_to_choose_http_with_a_bad_address_and_warns_without_a_token(seeded, app):
    runner = app.test_cli_runner()
    app.config["EHIRE_ARCHIVE_URL"] = "https://127.0.0.1:5011"
    out = runner.invoke(args=["archive-transport", "http"])
    assert out.exit_code != 0 and "https" in out.output
    app.config["EHIRE_ARCHIVE_URL"] = "http://127.0.0.1:5011"
    app.config["EHIRE_ARCHIVE_TOKEN"] = ""
    out = runner.invoke(args=["archive-transport", "http"])
    assert out.exit_code == 0 and "archive_transport=http" in out.output and "EHIRE_ARCHIVE_TOKEN is not set" in out.output
    assert runner.invoke(args=["archive-transport"]).output.strip() == "archive_transport=http"


def test_proxy_environment_variables_are_ignored(http, client, monkeypatch):
    for name in ("HTTP_PROXY", "http_proxy", "ALL_PROXY", "all_proxy"):
        monkeypatch.setenv(name, "http://127.0.0.1:1")  # nothing listens there
    monkeypatch.delenv("NO_PROXY", raising=False)
    monkeypatch.delenv("no_proxy", raising=False)
    create(client)
    assert queue.flush()["stored"] == 1 and len(http.requests) == 1


def test_a_redirect_is_never_followed(http, client):
    http.script.append((302, "MOVED", "Elsewhere."))
    create(client)
    queue.flush()
    assert len(http.requests) == 1


def test_the_multipart_names_are_safe_and_utf8_file_names_arrive_intact(http, client):
    rid = create_with_leaver(client).id
    add_documents(rid, 1, name='ΑΝΑΛΥΣΗ "θέσης" ; 2026.pdf')
    from ehire.services import request_flow
    from ehire.models import Request
    assert request_flow.submit(db.session.get(Request, rid), reload(rid).created_by, datetime.now(timezone.utc)).ok
    queue.flush()
    assert http.requests[0]["meta"]["files"][1]["filename"] == 'ΑΝΑΛΥΣΗ "θέσης" ; 2026.pdf'
    assert row_of(rid, "submitted").state == "stored"
    with pytest.raises(ArchiveError):
        transports.MultipartBody("b", b"{}", [("Bad Name", "x.pdf", "application/pdf", __file__)])


# ------------------------------------------------------------------ eArchive's answers of 16/11/2026

def test_a_file_entry_with_a_role_or_any_other_field_is_refused_by_the_fake(http):
    from tests.archive.fake_earchive import Refusal
    good = {"kind": "MAIN", "part_name": "main", "filename": "a.pdf", "mime": "application/pdf", "size": 1,
            "sha256": "0" * 64}
    meta = {"files": [dict(good, role="MAIN")]}
    with pytest.raises(Refusal) as err:
        http._schema(dict(_minimal_meta(), files=[dict(good, role="MAIN")]))
    assert err.value.status == 400 and err.value.code == "SCHEMA_INVALID"
    with pytest.raises(Refusal):
        http._schema(dict(_minimal_meta(), files=[{k: v for k, v in good.items() if k != "mime"}]))
    http._schema(dict(_minimal_meta(), files=[good]))
    del meta


def _minimal_meta():
    return {"schema_version": 1, "outbox_id": 1, "sent_at": "2026-11-16T10:00:00+02:00", "source_system": "eHire",
            "source_module": "position_request", "source_ref": "position_request:X:submitted", "doc_type": "t",
            "subject": "subject", "direction": "INTERNAL", "sender_name": "s", "letter_date": "2026-11-16",
            "category": "c", "classification": "HIGHLY_SENSITIVE", "personal_data": True,
            "personal_data_category": "p", "folder_hints": [{"hospital": "NGH"}], "files": []}


def test_error_bodies_are_read_from_the_error_object_only():
    parts = transports._error_parts(json.dumps({"error": {"code": "X_Y", "message": "m", "details": {"a": 1}}}).encode(), 400)
    assert parts == ("X_Y", "m", {"a": 1})
    assert transports._error_parts(json.dumps({"code": "TOP", "message": "m"}).encode(), 400)[0] == "HTTP_400"
    assert transports._error_parts(b"not json", 502) == ("HTTP_502", "", None)


def test_schema_invalid_shows_each_field_with_its_messages_then_the_form_errors(http, client):
    http.script.append((400, "SCHEMA_INVALID", "The meta part is not valid.",
                        {"formErrors": ["Unrecognized key: extra"],
                         "fieldErrors": {"files": ["Required", "size must be a number"], "attributes": ["too long"]}}))
    rid = create(client).id
    queue.flush()
    row = row_of(rid, "submitted")
    assert row.state == "blocked" and row.error_code == "SCHEMA_INVALID"
    assert row.last_error == ("SCHEMA_INVALID: The meta part is not valid. (files: Required, size must be a number; "
                              "attributes: too long; Unrecognized key: extra)")


def test_schema_invalid_reasons_are_short_and_never_hold_the_token(http, client):
    http.script.append((400, "SCHEMA_INVALID", "The meta part is not valid.",
                        {"formErrors": ["token %s" % TOKEN], "fieldErrors": {"subject": ["x" * 900]}}))
    rid = create(client).id
    queue.flush()
    row = row_of(rid, "submitted")
    assert row.state == "blocked" and TOKEN not in row.last_error and len(row.last_error) <= 500
    assert row.last_error.startswith("SCHEMA_INVALID: The meta part is not valid. (subject: xxx")
    assert "…" in transports.reasons_text({"fieldErrors": {"a": ["y" * 900]}, "formErrors": []})
    assert transports.reasons_text(None) == "" and transports.reasons_text({"fieldErrors": {}, "formErrors": []}) == ""
    assert transports.reasons_text({"reasons": ["old shape"]}) == "reasons: old shape"  # other shapes are still read


def test_schema_invalid_without_details_shows_the_message(http, client):
    http.script.append((400, "SCHEMA_INVALID", "meta is missing."))
    rid = create(client).id
    queue.flush()
    assert row_of(rid, "submitted").last_error == "SCHEMA_INVALID: meta is missing."


def test_the_fake_answers_schema_invalid_in_eArchives_shape(http):
    from tests.archive.fake_earchive import Refusal
    with pytest.raises(Refusal) as err:
        http._schema(dict(_minimal_meta(), extra=1, subject="x"))
    assert err.value.details == {"formErrors": ["Unknown field(s): extra."], "fieldErrors": {}}
    with pytest.raises(Refusal) as err:
        http._schema(dict(_minimal_meta(), subject="x"))
    assert err.value.details == {"formErrors": [], "fieldErrors": {"subject": ["subject must be text of 3 to 500 characters."]}}


@pytest.mark.parametrize("status,code", [(408, "REQUEST_TIMEOUT"), (429, "TOO_MANY_REQUESTS")])
def test_408_and_429_wait_and_retry_with_the_same_key(http, client, status, code):
    http.script.append((status, code, "Slow down."))
    rid = create(client).id
    queue.flush()
    row = row_of(rid, "submitted")
    assert row.state == "queued" and row.attempts == 1 and row.next_attempt_at is not None
    make_due()
    queue.flush()
    assert row_of(rid, "submitted").state == "stored"
    assert http.requests[0]["headers"]["idempotency-key"] == http.requests[1]["headers"]["idempotency-key"]


def _sent_parts(app, row):
    from ehire.archive import bundle
    manifest, files = queue.files_of(row)
    manifest, files = bundle.pack(row, manifest, files)
    return json.loads(row.meta_json), files


def test_a_retry_with_a_changed_sent_at_is_a_mismatch_but_ehires_own_retry_is_not(http, client, app):
    rid = create(client).id
    queue.flush()
    row = row_of(rid, "submitted")
    meta, files = _sent_parts(app, row)
    transport = HttpTransport()
    same = transport.deposit_meta(row.id, meta, files)  # the stored bytes again: replayed
    assert same.protocol_number == "ΑΔ/2026/00001" and http.requests[-1]["status"] == 200
    changed = dict(meta, sent_at="2030-01-01T00:00:00+02:00")
    named = transport.deposit_meta(row.id, changed, files)  # eArchive names the record it already holds
    assert http.requests[-1]["status"] == 409 and named.mismatch and named.protocol_id == "p-0001"
    http.mismatch_details = False  # before eArchive's update: no details
    with pytest.raises(transports.BlockedError) as err:
        transport.deposit_meta(row.id, changed, files)
    assert err.value.code == "IDEMPOTENCY_MISMATCH" and http.requests[-1]["status"] == 409
    row.state = "queued"  # eHire's retry builds nothing new and sends the stored meta
    db.session.commit()
    assert queue.flush()["stored"] == 1
    assert [r["status"] for r in http.requests] == [201, 200, 409, 409, 200] and row_of(rid, "submitted").meta_json == row.meta_json


def _rebuild_after_filing(http, client, monkeypatch):
    """The first send was filed. An administrator then retries: meta is rebuilt, so sent_at differs."""
    from ehire import localtime
    rid = create(client).id
    queue.flush()
    row = row_of(rid, "submitted")
    row.state = "failed"
    db.session.commit()
    real = localtime.now
    monkeypatch.setattr(localtime, "now", lambda: real() + timedelta(hours=2))
    as_user(client, "demo.admin")
    assert client.post("/settings/archive/%d/retry" % row.id).status_code == 302
    return rid


def test_an_admin_retry_after_the_deposit_was_filed_stays_blocked_with_the_reason_when_no_number_comes(http, client, monkeypatch):
    http.mismatch_details = False  # eArchive's update of 16/11/2026 is not installed yet
    rid = _rebuild_after_filing(http, client, monkeypatch)
    queue.flush()
    row = row_of(rid, "submitted")
    assert http.requests[-1]["status"] == 409
    assert row.state == "blocked" and row.error_code == "IDEMPOTENCY_MISMATCH" and row.last_error.startswith("IDEMPOTENCY_MISMATCH")


def test_an_admin_retry_settles_by_itself_when_eArchive_names_the_record_in_the_mismatch(http, client, monkeypatch):
    rid = _rebuild_after_filing(http, client, monkeypatch)  # the fake answers as eArchive does after its update
    queue.flush()
    row = row_of(rid, "submitted")
    assert http.requests[-1]["status"] == 409
    assert (row.state, row.protocol_id, row.protocol_number) == ("stored", "p-0001", "ΑΔ/2026/00001")
    assert row.last_error is None and row.error_code is None and len(http.filed) == 1
    audit = AuditLog.query.filter_by(event="archive_duplicate", request_id=rid).one()
    assert '"resolved_from": "IDEMPOTENCY_MISMATCH"' in audit.detail_json
    assert AuditLog.query.filter_by(event="archive_stored", request_id=rid).count() == 2


def test_a_plain_duplicate_is_not_marked_as_resolved_from_a_mismatch(http, client):
    http.script.append((409, "DUPLICATE_SOURCE_REF", "Already filed.", {"protocol_id": "p-9", "protocol_number": "ΑΔ/2026/00009"}))
    rid = create(client).id
    queue.flush()
    audit = AuditLog.query.filter_by(event="archive_duplicate", request_id=rid).one()
    assert "resolved_from" not in audit.detail_json


def test_a_mismatch_without_details_leaves_the_reason_for_an_administrator(http, client, monkeypatch):
    http.mismatch_details = False
    rid = _rebuild_after_filing(http, client, monkeypatch)
    queue.flush()
    row = row_of(rid, "submitted")
    assert row.state == "blocked"
    assert row.last_error == "IDEMPOTENCY_MISMATCH: The same key was used with different content."
    assert AuditLog.query.filter_by(event="archive_blocked", request_id=rid).count() == 1
    assert AuditLog.query.filter_by(event="archive_duplicate", request_id=rid).count() == 0


def test_an_admin_retry_resolves_to_the_stored_record_when_the_answer_names_it(http, client, monkeypatch):
    rid = _rebuild_after_filing(http, client, monkeypatch)
    http.script.append((409, "IDEMPOTENCY_MISMATCH", "Other content.",
                        {"protocol_id": "p-0001", "protocol_number": "ΑΔ/2026/00001"}))
    queue.flush()
    row = row_of(rid, "submitted")
    assert row.state == "stored" and row.protocol_number == "ΑΔ/2026/00001"
    assert AuditLog.query.filter_by(event="archive_duplicate", request_id=rid).count() == 1


def test_an_admin_retry_with_a_duplicate_source_ref_resolves_to_the_stored_record(http, client, monkeypatch):
    rid = _rebuild_after_filing(http, client, monkeypatch)
    http.keys.clear()  # eArchive no longer holds the key, but the source_ref is filed
    queue.flush()
    row = row_of(rid, "submitted")
    assert http.requests[-1]["status"] == 409
    assert row.state == "stored" and row.protocol_number == "ΑΔ/2026/00001" and row.protocol_id == "p-0001"


# ------------------------------------------------------------------ names staff see

def test_the_main_file_has_a_greek_title_and_names_are_unique_and_clean(http, client):
    rid = create_with_leaver(client).id
    add_documents(rid, 2, name="same.pdf")
    submit_with(client, rid)
    queue.flush()
    names = [f["filename"] for f in http.requests[0]["meta"]["files"]]
    assert names == ["ΑΕΘ-2026-0001 — υποβολή.pdf", "same.pdf", "same (2).pdf"]
    assert meta_mod.unique_names(["a.pdf", "A.pdf", "a (2).pdf", "b"]) == ["a.pdf", "A (2).pdf", "a (2) (2).pdf", "b"]
    assert meta_mod.unique_names(["b", "b"]) == ["b", "b (2)"]
    assert meta_mod.clean_filename("../../etc/pa\x00ss\u202ewd.pdf") == "passwd.pdf"
    assert meta_mod.clean_filename("C:\\dir\\sub\\file\n.pdf") == "file.pdf"
    assert meta_mod.clean_filename("///") == "file"


# ------------------------------------------------------------------ more than 19 attachments: one zip

def test_twenty_attachments_go_as_one_zip_and_nineteen_go_singly(http, client):
    rid = create_with_leaver(client).id
    add_documents(rid, 20)
    submit_with(client, rid)
    assert queue.flush()["stored"] == 1
    sent = http.requests[0]
    files = sent["meta"]["files"]
    assert [(f["kind"], f["part_name"], f["filename"], f["mime"]) for f in files] == [
        ("MAIN", "main", "ΑΕΘ-2026-0001 — υποβολή.pdf", "application/pdf"),
        ("ATTACHMENT", "att1", "Συνημμένα.zip", "application/zip")]
    assert set(sent["files"]) == {"main", "att1"}
    assert http.zips == [["supporting-%02d.pdf" % i for i in range(1, 21)]]
    assert row_of(rid, "submitted").state == "stored"


def test_the_zip_is_byte_identical_on_every_rebuild_and_kept_in_storage(http, client, tmp_path):
    import os
    from ehire.archive import bundle
    rid = create_with_leaver(client).id
    add_documents(rid, 22)
    submit_with(client, rid)
    row = row_of(rid, "submitted")
    queue.render_deposit(row.id)
    row = row_of(rid, "submitted")
    manifest, files = queue.files_of(row)
    m1, f1 = bundle.pack(row, manifest, files)
    import time
    time.sleep(1.1)  # a clock in the zip would show now
    m2, f2 = bundle.pack(row, manifest, files)
    assert f1[-1].sha256 == f2[-1].sha256 and f1[-1].size == f2[-1].size and f1[-1].path == f2[-1].path
    assert open(f1[-1].path, "rb").read() == open(f2[-1].path, "rb").read()
    assert f1[-1].sha256 == hashlib.sha256(open(f1[-1].path, "rb").read()).hexdigest()
    assert "/archive/%d/" % rid in f1[-1].path and os.path.basename(f1[-1].path).startswith("submitted-attachments-")
    assert [e["role"] for e in m1["files"]] == ["request_pdf", "bundle"]
    assert [e["role"] for e in manifest["files"]].count("document") == 22  # the manifest itself is not changed
    import zipfile
    with zipfile.ZipFile(f1[-1].path) as zf:
        assert {i.date_time for i in zf.infolist()} == {(1980, 1, 1, 0, 0, 0)} and len(zf.infolist()) == 22


def test_a_retry_of_a_zip_deposit_sends_identical_content(http, client):
    rid = create_with_leaver(client).id
    add_documents(rid, 21)
    submit_with(client, rid)
    queue.flush()
    row = row_of(rid, "submitted")
    row.state = "queued"
    db.session.commit()
    assert queue.flush()["stored"] == 1
    assert [r["status"] for r in http.requests] == [201, 200] and len(http.filed) == 1
    assert http.requests[0]["files"]["att1"] == http.requests[1]["files"]["att1"]


def test_a_zip_with_a_file_type_or_size_eArchive_refuses_is_blocked_with_the_file_named(http, client, monkeypatch):
    rid = create_with_leaver(client).id
    add_documents(rid, 20)
    from ehire.models import RequestDocument
    RequestDocument.query.filter_by(request_id=rid).first().file_name = "macro.exe"
    db.session.commit()
    submit_with(client, rid)
    queue.flush()
    row = row_of(rid, "submitted")
    assert row.state == "blocked" and row.error_code == "FILE_TYPE" and "macro.exe" in row.last_error
    assert http.requests == []


def test_a_zip_with_a_file_over_the_limit_is_blocked_before_sending(http, client, monkeypatch):
    rid = create_with_leaver(client).id
    add_documents(rid, 20)
    monkeypatch.setattr(meta_mod, "MAX_FILE_BYTES", 10)
    submit_with(client, rid)
    queue.flush()
    row = row_of(rid, "submitted")
    assert row.state == "blocked" and row.error_code == "FILE_TOO_BIG" and http.requests == []


def test_the_fake_opens_a_zip_and_names_the_file_it_refuses(http):
    import io
    import zipfile
    from tests.archive.fake_earchive import Refusal

    def zipped(names, size=10):
        buf = io.BytesIO()
        with zipfile.ZipFile(buf, "w") as zf:
            for n in names:
                zf.writestr(n, b"x" * size)
        return buf.getvalue()
    entry = {"filename": "Συνημμένα.zip"}
    http._open_zip(entry, zipped(["a.pdf", "b.docx"]))
    with pytest.raises(Refusal) as err:
        http._open_zip(entry, zipped(["a.pdf", "virus.exe"]))
    assert err.value.status == 415 and err.value.code == "MIME_REJECTED" and "virus.exe" in err.value.message
    with pytest.raises(Refusal) as err:
        http._open_zip(entry, zipped(["f%d.pdf" % i for i in range(201)]))
    assert err.value.status == 413
    with pytest.raises(Refusal) as err:
        http._open_zip(entry, b"not a zip")
    assert err.value.code == "ARCHIVE_BAD_ZIP"


# ------------------------------------------------------------------ a site eArchive does not know yet

def test_the_daily_retry_after_an_unknown_site_reuses_the_key_and_sends_identical_content(http, client):
    http.sites = tuple(c for c in http.sites if c != "NGH")
    rid = create_with_leaver(client).id
    add_documents(rid, 21)  # a zip, so the bytes of the zip are compared too
    submit_with(client, rid)
    queue.flush()
    assert row_of(rid, "submitted").error_code == "SITE_UNKNOWN"
    first_meta = row_of(rid, "submitted").meta_json
    for _ in range(2):  # two daily retries, both refused again
        make_due()
        queue.flush()
    http.sites += ("NGH",)
    make_due()
    assert queue.flush()["stored"] == 1
    assert len(http.requests) == 4 and [r["status"] for r in http.requests] == [400, 400, 400, 201]
    keys = {r["headers"]["idempotency-key"] for r in http.requests}
    assert keys == {"ehire:%d" % row_of(rid, "submitted").id}
    assert all(r["meta"] == http.requests[0]["meta"] for r in http.requests)
    zipped = http.requests[-1]["meta"]["files"][1]  # the hashes in meta are the same each time, the zip's among them
    assert zipped["mime"] == "application/zip" and hashlib.sha256(http.requests[-1]["files"]["att1"]).hexdigest() == zipped["sha256"]
    assert row_of(rid, "submitted").meta_json == first_meta and len(http.filed) == 1


def test_an_unknown_site_waits_and_is_tried_again_daily_never_under_another_code(http, client):
    http.sites = tuple(c for c in http.sites if c != "NGH")
    rid = create(client).id
    queue.flush()
    row = row_of(rid, "submitted")
    assert row.state == "queued" and row.error_code == "SITE_UNKNOWN" and row.attempts == 0
    assert "NGH" in row.last_error and "δεν γνωρίζει" in row.last_error
    wait = row.next_attempt_at - datetime.now(timezone.utc).replace(tzinfo=None)
    assert timedelta(hours=23) < wait <= timedelta(days=1)
    assert queue.flush() == {"rendered": 0, "stored": 0, "failed": 0, "waiting": 0} and len(http.requests) == 1
    assert http.requests[0]["meta"]["folder_hints"] == [{"hospital": "NGH"}]
    http.sites += ("NGH",)
    make_due()
    assert queue.flush()["stored"] == 1
    row = row_of(rid, "submitted")
    assert row.state == "stored" and row.last_error is None and row.error_code is None
    assert [r["meta"]["folder_hints"] for r in http.requests] == [[{"hospital": "NGH"}]] * 2
    assert AuditLog.query.filter_by(event="archive_blocked", request_id=rid).count() == 0


def test_without_a_token_the_reason_is_greek(app):
    with pytest.raises(transports.TransientError) as err:
        HttpTransport(token="").deposit_meta(1, {"files": []}, [])
    assert "διακριτικό" in str(err.value)


# ------------------------------------------------------------------ flask archive-sites

def test_archive_sites_lists_active_facilities_with_their_codes_and_counts_the_missing(seeded, app):
    fac = Facility.query.filter_by(is_active=True).first()
    fac.archive_site_code = None
    other = Facility.query.filter(Facility.id != fac.id, Facility.is_active.is_(True)).first()
    other.is_active = False
    db.session.commit()
    out = app.test_cli_runner().invoke(args=["archive-sites"])
    assert out.exit_code == 0, out.output
    lines = out.output.splitlines()
    assert lines[0].split()[:2] == ["Facility", "code"] and fac.code in out.output and "none" in out.output
    assert other.code not in out.output.replace(fac.code, "")
    active = Facility.query.filter_by(is_active=True).count()
    assert lines[-1] == "Facilities without a code: 1 of %d" % active
    assert not [w for w in ("Maria", "ΑΕΘ-") if w in out.output]
