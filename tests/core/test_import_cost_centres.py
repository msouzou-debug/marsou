"""Cost centres in the Excel import: numeric codes, the optional directorate_code column, 2,000 rows."""
import io
import time

from openpyxl import load_workbook

from ehire.models import AuditLog, CostCentre, Directorate
from ehire.settings.import_xlsx import SHEETS
from tests.core.test_import import admin, good, post, run

HEAD = list(SHEETS["cost_centres"])


def test_numeric_cells_become_the_plain_digits(seeded, client):
    admin(client)
    rows = [HEAD, [1000000200, "Α", "A", "XD1", "yes"], [1000000300.0, "Β", "B", "", "yes"],
            [1.0000004E9, "Γ", "C", "", "yes"], ["0001000500", "Δ", "D", "", "yes"]]
    assert run(client, good(cost_centres=rows)).status_code == 302
    codes = sorted(c.code for c in CostCentre.query.filter(CostCentre.code.like("1000%") | CostCentre.code.like("0001%")))
    assert codes == ["0001000500", "1000000200", "1000000300", "1000000400"]  # nothing like 1000000200.0 or 1E9


def test_directorate_code_sets_keeps_and_clears(seeded, client):
    admin(client)
    run(client, good(cost_centres=[HEAD, ["X100", "Κέντρο", "Centre", "XD1", "yes"]]))
    cc = CostCentre.query.filter_by(code="X100").one()
    xd1 = Directorate.query.filter_by(code="XD1").one().id
    assert cc.directorate_id == xd1
    # blank keeps the stored value on an existing row
    run(client, good(cost_centres=[HEAD, ["X100", "Κέντρο", "Centre 2", "", "yes"]]))
    from ehire.extensions import db
    db.session.refresh(cc)
    assert cc.name_en == "Centre 2" and cc.directorate_id == xd1
    # a new row with a blank cell belongs to no Directorate
    run(client, good(cost_centres=[HEAD, ["X200", "Κέντρο", "Centre", "", "yes"]]))
    assert CostCentre.query.filter_by(code="X200").one().directorate_id is None
    # another Directorate moves it
    run(client, good(cost_centres=[HEAD, ["X100", "Κέντρο", "Centre 2", "XD2", "yes"]]))
    db.session.refresh(cc)
    assert cc.directorate_id == Directorate.query.filter_by(code="XD2").one().id


def test_unknown_directorate_code_is_an_error(seeded, client):
    admin(client)
    html = post(client, good(cost_centres=[HEAD, ["X100", "Κέντρο", "Centre", "NOPE", "yes"]])).get_data(as_text=True)
    assert "data-import-errors" in html and "directorate_code" in html and "NOPE" in html
    assert CostCentre.query.filter_by(code="X100").count() == 0


def test_a_file_without_the_column_still_imports_and_keeps_directorates(seeded, client):
    admin(client)
    nic = CostCentre.query.filter_by(code="1001").one().directorate_id
    assert nic is not None
    rows = [["code", "name_el", "name_en", "active"], ["1001", "Παθολογική κλινική", "Medical ward renamed", "yes"],
            ["X300", "Νέο", "New", "yes"]]
    assert run(client, good(cost_centres=rows)).status_code == 302
    from ehire.extensions import db
    cc = CostCentre.query.filter_by(code="1001").one()
    db.session.refresh(cc)
    assert cc.name_en == "Medical ward renamed" and cc.directorate_id == nic
    assert CostCentre.query.filter_by(code="X300").one().directorate_id is None


def test_template_has_the_column_and_round_trips(seeded, client):
    admin(client)
    wb = load_workbook(io.BytesIO(client.get("/settings/import/template.xlsx").data))
    ws = wb["cost_centres"]
    assert [c.value for c in ws[1]] == ["code", "name_el", "name_en", "directorate_code", "active"]
    row = next(r for r in ws.iter_rows(min_row=2, values_only=True) if r[0] == "1001")
    assert row[3] == "NIC" and isinstance(row[0], str)
    html = post(client, io.BytesIO(client.get("/settings/import/template.xlsx").data)).get_data(as_text=True)
    assert "data-import-errors" not in html and 'name="token"' not in html  # nothing to change


def test_two_thousand_rows_validate_apply_and_reimport_unchanged(seeded, client):
    admin(client)
    rows = [HEAD] + [[str(1000000000 + i), "Κέντρο %d" % i, "Centre %d" % i, "XD1" if i % 2 else "", "yes" if i % 50 else "no"]
                     for i in range(2000)]
    wb = good(cost_centres=rows)
    started = time.perf_counter()
    r = post(client, wb)
    validated = time.perf_counter() - started
    html = r.get_data(as_text=True)
    assert "data-import-errors" not in html and 'name="token"' in html
    token = html.split('name="token" value="')[1].split('"')[0]
    mid = time.perf_counter()
    assert client.post("/settings/import/confirm", data={"token": token}).status_code == 302
    applied = time.perf_counter() - mid
    print("2,000 cost centres: validate %.2fs, apply %.2fs" % (validated, applied))
    assert validated + applied < 30
    assert CostCentre.query.filter(CostCentre.code.like("1000%")).count() == 2000
    assert CostCentre.query.filter_by(code="1000000050").one().is_active is False
    # one audit row for the sheet, with counts, instead of 2,000
    bulk = AuditLog.query.filter_by(event="list_changed", object_type="cost_centre", object_id="import").one()
    assert '"rows_added": 2000' in bulk.detail_json
    assert AuditLog.query.filter_by(event="list_changed", object_type="cost_centre").count() == 1
    audits = AuditLog.query.count()
    again = post(client, good(cost_centres=rows)).get_data(as_text=True)
    assert "data-import-errors" not in again and 'name="token"' not in again  # everything unchanged
    assert AuditLog.query.count() == audits


def test_a_small_import_keeps_one_audit_row_per_changed_row(seeded, client):
    admin(client)
    run(client, good(cost_centres=[HEAD] + [["Y%d" % i, "Α", "A", "", "yes"] for i in range(3)]))
    rows = AuditLog.query.filter_by(event="list_changed", object_type="cost_centre").all()
    assert len(rows) == 3 and all('"source": "import"' in r.detail_json for r in rows)
