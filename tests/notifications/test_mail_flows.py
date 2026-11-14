"""Who is told what, through the real screens: outbox rows, actor rule, rollback, sending after commit."""
from ehr.extensions import db
from ehr.mail.backends import InMemoryBackend
from ehr.models import AuditLog, MailOutbox, User
from ehr.services.notify import notify
from ehr.workflow.model import Event
from tests.notifications.nhelpers import act, as_user, create, mails, reload, send_mail, step2, uid
from tests.requests.flowhelpers import step3
from tests.requests.test_return_replace_withdraw import resubmit


def to_of(rows):
    return sorted(db.session.get(User, m.to_user_id).username for m in rows)


def test_submit_tells_the_first_approver_and_confirms_to_the_requester(seeded, client):
    r = create(client)
    assert to_of(mails("task_opened", request_id=r.id)) == ["nic.accountant"]
    assert to_of(mails("request_submitted", request_id=r.id)) == ["nic.requester"]  # the one self-addressed mail
    assert {m.state for m in mails()} == {"queued"}
    queued = AuditLog.query.filter_by(event="mail_queued").all()
    assert len(queued) == len(mails()) and not AuditLog.query.filter_by(event="notification_due").count()


def test_nobody_is_mailed_about_their_own_action(seeded, client):
    r = create(client)
    step2(client, r.id)
    step3(client, r.id)
    assert "nic.accountant" not in to_of(mails("task_opened", request_id=r.id)[1:])  # acted at step 2, not told after
    for m in mails(request_id=r.id):
        assert m.event != "request_returned"
    before = len(mails())
    act(client, "central.finmgmt", r.id, "check", credit="yes", commitment_article="A-1")
    new = mails()[before:]
    assert "central.finmgmt" not in to_of(new)


def test_step_by_step_events(seeded, client):
    r = create(client)
    step2(client, r.id)
    assert to_of(mails("task_opened", request_id=r.id)) == ["nic.accountant", "nic.hr", "nic.sci"]
    act(client, "nic.hr", r.id, "return", comment="Add the signed form.")
    returned = mails("request_returned", request_id=r.id)
    assert to_of(returned) == ["nic.requester"] and "Add the signed form." in returned[0].html
    assert resubmit(client, r.id).status_code == 302
    assert to_of(mails("request_resubmitted", request_id=r.id)) == ["nic.hr"]
    assert to_of(mails("task_resumed", request_id=r.id)) == ["nic.hr", "nic.sci"]
    act(client, "nic.sci", r.id, "opinion", opinion="negative", comment="Not convinced.")
    act(client, "nic.hr", r.id, "check", documentation="complete")
    act(client, "nic.exec", r.id, "reject", comment="Not this year.")
    rejected = mails("request_rejected", request_id=r.id)
    assert to_of(rejected) == ["nic.requester"]
    assert "Not this year." in rejected[0].html


def test_rejection_and_approval_mail(seeded, client):
    r = create(client)
    act(client, "nic.accountant", r.id, "check", position="no", funds="yes", comment="No post is free.")
    rejected = mails("request_rejected", request_id=r.id)[0]
    assert "No post is free." in rejected.html and "2" in rejected.html
    r2 = create(client)
    step2(client, r2.id)
    step3(client, r2.id)
    from tests.requests.flowhelpers import step4
    step4(client, r2.id)
    act(client, "central.medical", r2.id, "opinion", opinion="positive")
    act(client, "central.ceo", r2.id, "approve")
    assert to_of(mails("request_approved", request_id=r2.id)) == ["nic.requester"]
    assert reload(r2.id).status == "approved"


def test_withdrawal_tells_the_people_it_was_waiting_on(seeded, client):
    r = create(client)
    as_user(client, "nic.requester")
    assert client.post("/requests/%d/withdraw" % r.id, data={"comment": "No longer needed."}).status_code == 302
    assert to_of(mails("request_withdrawn", request_id=r.id)) == ["nic.accountant"]


def test_new_material_reaches_the_person_who_may_replace(seeded, client):
    r = create(client)
    step2(client, r.id)
    act(client, "nic.sci", r.id, "opinion", opinion="positive")
    act(client, "nic.hr", r.id, "return", comment="Need a better description.")
    resubmit(client, r.id)
    assert "nic.sci" in to_of(mails("new_material", request_id=r.id))


def test_inactive_users_get_nothing_and_no_address_is_a_failed_row(seeded, client):
    User.query.filter_by(username="nic.accountant").one().is_active = False
    User.query.filter_by(username="nic.deputy").one().email = None
    db.session.commit()
    r = create(client)
    # The accountant is inactive, so the task goes to the substitute, who has no address.
    assert to_of(mails("task_opened", request_id=r.id)) == ["nic.deputy"]
    row = mails("task_opened", request_id=r.id)[0]
    assert row.state == "failed" and "no email address" in row.last_error and row.to_email is None
    assert "nic.accountant" not in to_of(mails(request_id=r.id))


def test_admins_get_task_unassigned(seeded, client):
    for name in ("nic.accountant", "nic.deputy"):
        User.query.filter_by(username=name).one().is_active = False
    db.session.commit()
    r = create(client)
    assert mails("task_opened", request_id=r.id) == []
    got = mails("task_unassigned", request_id=r.id)
    assert to_of(got) == ["demo.admin"] and "Settings" in got[0].html


def test_a_rolled_back_action_sends_nothing(seeded, client, mem):
    r = create(client)
    before = len(mails())
    notify([Event("task_opened", r.id, uid("nic.hr"), {"role": "dir_hr_officer", "step": 3})])
    db.session.rollback()
    assert len(mails()) == before
    # An engine error (no comment on a return) writes nothing either.
    resp = act(client, "nic.accountant", r.id, "return", comment="")
    assert resp.status_code == 200 and len(mails()) == before and reload(r.id).status == "in_progress"
    assert mem.sent == []


def test_web_request_sends_after_commit(seeded, client, mem):
    seeded.config["MAIL_AUTO_FLUSH"] = True
    r = create(client)
    assert {m["to"] for m in mem.sent} == {"nic.accountant@example.invalid", "nic.requester@example.invalid"}
    assert all(m.state == "sent" and m.sent_at for m in mails(request_id=r.id))


def test_a_failing_backend_never_breaks_the_action(seeded, client):
    seeded.config["MAIL_AUTO_FLUSH"] = True
    seeded.config["MAIL_BACKEND_OVERRIDE"] = InMemoryBackend(fail_with="server down")
    r = create(client)
    assert reload(r.id).status == "in_progress"
    rows = mails(request_id=r.id)
    assert rows and all(m.state == "failed" and m.attempts == 1 and "server down" in m.last_error for m in rows)


def test_send_mail_marks_sent_and_failed_and_retries_up_to_five_attempts(seeded, client, mem):
    r = create(client)
    assert send_mail(seeded) == {"sent": 2, "failed": 0, "expired": 0}
    assert {m.state for m in mails(request_id=r.id)} == {"sent"}
    assert send_mail(seeded)["sent"] == 0  # nothing is sent twice

    bad = InMemoryBackend(fail_for={"nic.accountant@example.invalid"})
    seeded.config["MAIL_BACKEND_OVERRIDE"] = bad
    r2 = create(client)
    out = send_mail(seeded)
    assert out["sent"] == 1 and out["failed"] == 1
    row = mails("task_opened", "nic.accountant", r2.id)[0]
    assert (row.state, row.attempts) == ("failed", 1) and "refused" in row.last_error
    for _ in range(8):
        send_mail(seeded)
    assert mails("task_opened", "nic.accountant", r2.id)[0].attempts == 5  # stops at five
    bad.fail_for.clear()
    assert send_mail(seeded)["sent"] == 0
    row = db.session.get(MailOutbox, row.id)
    row.attempts = 2
    db.session.commit()
    assert send_mail(seeded)["sent"] == 1 and db.session.get(MailOutbox, row.id).state == "sent"


def test_outbox_only_sends_nothing_and_leaves_rows_queued(seeded, client):
    r = create(client)
    assert send_mail(seeded) == {"sent": 0, "failed": 0, "expired": 0}
    assert {m.state for m in mails(request_id=r.id)} == {"queued"}


def test_old_queued_mail_expires_instead_of_going_out_late(seeded, client, mem):
    from datetime import timedelta
    r = create(client)
    for m in mails(request_id=r.id):
        m.created_at = m.created_at - timedelta(hours=60)
    db.session.commit()
    assert send_mail(seeded)["expired"] == 2 and mem.sent == []
