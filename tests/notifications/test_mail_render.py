"""Every event renders in both languages with one link, no raw keys and nothing the brief leaves out."""
import html as htmllib
import json
import re
from pathlib import Path

import pytest

from ehr.extensions import db
from ehr.mail.layout import EVENT_KIND, STATUS, EVENTS, Context, render_email, request_url
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
    # Exactly one link: one distinct href (the VML fallback repeats it), the request URL with no token.
    assert set(HREF.findall(html)) == {url} and len(set(HREF.findall(html))) == 1
    assert set(URLS.findall(html)) == {url} and URLS.findall(text) == [url]
    assert "token" not in html.lower() and "<link" not in html and "url(" not in html and "@import" not in html
    # The only image is the logo, by Content-ID; nothing remote.
    assert re.findall(r'src="([^"]*)"', html) == ["cid:okypylogo"] and html.count("<img") == 1
    assert "background-image" not in html and "<style" not in html and "<script" not in html
    # Strings: every key used exists in both files and none shows through as a raw key.
    en = json.loads((I18N / "en.json").read_text(encoding="utf-8"))
    el = json.loads((I18N / "el.json").read_text(encoding="utf-8"))
    for key in ctx.used - KNOWN_MISSING:
        assert key in en and key in el, key
        assert key not in html and key not in text and key not in subject
        assert not (key.startswith("mail.") and key.endswith(".label"))  # the old per-event labels are gone
    plain = htmllib.unescape(html)
    status = STATUS[EVENT_KIND[kind]]
    assert ctx.t(status["key"]) in plain and ctx.t(status["key"]) in text
    assert ctx.t("mail.area") in plain and ctx.t("mail.footer") in plain and ctx.t("mail.footer") in text
    assert ctx.t("action.view_request") in plain and ctx.t("action.view_request") in text
    assert req.number in subject and "{" not in subject and "}" not in html
    # Preheader: hidden, first text line, equal to the intro sentence.
    pre = re.search(r'<div style="display:none[^>]*>([^<]*)</div>', html)
    assert pre
    assert htmllib.unescape(pre.group(1)) == text.split("\n\n")[1].strip()  # the intro sentence
    # Nothing the brief leaves out.
    for body in (html, text):
        assert LEAVER not in body and "€" not in body and "annual_employer_cost" not in body
    # eFinance frame: 640 px, tables and inline styles, Arial, bars, VML button with the same href.
    assert "max-width:640px" in html and 'role="presentation"' in html and 'name="viewport"' in html
    assert "font-family:Arial,Helvetica,sans-serif" in html and 'width="104" height="65"' in html
    assert html.count('bgcolor="%s"' % status["bar"]) >= 1 and "background:%s" % status["bar"] in html
    assert 'bgcolor="#069FEC"' in html  # the closing 6 px bar
    assert "<v:roundrect" in html and 'arcsize="8%"' in html and "height:40px" in html
    assert "<!--[if mso]><table" in html and "mso-line-height-rule:exactly" in html
    assert "flex" not in html and "grid" not in html
    assert html.count('href="%s"' % url) == 2  # the VML button and the link, nothing else


def test_status_kinds_follow_the_efinance_frame():
    assert {k: (v["label"], v["bar"]) for k, v in STATUS.items()} == {
        "action": ("#1B75BB", "#069FEC"), "problem": ("#B42318", "#B42318"),
        "done": ("#58595B", "#8BC53F"), "info": ("#58595B", "#EAEAEA")}
    assert {k: v["key"] for k, v in STATUS.items()} == {k: "mail.status." + k for k in STATUS}
    assert {k for k, v in EVENT_KIND.items() if v == "action"} == {
        "task_opened", "task_resumed", "new_material", "request_returned", "reminder_due", "withdrawal_warning"}
    assert {k for k, v in EVENT_KIND.items() if v == "problem"} == {"request_rejected", "task_unassigned", "escalation_due"}
    assert {k for k, v in EVENT_KIND.items() if v == "done"} == {"request_approved"}
    assert {k for k, v in EVENT_KIND.items() if v == "info"} == {
        "request_submitted", "request_resubmitted", "task_redirected", "request_withdrawn"}


@pytest.mark.parametrize("lang", ["el", "en"])
@pytest.mark.parametrize("kind", ["action", "problem", "done", "info"])
def test_label_and_bar_per_kind(app, req, kind, lang):
    event = next(e for e, k in EVENT_KIND.items() if k == kind)
    recipient = User.query.filter_by(username="nic.accountant").one()
    html = render_email(event_for(event, req), req, recipient, lang, "http://x", app.jinja_env)[1]
    label = json.loads((I18N / ("%s.json" % lang)).read_text(encoding="utf-8"))["mail.status." + kind]
    assert ">%s</span>" % label in html
    assert "color:%s" % STATUS[kind]["label"] in html and 'bgcolor="%s"' % STATUS[kind]["bar"] in html


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
    assert row.language == "en" and 'lang="en"' in row.html and "Action needed" in row.html
