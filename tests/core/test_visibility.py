import pytest

from ehr.auth import can_see_request, visible_requests_query
from ehr.extensions import db
from ehr.models import Directorate, Request, Task, User


@pytest.fixture
def reqs(seeded):
    u = {x.username: x for x in User.query.all()}
    d = {x.code: x for x in Directorate.query.all()}
    a = Request(status="in_progress", directorate_id=d["LIM"].id, created_by=u["lim.requester"].id, number="X-1")
    b = Request(status="in_progress", directorate_id=d["NIC"].id, created_by=u["nic.requester"].id, number="X-2")
    draft = Request(status="draft", directorate_id=d["LIM"].id, created_by=u["lim.requester"].id)
    db.session.add_all([a, b, draft])
    db.session.commit()
    return u, a, b, draft


def ids(user):
    return {r.id for r in visible_requests_query(user)}


def test_requester_sees_own_only(reqs):
    u, a, b, draft = reqs
    assert ids(u["lim.requester"]) == {a.id, draft.id}
    assert can_see_request(u["lim.requester"], a) and not can_see_request(u["lim.requester"], b)


def test_directorate_role_sees_own_directorate_not_drafts(reqs):
    u, a, b, draft = reqs
    for name in ("lim.accountant", "lim.exec", "lim.deputy"):
        assert ids(u[name]) == {a.id}, name
        assert can_see_request(u[name], a) and not can_see_request(u[name], b) and not can_see_request(u[name], draft)


def test_other_directorate_cannot_see(reqs):
    u, a, b, draft = reqs
    assert not can_see_request(u["nic.exec"], a)
    assert ids(u["nic.exec"]) == {b.id}


def test_central_viewer_admin_see_all_submitted(reqs):
    u, a, b, draft = reqs
    for name in ("central.ceo", "central.deputy", "demo.viewer", "demo.admin"):
        assert ids(u[name]) == {a.id, b.id}, name


def test_task_holder_sees_request(reqs):
    u, a, b, draft = reqs
    assert not can_see_request(u["phc.hr"], a)
    db.session.add(Task(request_id=a.id, step=3, role="dir_hr_officer", assignee_user_id=u["phc.hr"].id))
    db.session.commit()
    assert can_see_request(u["phc.hr"], a) and a.id in ids(u["phc.hr"])


def test_none_user_sees_nothing(reqs):
    assert not can_see_request(None, reqs[1])
    assert visible_requests_query(None).count() == 0
