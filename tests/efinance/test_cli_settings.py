"""The commands (efinance-test, efinance-link, sync-cost-centres) and the Settings panel with its button."""
import re

import pytest

from ehire.extensions import db
from ehire.models import AuditLog, CostCentre, Setting
from ehire.services import efinance_link
from tests.conftest import login
from tests.efinance.conftest import LINES, demo_list, set_link
from tests.efinance.fake_efinance import cc


def _run(app, *args):
    return app.test_cli_runner().invoke(args=list(args))


# ---------------------------------------------------------------- efinance-test

def test_efinance_test_passes_and_says_what_came_back(wired, fake):
    demo_list(fake)
    fake.budgets[("1001", 2026)] = LINES
    res = _run(wired, "efinance-test")
    assert res.exit_code == 0, res.output
    assert "cost centres: ok, 10 rows (10 active)" in res.output and "efinance-test: passed" in res.output
    assert re.search(r"budget: ok, cost centre 1001, year \d{4}: \d+ line", res.output)
    assert fake.token not in res.output


def test_efinance_test_takes_a_cost_centre(wired, fake):
    demo_list(fake)
    res = _run(wired, "efinance-test", "--cost-centre", "9999")
    assert res.exit_code == 0 and "does not know cost centre 9999 (404)" in res.output


@pytest.mark.parametrize("mode,words", [(401, "refused the token"), (500, "HTTP 500"), ("timeout", "no answer in time"),
                                        ("redirect", "never follows"), ("bad_json", "not JSON")])
def test_efinance_test_fails_in_plain_words(wired, fake, mode, words):
    demo_list(fake)
    fake.mode = mode
    res = _run(wired, "efinance-test", "--cost-centre", "1001")
    assert res.exit_code == 1 and words in res.output and "efinance-test: failed" in res.output
    assert fake.token not in res.output


def test_efinance_test_reports_missing_settings_without_calling(wired, fake):
    wired.config.update(EHIRE_EFINANCE_URL="http://efinance.example.org", EHIRE_EFINANCE_TOKEN="")
    res = _run(wired, "efinance-test")
    assert res.exit_code == 1 and "EHIRE_EFINANCE_TOKEN is empty" in res.output and "plain http" in res.output
    assert not fake.calls


# ---------------------------------------------------------------- efinance-link

def test_efinance_link_shows_none_by_default(wired):
    res = _run(wired, "efinance-link")
    assert res.exit_code == 0 and res.output.strip() == "efinance_link=none"


def test_efinance_link_http_is_refused_unless_the_test_passes(wired, fake):
    demo_list(fake)
    fake.mode = 401
    res = _run(wired, "efinance-link", "http")
    assert res.exit_code != 0 and "stays none" in res.output
    db.session.expire_all()
    assert efinance_link.link_name() == "none"


def test_efinance_link_http_after_a_passing_test_and_back(wired, fake):
    demo_list(fake)
    res = _run(wired, "efinance-link", "http")
    assert res.exit_code == 0 and res.output.strip().endswith("efinance_link=http")
    db.session.expire_all()
    assert efinance_link.link_name() == "http"
    audit = AuditLog.query.filter_by(event="setting_changed", object_id="efinance_link").one()
    assert '"after": "http"' in audit.detail_json and fake.token not in audit.detail_json
    calls = len(fake.calls)
    assert _run(wired, "efinance-link", "none").output.strip() == "efinance_link=none"
    assert len(fake.calls) == calls  # switching off calls nothing


def test_efinance_link_rejects_other_values(wired):
    assert _run(wired, "efinance-link", "folder").exit_code != 0


# ---------------------------------------------------------------- sync-cost-centres

def test_sync_command_one_line_and_exit_codes(linked, fake):
    demo_list(fake, [cc("1000000600", "Νέο", "NIC")])
    res = _run(linked, "sync-cost-centres")
    assert res.exit_code == 0 and res.output.count("\n") == 1
    assert res.output.startswith("changed: added=1 updated=0 deactivated=0 reactivated=0 total=11")
    fake.mode = 500
    res = _run(linked, "sync-cost-centres")
    assert res.exit_code == 1 and res.output.strip() == "failed: http_500 (nothing changed)"


def test_sync_command_safety_stop_exits_non_zero(linked, fake):
    fake.cost_centres = []
    res = _run(linked, "sync-cost-centres")
    assert res.exit_code == 1 and "empty" in res.output


def test_sync_command_with_link_none_skips(wired, fake):
    fake.fail_if_called = True
    res = _run(wired, "sync-cost-centres")
    assert res.exit_code == 0 and res.output.strip() == "skipped: efinance_link=none" and not fake.calls


# ---------------------------------------------------------------- the Settings panel and button

def test_panel_with_link_none(wired, fake, client):
    fake.fail_if_called = True
    login(client, "demo.admin")
    html = client.get("/settings/cost_centre?lang=en").get_data(as_text=True)
    assert "eFinance link" in html and "Off. Cost centres change only here" in html
    assert "Sync now" not in html and "No sync has run yet." in html and not fake.calls


def test_panel_with_link_on_shows_the_button_and_the_hand_edit_note(linked, client):
    login(client, "demo.admin")
    html = client.get("/settings/cost_centre?lang=el").get_data(as_text=True)
    assert "Συγχρονισμός τώρα" in html and "επαναφέρει στα στοιχεία του eFinance" in html
    assert "/settings/cost_centre/sync" in html


def test_button_runs_the_sync_and_shows_the_counts(linked, fake, client):
    demo_list(fake, [cc("1000000700", "Νέο", "NIC")])
    login(client, "demo.admin")
    resp = client.post("/settings/cost_centre/sync?lang=el", follow_redirects=True)
    html = resp.get_data(as_text=True)
    assert resp.status_code == 200 and "Προστέθηκαν 1, άλλαξαν 0" in html
    assert "Τελευταίος συγχρονισμός:" in html
    row = AuditLog.query.filter_by(object_id="efinance_sync").one()
    assert row.user_id is not None  # the administrator who pressed it


def test_button_after_a_safety_stop_says_nothing_changed(linked, fake, client):
    fake.cost_centres = demo_list(fake)[:2]
    login(client, "demo.admin")
    html = client.post("/settings/cost_centre/sync?lang=el", follow_redirects=True).get_data(as_text=True)
    assert "λιγότερα από τα μισά" in html
    assert CostCentre.query.filter_by(is_active=True).count() == 10


def test_button_shows_unknown_entities(linked, fake, client):
    demo_list(fake, [cc("1000000800", "Νέο", "QQQ")])
    login(client, "demo.admin")
    html = client.post("/settings/cost_centre/sync?lang=en", follow_redirects=True).get_data(as_text=True)
    assert "Entity codes with no Directorate in eHire: QQQ." in html


@pytest.mark.parametrize("user", ["nic.requester", "nic.accountant", "central.finmgmt", "demo.viewer"])
def test_button_needs_settings_manage(linked, fake, client, user):
    login(client, user)
    assert client.post("/settings/cost_centre/sync").status_code == 404
    assert not fake.calls


def test_button_needs_a_csrf_token(linked, fake, client):
    login(client, "demo.admin")
    client.application.config["CSRF_ENABLED"] = True
    assert client.post("/settings/cost_centre/sync").status_code == 400
    assert not fake.calls
    html = client.get("/settings/cost_centre").get_data(as_text=True)
    token = re.search(r'action="/settings/cost_centre/sync".*?name="csrf_token" value="([^"]+)"', html, re.S).group(1)
    assert client.post("/settings/cost_centre/sync", data={"csrf_token": token}).status_code == 302
    assert fake.calls


def test_button_with_link_none_does_not_call(wired, fake, client):
    fake.fail_if_called = True
    login(client, "demo.admin")
    html = client.post("/settings/cost_centre/sync?lang=en", follow_redirects=True).get_data(as_text=True)
    assert "The eFinance link is off. No sync ran." in html and not fake.calls


def test_hand_add_still_works_while_the_link_is_on(linked, client):
    login(client, "demo.admin")
    client.post("/settings/cost_centre/add", data={"code": "T-77", "name_el": "Δοκιμή", "name_en": "Test"})
    assert CostCentre.query.filter_by(code="T-77").one().is_active


def test_settings_rows_hold_no_token(linked, fake, client):
    demo_list(fake)
    fake.etag = '"abc"'
    login(client, "demo.admin")
    client.post("/settings/cost_centre/sync")
    for row in Setting.query:
        assert fake.token not in (row.value or "")
