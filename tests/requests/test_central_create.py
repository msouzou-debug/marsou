"""Central roles may create requests (owner decision 14/11/2026). The conflict-of-interest rule still holds."""
import pytest

from ehr.models import Directorate, RolePermission, Task, User
from tests.requests.flowhelpers import act, actions_of, as_user, create, reload, step2, step3, step4, text

CENTRAL = {"central.finmgmt": "fin_mgmt_head", "central.hr": "central_hr_officer",
           "central.medical": "medical_director", "central.nursing": "nursing_director", "central.ceo": "ceo"}


def test_the_five_central_roles_hold_request_create_and_viewer_and_admin_do_not(seeded):
    holders = {r.role for r in RolePermission.query.filter_by(permission_key="request.create")}
    assert holders == {"requester", "dir_accountant", "sci_director", "dir_hr_officer", "dir_exec",
                       "fin_mgmt_head", "central_hr_officer", "medical_director", "nursing_director", "ceo"}
    assert "request.create" not in User.query.filter_by(username="demo.viewer").one().permissions()
    assert "request.create" not in User.query.filter_by(username="demo.admin").one().permissions()


def test_demo_seed_and_create_admin_seed_the_same_role_permissions(app):
    """One source (seed_data.json) feeds both, so a real install gets the same rows as the demo."""
    from ehr.cli import _ensure_role_permissions
    from ehr.extensions import db
    from ehr.models import RolePermission as RP
    from ehr.seed import load_data, seed_demo

    _ensure_role_permissions()
    db.session.commit()
    real = {(r.role, r.permission_key) for r in RP.query}
    RP.query.delete()
    db.session.commit()
    seed_demo()
    assert {(r.role, r.permission_key) for r in RP.query} == real
    assert ("ceo", "request.create") in real
    assert real == {(role, k) for role, keys in load_data()["role_permissions"].items() for k in keys}


@pytest.mark.parametrize("username", sorted(CENTRAL))
def test_a_central_user_sees_every_active_directorate_and_can_create(seeded, client, username):
    as_user(client, username)
    page = text(client.get("/requests/new?lang=en"))
    assert page.count("<option") >= len(Directorate.query.filter_by(is_active=True).all())
    for d in Directorate.query.filter_by(is_active=True):
        assert d.name_en in page
    req = create(client, username, directorate_code="LIM", category="admin")
    assert req.created_by == User.query.filter_by(username=username).one().id
    assert req.directorate.code == "LIM" and req.status == "in_progress" and req.number


def test_a_central_user_cannot_choose_a_deactivated_directorate(seeded, client):
    from ehr.extensions import db

    Directorate.query.filter_by(code="PHC").one().is_active = False
    db.session.commit()
    as_user(client, "central.hr")
    page = text(client.get("/requests/new?lang=en"))
    assert Directorate.query.filter_by(code="NIC").one().name_en in page
    assert Directorate.query.filter_by(code="PHC").one().name_en not in page


def test_the_ceo_cannot_decide_the_ceo_task_on_their_own_request(seeded, client):
    req = create(client, "central.ceo", directorate_code="NIC", category="admin")
    rid = req.id
    step2(client, rid, financials=False)
    step3(client, rid, sci=False)
    step4(client, rid)
    r = reload(rid)
    assert r.current_step == 6
    task = Task.query.filter_by(request_id=rid, role="ceo", status="open").one()
    ceo = User.query.filter_by(username="central.ceo").one()
    deputy = User.query.filter_by(username="central.deputy").one()
    assert task.assignee_user_id == deputy.id and task.on_behalf_of_user_id == ceo.id
    assert task.redirect_reason == "conflict_of_interest"

    as_user(client, "central.ceo")
    assert 'id="ehr-card-' not in text(client.get("/requests/%d" % rid))
    before = len(actions_of(rid))
    resp = act(client, "central.ceo", rid, "approve", role="ceo", task_id=task.id, follow=True)
    assert "You can&#39;t act on your own request." in text(resp)
    assert len(actions_of(rid)) == before and reload(rid).status == "in_progress"

    assert act(client, "central.deputy", rid, "approve").status_code == 302
    r = reload(rid)
    assert r.status == "approved"
    last = [a for a in actions_of(rid) if a.action == "approve"][-1]
    assert last.actor_user_id == deputy.id and last.on_behalf_of_user_id == ceo.id
    assert last.redirect_reason == "conflict_of_interest"
