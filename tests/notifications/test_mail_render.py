"""Every event renders in both languages with one link, no raw keys and nothing the brief leaves out."""
import html as htmllib
import json
from pathlib import Path

import pytest

from ehr.extensions import db
from ehr.mail.layout import BAR, EVENT_KIND, EVENTS, Context, render_email, request_url
from ehr.models import Request, User
from ehr.workflow.model import Event
from tests.notifications.nhelpers import HREF, URLS, act, create, uid

I18N = Path(__file__).resolve().parents[2] / "ehr" / "i18n"
# Phase 4 keys the strings agent has not written yet. Must be empty when every key exists.
KNOWN_MISSING = set()

LEAVER = "Sample Leaver Person"
DATA = {
    "task_opened": {"role": "dir_accountant", "step": 2},
    "task_resumed": {"role": "dir_accountant", "step": 2},
    "task_redirected": {"redirect_reason": "out_of_office"},
    "task_unassigned": {"role": "dir_exec", "step": 3},
    "request_submitted": {}, "request_returned": {"role": "dir_hr_officer", "step": 3},
    "request_resubmitted": {}, "new_material": {"role": "sci_director", "step": 3},
    "request_approved": {"step": 6}, "request_rejected": {"step": 4}, "request_withdrawn": {"step": 3},
    "reminder_due": {"working_days": 2}, "escalation_due": {"working_days": 5},
    "withdrawal_warning": {"working_days": 15, "limit": 30},
}


@pytest.fixture
def req(seeded, client):
    r = create(client, reason="retirement", **{"leavers[0].name": LEAVER})
    act(client, "nic.accountant", r.id, "return", comment="Please add the signed form.")
    return db.session.get(Request, r.id)


def event_for(kind, req, to="nic.accountant"):
    data = dict(DATA[kind])
    if kind == "task_redirected":
        data["assignee"] = uid("nic.deputy")
    if kind == "escalation_due":
        data["assignee"] = uid("nic.accountant")
    return Event(kind, req.id, uid(to), data)


def test_every_event_is_covered():
    assert set(EVENTS) == set(DATA)
    assert set(EVENTS) == {"task_opened", "task_resumed", "task_redirected", "task_unassigned", "request_submitted",
                           "request_returned", "request_resubmitted", "new_material", "request_approved",
                           "request_rejected", "request_withdrawn", "reminder_due", "escalation_due",
                           "withdrawal_warning"}


@pytest.mark.parametrize("lang", ["el", "en"])
@pytest.mark.parametrize("kind", sorted(EVENTS))
def test_each_event_renders_cleanly(app, req, kind, lang):
    ctx = Context(lang)
    recipient = User.query.filter_by(username="nic.accountant").one()
    subject, html, text = render_email(event_for(kind, req), req, recipient, lang, "http://127.0.0.1:5008",
                                       app.jinja_env, ctx)
    url = request_url("http://127.0.0.1:5008", req.id)
    assert url == "http://127.0.0.1:5008/requests/%d?do=review" % req.id
    # Exactly one link, in both forms, and it is the request URL with no token.
    assert HREF.findall(html) == [url]
    assert URLS.findall(html) == [url] and URLS.findall(text) == [url]
    assert "token" not in html.lower() and "<img" not in html and "<link" not in html and "url(" not in html
    assert "src=" not in html and "@import" not in html
    # Strings: every key used exists in both files and none shows through as a raw key.
    en = json.loads((I18N / "en.json").read_text(encoding="utf-8"))
    el = json.loads((I18N / "el.json").read_text(encoding="utf-8"))
    for key in ctx.used - KNOWN_MISSING:
        assert key in en and key in el, key
        assert key not in html and key not in text and key not in subject
    plain = htmllib.unescape(html)
    assert ctx.t("mail.%s.label" % kind) in plain
    assert ctx.t("action.view_request") in plain and ctx.t("mail.footer") in plain and ctx.t("mail.footer") in text
    assert req.number in subject and "{" not in subject and "}" not in html
    # Nothing the brief leaves out.
    for body in (html, text):
        assert LEAVER not in body and "€" not in body and "annual_employer_cost" not in body
    # Phone first: one centred column, at most 600 px, tables and inline styles.
    assert "max-width:600px" in html and 'role="presentation"' in html and "min-height:44px" in html
    assert "<style" not in html and 'name="viewport"' in html
    bar = BAR[EVENT_KIND[kind]]
    assert bar["bg"] in html and bar["fg"] in html


def test_bar_colours_follow_the_brief():
    assert BAR["waiting"] == {"bg": "#ED7D31", "fg": "#1F1F1F", "border": "#ED7D31"}
    assert BAR["approved"]["bg"] == "#F2F8EA" and BAR["approved"]["fg"] == "#3F6B12"
    assert BAR["rejected"]["bg"] == "#C0392B" and BAR["information"]["bg"] == "#1B75BB"
    assert EVENT_KIND["request_approved"] == "approved" and EVENT_KIND["request_rejected"] == "rejected"
    assert EVENT_KIND["task_opened"] == "waiting" and EVENT_KIND["escalation_due"] == "information"


def test_comment_is_shown_for_return_and_rejection_only(app, req):
    recipient = User.query.filter_by(username="nic.requester").one()
    returned = render_email(event_for("request_returned", req, "nic.requester"), req, recipient, "en", "http://x",
                            app.jinja_env)
    assert "Please add the signed form." in returned[1] and "Please add the signed form." in returned[2]
    opened = render_email(event_for("task_opened", req), req, recipient, "en", "http://x", app.jinja_env)
    assert "Please add the signed form." not in opened[1]


def test_text_is_cut_and_html_is_escaped(app, req):
    req.need_text = "<b>bold</b> " + "word " * 80
    recipient = User.query.filter_by(username="nic.accountant").one()
    _s, html, text = render_email(event_for("task_opened", req), req, recipient, "en", "http://x", app.jinja_env)
    assert "<b>bold</b>" not in html and "&lt;b&gt;bold" in html
    assert "…" in html and html.count("word") < 40
    db.session.rollback()


def test_subject_uses_the_recipients_language(app, req):
    recipient = User.query.filter_by(username="nic.accountant").one()
    en = render_email(event_for("task_opened", req), req, recipient, "en", "http://x", app.jinja_env)[0]
    el = render_email(event_for("task_opened", req), req, recipient, "el", "http://x", app.jinja_env)[0]
    assert en == "[%s] %s · %s" % (req.number, req.position.title_en, req.facility.name_en)
    assert el == "[%s] %s · %s" % (req.number, req.position.title_el, req.facility.name_el)


def test_requester_facing_mail_says_who_it_waits_on(app, seeded, client):
    r = create(client)
    recipient = User.query.filter_by(username="nic.requester").one()
    _s, html, _t = render_email(Event("request_submitted", r.id, recipient.id, {}), r, recipient, "en", "http://x",
                                app.jinja_env)
    assert "Waiting on" in html and User.query.filter_by(username="nic.accountant").one().full_name in html


def test_each_mail_is_in_the_recipients_stored_language(app, seeded, client):
    User.query.filter_by(username="nic.accountant").one().language = "en"
    db.session.commit()
    r = create(client)
    row = [m for m in __import__("tests.notifications.nhelpers", fromlist=["mails"]).mails("task_opened", "nic.accountant")][0]
    assert row.language == "en" and 'lang="en"' in row.html and "Waiting for you" in row.html
