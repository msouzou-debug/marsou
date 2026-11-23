"""Settings > cost centres: Directorate field, filter and paging. The other lists stay as they were."""
from ehire.extensions import db
from ehire.models import AuditLog, CostCentre, Directorate
from tests.conftest import login


def _admin(client):
    login(client, "demo.admin")


def _dir(code):
    return Directorate.query.filter_by(code=code).one().id


def _many(n, directorate_id=None, start=2000000000):
    for i in range(n):
        db.session.add(CostCentre(code=str(start + i), name_el="Κ%d" % i, name_en="C%d" % i, directorate_id=directorate_id))
    db.session.commit()


def test_add_with_and_without_a_directorate(seeded, client):
    _admin(client)
    client.post("/settings/cost_centre/add", data={"code": "1000000200", "name_el": "Α", "name_en": "A",
                                                   "directorate_id": str(_dir("LIM"))})
    client.post("/settings/cost_centre/add", data={"code": "0001000300", "name_el": "Β", "name_en": "B"})
    a = CostCentre.query.filter_by(code="1000000200").one()
    b = CostCentre.query.filter_by(code="0001000300").one()  # leading zeros kept
    assert a.directorate_id == _dir("LIM") and b.directorate_id is None
    added = AuditLog.query.filter_by(event="list_changed", object_id=str(a.id)).one()
    assert '"directorate_id": %d' % _dir("LIM") in added.detail_json


def test_edit_changes_and_clears_the_directorate_but_never_the_code(seeded, client):
    _admin(client)
    cc = CostCentre.query.filter_by(code="1001").one()
    client.post("/settings/cost_centre/%d/edit" % cc.id, data={"name_el": "Α", "name_en": "A", "code": "HACK",
                                                               "directorate_id": str(_dir("MH"))})
    db.session.refresh(cc)
    assert cc.directorate_id == _dir("MH") and cc.code == "1001"
    client.post("/settings/cost_centre/%d/edit" % cc.id, data={"name_el": "Α", "name_en": "A", "directorate_id": ""})
    db.session.refresh(cc)
    assert cc.directorate_id is None
    assert AuditLog.query.filter_by(event="list_changed", object_id=str(cc.id)).count() == 2


def test_an_unknown_directorate_is_refused_not_read_as_none(seeded, client):
    _admin(client)
    cc = CostCentre.query.filter_by(code="1001").one()
    before = cc.directorate_id
    client.post("/settings/cost_centre/%d/edit" % cc.id, data={"name_el": "Α", "name_en": "A", "directorate_id": "99999"})
    db.session.refresh(cc)
    assert cc.directorate_id == before and cc.name_en == "Medical ward"
    client.post("/settings/cost_centre/add", data={"code": "77", "name_el": "Α", "name_en": "A", "directorate_id": "x"})
    assert CostCentre.query.filter_by(code="77").count() == 0


def test_list_is_paged_by_fifty_and_clamped(seeded, client):
    _many(120)
    _admin(client)
    total = CostCentre.query.count()  # 10 seeded + 120
    pages = -(-total // 50)
    p1 = client.get("/settings/cost_centre?lang=en").get_data(as_text=True)
    assert p1.count("/edit\"") == 50
    assert "Page 1 of %d" % pages in p1 and "Next" in p1 and "Previous" not in p1
    last = client.get("/settings/cost_centre?page=%d&lang=en" % pages).get_data(as_text=True)
    assert last.count("/edit\"") == total - 50 * (pages - 1) and "Next" not in last and "Previous" in last
    beyond = client.get("/settings/cost_centre?page=99&lang=en").get_data(as_text=True)
    assert "Page %d of %d" % (pages, pages) in beyond
    junk = client.get("/settings/cost_centre?page=abc&lang=en").get_data(as_text=True)
    assert "Page 1 of" in junk


def test_filter_by_directorate_and_by_none(seeded, client):
    _many(70, _dir("MH"))
    _admin(client)
    mh = client.get("/settings/cost_centre?directorate=%d&lang=en" % _dir("MH")).get_data(as_text=True)
    assert mh.count("/edit\"") == 50 and "Page 1 of 2" in mh and "page=2" in mh and "directorate=%d" % _dir("MH") in mh.split("Page 1 of 2")[1]
    assert "1001" not in mh
    unassigned = client.get("/settings/cost_centre?directorate=none&lang=en").get_data(as_text=True)
    assert unassigned.count("/edit\"") == 2  # the two seeded cost centres with no Directorate: 1009, 1010
    assert "1009" in unassigned and "1007" not in unassigned
    assert "Filter by Directorate" in unassigned and "No Directorate" in unassigned
    bogus = client.get("/settings/cost_centre?directorate=zzz&lang=en").get_data(as_text=True)
    assert "Page 1 of" in bogus


def test_saving_returns_to_the_same_filter_and_page(seeded, client):
    _many(70, _dir("MH"))
    _admin(client)
    cc = CostCentre.query.filter_by(directorate_id=_dir("MH")).order_by(CostCentre.code).first()
    resp = client.post("/settings/cost_centre/%d/edit" % cc.id,
                       data={"name_el": "Α", "name_en": "A", "directorate_id": str(_dir("MH")),
                             "filter_directorate": str(_dir("MH")), "page": "2"})
    assert resp.status_code == 302 and "directorate=%d" % _dir("MH") in resp.headers["Location"] \
        and "page=2" in resp.headers["Location"]


def test_the_other_lists_are_not_paged_or_filtered(seeded, client):
    _admin(client)
    for kind in ("directorate", "facility", "position", "oay_specialty"):
        r = client.get("/settings/%s?lang=en" % kind)
        html = r.get_data(as_text=True)
        assert r.status_code == 200 and "Filter by Directorate" not in html and "Page 1 of" not in html
        assert "filter_directorate" not in html
