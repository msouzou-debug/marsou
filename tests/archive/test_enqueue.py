"""Deposits are queued inside the action's transaction: at submission, at approval, and never twice."""
import json

import pytest

from ehr.extensions import db
from ehr.models import ArchiveDeposit, AuditLog
from tests.archive.ahelpers import approve_all, deposits, kinds
from tests.requests.flowhelpers import act, as_user, create, reload, step2, step3, step4
from tests.requests.helpers import full_form
from tests.requests.test_return_replace_withdraw import resubmit


def test_scenario_1_path_gives_two_rows_and_the_audit_rows(seeded, client):
    rid = create(client).id
    assert kinds(rid) == ["submitted"]
    row = deposits(rid)[0]
    assert (row.state, row.attempts, row.round, row.pdf_storage_ref) == ("queued", 0, 1, None)
    approve_all(client, rid)
    assert kinds(rid) == ["submitted", "approved"]
    assert {d.state for d in deposits(rid)} == {"queued"}
    queued = AuditLog.query.filter_by(request_id=rid, event="archive_queued").all()
    assert len(queued) == 2 and json.loads(queued[0].detail_json)["kind"] == "submitted"


def test_an_admin_category_request_is_deposited_too(seeded, client):
    rid = create(client, category="admin").id
    step2(client, rid, financials=False)
    step3(client, rid, sci=False)
    step4(client, rid)
    assert act(client, "central.ceo", rid, "approve").status_code == 302
    assert kinds(rid) == ["submitted", "approved"]


def test_a_draft_queues_nothing(seeded, client):
    as_user(client, "nic.requester")
    data = full_form()
    data["intent"] = "draft"
    client.post("/requests", data=data)
    assert deposits() == []


def test_rejection_sets_the_outcome_and_adds_no_row(seeded, client):
    rid = create(client).id
    resp = act(client, "nic.accountant", rid, "check", position="no", funds="yes", comment="No post.")
    assert resp.status_code == 302 and reload(rid).status == "rejected"
    rows = deposits(rid)
    assert [(d.kind, d.request_outcome) for d in rows] == [("submitted", "rejected")]
    assert AuditLog.query.filter_by(request_id=rid, event="archive_outcome").count() == 1


def test_withdrawal_by_the_requester_sets_the_outcome(seeded, client):
    rid = create(client).id
    as_user(client, "nic.requester")
    resp = client.post("/requests/%d/withdraw" % rid, data={"comment": "Not needed any more."})
    assert resp.status_code == 302 and reload(rid).status == "withdrawn"
    assert [(d.kind, d.request_outcome) for d in deposits(rid)] == [("submitted", "withdrawn")]


def test_a_system_withdrawal_sets_the_outcome_too(seeded, client):
    from datetime import datetime, timedelta, timezone
    from ehr.services.request_flow import system_withdraw
    rid = create(client).id
    assert act(client, "nic.accountant", rid, "return", comment="Add the paper.").status_code == 302
    req = reload(rid)
    result = system_withdraw(req, datetime.now(timezone.utc) + timedelta(days=90))
    assert result.ok and reload(rid).status == "withdrawn"
    assert [(d.kind, d.request_outcome) for d in deposits(rid)] == [("submitted", "withdrawn")]


def test_a_resubmission_does_not_add_a_submitted_row(seeded, client):
    rid = create(client).id
    assert act(client, "nic.accountant", rid, "return", comment="Add the paper.").status_code == 302
    assert resubmit(client, rid, need_text="Better wording.").status_code == 302
    assert reload(rid).round == 2
    rows = deposits(rid)
    assert [(d.kind, d.round) for d in rows] == [("submitted", 1)]  # the state at FIRST submission


def test_a_rolled_back_action_queues_nothing(seeded, client, monkeypatch):
    from ehr.services import request_flow
    as_user(client, "nic.requester")

    real = request_flow.archive_after_action

    def queue_then_fail(*a, **k):
        real(*a, **k)
        assert ArchiveDeposit.query.count() == 1  # it was queued in the open transaction
        raise RuntimeError("the action failed after the deposit was queued")
    monkeypatch.setattr(request_flow, "archive_after_action", queue_then_fail)
    client.application.config["PROPAGATE_EXCEPTIONS"] = False
    resp = client.post("/requests", data=full_form())
    assert resp.status_code == 500
    db.session.rollback()
    assert ArchiveDeposit.query.count() == 0
    assert AuditLog.query.filter_by(event="archive_queued").count() == 0


def test_the_unique_key_is_request_and_kind(seeded, client):
    rid = create(client).id
    db.session.add(ArchiveDeposit(request_id=rid, kind="submitted", round=1))
    with pytest.raises(Exception):
        db.session.commit()
    db.session.rollback()
