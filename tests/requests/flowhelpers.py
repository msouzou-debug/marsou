"""HTTP-level helpers for the workflow screens: sign in as a demo user, post the real forms."""
from ehr.extensions import db
from ehr.models import OaySpecialty, Request, RequestAction, Task, User

from tests.conftest import login
from tests.requests.helpers import full_form, ids


def fin_fields(specialty_id=None, **over):
    data = {
        "oay_specialty_id": str(specialty_id or OaySpecialty.query.first().id),
        "payroll_to_month": "09/2026", "oay_data_month": "08/2026",
        "fin.prev_year.visits": "48.200", "fin.prev_year.procedures": "9.350",
        "fin.prev_year.revenue": "1.254.300,50", "fin.prev_year.payroll_cost": "812.400,00",
        "fin.prev_year.headcount": "14",
        "fin.ytd.visits": "37.900", "fin.ytd.procedures": "7.120",
        "fin.ytd.revenue": "988.250,00", "fin.ytd.payroll_cost": "603.100,00", "fin.ytd.headcount": "14,5",
    }
    data.update(over)
    return data


def as_user(client, username):
    client.post("/logout")
    resp = login(client, username)
    assert resp.status_code == 302
    return client


def create(client, username="nic.requester", **kwargs):
    """Submit a new request as `username` through the form. Returns the Request."""
    as_user(client, username)
    resp = client.post("/requests", data=full_form(**kwargs))
    assert resp.status_code == 302, resp.get_data(as_text=True)[:1500]
    return Request.query.order_by(Request.id.desc()).first()


def open_task(rid, username, role=None):
    user = User.query.filter_by(username=username).one()
    q = Task.query.filter_by(request_id=rid, assignee_user_id=user.id).filter(
        (Task.status == "open") | ((Task.status == "closed") & (Task.may_replace.is_(True))))
    if role:
        q = q.filter_by(role=role)
    return q.order_by(Task.id.desc()).first()


def act(client, username, rid, action, role=None, task_id=None, follow=False, **fields):
    """Post an approver card as `username`. The role and task id come from the database when not given."""
    as_user(client, username)
    task = open_task(rid, username, role)
    data = {"action": action, "role": role or (task.role if task else "dir_accountant"),
            "task_id": str(task_id or (task.id if task else 0))}
    data.update(fields)
    return client.post("/requests/%d/action?lang=en" % rid, data=data, follow_redirects=follow)


def actions_of(rid):
    db.session.expire_all()
    return RequestAction.query.filter_by(request_id=rid).order_by(RequestAction.id).all()


def reload(rid):
    db.session.expire_all()
    return db.session.get(Request, rid)


def text(resp):
    return resp.get_data(as_text=True)


def step2(client, rid, user="nic.accountant", financials=True, **over):
    fields = {"position": "yes", "funds": "yes"}
    if financials:
        fields.update(fin_fields())
    fields.update(over)
    resp = act(client, user, rid, "check", **fields)
    assert resp.status_code == 302, text(resp)[:3000]
    return resp


def step3(client, rid, d="nic", sci=True):
    if sci:
        assert act(client, d + ".sci", rid, "opinion", opinion="positive").status_code == 302
    assert act(client, d + ".hr", rid, "check", documentation="complete").status_code == 302
    assert act(client, d + ".exec", rid, "approve").status_code == 302


def step4(client, rid, leaver_costs=None):
    assert act(client, "central.finmgmt", rid, "check", credit="yes", commitment_article="A-1").status_code == 302
    fields = {"new_hire_cost": "50.000,00"}
    for leaver in reload(rid).leavers:
        fields["leaver_cost.%d" % leaver.id] = "40.000,50"
    fields.update(leaver_costs or {})
    resp = act(client, "central.hr", rid, "check", **fields)
    assert resp.status_code == 302, text(resp)[:3000]
