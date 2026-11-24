"""Contract 07, version 2, "How eHire uses the budget answer": the three modes of `efinance_budget` on the step 2 and
step 4 cards, the warnings, the stored snapshot (page, PDF, eArchive comment), the fallbacks, and that nothing calls
eFinance while the link is `none` or the mode is `off`. In mode `exists` no amount may appear anywhere."""
import json

import pytest

from ehire.extensions import db
from ehire.models import ArchiveDeposit, Request, RequestAction
from ehire.services import budget_efinance, cost_centre_sync
from ehire.services.budget_efinance import current_year
from tests.efinance.conftest import AMOUNT_TEXTS, LINES, demo_list, set_budget_mode, set_link
from tests.efinance.fake_efinance import line
from tests.requests.flowhelpers import act, actions_of, as_user, create, fin_fields, reload, step2, step3, text

SNAPSHOT_KEYS_EXISTS = {"mode", "cost_centre", "entity_code", "year", "status", "salary_lines", "lines_with_budget",
                        "budget_loaded", "warning", "warnings"}


def _budget(fake, lines=LINES, code="1001", entity="NIC"):
    if not any(c["code"] == code for c in fake.cost_centres):
        fake.cost_centres.append({"code": code, "name": "x", "entity_code": entity, "active": True})
    fake.budgets[(code, current_year())] = [dict(l) for l in lines]


def _action(rid, role):
    return [a for a in actions_of(rid) if a.role == role and a.action == "check"][-1]


def _payload(rid, role):
    return json.loads(_action(rid, role).payload_json)


def _page(client, user, rid, lang="en"):
    as_user(client, user)
    return text(client.get("/requests/%d?lang=%s" % (rid, lang)))


def _panel(html):
    """The budget panel of the card (the section with data-ehire-budget)."""
    return html.split("data-ehire-budget", 1)[1].split("</section>", 1)[0]


def _no_amounts(blob):
    found = [a for a in AMOUNT_TEXTS if a in blob]
    assert not found, found


def _to_step4(client, step2_fields=None):
    req = create(client)
    step2(client, req.id, **(step2_fields or {}))
    step3(client, req.id)
    assert reload(req.id).current_step == 4
    return req


def _deposit_html(rid):
    from ehire.archive import pdf

    row = ArchiveDeposit(request_id=rid, kind="decided", round=1, state="queued")  # no cut-off: every action
    db.session.add(row)
    db.session.commit()
    return pdf.render_html(pdf.prepare(row)["context"])


def _archive_comments(rid):
    from ehire.archive import meta

    actions = RequestAction.query.filter_by(request_id=rid).order_by(RequestAction.id).all()
    entries = meta._approvals(db.session.get(Request, rid), actions, {})
    return [e["comment"] for e in entries if e.get("comment")]


# ---------------------------------------------------------------- link none, mode off: nothing is called

def test_link_none_draws_nothing_and_never_calls_efinance(wired, fake, client):
    fake.fail_if_called = True
    _budget(fake)
    req = create(client)
    html = _page(client, "nic.accountant", req.id)
    assert "Figures from eFinance" not in html and "not available" not in html
    step2(client, req.id, budget_code="2102")
    step3(client, req.id)
    html = _page(client, "central.finmgmt", req.id)
    assert "Figures from eFinance" not in html
    resp = act(client, "central.finmgmt", req.id, "check", credit="yes", commitment_article="")
    assert "Enter the commitment article." in text(resp)  # the free-text rule is kept
    assert act(client, "central.finmgmt", req.id, "check", credit="yes", commitment_article="A-1").status_code == 302
    assert "budget_snapshot" not in _payload(req.id, "dir_accountant")
    assert "budget_code" not in _payload(req.id, "fin_mgmt_head")
    assert not fake.calls and not fake.forbidden


@pytest.mark.parametrize("mode", ["exists", "figures"])
def test_link_none_with_any_mode_calls_nothing(wired, fake, client, mode):
    set_budget_mode(mode)
    fake.fail_if_called = True
    req = create(client)
    assert "Figures from eFinance" not in _page(client, "nic.accountant", req.id)
    step2(client, req.id)
    assert not fake.calls


def test_mode_off_draws_no_panel_and_makes_no_budget_call(linked, fake, client):
    set_budget_mode("off")
    _budget(fake)
    req = create(client)
    html = _page(client, "nic.accountant", req.id)
    assert "Figures from eFinance" not in html and "not available right now" not in html
    step2(client, req.id, budget_code="2102")
    assert "budget_snapshot" not in _payload(req.id, "dir_accountant")
    assert not [c for c in fake.calls if c["path"].endswith("/budget")]
    demo_list(fake)
    assert cost_centre_sync.sync().ok  # cost centres still sync
    assert fake.calls and all(c["path"].endswith("/cost-centres") for c in fake.calls)


def test_default_mode_is_exists(app):
    assert budget_efinance.budget_mode() == "exists"


# ---------------------------------------------------------------- mode exists: the card

def test_exists_card_lists_salary_lines_with_state_and_no_amounts(linked, fake, client):
    _budget(fake)
    req = create(client)
    html = _page(client, "nic.accountant", req.id, "el")
    panel = _panel(html)
    assert "Στοιχεία από το eFinance" in panel and "Γραμμή προϋπολογισμού" in panel
    assert "2102" in panel and "BASIC PAY" in panel and "2121" in panel and "OVERTIME" in panel
    assert "3003" not in html and "SUBSISTENCE" not in html  # not a salary line
    assert panel.count("Υπάρχει προϋπολογισμός") == 2 and panel.count("Δεν έχει καταχωριστεί προϋπολογισμός") == 1
    assert "bi-check-circle-fill" in panel and "bi-x-circle" in panel  # an icon plus words
    assert "ολόκληρη τη Διεύθυνση, όχι μόνο το κέντρο κόστους 1001" in panel
    assert "δεν καταγράφει δαπάνες μισθοδοσίας" in panel
    assert "Διαθέσιμο υπόλοιπο" not in panel and "Δαπάνες" not in panel and "ευρώ" not in panel
    assert panel.count('name="budget_code"') == 4  # three lines and "no line"
    assert 'value="" checked' in panel  # nothing picked yet
    assert "(προαιρετικά)" in panel
    _no_amounts(html)
    assert fake.calls[-1]["query"] == {"cost_centre": "1001", "year": str(current_year()), "payroll": "1"}


def test_exists_answer_stores_a_snapshot_without_amounts(linked, fake, client):
    _budget(fake)
    req = create(client)
    step2(client, req.id, budget_code="2102", budget_snapshot='{"budget": "999999999.00", "warning": false}')
    action = _action(req.id, "dir_accountant")
    p = json.loads(action.payload_json)
    snap = p["budget_snapshot"]
    assert p["budget_code"] == "2102"
    assert set(snap) == SNAPSHOT_KEYS_EXISTS | {"budget_code", "description"}
    assert snap == {"mode": "exists", "cost_centre": "1001", "entity_code": "NIC", "year": current_year(),
                    "status": "lines", "salary_lines": 3, "lines_with_budget": 2, "budget_loaded": True,
                    "warning": False, "warnings": [], "budget_code": "2102", "description": "BASIC PAY"}
    _no_amounts(action.payload_json)
    assert "999999999" not in action.payload_json


def test_exists_no_line_picked_is_allowed_without_a_warning(linked, fake, client):
    _budget(fake)
    req = create(client)
    step2(client, req.id, budget_code="")
    p = _payload(req.id, "dir_accountant")
    assert p["budget_code"] == "" and p["budget_snapshot"]["warning"] is False
    assert "budget_code" not in p["budget_snapshot"] and p["budget_snapshot"]["budget_loaded"] is True


def test_exists_picked_line_without_budget_warns_and_needs_a_comment(linked, fake, client):
    _budget(fake)
    req = create(client)
    resp = act(client, "nic.accountant", req.id, "check", position="yes", funds="yes", budget_code="2121",
               **fin_fields())
    html = text(resp)
    assert resp.status_code == 200 and "A budget warning is shown. To answer Yes, add a comment." in html
    shown = html.split('data-ehire-budget-warning="line_no_budget"', 1)[1].split(">", 1)[0]
    assert "hidden" not in shown and "The line you picked has no budget loaded for %d." % current_year() in html
    assert 'data-ehire-budget-warn="line_no_budget"' in html
    assert reload(req.id).current_step == 2
    step2(client, req.id, budget_code="2121", comment="Finance will load it in January.")
    snap = _payload(req.id, "dir_accountant")["budget_snapshot"]
    assert snap["warning"] is True and snap["warnings"] == ["line_no_budget"] and snap["budget_loaded"] is False


def test_exists_no_salary_line_with_a_budget_warns(linked, fake, client):
    _budget(fake, [line(l["budget_code"], l["description"], None, payroll=l["payroll"]) for l in LINES])
    req = create(client)
    html = _page(client, "nic.accountant", req.id)
    assert "No salary line of the Directorate has a budget loaded in eFinance for %d." % current_year() in html
    assert _panel(html).count("No budget loaded") == 3
    resp = act(client, "nic.accountant", req.id, "check", position="yes", funds="yes", **fin_fields())
    assert "A budget warning is shown" in text(resp)
    step2(client, req.id, budget_code="2102", comment="Budget not entered yet.")
    snap = _payload(req.id, "dir_accountant")["budget_snapshot"]
    assert snap["warnings"] == ["no_budget"] and snap["lines_with_budget"] == 0 and snap["salary_lines"] == 3


@pytest.mark.parametrize("lines", [[], [LINES[3]]], ids=["empty", "only-non-salary"])
def test_exists_no_salary_lines_at_all_warns(linked, fake, client, lines):
    _budget(fake, lines)
    req = create(client)
    html = _page(client, "nic.accountant", req.id)
    assert "No salary line of the Directorate has a budget loaded" in html and 'name="budget_code"' not in html
    step2(client, req.id, comment="Checked by hand.")
    snap = _payload(req.id, "dir_accountant")["budget_snapshot"]
    assert snap["status"] == "no_lines" and snap["warnings"] == ["no_budget"] and snap["salary_lines"] == 0


def test_exists_unknown_cost_centre_warns(linked, fake, client):
    req = create(client)  # the stand-in knows no cost centre at all: 404
    html = _page(client, "nic.accountant", req.id)
    assert "eFinance does not know cost centre 1001." in html
    resp = act(client, "nic.accountant", req.id, "check", position="yes", funds="yes", **fin_fields())
    assert "A budget warning is shown" in text(resp)
    step2(client, req.id, comment="Checked by hand.")
    snap = _payload(req.id, "dir_accountant")["budget_snapshot"]
    assert snap["status"] == "unknown_cost_centre" and snap["warnings"] == ["unknown_cost_centre"]


@pytest.mark.parametrize("code", ["3003", "9999"])
def test_a_code_that_is_not_a_salary_line_is_refused(linked, fake, client, code):
    _budget(fake)
    req = create(client)
    resp = act(client, "nic.accountant", req.id, "check", position="yes", funds="yes", budget_code=code,
               **fin_fields())
    assert resp.status_code == 200 and reload(req.id).current_step == 2


def test_no_still_needs_only_the_usual_comment(linked, fake, client):
    _budget(fake)
    req = create(client)
    resp = act(client, "nic.accountant", req.id, "check", position="yes", funds="no", budget_code="2121")
    assert "budget warning" not in text(resp)
    assert act(client, "nic.accountant", req.id, "check", position="yes", funds="no", budget_code="2121",
               comment="No funds.").status_code == 302
    assert reload(req.id).status == "rejected"


@pytest.mark.parametrize("mode", [401, 500, "timeout", "redirect", "bad_json", "huge"])
def test_efinance_unavailable_cards_work_as_today(linked, fake, client, mode):
    _budget(fake)
    fake.mode = mode
    req = create(client)
    html = _page(client, "nic.accountant", req.id)
    assert "The eFinance figures are not available right now. Answer as usual." in html
    assert 'name="budget_code"' not in html
    step2(client, req.id, budget_code="2121")
    p = _payload(req.id, "dir_accountant")
    assert "budget_snapshot" not in p and "budget_code" not in p
    step3(client, req.id)
    html = _page(client, "central.finmgmt", req.id)
    assert "not available right now" in html and 'name="commitment_article"' in html
    resp = act(client, "central.finmgmt", req.id, "check", credit="yes", commitment_article="")
    assert "Enter the commitment article." in text(resp)
    assert act(client, "central.finmgmt", req.id, "check", credit="yes", commitment_article="A-1").status_code == 302


def test_answers_are_cached_for_five_minutes(linked, fake, client):
    _budget(fake)
    req = create(client)
    _page(client, "nic.accountant", req.id)
    _page(client, "nic.accountant", req.id)
    step2(client, req.id, budget_code="2102")
    assert len([c for c in fake.calls if c["path"].endswith("/budget")]) == 1


def test_snapshot_is_not_changed_by_a_later_answer(linked, fake, client):
    _budget(fake)
    req = create(client)
    step2(client, req.id, budget_code="2102")
    _budget(fake, [line("2102", "BASIC PAY", None)])
    budget_efinance.clear_cache()
    assert _payload(req.id, "dir_accountant")["budget_snapshot"]["budget_loaded"] is True


# ---------------------------------------------------------------- mode exists: step 4

def test_step4_opens_on_the_step2_line_and_fills_the_article(linked, fake, client):
    _budget(fake)
    req = _to_step4(client, {"budget_code": "2102"})
    html = _page(client, "central.finmgmt", req.id)
    assert 'value="2102" checked' in html and 'name="commitment_article" value="2102"' in html
    assert "Its code fills in the commitment article." in html
    _no_amounts(html)
    # Picking a line without typing an article fills it on the server too (no JavaScript needed).
    assert act(client, "central.finmgmt", req.id, "check", credit="yes", commitment_article="",
               budget_code="2103").status_code == 302
    p = _payload(req.id, "fin_mgmt_head")
    assert p["commitment_article"] == "2103" and p["budget_snapshot"]["budget_code"] == "2103"
    _no_amounts(_action(req.id, "fin_mgmt_head").payload_json)


def test_step4_typed_article_is_kept(linked, fake, client):
    _budget(fake)
    req = _to_step4(client, {"budget_code": "2102"})
    act(client, "central.finmgmt", req.id, "check", credit="yes", commitment_article="2102/ΑΒ", budget_code="2102")
    assert _payload(req.id, "fin_mgmt_head")["commitment_article"] == "2102/ΑΒ"


def test_step4_no_line_still_needs_the_article(linked, fake, client):
    _budget(fake)
    req = _to_step4(client)
    resp = act(client, "central.finmgmt", req.id, "check", credit="yes", commitment_article="", budget_code="")
    assert "Enter the commitment article." in text(resp)


def test_step4_line_without_budget_warns(linked, fake, client):
    _budget(fake)
    req = _to_step4(client)
    resp = act(client, "central.finmgmt", req.id, "check", credit="yes", commitment_article="2121",
               budget_code="2121")
    assert "A budget warning is shown" in text(resp)
    assert act(client, "central.finmgmt", req.id, "check", credit="yes", commitment_article="2121",
               budget_code="2121", comment="Agreed with Finance.").status_code == 302
    assert _payload(req.id, "fin_mgmt_head")["budget_snapshot"]["warnings"] == ["line_no_budget"]


def test_exists_mode_ignores_the_annual_cost(linked, fake, client):
    _budget(fake)
    req = _to_step4(client, {"budget_code": "2102"})
    act(client, "central.hr", req.id, "check", new_hire_cost="9.000.000,00")
    assert act(client, "central.finmgmt", req.id, "check", credit="yes", commitment_article="2102",
               budget_code="2102").status_code == 302
    snap = _payload(req.id, "fin_mgmt_head")["budget_snapshot"]
    assert snap["warning"] is False and "annual_cost" not in snap


# ---------------------------------------------------------------- mode exists: where the snapshot is shown

def test_snapshot_is_shown_in_checks_and_opinions(linked, fake, client):
    _budget(fake)
    req = create(client)
    step2(client, req.id, budget_code="2121", comment="Transfer planned.")
    set_link("none")  # the stored check shows whatever the link is now
    html = _page(client, "nic.exec", req.id)
    checks = html.split('id="sec-checks"', 1)[1]
    assert "Figures from eFinance" in checks and "2121 OVERTIME" in checks and "No budget loaded" in checks
    assert "Salary lines with a budget for %d: 2 of 3." % current_year() in checks
    assert "The line picked had no budget loaded for %d." % current_year() in checks
    assert "Cost centre 1001, Directorate NIC, year %d" % current_year() in checks
    assert "ehire-budget-view__warn" in checks
    _no_amounts(html)
    requester = _page(client, "nic.requester", req.id).split('id="sec-checks"', 1)[1]
    assert "Figures from eFinance" not in requester  # the requester sees outcomes only


def test_snapshot_without_warning_says_so(linked, fake, client):
    _budget(fake)
    req = create(client)
    step2(client, req.id, budget_code="2102")
    checks = _page(client, "nic.exec", req.id, "el").split('id="sec-checks"', 1)[1]
    assert "Υπάρχει προϋπολογισμός" in checks and "Δεν εμφανίστηκε προειδοποίηση." in checks


def test_snapshot_is_in_the_request_pdf_without_amounts(linked, fake, client):
    _budget(fake)
    req = create(client)
    step2(client, req.id, budget_code="2102")
    html = _deposit_html(req.id)
    assert "Στοιχεία από το eFinance" in html and "2102 BASIC PAY" in html and "Υπάρχει προϋπολογισμός" in html
    assert "Γραμμές μισθοδοσίας με προϋπολογισμό για το %d: 2 από 3." % current_year() in html
    _no_amounts(html)


def test_snapshot_goes_into_the_archive_approval_comment_without_amounts(linked, fake, client):
    from ehire.archive import meta

    _budget(fake)
    req = create(client)
    step2(client, req.id, budget_code="2121", comment="Transfer planned.")
    comment = [c for c in _archive_comments(req.id) if "eFinance" in c][0]
    assert comment.startswith("Transfer planned.\n\nΣτοιχεία από το eFinance")
    assert "Δεν έχει καταχωριστεί προϋπολογισμός" in comment and len(comment) <= meta.COMMENT_MAX
    assert "Η γραμμή που επιλέχθηκε δεν είχε καταχωρισμένο προϋπολογισμό" in comment
    _no_amounts(comment)


def test_archive_comment_leaves_the_check_out_when_it_does_not_fit(linked, fake, client):
    _budget(fake)
    req = create(client)
    long = "Σ" * 1990
    step2(client, req.id, budget_code="2102", comment=long)
    assert long in _archive_comments(req.id)  # the person's comment, never cut; the PDF still has the check
    assert "Στοιχεία από το eFinance" in _deposit_html(req.id)


# ---------------------------------------------------------------- mode figures (kept, not switched on)

def test_figures_card_shows_the_amounts_of_salary_lines(linked, fake, client):
    set_budget_mode("figures")
    _budget(fake)
    req = create(client)
    html = _page(client, "nic.accountant", req.id, "el")
    panel = _panel(html)
    assert "ehire-budget--figures" in html
    assert "Διαθέσιμο υπόλοιπο" in panel and "Δεσμεύσεις" in panel and "Δαπάνες" in panel
    assert "49.659,88" in panel and "180.340,12" in panel and "250.000,00" in panel and "61.200,50" in panel
    assert "3003" not in html and "77.777" not in html
    assert "δεν καταγράφει δαπάνες μισθοδοσίας" not in panel  # that note is for mode exists
    assert 'data-ehire-budget-warn="not_available"' in panel  # 2103: -0,50 available


def test_figures_snapshot_stores_the_amounts(linked, fake, client):
    set_budget_mode("figures")
    _budget(fake)
    req = create(client)
    step2(client, req.id, budget_code="2102")
    snap = _payload(req.id, "dir_accountant")["budget_snapshot"]
    assert snap["mode"] == "figures" and snap["available"] == "49659.88" and snap["open_requisitions"] == "20000.00"
    assert snap["budget"] == "250000.00" and snap["spent"] == "180340.12" and snap["warning"] is False
    html = _deposit_html(req.id)
    assert "49.659,88 €" in html and "Δεσμεύσεις:" in html


def test_figures_nothing_available_warns(linked, fake, client):
    set_budget_mode("figures")
    _budget(fake)
    req = create(client)
    resp = act(client, "nic.accountant", req.id, "check", position="yes", funds="yes", budget_code="2103",
               **fin_fields())
    assert "The line you picked has nothing available." in text(resp)
    step2(client, req.id, budget_code="2103", comment="Transfer.")
    assert _payload(req.id, "dir_accountant")["budget_snapshot"]["warnings"] == ["not_available"]


def test_figures_line_without_budget_warns_as_in_exists(linked, fake, client):
    set_budget_mode("figures")
    _budget(fake)
    req = create(client)
    resp = act(client, "nic.accountant", req.id, "check", position="yes", funds="yes", budget_code="2121",
               **fin_fields())
    assert "has no budget loaded" in text(resp)


def test_figures_below_the_annual_cost_warns_at_step4(linked, fake, client):
    set_budget_mode("figures")
    _budget(fake, [line("2102", "BASIC PAY", "30000.00", available="18000.00")])
    req = _to_step4(client, {"budget_code": "2102"})
    assert act(client, "central.hr", req.id, "check", new_hire_cost="40.000,00").status_code == 302
    html = _page(client, "central.finmgmt", req.id)
    assert "less than the annual employer cost of the new posts (40.000,00 €)" in html
    resp = act(client, "central.finmgmt", req.id, "check", credit="yes", commitment_article="2102", budget_code="2102")
    assert "A budget warning is shown" in text(resp)
    assert act(client, "central.finmgmt", req.id, "check", credit="yes", commitment_article="2102", budget_code="2102",
               comment="Top-up agreed.").status_code == 302
    snap = _payload(req.id, "fin_mgmt_head")["budget_snapshot"]
    assert snap["warnings"] == ["below_cost"] and snap["annual_cost"] == "40000.00"
