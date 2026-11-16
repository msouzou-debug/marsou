from io import BytesIO

from ehr.models import ArchiveDeposit, Request
from tests.requests.flowhelpers import act, as_user, create, reload, step2, step3, step4
from tests.documents.samples import pdf_bytes


def deposits(rid=None):
    from ehr.extensions import db
    db.session.expire_all()
    q = ArchiveDeposit.query.order_by(ArchiveDeposit.id)
    if rid is not None:
        q = q.filter_by(request_id=rid)
    return q.all()


def row_of(rid, kind):
    from ehr.extensions import db
    db.session.expire_all()
    return ArchiveDeposit.query.filter_by(request_id=rid, kind=kind).one()


def kinds(rid):
    return [d.kind for d in deposits(rid)]


def approve_all(client, rid, sci=True):
    step2(client, rid)
    step3(client, rid, sci=sci)
    step4(client, rid)
    if sci:
        assert act(client, "central.medical", rid, "opinion", opinion="positive", comment="Fine.").status_code == 302
    assert act(client, "central.ceo", rid, "approve").status_code == 302
    assert reload(rid).status == "approved"


def create_with_leaver(client, **kw):
    """A leaver request with a draft first, so a document can be attached before submission."""
    from tests.requests.helpers import full_form
    as_user(client, "nic.requester")
    data = full_form(reason="resignation", **kw)
    data["intent"] = "draft"
    assert client.post("/requests", data=data).status_code == 302
    req = Request.query.order_by(Request.id.desc()).first()
    return req


def attach(client, rid, name="job-description.pdf", content=None):
    data = {"documents": [(BytesIO(content or pdf_bytes(1, ["Sample attachment"])), name)]}
    resp = client.post("/requests/%d/documents" % rid, data=data, content_type="multipart/form-data")
    assert resp.status_code == 302


LEAVERS = {"leavers[0].name": "Maria Test Leaver", "leavers[1].name": "Andreas Sample Person",
           "leavers[1].leave_date": "15/04/2027", "leavers[1].employment": "civil_servant", "positions_count": "2"}


def rich_request(client):
    """An approved resignation request: two leavers, financials, two documents, a return, a replaced answer.
    Invented data only. Returns the request id."""
    from tests.requests.flowhelpers import act, step2, step4
    from tests.requests.helpers import full_form
    from tests.requests.test_return_replace_withdraw import resubmit
    rid = create_with_leaver(client, **LEAVERS).id
    attach(client, rid, "job-description.pdf")
    attach(client, rid, "rota-2026.pdf", pdf_bytes(1, ["Rota"]))
    assert client.post("/requests/%d/edit" % rid, data=full_form(reason="resignation", **LEAVERS)).status_code == 302
    step2(client, rid)
    assert act(client, "nic.hr", rid, "check", documentation="complete").status_code == 302
    assert act(client, "nic.sci", rid, "return", comment="Please attach the rota.").status_code == 302
    assert resubmit(client, rid, note="Rota attached.", reason="resignation", **LEAVERS).status_code == 302
    assert act(client, "nic.hr", rid, "check", documentation="complete",
               comment="Checked again after the rota was added.").status_code == 302
    assert act(client, "nic.sci", rid, "opinion", opinion="positive", comment="Supported.").status_code == 302
    assert act(client, "nic.exec", rid, "approve", comment="Approved by the Directorate.").status_code == 302
    step4(client, rid)
    assert act(client, "central.medical", rid, "opinion", opinion="positive", comment="Fine.").status_code == 302
    assert act(client, "central.ceo", rid, "approve").status_code == 302
    assert reload(rid).status == "approved"
    return rid
