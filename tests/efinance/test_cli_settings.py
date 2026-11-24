"""The commands (efinance-test, efinance-link, sync-cost-centres) and the Settings panel with its button."""
import re

import pytest

from ehire.extensions import db
from ehire.models import AuditLog, CostCentre, Setting
from ehire.services import efinance_link
from tests.conftest import login
from ehire.services import budget_efinance
from ehire.services.budget_efinance import current_year
from tests.efinance.conftest import LINES, demo_list, set_budget_mode, set_link
from tests.efinance.fake_efinance import cc, line


def _run(app, *args):
    return app.test_cli_runner().invoke(args=list(args))


# ---------------------------------------------------------------- efinance-test

def test_efinance_test_passes_and_says_what_came_back(wired, fake):
    demo_list(fake)
    fake.budgets[("1001", current_year())] = LINES
    res = _run(wired, "efinance-test")
    assert res.exit_code == 0, res.output
    assert "cost centres: ok, 10 rows (10 active)" in res.output and "efinance-test: passed" in res.output
    assert ("budget: ok, cost centre 1001 (entity NIC), year %d: 3 salary line(s) came back, 2 with a budget "
            "loaded; spent_covers: efinance_invoices_only" % current_year()) in res.output
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


# ---------------------------------------------------------------- efinance-budget

def test_efinance_budget_shows_exists_by_default(wired):
    res = _run(wired, "efinance-budget")
    assert res.exit_code == 0 and res.output.strip() == "efinance_budget=exists"


@pytest.mark.parametrize("mode", ["off", "exists"])
def test_efinance_budget_off_and_exists_need_no_call(wired, fake, mode):
    fake.fail_if_called = True
    set_budget_mode("figures" if mode == "exists" else "exists")
    res = _run(wired, "efinance-budget", mode)
    assert res.exit_code == 0 and res.output.strip() == "efinance_budget=%s" % mode
    db.session.expire_all()
    assert budget_efinance.budget_mode() == mode and not fake.calls
    row = AuditLog.query.filter_by(event="setting_changed", object_id="efinance_budget").one()
    assert '"after": "%s"' % mode in row.detail_json and "forced" not in row.detail_json


def test_efinance_budget_figures_is_refused_while_spent_leaves_out_salaries(wired, fake):
    demo_list(fake)
    fake.budgets[("1001", current_year())] = LINES  # spent_covers: efinance_invoices_only
    res = _run(wired, "efinance-budget", "figures")
    assert res.exit_code != 0 and "stays exists" in res.output and "does not include salaries" in res.output
    assert "--i-know-salaries-are-missing" in res.output
    db.session.expire_all()
    assert budget_efinance.budget_mode() == "exists"
    assert not AuditLog.query.filter_by(event="setting_changed", object_id="efinance_budget").count()


@pytest.mark.parametrize("lines", [[], [line("2102", "BASIC PAY", "1.00", covers=None)],
                                   [line("2102", "BASIC PAY", "1.00", covers="sap_payroll"),
                                    line("2103", "13TH SALARY", "1.00")]],
                         ids=["no-lines", "not-given", "one-line-invoices-only"])
def test_efinance_budget_figures_is_refused_without_proof(wired, fake, lines):
    demo_list(fake)
    fake.budgets[("1001", current_year())] = lines
    assert _run(wired, "efinance-budget", "figures").exit_code != 0
    db.session.expire_all()
    assert budget_efinance.budget_mode() == "exists"


def test_efinance_budget_figures_is_refused_when_efinance_cannot_answer(wired, fake):
    demo_list(fake)
    fake.mode = 500
    res = _run(wired, "efinance-budget", "figures")
    assert res.exit_code != 0 and "HTTP 500" in res.output


def test_efinance_budget_figures_with_the_override_flag(wired, fake):
    demo_list(fake)
    fake.budgets[("1001", current_year())] = LINES
    res = _run(wired, "efinance-budget", "figures", "--i-know-salaries-are-missing")
    assert res.exit_code == 0 and res.output.strip().endswith("efinance_budget=figures")
    db.session.expire_all()
    assert budget_efinance.budget_mode() == "figures"
    row = AuditLog.query.filter_by(event="setting_changed", object_id="efinance_budget").one()
    assert '"forced": true' in row.detail_json and fake.token not in res.output + row.detail_json


def test_efinance_budget_figures_once_spent_covers_salaries(wired, fake):
    demo_list(fake)
    fake.budgets[("1001", current_year())] = [line("2102", "BASIC PAY", "1.00", covers="sap_payroll_actuals")]
    res = _run(wired, "efinance-budget", "figures", "--cost-centre", "1001")
    assert res.exit_code == 0 and "spent_covers: sap_payroll_actuals" in res.output
    db.session.expire_all()
    assert budget_efinance.budget_mode() == "figures"
    row = AuditLog.query.filter_by(event="setting_changed", object_id="efinance_budget").one()
    assert "forced" not in row.detail_json


def test_efinance_budget_rejects_other_values(wired):
    assert _run(wired, "efinance-budget", "amounts").exit_code != 0


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
    assert "Budget check at steps 2 and 4:</span> Whether a budget is loaded, no amounts" in html
    assert "Sync now" not in html and "No sync has run yet." in html and not fake.calls


@pytest.mark.parametrize("mode,words", [("off", "Ανενεργός"), ("exists", "Μόνο αν υπάρχει προϋπολογισμός, χωρίς ποσά"),
                                        ("figures", "Με ποσά (προϋπολογισμός, δαπάνες, δεσμεύσεις, διαθέσιμο υπόλοιπο)")])
def test_panel_shows_the_budget_mode_in_words(linked, client, mode, words):
    set_budget_mode(mode)
    login(client, "demo.admin")
    html = client.get("/settings/cost_centre?lang=el").get_data(as_text=True)
    found = html.split("data-ehire-efinance-budget", 1)[1].split("</p>", 1)[0]
    assert "Έλεγχος προϋπολογισμού στα βήματα 2 και 4" in found and words in found


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
