"""Mail backends behind one interface: `send(to, subject, html, text) -> None`, raising on failure.

`outbox_only` (default) sends nothing: mail stays in the outbox for admins to read. `smtp` and `graph` read their
configuration from the environment when a message is sent, so no secret is stored in the database or the repo.
"""
import base64
import json
import os
import smtplib
import time
import urllib.error
import urllib.parse
import urllib.request
from email.message import EmailMessage

from ..models import get_setting
from .mime import build_message

BACKEND_NAMES = ("outbox_only", "smtp", "graph")


class MailError(Exception):
    """A message could not be sent. The text goes to `mail_outbox.last_error`, so it must not hold secrets."""


class MailBackend:
    delivers = True  # False: flushing leaves the outbox alone

    def send(self, to, subject, html, text):
        raise NotImplementedError


class OutboxOnlyBackend(MailBackend):
    delivers = False

    def send(self, to, subject, html, text):
        raise MailError("outbox_only backend does not send")


class InMemoryBackend(MailBackend):
    """For tests. `fail_with` makes every send raise; `fail_for` fails only for those addresses."""

    def __init__(self, fail_with=None, fail_for=()):
        self.sent = []
        self.fail_with = fail_with
        self.fail_for = set(fail_for)

    def send(self, to, subject, html, text):
        if self.fail_with or to in self.fail_for:
            raise MailError(self.fail_with or "refused by test backend")
        self.sent.append({"to": to, "subject": subject, "html": html, "text": text})


def _flag(value, default):
    if value is None or value == "":
        return default
    return str(value).strip().lower() in ("1", "true", "yes", "on")


class SmtpBackend(MailBackend):
    """EHR_SMTP_HOST, EHR_SMTP_PORT (587), EHR_SMTP_USER, EHR_SMTP_PASSWORD, EHR_SMTP_STARTTLS (1), EHR_MAIL_FROM."""

    def __init__(self, environ=None, smtp_factory=smtplib.SMTP, timeout=30):
        env = os.environ if environ is None else environ
        self.host = env.get("EHR_SMTP_HOST", "")
        self.port = int(env.get("EHR_SMTP_PORT") or 587)
        self.user = env.get("EHR_SMTP_USER", "")
        self.password = env.get("EHR_SMTP_PASSWORD", "")
        self.starttls = _flag(env.get("EHR_SMTP_STARTTLS"), True)
        self.sender = env.get("EHR_MAIL_FROM", "")
        self.smtp_factory = smtp_factory
        self.timeout = timeout

    def build_message(self, to, subject, html, text):
        return build_message(self.sender, to, subject, html, text)

    def send(self, to, subject, html, text):
        if not self.host or not self.sender:
            raise MailError("SMTP is not configured (EHR_SMTP_HOST, EHR_MAIL_FROM)")
        msg = self.build_message(to, subject, html, text)
        try:
            with self.smtp_factory(self.host, self.port, timeout=self.timeout) as smtp:
                if self.starttls:
                    smtp.starttls()
                if self.user:
                    smtp.login(self.user, self.password)
                smtp.send_message(msg)
        except (smtplib.SMTPException, OSError) as exc:
            raise MailError("SMTP error: %s" % type(exc).__name__ + (": %s" % exc if str(exc) else "")) from exc


class GraphBackend(MailBackend):
    """Microsoft Graph, client-credentials flow, `sendMail` for one sender mailbox.

    EHR_GRAPH_TENANT, EHR_GRAPH_CLIENT_ID, EHR_GRAPH_CLIENT_SECRET, EHR_GRAPH_SENDER (the mailbox address).
    The whole MIME message is posted base64-encoded with Content-Type text/plain (the form eFinance uses), which
    keeps the plain-text alternative and the inline logo.
    Not tested against a real tenant: tests use a fake opener.
    """

    LOGIN = "https://login.microsoftonline.com/%s/oauth2/v2.0/token"
    SEND = "https://graph.microsoft.com/v1.0/users/%s/sendMail"
    SCOPE = "https://graph.microsoft.com/.default"

    def __init__(self, environ=None, opener=None, clock=time.time, timeout=30):
        env = os.environ if environ is None else environ
        self.tenant = env.get("EHR_GRAPH_TENANT", "")
        self.client_id = env.get("EHR_GRAPH_CLIENT_ID", "")
        self.client_secret = env.get("EHR_GRAPH_CLIENT_SECRET", "")
        self.sender = env.get("EHR_GRAPH_SENDER", "")
        self.opener = opener or urllib.request.build_opener().open
        self.clock = clock
        self.timeout = timeout
        self._token = None
        self._expires = 0

    def _call(self, req):
        try:
            return self.opener(req, timeout=self.timeout)
        except urllib.error.HTTPError as exc:
            detail = ""
            try:
                detail = json.loads(exc.read().decode("utf-8", "replace")).get("error", {})
                detail = detail.get("code", "") if isinstance(detail, dict) else str(detail)
            except Exception:  # noqa: BLE001  the error body is only a hint
                pass
            raise MailError("Graph HTTP %s %s" % (exc.code, detail)) from exc
        except (urllib.error.URLError, OSError) as exc:
            raise MailError("Graph network error: %s" % type(exc).__name__) from exc

    def token_request(self):
        body = urllib.parse.urlencode({
            "client_id": self.client_id, "client_secret": self.client_secret,
            "scope": self.SCOPE, "grant_type": "client_credentials"}).encode("ascii")
        return urllib.request.Request(
            self.LOGIN % urllib.parse.quote(self.tenant, safe=""), data=body, method="POST",
            headers={"Content-Type": "application/x-www-form-urlencoded"})

    def access_token(self):
        if self._token and self.clock() < self._expires - 60:
            return self._token
        with self._call(self.token_request()) as resp:
            data = json.loads(resp.read().decode("utf-8"))
        token = data.get("access_token")
        if not token:
            raise MailError("Graph token response had no access_token")
        self._token = token
        self._expires = self.clock() + int(data.get("expires_in") or 3600)
        return token

    def send_request(self, to, subject, html, text, token):
        mime = build_message(self.sender, to, subject, html, text)
        return urllib.request.Request(
            self.SEND % urllib.parse.quote(self.sender, safe="@"),
            data=base64.b64encode(mime.as_bytes()), method="POST",
            headers={"Authorization": "Bearer " + token, "Content-Type": "text/plain"})

    def send(self, to, subject, html, text):
        if not (self.tenant and self.client_id and self.client_secret and self.sender):
            raise MailError("Graph is not configured (EHR_GRAPH_TENANT, CLIENT_ID, CLIENT_SECRET, SENDER)")
        token = self.access_token()
        with self._call(self.send_request(to, subject, html, text, token)) as resp:
            status = getattr(resp, "status", 202)
            if status not in (200, 202):
                raise MailError("Graph answered HTTP %s" % status)


def backend_name():
    name = (get_setting("mail_backend", "outbox_only") or "outbox_only").strip().lower()
    return name if name in BACKEND_NAMES else "outbox_only"  # "none" and typos send nothing


def get_backend(app=None):
    """The backend for this moment. Tests set app.config['MAIL_BACKEND_OVERRIDE'] to an instance."""
    from flask import current_app

    app = app or current_app
    override = app.config.get("MAIL_BACKEND_OVERRIDE")
    if override is not None:
        return override
    name = backend_name()
    if name == "smtp":
        return SmtpBackend()
    if name == "graph":
        return GraphBackend()
    return OutboxOnlyBackend()
