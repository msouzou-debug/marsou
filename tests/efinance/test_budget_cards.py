"""Contract 07, "How eHire uses the budget answer": the step 2 and step 4 cards, the warnings, the stored snapshot,
the fallbacks, and that with the link `none` nothing ever calls eFinance."""
import json

import pytest

from ehire.extensions import db
from ehire.models import RequestAction
from ehire.services import budget_efinance
from ehire.services.budget_efinance import current_year
from tests.efinance.conftest import LINES, set_link
from tests.efinance.fake_efinance import line
from tests.requests.flowhelpers import act, actions_of, as_user, create, fin_fields, reload, step2, step3, text


def _budget(fake, lines=LINES, code="1001"):
    fake.budgets[(code, current_year())] = list(lines)


def _payload(rid, role):
    rows = [a for a in actions_of(rid) if a.role == role and a.action == "check"]
    return json.loads(rows[-1].payload_json)


def _page(client, user, rid):
    as_user(client, user)
    return text(client.get("/requests/%d?lang=en" % rid))


def _to_step4(client, fake, step2_fields=None):
    req = create(client)
    step2(client, req.id, **(step2_fields or {}))
    step3(client, req.id)
    assert reload(req.id).current_step == 4
    return req


# ---------------------------------------------------------------- link none: as today, and no network call

def test_link_none_draws_nothing_and_never_calls_efinance(wired, fake, client):
    fake.fail_if_called = True
    _budget(fake)
    req = create(client)
    html = _page(client, "nic.accountant", req.id)
    assert "Figures from eFinance" not in html and "not available" not in html
    step2(client, req.id, budget_article="02101")
    step3(client, req.id)
    html = _page(client, "central.finmgmt", req.id)
    assert "Figures from eFinance" not in html
    resp = act(client, "central.finmgmt", req.id, "check", credit="yes", commitment_article="")
    assert "Enter the commitment article." in text(resp)  # the free-text rule is kept
    assert act(client, "central.finmgmt", req.id, "check", credit="yes", commitment_article="A-1").status_code == 302
    assert "budget_snapshot" not in _payload(req.id, "dir_accountant")
    assert "budget_article" not in _payload(req.id, "fin_mgmt_head")
    assert not fake.calls and not fake.forbidden


# ---------------------------------------------------------------- step 2

def test_step2_card_lists_the_lines_with_greek_amounts(linked, fake, client):
    _budget(fake)
    req = create(client)
    as_user(client, "nic.accountant")
    html = text(client.get("/requests/%d?lang=el" % req.id))
    assert "Στοιχεία από το eFinance" in html and "Διαθέσιμο υπόλοιπο" in html
    assert "49.659,88" in html and "180.340,12" in html and "250.000,00" in html
    assert html.count('name="budget_article"') == 3
    assert "Στοιχεία της 23/11/2026 08:30" in html  # 06:30 UTC shown in Cyprus time
    assert fake.calls[-1]["query"] == {"cost_centre": "1001", "year": str(current_year())}


def test_step2_answer_stores_the_server_built_snapshot(linked, fake, client):
    _budget(fake)
    req = create(client)
    step2(client, req.id, budget_article="02101", budget_snapshot='{"available": "999999999.00", "warning": false}')
    p = _payload(req.id, "dir_accountant")
    snap = p["budget_snapshot"]
    assert p["budget_article"] == "02101"
    assert snap["available"] == "49659.88" and snap["budget"] == "250000.00" and snap["spent"] == "180340.12"
    assert snap["committed"] == "20000.00" and snap["article"] == "02101" and snap["year"] == current_year()
    assert snap["as_of"] == "2026-11-23T06:30:00Z" and snap["warning"] is False and snap["cost_centre"] == "1001"


def test_step2_snapshot_is_not_changed_by_later_efinance_figures(linked, fake, client):
    _budget(fake)
    req = create(client)
    step2(client, req.id, budget_article="02101")
    _budget(fake, [line("02101", "Sample salaries", "1.00", "1.00", "0.00", "0.00")])
    budget_efinance.clear_cache()
    assert _payload(req.id, "dir_accountant")["budget_snapshot"]["available"] == "49659.88"


def test_step2_yes_on_a_line_with_nothing_available_needs_a_comment(linked, fake, client):
    _budget(fake)
    req = create(client)
    resp = act(client, "nic.accountant", req.id, "check", position="yes", funds="yes", budget_article="02102",
               **fin_fields())
    assert resp.status_code == 200 and "A budget warning is shown. To answer Yes, add a comment." in text(resp)
    assert reload(req.id).current_step == 2
    step2(client, req.id, budget_article="02102", comment="A transfer is planned.")
    snap = _payload(req.id, "dir_accountant")["budget_snapshot"]
    assert snap["warning"] is True and snap["warnings"] == ["not_available"]


def test_step2_negative_available_also_warns(linked, fake, client):
    _budget(fake, [line("02101", "Sample salaries", "10.00", "20.00", "0.00", "-10.00")])
    req = create(client)
    resp = act(client, "nic.accountant", req.id, "check", position="yes", funds="yes", budget_article="02101",
               **fin_fields())
    assert "add a comment" in text(resp)


def test_step2_warning_is_drawn_for_the_picked_line(linked, fake, client):
    _budget(fake)
    req = create(client)
    resp = act(client, "nic.accountant", req.id, "check", position="yes", funds="yes", budget_article="02102",
               **fin_fields())
    html = text(resp)
    shown = html.split('data-ehire-budget-warning="not_available"', 1)[1].split(">", 1)[0]
    assert "hidden" not in shown  # drawn for the picked line, without JavaScript
    assert 'data-ehire-budget-warn="not_available"' in html


def test_step2_no_still_needs_only_the_usual_comment(linked, fake, client):
    _budget(fake)
    req = create(client)
    resp = act(client, "nic.accountant", req.id, "check", position="yes", funds="no", budget_article="02102")
    assert "budget warning" not in text(resp)
    assert act(client, "nic.accountant", req.id, "check", position="yes", funds="no", budget_article="02102",
               comment="No funds.").status_code == 302
    assert reload(req.id).status == "rejected"


def test_step2_no_budget_for_the_cost_centre_warns(linked, fake, client):
    _budget(fake, [])
    req = create(client)
    html = _page(client, "nic.accountant", req.id)
    assert "eFinance holds no budget for this cost centre for %d." % current_year() in html
    resp = act(client, "nic.accountant", req.id, "check", position="yes", funds="yes", **fin_fields())
    assert "A budget warning is shown" in text(resp)
    step2(client, req.id, comment="Budget to be added.")
    snap = _payload(req.id, "dir_accountant")["budget_snapshot"]
    assert snap["status"] == "no_lines" and snap["warnings"] == ["no_lines"] and "article" not in snap


def test_step2_unknown_cost_centre_warns(linked, fake, client):
    req = create(client)  # the stand-in knows no cost centre at all: 404
    html = _page(client, "nic.accountant", req.id)
    assert "eFinance does not know cost centre 1001." in html
    step2(client, req.id, comment="Checked by hand.")
    assert _payload(req.id, "dir_accountant")["budget_snapshot"]["status"] == "unknown_cost_centre"


def test_step2_line_not_in_efinance_is_refused(linked, fake, client):
    _budget(fake)
    req = create(client)
    resp = act(client, "nic.accountant", req.id, "check", position="yes", funds="yes", budget_article="99999",
               **fin_fields())
    assert resp.status_code == 200 and reload(req.id).current_step == 2


def test_step2_no_line_picked_is_allowed_without_a_warning(linked, fake, client):
    _budget(fake)
    req = create(client)
    step2(client, req.id)
    p = _payload(req.id, "dir_accountant")
    assert p["budget_article"] == "" and p["budget_snapshot"]["warning"] is False


@pytest.mark.parametrize("mode", [401, 500, "timeout", "redirect", "bad_json", "huge"])
def test_efinance_unavailable_cards_work_as_today(linked, fake, client, mode):
    _budget(fake)
    fake.mode = mode
    req = create(client)
    html = _page(client, "nic.accountant", req.id)
    assert "The eFinance figures are not available right now. Answer as usual." in html
    assert 'name="budget_article"' not in html
    step2(client, req.id, budget_article="02102")
    p = _payload(req.id, "dir_accountant")
    assert "budget_snapshot" not in p and "budget_article" not in p
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
    step2(client, req.id, budget_article="02101")
    assert len([c for c in fake.calls if c["path"].endswith("/budget")]) == 1


# ---------------------------------------------------------------- step 4

def test_step4_opens_on_the_step2_line_and_fills_the_article(linked, fake, client):
    _budget(fake)
    req = _to_step4(client, fake, {"budget_article": "02110"})
    html = _page(client, "central.finmgmt", req.id)
    assert 'value="02110" checked' in html
    assert 'name="commitment_article" value="02110"' in html
    # Picking a line without typing an article fills it on the server too (no JavaScript needed).
    assert act(client, "central.finmgmt", req.id, "check", credit="yes", commitment_article="",
               budget_article="02101").status_code == 302
    p = _payload(req.id, "fin_mgmt_head")
    assert p["commitment_article"] == "02101" and p["budget_snapshot"]["article"] == "02101"


def test_step4_typed_article_is_kept(linked, fake, client):
    _budget(fake)
    req = _to_step4(client, fake, {"budget_article": "02101"})
    act(client, "central.finmgmt", req.id, "check", credit="yes", commitment_article="02101/ΑΒ",
        budget_article="02101")
    assert _payload(req.id, "fin_mgmt_head")["commitment_article"] == "02101/ΑΒ"


def test_step4_below_the_annual_cost_recorded_by_central_hr_warns(linked, fake, client):
    _budget(fake)
    req = _to_step4(client, fake, {"budget_article": "02110"})
    assert act(client, "central.hr", req.id, "check", new_hire_cost="40.000,00").status_code == 302
    html = _page(client, "central.finmgmt", req.id)
    assert "less than the annual employer cost of the new posts (40.000,00 €)" in html
    resp = act(client, "central.finmgmt", req.id, "check", credit="yes", commitment_article="02110",
               budget_article="02110")
    assert "A budget warning is shown" in text(resp)
    # A line that covers the cost needs no comment.
    assert act(client, "central.finmgmt", req.id, "check", credit="yes", commitment_article="02101",
               budget_article="02101").status_code == 302
    snap = _payload(req.id, "fin_mgmt_head")["budget_snapshot"]
    assert snap["warning"] is False and snap["annual_cost"] == "40000.00"


def test_step4_below_cost_with_a_comment_passes_and_is_recorded(linked, fake, client):
    _budget(fake)
    req = _to_step4(client, fake)
    act(client, "central.hr", req.id, "check", new_hire_cost="50.000,00")
    assert act(client, "central.finmgmt", req.id, "check", credit="yes", commitment_article="02110",
               budget_article="02110", comment="Top-up agreed.").status_code == 302
    assert _payload(req.id, "fin_mgmt_head")["budget_snapshot"]["warnings"] == ["below_cost"]


def test_step2_has_no_cost_to_compare_with(linked, fake, client):
    _budget(fake)
    req = create(client)
    step2(client, req.id, budget_article="02110")  # 18.000 available, no cost recorded yet: no warning
    assert _payload(req.id, "dir_accountant")["budget_snapshot"]["warning"] is False


# ---------------------------------------------------------------- where the snapshot is shown

def test_snapshot_is_shown_in_checks_and_opinions(linked, fake, client):
    _budget(fake)
    req = create(client)
    step2(client, req.id, budget_article="02102", comment="Transfer planned.")
    set_link("none")  # the stored figures show whatever the link is now
    html = _page(client, "nic.exec", req.id)
    checks = html.split('id="sec-checks"', 1)[1]
    assert "Figures from eFinance" in checks and "02102" in checks and "80.000,00 €" in checks
    assert "The line had nothing available." in checks
    requester = _page(client, "nic.requester", req.id).split('id="sec-checks"', 1)[1]
    assert "Figures from eFinance" not in requester  # the requester sees outcomes only


def test_snapshot_is_in_the_request_pdf(linked, fake, client):
    from ehire.archive import pdf
    from ehire.models import ArchiveDeposit

    _budget(fake)
    req = create(client)
    step2(client, req.id, budget_article="02101")
    row = ArchiveDeposit(request_id=req.id, kind="decided", round=1, state="queued")  # no cut-off: every action
    db.session.add(row)
    db.session.commit()
    html = pdf.render_html(pdf.prepare(row)["context"])
    assert "Στοιχεία από το eFinance" in html and "49.659,88 €" in html and "02101" in html
    assert "Στοιχεία της 23/11/2026 08:30" in html


def test_snapshot_goes_into_the_archive_approval_comment(linked, fake, client):
    from ehire.archive import meta
    from ehire.models import Request

    _budget(fake)
    req = create(client)
    step2(client, req.id, budget_article="02102", comment="Transfer planned.")
    actions = RequestAction.query.filter_by(request_id=req.id).order_by(RequestAction.id).all()
    names = {}
    entries = meta._approvals(db.session.get(Request, req.id), actions, names)
    comment = [e for e in entries if e.get("comment") and "eFinance" in e["comment"]][0]["comment"]
    assert comment.startswith("Transfer planned.\n\nΣτοιχεία από το eFinance")
    assert "Διαθέσιμο υπόλοιπο: 0,00 €" in comment and len(comment) <= meta.COMMENT_MAX
