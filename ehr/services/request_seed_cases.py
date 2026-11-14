"""Invented sample requests for demos and screenshots. Every step goes through the real engine and the same
services the screens use (request_form, request_cards, request_flow); no row is written by hand.

`seed_cases(now)` is idempotent: each case leaves a `seed_case` audit row and is skipped when it is there.
"""
from datetime import timedelta

from ehr import localtime
from ehr.extensions import db
from ehr.models import AuditLog, CostCentre, Facility, OaySpecialty, Position, Request, User, audit
from ehr.workflow import timing

from . import request_flow as flow
from . import request_form as form_rules
from .request_cards import read_action
from .request_engine import holidays
from .request_timers import run_timers


class Clock:
    def __init__(self, start):
        self.at = start

    def tick(self):
        self.at = self.at + timedelta(minutes=20)
        return self.at


def working_days_ago(now, n, days_off):
    """Latest moment that is at least n working days before now (so a task opened then has waited n days)."""
    start = now
    while timing.working_days_between(start, now, days_off, localtime.zone()) < n:
        start = start - timedelta(days=1)
    return start


def _user(username):
    user = User.query.filter_by(username=username).first()
    if user is None:
        raise RuntimeError("Demo user %s not found. Run `flask seed-demo` first." % username)
    return user


def _raw(user, directorate_id, category, reason, count=1, leavers=()):
    raw = form_rules.empty_raw()
    facility = Facility.query.filter_by(directorate_id=directorate_id, is_active=True).order_by(Facility.id).first()
    raw.update({
        "directorate_id": str(directorate_id), "facility_id": str(facility.id),
        "cost_centre_id": str(CostCentre.query.order_by(CostCentre.code).first().id),
        "category": category, "positions_count": str(count), "reason": reason,
        "position_id": str(Position.query.filter_by(category=category, is_active=True).order_by(Position.id).first().id),
        "need_text": "Sample need: the ward cannot keep its rota with the present staff.",
        "alternatives_text": "Sample alternatives: overtime and agency cover were tried.",
        "absence_flag": "no"})
    if category in ("medical", "allied"):
        raw["oay_specialty_id"] = str(OaySpecialty.query.order_by(OaySpecialty.name).first().id)
        raw["external_funding_flag"] = "no"
    if reason == "new_need":
        raw["new_need_origin"] = "Sample origin: a new service line."
        raw["new_need_cover_so_far"] = "Sample cover: temporary staff."
        if category in ("medical", "allied"):
            raw["new_need_plan"] = "Sample plan: revenue covers the cost within two years."
    else:
        raw["leavers"] = [{"name": name, "leave_date": "01/03/2027", "employment": "okypy_contract"}
                          for name in leavers]
    return raw


class Case:
    """One request being driven step by step."""

    def __init__(self, username, directorate_code, category, reason, start, count=1, leavers=()):
        from ehr.models import Directorate

        self.clock = Clock(start)
        self.user = _user(username)
        d = Directorate.query.filter_by(code=directorate_code).one()
        raw = _raw(self.user, d.id, category, reason, count, leavers)
        lookups = form_rules.Lookups(self.user, "en")
        errors = form_rules.validate(raw, lookups, True)
        if errors:
            raise RuntimeError("Seed case is not valid: %r" % errors)
        self.req = Request(created_by=self.user.id, status="draft", round=1, created_at=start)
        db.session.add(self.req)
        form_rules.store(self.req, raw)
        db.session.flush()
        self.fin_specialty = raw.get("oay_specialty_id", "")
        result = flow.submit(self.req, self.user.id, self.clock.tick())
        assert result.ok, result.errors

    def _holder(self, role):
        for task in self.req.tasks:
            if task.role == role and task.status == "open":
                return task.assignee_user_id
        raise RuntimeError("No open task for %s" % role)

    def act(self, role, action, form=None, comment=None):
        form = dict(form or {}, comment=comment or "")
        payload, text, errors = read_action(self.req, role, action, form)
        assert not errors, errors
        result = flow.act(self.req, self._holder(role), action, role, payload, text, self.clock.tick())
        assert result.ok, (role, action, result.errors)

    def accountant(self, position="yes", funds="yes", comment=None):
        form = {"position": position, "funds": funds}
        if (self.req.route_snapshot_json or "").find('"financials_required": true') >= 0:
            form.update({"oay_specialty_id": self.fin_specialty, "payroll_to_month": "09/2026",
                         "oay_data_month": "08/2026",
                         "fin.prev_year.visits": "48.200", "fin.prev_year.procedures": "9.350",
                         "fin.prev_year.revenue": "1.254.300,50", "fin.prev_year.payroll_cost": "812.400,00",
                         "fin.prev_year.headcount": "14",
                         "fin.ytd.visits": "37.900", "fin.ytd.procedures": "7.120",
                         "fin.ytd.revenue": "988.250,00", "fin.ytd.payroll_cost": "603.100,00",
                         "fin.ytd.headcount": "14,5"})
        self.act("dir_accountant", "check", form, comment)

    def step4(self):
        self.act("fin_mgmt_head", "check", {"credit": "yes", "commitment_article": "2.1.05.001"})
        self.act("central_hr_officer", "check", self.costs())

    def costs(self):
        from .request_engine import current_leavers

        form = {"new_hire_cost": "52.000,00"}
        for leaver in current_leavers(self.req):
            form["leaver_cost.%d" % leaver.id] = "48.500,00"
        return form

    def input_step3(self):
        for role in [t.role for t in self.req.tasks if t.status == "open"]:
            if role == "sci_director":
                self.act(role, "opinion", {"opinion": "positive"}, "Sample: supports the request.")
            elif role == "dir_hr_officer":
                self.act(role, "check", {"documentation": "complete"})


def _marker(n):
    return AuditLog.query.filter_by(event="seed_case", object_id=str(n)).first() is not None


def _done(case, n):
    audit("seed_case", request_id=case.req.id, object_type="request", object_id=n,
          detail={"number": case.req.number})
    db.session.commit()
    return case.req.number


def seed_cases(now):
    """Create the sample cases that do not exist yet. Returns the numbers created."""
    days_off = holidays(db.session)
    created = []

    if not _marker(1):  # medical new need at step 3, one input in
        c = Case("lim.requester", "LIM", "medical", "new_need", now - timedelta(hours=6))
        c.accountant()
        c.act("dir_hr_officer", "check", {"documentation": "complete"})
        created.append(_done(c, 1))

    if not _marker(2):  # nursing replacement waiting at step 4 for 6 working days
        opened = working_days_ago(now, 6, days_off)
        c = Case("nic.requester", "NIC", "nursing", "resignation", opened - timedelta(hours=4), leavers=("Leaver (sample) A",))
        c.accountant()
        c.input_step3()
        c.clock.at = opened
        c.act("dir_exec", "approve")
        created.append(_done(c, 2))

    if not _marker(3):  # admin post waiting for the CEO
        c = Case("phc.requester", "PHC", "admin", "new_need", now - timedelta(hours=8))
        c.accountant()
        c.input_step3()
        c.act("dir_exec", "approve")
        c.step4()
        created.append(_done(c, 3))

    if not _marker(4):  # rejected at step 2
        c = Case("lim.requester", "LIM", "other", "new_need", now - timedelta(days=5))
        c.accountant(position="no", comment="Sample: no vacant post is available in this unit.")
        created.append(_done(c, 4))

    if not _marker(5):  # approved, medical, retirement
        c = Case("lim.requester", "LIM", "medical", "retirement", now - timedelta(days=12), count=1,
                 leavers=("Leaver (sample) B",))
        c.accountant()
        c.input_step3()
        c.act("dir_exec", "approve")
        c.step4()
        c.act("medical_director", "opinion", {"opinion": "positive"})
        c.act("ceo", "approve")
        created.append(_done(c, 5))

    if not _marker(6):  # returned at step 3
        c = Case("nic.requester", "NIC", "medical", "new_need", now - timedelta(days=2))
        c.accountant()
        c.act("sci_director", "opinion", {"opinion": "positive"}, "Sample: supports the request.")
        c.act("dir_hr_officer", "return", comment="Sample: please attach the signed job description.")
        created.append(_done(c, 6))

    if not _marker(7):  # withdrawn
        c = Case("nic.requester", "NIC", "admin", "new_need", now - timedelta(days=4))
        result = flow.withdraw(c.req, c.user.id, c.clock.tick(), "Sample: the need was met another way.")
        assert result.ok, result.errors
        created.append(_done(c, 7))

    run_timers(now)  # stamps the reminder and escalation that case 2 has earned
    return created
