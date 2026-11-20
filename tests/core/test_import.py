import io

from openpyxl import Workbook, load_workbook

from ehire.models import (AuditLog, CostCentre, Directorate, Facility, OaySpecialty, Position, RoleAssignment, User)
from ehire.settings.import_xlsx import SHEETS
from tests.conftest import login


def book(**sheets):
    """An in-memory workbook. Each keyword is a sheet: a list of rows, the first being the header."""
    wb = Workbook()
    wb.remove(wb.active)
    for name, rows in sheets.items():
        ws = wb.create_sheet(name)
        for row in rows:
            ws.append(row)
    out = io.BytesIO()
    wb.save(out)
    out.seek(0)
    return out


def good(**override):
    sheets = {
        "directorates": [list(SHEETS["directorates"]), ["XD1", "Α", "A", "yes", "yes"], ["XD2", "Β", "B", "no", "yes"]],
        "facilities": [list(SHEETS["facilities"]), ["XD1", "XF1", "Νοσ", "Hosp", "NGH", "yes"]],
        "positions": [list(SHEETS["positions"]), ["medical", "Ιατρός Χ", "Doctor X", "yes"]],
        "cost_centres": [list(SHEETS["cost_centres"]), ["X100", "Κέντρο", "Centre", "yes"]],
        "oay_specialties": [list(SHEETS["oay_specialties"]), ["Χειρουργική Χ", "yes"]],
        "users": [list(SHEETS["users"]), ["x.boss", "Boss X", "boss@example.org", "local", "", "yes"],
                  ["x.acc", "Acc X", "", "local", "x.boss", "yes"], ["x.ad", "Ad X", "", "ad", "", "no"]],
        "role_holders": [list(SHEETS["role_holders"]), ["dir_accountant", "XD1", "x.acc", "x.boss"],
                         ["ceo", "", "x.boss", ""], ["requester", "XD1", "x.acc", ""], ["requester", "XD1", "x.boss", ""]],
    }
    sheets.update(override)
    return book(**sheets)


def post(client, wb, name="data.xlsx"):
    return client.post("/settings/import", data={"file": (wb, name)}, content_type="multipart/form-data")


def token_of(response):
    html = response.get_data(as_text=True)
    marker = 'name="token" value="'
    return html.split(marker)[1].split('"')[0]


def run(client, wb):
    r = post(client, wb)
    assert r.status_code == 200 and "data-import-summary" in r.get_data(as_text=True), r.get_data(as_text=True)[:3000]
    return client.post("/settings/import/confirm", data={"token": token_of(r)})


def admin(client):
    login(client, "demo.admin")


def test_page_and_permission(seeded, client):
    login(client, "lim.requester")
    for path in ("/settings/import", "/settings/import/template.xlsx"):
        assert client.get(path).status_code == 404
    assert post(client, good()).status_code == 404
    assert Directorate.query.filter_by(code="XD1").count() == 0
    admin(client)
    assert client.get("/settings/import").status_code == 200


def test_template_downloads_and_opens(seeded, client):
    admin(client)
    r = client.get("/settings/import/template.xlsx")
    assert r.status_code == 200
    wb = load_workbook(io.BytesIO(r.data))
    assert wb.sheetnames == ["Instructions"] + list(SHEETS)
    for name, columns in SHEETS.items():
        ws = wb[name]
        assert [c.value for c in ws[1]] == list(columns)
        assert ws.freeze_panes == "A2"
        assert ws["A1"].fill.start_color.rgb.endswith("069FEC") and ws["A1"].font.bold
    assert wb["directorates"].max_row == Directorate.query.count() + 1
    assert wb["facilities"].data_validations.dataValidation


def test_valid_file_imports_all_sheets(seeded, client):
    admin(client)
    assert run(client, good()).status_code == 302
    assert Directorate.query.filter_by(code="XD1").one().has_sci_director is True
    assert Facility.query.filter_by(code="XF1").one().archive_site_code == "NGH"
    assert Position.query.filter_by(title_el="Ιατρός Χ").one().category == "medical"
    assert CostCentre.query.filter_by(code="X100").count() == 1
    assert OaySpecialty.query.filter_by(name="Χειρουργική Χ").count() == 1
    acc = User.query.filter_by(username="x.acc").one()
    boss = User.query.filter_by(username="x.boss").one()
    assert acc.line_manager_user_id == boss.id and acc.must_change_password and acc.password_hash
    ad = User.query.filter_by(username="x.ad").one()
    assert ad.auth_source == "ad" and ad.is_active is False and ad.password_hash is None
    d1 = Directorate.query.filter_by(code="XD1").one()
    holder = RoleAssignment.query.filter_by(role="dir_accountant", directorate_id=d1.id).one()
    assert holder.user_id == acc.id and holder.substitute_user_id == boss.id
    assert RoleAssignment.query.filter_by(role="requester", directorate_id=d1.id).count() == 2
    assert RoleAssignment.query.filter_by(role="ceo", user_id=boss.id).count() == 1
    events = {a.event for a in AuditLog.query.all()}
    assert {"list_changed", "user_changed", "role_changed"} <= events


def test_one_bad_row_blocks_everything(seeded, client):
    admin(client)
    bad = good(positions=[list(SHEETS["positions"]), ["medical", "Ιατρός Χ", "Doctor X", "yes"],
                          ["wizard", "Μάγος", "Wizard", "yes"]])
    r = post(client, bad)
    html = r.get_data(as_text=True)
    assert "data-import-errors" in html and "positions" in html and "<td>3</td>" in html and "category" in html
    assert Directorate.query.filter_by(code="XD1").count() == 0
    assert User.query.filter_by(username="x.boss").count() == 0


def test_reimport_and_roundtrip_change_nothing(seeded, client):
    admin(client)
    run(client, good())
    audits = AuditLog.query.count()
    html = post(client, good()).get_data(as_text=True)
    assert "data-import-errors" not in html and 'name="token"' not in html  # nothing to confirm
    assert "<td>0</td><td>0</td><td>" in html
    template = client.get("/settings/import/template.xlsx").data  # the export of what is there now
    html = post(client, io.BytesIO(template)).get_data(as_text=True)
    assert "data-import-errors" not in html, html[:3000]
    assert 'name="token"' not in html
    assert AuditLog.query.count() == audits


def test_update_and_deactivate(seeded, client):
    admin(client)
    run(client, good())
    changed = good(
        directorates=[list(SHEETS["directorates"]), ["XD1", "Α2", "A2", "no", "no"]],
        cost_centres=[list(SHEETS["cost_centres"]), ["X100", "Κέντρο", "Centre 2", "no"]],
        users=[list(SHEETS["users"]), ["X.BOSS", "Boss Y", "", "local", "", "no"]],
        role_holders=[list(SHEETS["role_holders"]), ["ceo", "", "x.acc", ""]],
    )
    assert run(client, changed).status_code == 302
    d = Directorate.query.filter_by(code="XD1").one()
    assert (d.name_en, d.has_sci_director, d.is_active) == ("A2", False, False)
    cc = CostCentre.query.filter_by(code="X100").one()
    assert cc.name_en == "Centre 2" and cc.is_active is False
    boss = User.query.filter_by(username="x.boss").one()
    assert boss.full_name == "Boss Y" and boss.is_active is False and User.query.filter_by(username="X.BOSS").count() == 0
    ceo = [a for a in RoleAssignment.query.filter_by(role="ceo").all() if a.is_active_on()]
    assert [a.user.username for a in ceo] == ["x.acc"]  # the earlier holder ended, nothing deleted
    assert RoleAssignment.query.filter_by(role="ceo", user_id=boss.id).count() == 1


def test_role_holder_uniqueness(seeded, client):
    admin(client)
    rows = [list(SHEETS["role_holders"]), ["ceo", "", "x.acc", ""], ["ceo", "", "x.boss", ""]]
    html = post(client, good(role_holders=rows)).get_data(as_text=True)
    assert "data-import-errors" in html and "role_holders" in html and "<td>3</td>" in html


def test_unknown_directorate_and_bad_site_code(seeded, client):
    admin(client)
    fac = [list(SHEETS["facilities"]), ["NOPE", "XF1", "Ν", "H", "NGH", "yes"], ["XD1", "XF2", "Ν", "H", "NAM", "yes"]]
    html = post(client, good(facilities=fac)).get_data(as_text=True)
    assert "NOPE" in html and "archive_site_code" in html and "<td>2</td>" in html and "<td>3</td>" in html
    roles = [list(SHEETS["role_holders"]), ["dir_accountant", "NOPE", "x.acc", ""]]
    assert "NOPE" in post(client, good(role_holders=roles)).get_data(as_text=True)


def test_file_safety(seeded, client):
    admin(client)
    assert "data-import-errors" not in post(client, io.BytesIO(b"hello"), "x.xlsx").get_data(as_text=True)
    r = post(client, io.BytesIO(b"PK\x03\x04junk"), "x.xlsx")
    assert r.status_code == 200 and Directorate.query.filter_by(code="XD1").count() == 0
    assert "alert-danger" in post(client, io.BytesIO(b"x"), "x.csv").get_data(as_text=True)
    big = io.BytesIO(b"PK\x03\x04" + b"0" * (5 * 1024 * 1024 + 10))
    assert "alert-danger" in post(client, big).get_data(as_text=True)
    many = good(cost_centres=[list(SHEETS["cost_centres"])] + [[f"C{i}", "Α", "A", "yes"] for i in range(5001)])
    assert "data-import-errors" in post(client, many).get_data(as_text=True)


def test_blank_rows_and_whitespace_ignored(seeded, client):
    admin(client)
    rows = [list(SHEETS["cost_centres"]), [None, None, None, None], ["  X7  ", " Α ", " A ", None]]
    assert run(client, good(cost_centres=rows)).status_code == 302
    assert CostCentre.query.filter_by(code="X7").one().name_en == "A"


def test_confirm_needs_own_token(seeded, client):
    admin(client)
    assert client.post("/settings/import/confirm", data={"token": "bogus"}).status_code == 302
    assert Directorate.query.filter_by(code="XD1").count() == 0


def test_number_prefix_falls_back_to_the_seed_file_when_no_setting_is_recorded(app):
    from ehire.extensions import db
    from ehire.models import Setting
    from ehire.seed import load_data
    from ehire.services import numbering

    with app.app_context():
        row = db.session.get(Setting, "number_prefix")
        if row is not None:
            db.session.delete(row)
            db.session.flush()
        assert numbering._prefix(db.session) == load_data()["settings"]["number_prefix"]
        db.session.rollback()
