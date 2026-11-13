"""Test helpers: a tiny stand-in for the caller that stores engine results."""
from dataclasses import replace
from datetime import datetime, timedelta

from ehr.workflow.engine import apply
from ehr.workflow.model import (ActionRecord, Directory, NewAction, RequestState, TaskState)

T0 = datetime(2026, 11, 2, 9, 0)  # a Monday

ACC_OK = {
    "position": "yes", "funds": "yes", "oay_specialty_id": "S1", "payroll_to_month": "2026-09",
    "prev_year": {"visits": 10, "procedures": 5, "revenue": 100, "payroll_cost": 50, "headcount": 3},
    "ytd": {"visits": 8, "procedures": 4, "revenue": 80, "payroll_cost": 40, "headcount": 3},
}
ACC_SIMPLE = {"position": "yes", "funds": "yes"}


def make_directory(sci=True, out=(), extra_holders=None, extra_subs=None):
    holders = {
        ("dir_accountant", "D1"): "acc1", ("dir_hr_officer", "D1"): "hro1",
        ("dir_exec", "D1"): "exe1",
        ("fin_mgmt_head", None): "fin1", ("central_hr_officer", None): "chr1",
        ("medical_director", None): "med1", ("nursing_director", None): "nur1",
        ("ceo", None): "ceo1",
    }
    if sci:
        holders[("sci_director", "D1")] = "sci1"
    holders.update(extra_holders or {})
    subs = {("sci_director", "D1"): "sci_sub", ("dir_hr_officer", "D1"): "hro_sub"}
    subs.update(extra_subs or {})
    managers = {"acc1": "exe1", "sci1": "med1", "sci_sub": "exe1", "hro1": "exe1",
                "exe1": "ceo1", "fin1": "ceo1", "chr1": "ceo1", "med1": "ceo1",
                "nur1": "ceo1", "req1": "exe1"}
    return Directory(holders=holders, substitutes=subs, out_of_office=frozenset(out),
                     line_managers=managers)


class Sim:
    def __init__(self, category="medical", sci=True, reason="new_need", leavers=(),
                 requester="req1", out=(), directory=None):
        self.directory = directory or make_directory(sci=sci, out=out)
        self.state = RequestState(id=1, status="draft", category=category, directorate_id="D1",
                                  created_by=requester, reason=reason, leaver_ids=tuple(leavers))
        self.now = T0
        self.next_task = 1
        self.next_action = 1
        self.last = None

    def tick(self, days=0, hours=1):
        self.now = self.now + timedelta(days=days, hours=hours)

    def act(self, user, action, role=None, payload=None, comment=None, changed=None, expect=None):
        self.tick()
        res = apply(self.state, NewAction(user, action, role, payload or {}, comment, changed or {}),
                    self.directory, self.now)
        self.last = res
        if expect is not None:
            assert res.errors == (expect,), res.errors
            return res
        assert res.ok, res.errors
        self.store(res)
        return res

    def system_withdraw(self, comment=None):
        res = apply(self.state, NewAction(None, "withdraw", "system", {}, comment, {}, True),
                    self.directory, self.now)
        self.last = res
        if res.ok:
            self.store(res)
        return res

    def store(self, res):
        st = self.state
        actions = list(st.actions)
        sup = set(res.superseded_action_ids)
        actions = [replace(a, is_superseded=True) if a.id in sup else a for a in actions]
        if res.action is not None:
            actions.append(replace(res.action, id=self.next_action))
            self.next_action += 1
        tasks = list(st.tasks)
        index = {t.id: i for i, t in enumerate(tasks)}
        for op in res.task_ops:
            if op.op == "open":
                tasks.append(TaskState(
                    id=self.next_task, request_id=st.id, round=op.round, step=op.step,
                    phase=op.phase, role=op.role, assignee_user_id=op.assignee_user_id,
                    on_behalf_of_user_id=op.on_behalf_of_user_id, redirect_reason=op.redirect_reason,
                    status="open", opened_at=self.now, clock_started_at=self.now))
                self.next_task += 1
                continue
            i = index[op.task_id]
            t = tasks[i]
            if op.op == "pause":
                t = replace(t, status="paused")
            elif op.op == "resume":
                t = replace(t, status="open", clock_started_at=self.now, reminded_at=None,
                            escalated_at=None)
            elif op.op == "close":
                t = replace(t, status="closed")
            elif op.op == "allow_replace":
                t = replace(t, may_replace=True)
            elif op.op == "clear_replace":
                t = replace(t, may_replace=False)
            elif op.op == "reassign":
                t = replace(t, assignee_user_id=op.assignee_user_id,
                            on_behalf_of_user_id=op.on_behalf_of_user_id,
                            redirect_reason=op.redirect_reason)
            tasks[i] = t
        self.state = replace(
            st, status=res.status, current_step=res.current_step, step3_phase=res.step3_phase,
            round=res.round, returned_from_step=res.returned_from_step, category=res.category,
            route=res.route, returned_at=res.returned_at, actions=tuple(actions), tasks=tuple(tasks))

    # -- shortcuts
    def open_tasks(self):
        return {t.role: t for t in self.state.tasks if t.status == "open"}

    def kinds(self, res=None):
        return [e.kind for e in (res or self.last).events]

    def submit(self):
        return self.act(self.state.created_by, "submit", "requester")

    def acc(self, payload=None, **kw):
        return self.act("acc1", "check", "dir_accountant", payload or ACC_OK, **kw)

    def sci(self, opinion="positive", comment=None, user="sci1", **kw):
        return self.act(user, "opinion", "sci_director", {"opinion": opinion}, comment, **kw)

    def hro(self, doc="complete", comment=None, user="hro1", **kw):
        return self.act(user, "check", "dir_hr_officer", {"documentation": doc}, comment, **kw)

    def exe(self, action="approve", comment=None, **kw):
        return self.act("exe1", action, "dir_exec", {}, comment, **kw)

    def fin(self, credit="yes", comment=None, **kw):
        p = {"credit": credit}
        if credit == "yes":
            p["commitment_article"] = "ART-1"
        return self.act("fin1", "check", "fin_mgmt_head", p, comment, **kw)

    def chr_(self, payload=None, **kw):
        p = payload if payload is not None else {"new_hire_cost": "1000"}
        return self.act("chr1", "check", "central_hr_officer", p, **kw)

    def director(self, role="medical_director", user="med1", opinion="positive", **kw):
        return self.act(user, "opinion", role, {"opinion": opinion}, None, **kw)

    def ceo(self, action="approve", comment=None, **kw):
        return self.act("ceo1", action, "ceo", {}, comment, **kw)

    def through_step2(self, payload=None):
        self.submit()
        self.acc(payload)

    def through_step3(self):
        self.through_step2()
        if "sci_director" in self.open_tasks():
            self.sci()
        self.hro()
        self.exe()
