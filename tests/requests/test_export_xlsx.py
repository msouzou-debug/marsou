"""Excel export of the request list (Phase 6)."""
import io
import json
import shutil
import subprocess
from datetime import datetime, timezone
from pathlib import Path

import pytest
from openpyxl import load_workbook

from ehr import localtime
from ehr.extensions import db
from ehr.models import AuditLog, Request, User
from tests.conftest import login
from tests.requests.flowhelpers import act, as_user, create, step2

ROOT = Path(__file__).resolve().parents[2] / "ehr/i18n"
EN = json.loads((ROOT / "en.json").read_text(encoding="utf-8"))
EL = json.loads((ROOT / "el.json").read_text(encoding="utf-8"))
KNOWN_MISSING = set()  # keys the strings agent has not written yet; empty when all exist

HEADER_KEYS = ["export.col.number", "export.col.status", "export.col.step", "field.directorate", "field.facility",
               "field.cost_centre", "field.category", "field.position", "field.positions_count", "field.reason",
               "export.col.requester", "export.col.waiting_on", "export.col.days_waiting", "export.col.round",
               "export.col.documents", "export.col.submitted", "export.col.closed"]


def _text(table, key):
    return table.get(key, key)


@pytest.fixture
def cases(seeded, client):
    """Invented requests: Nicosia in progress, Nicosia rejected at step 2, Limassol returned, Limassol in progress."""
    a = create(client, "nic.requester")
    b = create(client, "nic.requester", category="admin")
    as_user(client, "nic.accountant")
    act(client, "nic.accountant", b.id, "check", position="no", funds="yes", comment="No post.")
    c = create(client, "lim.requester", directorate_code="LIM")
    act(client, "lim.accountant", c.id, "return", comment="Please add detail.")
    d = create(client, "lim.requester", directorate_code="LIM", category="admin")
    return {"a": a.id, "b": b.id, "c": c.id, "d": d.id}


def _export(client, user, query="", lang="en"):
    as_user(client, user)
    resp = client.get("/requests/export.xlsx?lang=%s%s" % (lang, query))
    return resp


def _wb(resp):
    assert resp.status_code == 200, resp.get_data(as_text=True)[:500]
    return load_workbook(io.BytesIO(resp.data))


def _rows(wb):
    ws = wb.worksheets[0]
    return [[c.value for c in row] for row in ws.iter_rows(min_row=2)]


def test_requester_gets_404_and_no_button(cases, client):
    assert _export(client, "nic.requester").status_code == 404
    assert "export.xlsx" not in client.get("/requests?tab=mine").get_data(as_text=True)


def test_anonymous_goes_to_login(seeded, client):
    assert client.get("/requests/export.xlsx").status_code in (302, 401, 404)


def test_button_shown_to_those_who_may_export(cases, client):
    as_user(client, "central.ceo")
    assert "/requests/export.xlsx?tab=all" in client.get("/requests?tab=all").get_data(as_text=True)


@pytest.mark.parametrize("user,expected", [("central.ceo", 4), ("demo.viewer", 4), ("nic.accountant", 2),
                                           ("lim.exec", 2), ("phc.accountant", 0)])
def test_row_count_matches_what_the_user_may_see(cases, client, user, expected):
    wb = _wb(_export(client, user, "&tab=all"))
    rows = [r for r in _rows(wb) if r[0]]
    assert len(rows) == expected
    as_user(client, user)
    html = client.get("/requests?tab=all").get_data(as_text=True)
    assert html.count("ehr-row position-relative") == expected


def test_directorate_role_sees_only_its_directorate(cases, client):
    wb = _wb(_export(client, "nic.accountant", "&tab=all"))
    assert {r[3] for r in _rows(wb) if r[0]} == {"Nicosia"}


def test_tab_and_search_are_honoured(cases, client):
    one = db.session.get(Request, cases["a"])
    wb = _wb(_export(client, "central.ceo", "&tab=all&q=" + one.number[-4:]))
    assert [r[0] for r in _rows(wb) if r[0]] == [one.number]
    wb = _wb(_export(client, "central.ceo", "&tab=mine"))
    assert [r for r in _rows(wb) if r[0]] == []
    wb = _wb(_export(client, "nic.accountant", "&tab=waiting"))
    assert len([r for r in _rows(wb) if r[0]]) == 1


@pytest.mark.parametrize("lang,table", [("en", EN), ("el", EL)])
def test_sheet_names_and_headers_in_both_languages(cases, client, lang, table):
    wb = _wb(_export(client, "central.ceo", "&tab=all", lang))
    assert wb.sheetnames == [_text(table, "export.sheet.requests"), _text(table, "export.sheet.summary"),
                             _text(table, "export.sheet.notes")]
    headers = [c.value for c in wb.worksheets[0][1]]
    assert headers == [_text(table, k) for k in HEADER_KEYS]
    if not KNOWN_MISSING:
        assert all(k in table for k in HEADER_KEYS)


def test_requests_sheet_is_a_table_with_real_dates_and_numbers(cases, client):
    wb = _wb(_export(client, "central.ceo", "&tab=all"))
    ws = wb.worksheets[0]
    assert list(ws.tables) == ["tblRequests"] and ws.freeze_panes == "A2"
    assert ws.tables["tblRequests"].ref == "A1:Q5"
    for row in ws.iter_rows(min_row=2):
        assert isinstance(row[8].value, int) and isinstance(row[13].value, int) and isinstance(row[14].value, int)
        assert isinstance(row[15].value, (datetime,)) and row[15].number_format == "dd/mm/yyyy"
    by_status = {r[1]: r for r in _rows(wb)}
    assert isinstance(by_status["In progress"][12], int)
    assert by_status["Rejected"][12] is None and by_status["Rejected"][16] is not None
    assert by_status["Returned"][12] is None


def test_summary_is_formulas_over_sheet_one(cases, client):
    wb = _wb(_export(client, "central.ceo", "&tab=all"))
    ws = wb.worksheets[1]
    formulas = [c.value for row in ws.iter_rows() for c in row if isinstance(c.value, str) and c.value.startswith("=")]
    assert formulas and all(c.data_type == "f" for row in ws.iter_rows() for c in row
                            if isinstance(c.value, str) and c.value.startswith("="))
    assert any("COUNTIFS(tblRequests[[Status]]" in f for f in formulas)
    assert any("SUMIFS(tblRequests[[Number of posts]]" in f for f in formulas)
    assert any(f.startswith("=IFERROR(AVERAGEIFS(") for f in formulas)
    assert any(f.startswith("=SUM(") for f in formulas)
    # no number on the sheet is a typed value: numeric cells hold none
    assert not [c.coordinate for row in ws.iter_rows() for c in row if isinstance(c.value, (int, float))]
    assert ws.max_row > 10


def test_notes_sheet(cases, client):
    wb = _wb(_export(client, "central.ceo", "&tab=all"))
    notes = [r[0].value for r in wb.worksheets[2].iter_rows()]
    assert len(notes) == 4 and all(notes)
    if "export.notes.generated" in EN:
        name = User.query.filter_by(username="central.ceo").one().full_name
        assert name in notes[0] and localtime.today().strftime("%d/%m/%Y") in notes[0]


def test_no_leaver_names_costs_or_comments(seeded, client):
    req = create(client, reason="resignation")
    step2(client, req.id)
    wb = _wb(_export(client, "central.ceo", "&tab=all"))
    dump = json.dumps([[c.value for c in row] for ws in wb.worksheets for row in ws.iter_rows()], default=str)
    assert "Sample Person" not in dump and "Sample need text" not in dump and "1254300" not in dump


def test_formula_injection_is_stored_as_text(seeded, client):
    req = create(client)
    user = db.session.get(User, req.created_by)
    user.full_name = '=HYPERLINK("http://example.invalid","x")'
    db.session.commit()
    resp = _export(client, "central.ceo", "&tab=all")
    wb = _wb(resp)
    cell = wb.worksheets[0].cell(row=2, column=11)
    assert cell.value == '=HYPERLINK("http://example.invalid","x")'
    assert cell.data_type == "s" and cell.quotePrefix
    assert b"<f>HYPERLINK" not in b"".join(zf for zf in [_unzip(resp.data, "xl/worksheets/sheet1.xml")])


def _unzip(data, name):
    import zipfile
    return zipfile.ZipFile(io.BytesIO(data)).read(name)


def test_audit_row_and_file_name(cases, client):
    resp = _export(client, "central.ceo", "&tab=all&q=1")
    assert resp.status_code == 200
    assert resp.headers["Content-Disposition"].split("filename=")[1].strip('"') == "eHR-requests-%s.xlsx" % localtime.today().strftime("%Y%m%d")
    row = AuditLog.query.filter_by(event="list_exported").one()
    detail = json.loads(row.detail_json) if isinstance(row.detail_json, str) else row.detail_json
    assert detail["tab"] == "all" and detail["q"] == "1" and detail["rows"] == len([r for r in _rows(_wb(resp)) if r[0]])


def test_empty_export_still_opens(seeded, client):
    wb = _wb(_export(client, "central.ceo", "&tab=all"))
    assert wb.worksheets[0].tables["tblRequests"].ref == "A1:Q2"


@pytest.mark.skipif(not shutil.which("soffice") and not Path("/usr/bin/soffice").exists(), reason="no LibreOffice")
@pytest.mark.parametrize("lang", ["en", "el"])
def test_libreoffice_recalculates_summary_to_the_row_counts(cases, client, tmp_path, lang):
    resp = _export(client, "central.ceo", "&tab=all", lang)
    src = tmp_path / "in" / "export.xlsx"
    src.parent.mkdir()
    src.write_bytes(resp.data)
    out = tmp_path / "out"
    subprocess.run([shutil.which("soffice") or "/usr/bin/soffice", "--headless", "-env:UserInstallation=file://%s" % (tmp_path / "profile"),
                    "--convert-to", "xlsx", "--outdir", str(out), str(src)], check=True, capture_output=True, timeout=120)
    done = load_workbook(out / "export.xlsx", data_only=True)
    rows = [r for r in _rows(_wb(resp)) if r[0]]
    ws = done.worksheets[1]
    labels = {"en": "Total", "el": EL.get("export.summary.total", "export.summary.total")}
    totals = [(r[1].value, r[2].value) for r in ws.iter_rows() if r[0].value == labels[lang]]
    assert len(totals) == 3
    posts = sum(r[8] for r in rows)
    for count, post_sum in totals:
        assert count == len(rows) and post_sum == posts
    avg = [r[1].value for r in ws.iter_rows() if r[0].value and "average" in str(r[0].value).lower()] if lang == "en" else None
    open_days = [r[12] for r in rows if r[12] is not None]
    if avg:
        assert avg[0] == pytest.approx(sum(open_days) / len(open_days))


def test_export_shows_local_cyprus_dates(cases, client):
    """Stored in UTC; 22:30 UTC on 4 March is 00:30 on 5 March in Cyprus, so the cell holds the 5th."""
    req = db.session.get(Request, cases["a"])
    req.submitted_at = datetime(2026, 3, 4, 22, 30, tzinfo=timezone.utc)
    req.closed_at = datetime(2026, 7, 14, 21, 30, tzinfo=timezone.utc)  # summer: UTC+3, so 00:30 on the 15th
    db.session.commit()
    rows = {r[0]: r for r in _rows(_wb(_export(client, "central.ceo", "&tab=all")))}
    row = rows[req.number]
    assert row[15] == datetime(2026, 3, 5) and row[16] == datetime(2026, 7, 15)
    assert req.submitted_at.replace(tzinfo=timezone.utc).date().day == 4  # the stored value did not change
