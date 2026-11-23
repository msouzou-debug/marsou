"""Rule B1 (contract 02): a "yes" on funds (step 2) or credit (step 4) given while an eFinance budget warning was shown
needs a comment. The warning comes in as a plain boolean; the engine owns the rule and the error code."""
from ehire.workflow.engine import apply
from ehire.workflow.model import NewAction

from tests.workflow.wfhelpers import ACC_OK, ACC_SIMPLE, Sim


def _at_step2(category="admin"):
    s = Sim(category=category)
    s.act("req1", "submit", "requester")
    return s


def _try(s, user, role, payload, comment=None, warning=False):
    return apply(s.state, NewAction(user, "check", role, payload, comment, budget_warning=warning), s.directory, s.now)


def test_B1_step2_yes_with_warning_and_no_comment_is_refused():
    s = _at_step2()
    assert _try(s, "acc1", "dir_accountant", ACC_SIMPLE, warning=True).errors == ("budget_comment_required",)


def test_B1_step2_yes_with_warning_and_comment_passes():
    s = _at_step2()
    res = _try(s, "acc1", "dir_accountant", ACC_SIMPLE, comment="Covered by a transfer.", warning=True)
    assert res.ok and res.current_step == 3


def test_B1_step2_without_warning_needs_no_comment():
    s = _at_step2()
    assert _try(s, "acc1", "dir_accountant", ACC_SIMPLE).ok


def test_B1_step2_no_still_follows_T2b():
    s = _at_step2()
    payload = dict(ACC_SIMPLE, funds="no")
    assert _try(s, "acc1", "dir_accountant", payload, warning=True).errors == ("comment_required",)
    assert _try(s, "acc1", "dir_accountant", payload, comment="No funds.", warning=True).status == "rejected"


def test_B1_step2_reports_missing_financials_and_comment_together():
    s = _at_step2("medical")
    res = _try(s, "acc1", "dir_accountant", ACC_SIMPLE, warning=True)
    assert set(res.errors) == {"financials_required", "budget_comment_required"}
    assert _try(s, "acc1", "dir_accountant", ACC_OK, comment="Seen.", warning=True).ok


def _at_step4():
    s = _at_step2()
    s.act("acc1", "check", "dir_accountant", ACC_SIMPLE)
    s.act("hro1", "check", "dir_hr_officer", {"documentation": "complete"})
    s.act("exe1", "approve", "dir_exec")
    assert s.state.current_step == 4
    return s


def test_B1_step4_credit_yes_with_warning_needs_a_comment():
    s = _at_step4()
    payload = {"credit": "yes", "commitment_article": "02101"}
    assert _try(s, "fin1", "fin_mgmt_head", payload, warning=True).errors == ("budget_comment_required",)
    assert _try(s, "fin1", "fin_mgmt_head", payload, comment="Agreed.", warning=True).ok
    assert _try(s, "fin1", "fin_mgmt_head", payload).ok


def test_B1_step4_article_rule_stays_and_is_reported_with_it():
    s = _at_step4()
    res = _try(s, "fin1", "fin_mgmt_head", {"credit": "yes", "commitment_article": ""}, warning=True)
    assert set(res.errors) == {"commitment_article_required", "budget_comment_required"}


def test_B1_step4_credit_no_still_rejects_with_a_comment():
    s = _at_step4()
    res = _try(s, "fin1", "fin_mgmt_head", {"credit": "no", "commitment_article": ""}, comment="None.", warning=True)
    assert res.status == "rejected"


def test_B1_does_not_touch_other_roles():
    s = _at_step2()
    s.act("acc1", "check", "dir_accountant", ACC_SIMPLE)
    res = apply(s.state, NewAction("hro1", "check", "dir_hr_officer", {"documentation": "complete"},
                                   budget_warning=True), s.directory, s.now)
    assert res.ok
