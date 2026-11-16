"""Migration 0005: new columns, kind approved -> decided, and the decided deposit of requests that ended without one."""
import json

import pytest
from sqlalchemy import create_engine, inspect

from ehr import migrations
from ehr.extensions import db
from ehr.models import ArchiveDeposit, AuditLog
from tests.archive.ahelpers import approve_all, deposits
from tests.requests.flowhelpers import act, as_user, create, reload

NEW_DEPOSIT_COLUMNS = ("meta_json", "protocol_id", "protocol_number", "url", "error_code", "next_attempt_at",
                       "legal_hold", "disposed_at")


def run_0005():
    db.session.commit()
    with db.engine.begin() as c:
        migrations.discover()[4].module.upgrade(c)
    db.session.expire_all()


def test_the_columns_are_added_to_a_database_that_lacks_them():
    engine = create_engine("sqlite://")
    from ehr import models  # noqa: F401
    db.metadata.create_all(engine)
    with engine.begin() as c:
        for name in NEW_DEPOSIT_COLUMNS:
            c.exec_driver_sql("ALTER TABLE archive_deposit DROP COLUMN %s" % name)
        c.exec_driver_sql("ALTER TABLE facility DROP COLUMN archive_site_code")
    assert "url" not in {c["name"] for c in inspect(engine).get_columns("archive_deposit")}
    with engine.begin() as c:
        migrations.discover()[4].module.upgrade(c)
        migrations.discover()[4].module.upgrade(c)  # twice is safe
    assert {"url", "legal_hold", "disposed_at"} <= {c["name"] for c in inspect(engine).get_columns("archive_deposit")}
    assert "archive_site_code" in {c["name"] for c in inspect(engine).get_columns("facility")}


def test_approved_becomes_decided_and_ended_requests_get_their_decided_deposit(seeded, client):
    approved = create(client).id
    approve_all(client, approved)
    rejected = create(client, username="lim.requester", directorate_code="LIM").id
    assert act(client, "lim.accountant", rejected, "check", position="no", funds="yes", comment="No.").status_code == 302
    assert reload(rejected).status == "rejected"
    withdrawn = create(client).id
    as_user(client, "nic.requester")
    assert client.post("/requests/%d/withdraw" % withdrawn, data={"comment": "Not needed."}).status_code == 302
    # Put the deposits back as release 4 left them.
    ArchiveDeposit.query.filter(ArchiveDeposit.request_id.in_([rejected, withdrawn]),
                                ArchiveDeposit.kind == "decided").delete(synchronize_session=False)
    for rid, outcome in ((rejected, "rejected"), (withdrawn, "withdrawn")):
        ArchiveDeposit.query.filter_by(request_id=rid, kind="submitted").one().request_outcome = outcome
    ArchiveDeposit.query.filter_by(request_id=approved, kind="decided").one().kind = "approved"
    db.session.commit()

    run_0005()
    kinds = {(d.request_id, d.kind) for d in deposits()}
    assert kinds == {(approved, "submitted"), (approved, "decided"), (rejected, "submitted"), (rejected, "decided"),
                     (withdrawn, "submitted"), (withdrawn, "decided")}
    row = ArchiveDeposit.query.filter_by(request_id=rejected, kind="decided").one()
    assert (row.state, row.round) == ("queued", 1)
    assert json.loads(row.manifest_json)["as_of"]["status"] == "rejected"
    assert AuditLog.query.filter_by(request_id=withdrawn, event="archive_queued").count() == 3  # submitted, decided at the time, decided by the migration
    run_0005()  # again: nothing new
    assert len(deposits()) == 6
