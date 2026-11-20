"""flask load-test-data and clear-test-data."""
import json
import os

import pytest

from ehire.extensions import db
from ehire.models import (ArchiveDeposit, AuditLog, CostCentre, Directorate, Facility, MailOutbox, NumberCounter, NumberSequence,
                          OaySpecialty, Position, Request, RequestAction, RequestDocument, RequestFinancials,
                          RequestLeaver, RoleAssignment, Task, User, UserDirectorate)
from ehire.models.access import ROLES
from ehire.auth import hash_password

from tests.conftest import login

PW = "Shared-Test-Pass-1"
LOAD_INPUT = PW + "\n" + PW + "\n"


@pytest.fixture
def prod(app, tmp_path):
    app.config["EHIRE_ENV"] = "production"
    app.config["EHIRE_STORAGE_DIR"] = str(tmp_path / "storage")
    return app


def real_data():
    """A real Directorate, list rows, user with the admin role, and a request. None of it may be touched."""
    d = Directorate(code="REAL", name_el="x", name_en="Real directorate", has_sci_director=False)
    db.session.add(d)
    db.session.flush()
    admin = User(username="marios", full_name="Marios", email="marios@example.org", auth_source="local",
                 password_hash=hash_password("Real-Password-1"))
    db.session.add(admin)
    db.session.flush()
    db.session.add(RoleAssignment(user_id=admin.id, role="admin"))
    req = Request(created_by=admin.id, status="draft", directorate_id=d.id, round=1)
    db.session.add(req)
    db.session.add(CostCentre(code="9999", name_el="x", name_en="Real cost centre"))
    db.session.add(Position(category="admin", title_el="x", title_en="Real position"))
    db.session.add(OaySpecialty(name="Real specialty"))
    db.session.commit()
    return d, admin, req


def invoke(app, *args, input=None):
    return app.test_cli_runner().invoke(args=list(args), input=input)


def test_load_works_in_production_and_is_idempotent(prod):
    real_data()
    result = invoke(prod, "load-test-data", input=LOAD_INPUT)
    assert result.exit_code == 0, result.output
    assert PW not in result.output
    users = User.query.filter(User.username.like("test.%")).all()
    assert len(users) == 30
    assert all(u.full_name.endswith(" (δοκιμή)") and u.email.endswith("@test.invalid") for u in users)
    assert all(d.code.startswith("T-") for d in Directorate.query.filter(Directorate.code != "REAL"))
    assert all(c.code.startswith("T-") for c in CostCentre.query.filter(CostCentre.code != "9999"))
    assert {a.role for a in RoleAssignment.query.all()} >= set(ROLES) - set()  # every role is held by somebody
    assert User.query.filter_by(username="test.nic.requester").one().line_manager_user_id is not None
    statuses = {r.status for r in Request.query.filter(Request.created_by.in_([u.id for u in users]))}
    assert {"in_progress", "returned", "approved", "rejected", "withdrawn"} <= statuses
    # Real data untouched, and no real list row picked for a test request.
    assert Directorate.query.filter_by(code="REAL").one() and User.query.filter_by(username="marios").one()
    real_ids = {CostCentre.query.filter_by(code="9999").one().id, Position.query.filter_by(title_en="Real position").one().id}
    for r in Request.query.filter(Request.created_by.in_([u.id for u in users])):
        assert r.cost_centre_id not in real_ids and r.position_id not in real_ids
        assert r.oay_specialty_id is None or db.session.get(OaySpecialty, r.oay_specialty_id).name.endswith(" (test)")
    # Mail only to the invalid domain; nothing to the real admin.
    mail = MailOutbox.query.all()
    assert mail and all(m.to_email.endswith("@test.invalid") for m in mail)
    # The shared password works.
    assert login(prod.test_client(), "test.nic.requester", PW).status_code == 302

    snapshot = (User.query.count(), Request.query.count(), Task.query.count(), MailOutbox.query.count(),
                RoleAssignment.query.count(), Directorate.query.count())
    again = invoke(prod, "load-test-data")  # nothing missing: no password asked
    assert again.exit_code == 0, again.output
    assert "none (already there)" in again.output
    assert snapshot == (User.query.count(), Request.query.count(), Task.query.count(), MailOutbox.query.count(),
                        RoleAssignment.query.count(), Directorate.query.count())


def test_load_asks_for_a_long_enough_password_and_stores_nothing_otherwise(prod):
    result = invoke(prod, "load-test-data", input="short\nshort\n")
    assert result.exit_code != 0 and "at least" in result.output
    assert User.query.count() == 0


def test_load_refuses_when_a_real_central_role_holder_exists(prod):
    admin = real_data()[1]
    db.session.add(RoleAssignment(user_id=admin.id, role="ceo"))
    db.session.commit()
    result = invoke(prod, "load-test-data", input=LOAD_INPUT)
    assert result.exit_code != 0 and "ceo is held by marios" in result.output
    assert User.query.filter(User.username.like("test.%")).count() == 0


def test_the_demo_commands_stay_refused_in_production(prod):
    for command in ("seed-demo", "seed-cases"):
        assert invoke(prod, command).exit_code != 0


def attach_files(prod, request_id, user_id):
    """A stored document and a stored archive PDF for a test request, as the app would leave them."""
    root = prod.config["EHIRE_STORAGE_DIR"]
    os.makedirs(os.path.join(root, str(request_id)), exist_ok=True)
    os.makedirs(os.path.join(root, "archive", str(request_id)), exist_ok=True)
    doc_ref, pdf_ref = "%d/1-aa.bin" % request_id, "archive/%d/submitted-bb.pdf" % request_id
    paths = [os.path.join(root, doc_ref), os.path.join(root, "%d/1-aa.pdf" % request_id), os.path.join(root, pdf_ref)]
    for p in paths:
        with open(p, "wb") as fh:
            fh.write(b"x")
    db.session.add(RequestDocument(request_id=request_id, file_name="a.pdf", storage_ref=doc_ref, uploaded_by=user_id))
    dep = ArchiveDeposit.query.filter_by(request_id=request_id, kind="submitted").first()
    dep.pdf_storage_ref = pdf_ref
    db.session.commit()
    return paths


def test_clear_removes_every_test_row_file_and_keeps_real_data(prod):
    d, admin, real_req = real_data()
    assert invoke(prod, "load-test-data", input=LOAD_INPUT).exit_code == 0
    test_users = [u.id for u in User.query.filter(User.username.like("test.%"))]
    sample = Request.query.filter(Request.created_by.in_(test_users)).first()
    sample_id = sample.id
    paths = attach_files(prod, sample_id, test_users[0])
    audit_before = AuditLog.query.count()
    assert max(n.last_value for n in NumberCounter.query) > 0

    result = invoke(prod, "clear-test-data", input="wrong\n")
    assert result.exit_code != 0 and "Not confirmed" in result.output and User.query.count() > 2
    result = invoke(prod, "clear-test-data", "--yes")
    assert result.exit_code == 0, result.output
    assert "requests" in result.output

    assert User.query.filter(User.username.like("test.%")).count() == 0
    assert [u.username for u in User.query.all()] == ["marios"]
    assert [x.code for x in Directorate.query.all()] == ["REAL"]
    assert Facility.query.count() == 0 and [c.code for c in CostCentre.query.all()] == ["9999"]
    assert [p.title_en for p in Position.query.all()] == ["Real position"]
    assert [s.name for s in OaySpecialty.query.all()] == ["Real specialty"]
    assert [r.id for r in Request.query.all()] == [real_req.id]
    for model in (RequestLeaver, RequestAction, RequestFinancials, RequestDocument, Task, MailOutbox, ArchiveDeposit,
                  UserDirectorate):
        assert model.query.count() == 0, model
    assert [(a.role, a.user_id) for a in RoleAssignment.query.all()] == [("admin", admin.id)]
    assert not any(os.path.exists(p) for p in paths)
    assert not os.path.exists(os.path.join(prod.config["EHIRE_STORAGE_DIR"], str(sample_id)))
    # Audit rows stay; the clear itself is recorded; the first real request would be number 1 again.
    assert AuditLog.query.count() == audit_before + 1
    assert AuditLog.query.filter(AuditLog.user_id.in_(test_users)).count() == 0
    row = AuditLog.query.filter_by(event="list_changed", object_id="clear").one()
    detail = json.loads(row.detail_json)
    assert detail["by"] == "cli" and detail["removed"]["users"] == 30 and "test.nic.requester" in detail["users"].values()
    assert NumberCounter.query.count() > 0 and all(n.last_value == 0 for n in NumberCounter.query)
    assert invoke(prod, "clear-test-data", "--yes").exit_code == 0  # nothing left: still fine

    # It can be loaded again after a clear (the old seed_case markers point at deleted requests).
    again = invoke(prod, "load-test-data", input=LOAD_INPUT)
    assert again.exit_code == 0 and Request.query.count() == 1 + 7


def counts():
    return (User.query.count(), Request.query.count(), RequestAction.query.count(), Directorate.query.count(),
            MailOutbox.query.count(), ArchiveDeposit.query.count())


def test_clear_refuses_when_a_real_user_acted_on_a_test_request(prod):
    admin = real_data()[1]
    invoke(prod, "load-test-data", input=LOAD_INPUT)
    victim = Request.query.filter(Request.number.isnot(None)).first()
    db.session.add(RequestAction(request_id=victim.id, round=1, role="admin", actor_user_id=admin.id, action="comment"))
    db.session.commit()
    before = counts()
    result = invoke(prod, "clear-test-data", "--yes")
    assert result.exit_code != 0
    assert "marios" in result.output and victim.number in result.output and "Nothing was changed" in result.output
    assert counts() == before


def test_clear_refuses_when_a_real_user_created_a_request_in_a_test_directorate(prod):
    admin = real_data()[1]
    invoke(prod, "load-test-data", input=LOAD_INPUT)
    test_dir = Directorate.query.filter(Directorate.code.like("T-%")).first()
    db.session.add(Request(created_by=admin.id, status="draft", directorate_id=test_dir.id, round=1))
    db.session.commit()
    before = counts()
    result = invoke(prod, "clear-test-data", "--yes")
    assert result.exit_code != 0 and "created by marios" in result.output
    assert counts() == before


def test_clear_refuses_when_a_test_deposit_reached_earchive(prod):
    real_data()
    invoke(prod, "load-test-data", input=LOAD_INPUT)
    dep = ArchiveDeposit.query.first()
    number = db.session.get(Request, dep.request_id).number
    dep.state, dep.protocol_number = "stored", "AD-2026-1"
    db.session.commit()
    before = counts()
    result = invoke(prod, "clear-test-data", "--yes")
    assert result.exit_code != 0 and "reached eArchive" in result.output and number in result.output
    assert "AD-2026-1" in result.output
    assert counts() == before and User.query.filter(User.username.like("test.%")).count() == 30


def test_clear_on_an_empty_database_says_so(prod):
    result = invoke(prod, "clear-test-data", "--yes")
    assert result.exit_code == 0 and "no test data" in result.output
