"""run-timers, seed-cases, string keys on screen and the card forms."""
import json
import re
from datetime import datetime, timedelta, timezone
from pathlib import Path

from ehr.extensions import db
from ehr.models import AuditLog, MailOutbox, PublicHoliday, Request, RolePermission, Task, User
from ehr.workflow import timing
from tests.requests.flowhelpers import act, actions_of, as_user, create, reload, step2, text
from tests.requests.test_keys import KNOWN_MISSING

ROOT = Path(__file__).resolve().parents[2] / "ehr"
CODES = ("not_your_task", "request_closed", "request_returned", "wrong_step", "comment_required", "financials_required",
         "commitment_article_required", "leaver_costs_required", "directorate_locked", "not_requester", "own_request",
         "invalid_payload")


def run_timers(app, at):
    result = app.test_cli_runner().invoke(args=["run-timers", "--at", at.isoformat()])
    assert result.exit_code == 0, result.output
    return dict(p.split("=") for p in result.output.split())


def days_off():
    return {h.date for h in PublicHoliday.query}


def test_every_engine_error_code_has_a_string_in_both_languages():
    for lang in ("el", "en"):
        strings = json.loads((ROOT / ("i18n/%s.json" % lang)).read_text(encoding="utf-8"))
        for code in CODES:
            assert strings.get("error." + code), (lang, code)


def test_scenario_15_timers_warn_then_withdraw_a_returned_request(seeded, client):
    rid = create(client).id
    act(client, "nic.accountant", rid, "return", comment="Attach the paper.")
    returned = datetime(2026, 1, 12, 10, 0, tzinfo=timezone.utc)
    r = reload(rid)
    r.returned_at = returned
    db.session.commit()
    half = timing.add_working_days(returned, 15, days_off())

    assert run_timers(seeded, half - timedelta(days=3))["warnings"] == "0"
    assert run_timers(seeded, half)["warnings"] == "1"
    assert reload(rid).withdrawal_warned is True and reload(rid).status == "returned"
    warn = MailOutbox.query.filter_by(event="withdrawal_warning", request_id=rid).all()
    assert len(warn) == 1 and warn[0].to_user_id == r.created_by
    assert run_timers(seeded, half + timedelta(hours=1))["warnings"] == "0"  # once only

    limit = timing.add_working_days(returned, 30, days_off())
    assert run_timers(seeded, limit)["withdrawn"] == "1"
    r = reload(rid)
    assert r.status == "withdrawn" and r.closed_at is not None
    last = actions_of(rid)[-1]
    assert (last.action, last.role, last.actor_user_id, last.comment) == ("withdraw", "system", None, "system.auto_withdraw")
    as_user(client, "nic.requester")
    html = text(client.get("/requests/%d?lang=en" % rid))
    assert "Withdrawn automatically" in html and "Withdrawn automatically after 30 working days" in html
    assert run_timers(seeded, limit + timedelta(days=1))["withdrawn"] == "0"


def test_timers_remind_and_escalate_once_per_clock_start(seeded, client):
    rid = create(client).id
    opened = datetime(2026, 2, 2, 9, 0, tzinfo=timezone.utc)  # a Monday
    for t in reload(rid).tasks:
        t.opened_at = t.clock_started_at = opened
    db.session.commit()
    assert run_timers(seeded, opened + timedelta(days=1)) == {"reminders": "0", "escalations": "0", "warnings": "0", "withdrawn": "0"}
    out = run_timers(seeded, timing.add_working_days(opened, 2, days_off()))
    assert out["reminders"] == "1" and out["escalations"] == "0"
    out = run_timers(seeded, timing.add_working_days(opened, 5, days_off()))
    assert out["reminders"] == "0" and out["escalations"] == "1"
    task = reload(rid).tasks[0]
    assert task.reminded_at is not None and task.escalated_at is not None and task.status == "open"  # stays put
    kinds = sorted(m.event for m in MailOutbox.query.filter_by(request_id=rid) if m.event.endswith("_due"))
    assert kinds == ["escalation_due", "reminder_due"]
    boss = User.query.filter_by(username="nic.exec").one()
    esc = MailOutbox.query.filter_by(event="escalation_due").all()
    assert esc[0].to_user_id == boss.id
    as_user(client, "nic.requester")
    html = text(client.get("/requests/%d?lang=en" % rid))
    assert "reminder sent" in html and "escalated to the line manager" in html


def test_events_are_queued_as_email(seeded, client):
    rid = create(client).id
    kinds = [m.event for m in MailOutbox.query.filter_by(request_id=rid)]
    assert "request_submitted" in kinds and "task_opened" in kinds


def test_seed_cases_creates_the_seven_cases_through_the_engine_and_is_idempotent(seeded):
    runner = seeded.test_cli_runner()
    assert runner.invoke(args=["seed-cases"]).exit_code == 0
    reqs = Request.query.order_by(Request.id).all()
    assert [r.status for r in reqs] == ["in_progress", "in_progress", "in_progress", "rejected", "approved", "returned",
                                        "withdrawn"]
    assert [r.current_step for r in reqs[:3]] == [3, 4, 6]
    open_roles = lambda r: sorted(t.role for t in r.tasks if t.status == "open")
    assert open_roles(reqs[0]) == ["sci_director"]
    c2 = reqs[1]
    assert open_roles(c2) == ["central_hr_officer", "fin_mgmt_head"]
    assert all(t.reminded_at and t.escalated_at for t in c2.tasks if t.status == "open")
    assert days_between(c2) >= 6
    assert open_roles(reqs[2]) == ["ceo"] and reqs[2].category == "admin"
    assert [t.status for t in reqs[5].tasks if t.status != "closed"] == ["paused"] and reqs[5].returned_at
    assert actions_of(reqs[4].id)[-1].action == "approve" and reqs[4].closed_at
    n = AuditLog.query.count()
    out = runner.invoke(args=["seed-cases"])
    assert "none" in out.output and Request.query.count() == 7 and AuditLog.query.count() == n


def days_between(req):
    t = [t for t in req.tasks if t.status == "open"][0]
    return timing.working_days_between(t.opened_at, datetime.now(timezone.utc), days_off())


def test_only_requesters_and_directorate_roles_can_create_requests(seeded):
    holders = {r.role for r in RolePermission.query.filter_by(permission_key="request.create")}
    assert holders == {"requester", "dir_accountant", "sci_director", "dir_hr_officer", "dir_exec"}


KEY_LIKE = re.compile(r"\b(?:action|card|closed|done|error|field|form|history|list|page|role|status|statusline|step|"
                      r"tracker|validation|docs|opinion|documentation|answer|category|reason|employment)\.[a-z_0-9.]*[a-z_0-9]\b")


def visible(html):
    return re.sub(r"<[^>]+>", " ", html)


def test_pages_render_in_both_languages_without_raw_keys(seeded, client):
    seeded.test_cli_runner().invoke(args=["seed-cases"])
    cases = {r.id: r for r in Request.query}
    views = [("nic.requester", 2), ("nic.requester", 6), ("nic.requester", 7), ("lim.requester", 4), ("lim.requester", 5),
             ("central.finmgmt", 2), ("central.hr", 2), ("central.ceo", 3), ("lim.sci", 1), ("nic.hr", 6),
             ("nic.sci", 6), ("demo.viewer", 5), ("lim.accountant", 5), ("nic.exec", 2)]
    pages = [(u, "/requests/%d" % rid) for u, rid in views]
    pages += [("nic.requester", "/requests/6/edit"), ("nic.requester", "/requests?tab=mine"),
              ("central.finmgmt", "/requests?tab=waiting"), ("nic.requester", "/requests/new")]
    for lang in ("el", "en"):
        for user, path in pages:
            as_user(client, user)
            resp = client.get(path + "?lang=" + lang)
            assert resp.status_code == 200, (user, path)
            raw = set(KEY_LIKE.findall(visible(text(resp)))) - KNOWN_MISSING
            assert not raw, (lang, user, path, sorted(raw))


def test_accountant_card_phone_markup_and_ratio(seeded, client):
    rid = create(client).id
    as_user(client, "nic.accountant")
    html = text(client.get("/requests/%d?lang=en&do=review" % rid))
    assert html.count('<section class="card ehr-card') == 1 and "Financial data" in html
    assert html.count('name="fin.') == 10 and 'name="oay_specialty_id"' in html
    # typed values are kept with the messages when the card comes back
    resp = act(client, "nic.accountant", rid, "check", position="yes", funds="yes", **{
        "oay_specialty_id": "1", "payroll_to_month": "13/2026", "fin.prev_year.visits": "1.000",
        "fin.prev_year.revenue": "200,00", "fin.prev_year.payroll_cost": "100,00", "fin.ytd.revenue": "12.5"})
    html = text(resp)
    assert resp.status_code == 200 and len(actions_of(rid)) == 1
    assert 'value="1.000"' in html and "Enter an amount, for example 1.234,56." in html
    assert "2,00" in html  # revenue per 1 of payroll, worked out for the typed values
    # a missing table is refused by the engine
    resp = act(client, "nic.accountant", rid, "check", position="yes", funds="yes")
    assert "Fill in the financial data." in text(resp) and len(actions_of(rid)) == 1


def test_cards_carry_a_csrf_token_and_a_lesser_return_control(seeded, client):
    rid = create(client).id
    as_user(client, "nic.accountant")
    html = text(client.get("/requests/%d?lang=en" % rid))
    section = html.split('<section class="card ehr-card')[1].split('aria-labelledby="sec-details"')[0]
    assert section.count('name="csrf_token"') == 2  # the answer form and the return form
    assert "Return to requester" in section and "btn-outline-secondary" in section
    # no button of the main weight sits in the lesser area, and it is a separate form behind a confirm step
    main, _, lesser = section.partition("ehr-card__lesser")
    assert "btn-primary" not in lesser and "<details" in lesser and "Return the request to" in lesser
    assert 'name="comment"' in lesser
    seeded.config["CSRF_ENABLED"] = True
    resp = client.post("/requests/%d/action" % rid, data={"action": "check", "role": "dir_accountant"})
    assert resp.status_code == 400
