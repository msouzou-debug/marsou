from ehr.extensions import db
from ehr.models import AuditLog, CostCentre, Directorate, Position
from tests.conftest import login


def admin(client):
    login(client, "demo.admin")


def test_pages_render_for_every_list(seeded, client):
    admin(client)
    assert client.get("/settings").status_code == 200
    for kind in ("directorate", "facility", "position", "cost_centre", "oay_specialty"):
        assert client.get(f"/settings/{kind}").status_code == 200
    assert client.get("/settings/nonsense").status_code == 404


def test_add_edit_deactivate_audited(seeded, client):
    admin(client)
    r = client.post("/settings/cost_centre/add", data={"code": "2001", "name_el": "Α", "name_en": "A"})
    assert r.status_code == 302
    cc = CostCentre.query.filter_by(code="2001").one()
    client.post(f"/settings/cost_centre/{cc.id}/edit", data={"name_el": "Β", "name_en": "B", "code": "HACK"})
    db.session.refresh(cc)
    assert cc.name_en == "B" and cc.code == "2001"
    client.post(f"/settings/cost_centre/{cc.id}/toggle")
    db.session.refresh(cc)
    assert cc.is_active is False
    client.post(f"/settings/cost_centre/{cc.id}/toggle")
    db.session.refresh(cc)
    assert cc.is_active is True
    actions = [a.detail_json for a in AuditLog.query.filter_by(event="list_changed").order_by(AuditLog.id)]
    assert len(actions) == 4
    assert '"add"' in actions[0] and '"edit"' in actions[1] and '"deactivate"' in actions[2] and '"activate"' in actions[3]
    assert AuditLog.query.filter_by(event="list_changed").first().user_id is not None


def test_required_and_duplicate(seeded, client):
    admin(client)
    n = CostCentre.query.count()
    client.post("/settings/cost_centre/add", data={"code": "", "name_el": "x", "name_en": "y"})
    client.post("/settings/cost_centre/add", data={"code": "1001", "name_el": "x", "name_en": "y"})
    assert CostCentre.query.count() == n
    assert AuditLog.query.filter_by(event="list_changed").count() == 0


def test_add_position_and_directorate(seeded, client):
    admin(client)
    client.post("/settings/position/add", data={"category": "medical", "title_el": "Ε", "title_en": "E"})
    client.post("/settings/position/add", data={"category": "bogus", "title_el": "Ε", "title_en": "E"})
    assert Position.query.filter_by(title_en="E").count() == 1
    client.post("/settings/directorate/add", data={"code": "NEW", "name_el": "Ν", "name_en": "N", "has_sci_director": "1"})
    assert Directorate.query.filter_by(code="NEW").one().has_sci_director is True


def test_non_admin_blocked(seeded, client):
    login(client, "lim.exec")
    assert client.post("/settings/cost_centre/add", data={"code": "9", "name_el": "a", "name_en": "b"}).status_code == 404
    assert CostCentre.query.filter_by(code="9").count() == 0


def test_audit_log_is_append_only(seeded, app):
    import pytest

    from ehr.models import audit

    row = audit("login", user_id=None)
    db.session.commit()
    row.event = "changed"
    with pytest.raises(RuntimeError):
        db.session.commit()
    db.session.rollback()
