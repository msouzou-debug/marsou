"""SMTP and Graph backends build the right requests. Both are tested with fakes: nothing here talks to a server."""
import io
import json
import smtplib
import urllib.error
import urllib.parse

import pytest

from ehr.mail.backends import (GraphBackend, InMemoryBackend, MailError, OutboxOnlyBackend, SmtpBackend,
                               backend_name, get_backend)
from ehr.models import Setting
from ehr.extensions import db

HTML = "<p>Grüße</p>"
TEXT = "Grüße http://example.invalid/requests/1?do=review"


class FakeSmtp:
    log = []

    def __init__(self, host, port, timeout=None):
        self.args = (host, port, timeout)
        FakeSmtp.log = [("connect", host, port)]

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False

    def starttls(self):
        FakeSmtp.log.append(("starttls",))

    def login(self, user, password):
        FakeSmtp.log.append(("login", user, password))

    def send_message(self, msg):
        FakeSmtp.log.append(("send", msg))


ENV = {"EHR_SMTP_HOST": "smtp.example.invalid", "EHR_SMTP_PORT": "2525", "EHR_SMTP_USER": "robot",
       "EHR_SMTP_PASSWORD": "pw-for-tests", "EHR_MAIL_FROM": "ehr@example.invalid"}


def test_smtp_builds_a_multipart_message_and_uses_starttls_and_login():
    SmtpBackend(ENV, smtp_factory=FakeSmtp).send("a@example.invalid", "Subject Α", HTML, TEXT)
    kinds = [e[0] for e in FakeSmtp.log]
    assert kinds == ["connect", "starttls", "login", "send"] and FakeSmtp.log[0][1:] == ("smtp.example.invalid", 2525)
    msg = FakeSmtp.log[-1][1]
    assert msg["To"] == "a@example.invalid" and msg["From"] == "ehr@example.invalid"
    assert msg["Subject"] == "Subject Α" and msg.get_content_type() == "multipart/alternative"
    parts = {p.get_content_type(): p.get_content() for p in msg.iter_parts()}
    assert parts["text/plain"].strip() == TEXT and parts["text/html"].strip() == HTML


def test_smtp_options_and_errors():
    SmtpBackend(dict(ENV, EHR_SMTP_STARTTLS="0", EHR_SMTP_USER=""), smtp_factory=FakeSmtp).send("a@example.invalid", "s", HTML, TEXT)
    assert [e[0] for e in FakeSmtp.log] == ["connect", "send"]
    with pytest.raises(MailError, match="not configured"):
        SmtpBackend({}, smtp_factory=FakeSmtp).send("a@example.invalid", "s", HTML, TEXT)

    class Down(FakeSmtp):
        def send_message(self, msg):
            raise smtplib.SMTPRecipientsRefused({})

    with pytest.raises(MailError, match="SMTP error") as info:
        SmtpBackend(ENV, smtp_factory=Down).send("a@example.invalid", "s", HTML, TEXT)
    assert "pw-for-tests" not in str(info.value)  # no secret reaches last_error


class Resp:
    def __init__(self, body=b"", status=200):
        self.body, self.status = body, status

    def read(self):
        return self.body

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False


class FakeOpener:
    def __init__(self, token_expires=3600, send_status=202):
        self.calls, self.token_expires, self.send_status = [], token_expires, send_status

    def __call__(self, req, timeout=None):
        self.calls.append(req)
        if "login.microsoftonline.com" in req.full_url:
            return Resp(json.dumps({"access_token": "tok-%d" % len(self.calls), "expires_in": self.token_expires}).encode())
        return Resp(b"", self.send_status)


GRAPH = {"EHR_GRAPH_TENANT": "tenant-id", "EHR_GRAPH_CLIENT_ID": "client-id", "EHR_GRAPH_CLIENT_SECRET": "s3cret",
         "EHR_GRAPH_SENDER": "ehr@example.invalid"}


def test_graph_gets_a_token_then_posts_send_mail():
    opener, now = FakeOpener(), [1000.0]
    GraphBackend(GRAPH, opener=opener, clock=lambda: now[0]).send("a@example.invalid", "Subject", HTML, TEXT)
    token_req, send_req = opener.calls
    assert token_req.get_method() == "POST"
    assert token_req.full_url == "https://login.microsoftonline.com/tenant-id/oauth2/v2.0/token"
    form = urllib.parse.parse_qs(token_req.data.decode())
    assert form == {"client_id": ["client-id"], "client_secret": ["s3cret"], "grant_type": ["client_credentials"],
                    "scope": ["https://graph.microsoft.com/.default"]}
    assert send_req.get_method() == "POST"
    assert send_req.full_url == "https://graph.microsoft.com/v1.0/users/ehr@example.invalid/sendMail"
    assert send_req.get_header("Authorization") == "Bearer tok-1" and send_req.get_header("Content-type") == "application/json"
    body = json.loads(send_req.data.decode())
    assert body["message"]["subject"] == "Subject"
    assert body["message"]["body"] == {"contentType": "HTML", "content": HTML}
    assert body["message"]["toRecipients"] == [{"emailAddress": {"address": "a@example.invalid"}}]
    assert body["saveToSentItems"] is False


def test_graph_reuses_the_token_until_it_is_about_to_expire():
    opener, now = FakeOpener(token_expires=3600), [1000.0]
    backend = GraphBackend(GRAPH, opener=opener, clock=lambda: now[0])
    backend.send("a@example.invalid", "s", HTML, TEXT)
    backend.send("b@example.invalid", "s", HTML, TEXT)
    assert [("login" in c.full_url) for c in opener.calls] == [True, False, False]
    now[0] += 3600
    backend.send("c@example.invalid", "s", HTML, TEXT)
    assert sum("login" in c.full_url for c in opener.calls) == 2


def test_graph_errors_are_clear_and_hold_no_secret():
    def refuse(req, timeout=None):
        raise urllib.error.HTTPError(req.full_url, 401, "Unauthorized", {}, io.BytesIO(b'{"error":{"code":"InvalidAuthenticationToken"}}'))

    with pytest.raises(MailError, match="HTTP 401 InvalidAuthenticationToken") as info:
        GraphBackend(GRAPH, opener=refuse).send("a@example.invalid", "s", HTML, TEXT)
    assert "s3cret" not in str(info.value)
    with pytest.raises(MailError, match="HTTP 200|answered"):
        GraphBackend(GRAPH, opener=FakeOpener(send_status=204)).send("a@example.invalid", "s", HTML, TEXT)
    with pytest.raises(MailError, match="not configured"):
        GraphBackend({}, opener=FakeOpener()).send("a@example.invalid", "s", HTML, TEXT)

    def offline(req, timeout=None):
        raise urllib.error.URLError("no route")

    with pytest.raises(MailError, match="network"):
        GraphBackend(GRAPH, opener=offline).send("a@example.invalid", "s", HTML, TEXT)


def test_the_setting_chooses_the_backend(app):
    assert isinstance(get_backend(), OutboxOnlyBackend) and not get_backend().delivers
    for value, kind in (("smtp", SmtpBackend), ("graph", GraphBackend), ("none", OutboxOnlyBackend), ("typo", OutboxOnlyBackend)):
        db.session.merge(Setting(key="mail_backend", value=value))
        db.session.commit()
        assert isinstance(get_backend(), kind), value
    app.config["MAIL_BACKEND_OVERRIDE"] = InMemoryBackend()
    assert isinstance(get_backend(), InMemoryBackend)
    assert backend_name() == "outbox_only"


def test_nothing_secret_lives_in_the_database(seeded):
    assert not [s.key for s in Setting.query.all() if any(w in s.key for w in ("secret", "password", "token"))]
