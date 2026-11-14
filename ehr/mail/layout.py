"""One email layout for every event (contract 03, section 7).

`render_email(event, req, recipient, lang, base_url)` returns (subject, html, text). The email informs and never
acts: one link, the request page with ?do=review. No token, no images, no external CSS.
"""
import re

from .. import i18n
from ..extensions import db
from ..models import RequestAction, RequestDocument, User

# Status bar per kind. The label word is always printed, so colour never carries the state alone.
BAR = {
    "waiting": {"bg": "#ED7D31", "fg": "#1F1F1F", "border": "#ED7D31"},
    "approved": {"bg": "#F2F8EA", "fg": "#3F6B12", "border": "#3F6B12"},
    "rejected": {"bg": "#C0392B", "fg": "#FFFFFF", "border": "#C0392B"},
    "information": {"bg": "#1B75BB", "fg": "#FFFFFF", "border": "#1B75BB"},
}
EVENT_KIND = {
    "task_opened": "waiting", "task_resumed": "waiting", "new_material": "waiting", "reminder_due": "waiting",
    "request_returned": "waiting", "withdrawal_warning": "waiting", "task_unassigned": "waiting",
    "request_approved": "approved",
    "request_rejected": "rejected",
    "task_redirected": "information", "request_submitted": "information", "request_resubmitted": "information",
    "request_withdrawn": "information", "escalation_due": "information",
}
EVENTS = tuple(EVENT_KIND)
# Events that go to the requester: they also say who the request is waiting on.
REQUESTER_EVENTS = ("request_submitted", "request_withdrawn", "request_approved", "request_rejected")
NEED_LIMIT = 150  # about two lines on a phone


def _short(text, limit=NEED_LIMIT):
    text = re.sub(r"\s+", " ", text or "").strip()
    if len(text) <= limit:
        return text
    cut = text[:limit].rsplit(" ", 1)[0].rstrip(" ,.;:") or text[:limit]
    return cut + "…"


def request_url(base_url, request_id):
    return "%s/requests/%d?do=review" % ((base_url or "").rstrip("/"), request_id)


def _name(user_id):
    user = db.session.get(User, user_id) if user_id else None
    return (user.full_name or user.username) if user else ""


class Context:
    """Everything one email needs, in one language. Records the string keys it used (for tests)."""

    def __init__(self, lang):
        self.lang = lang if lang in ("el", "en") else "el"
        self.used = set()

    def t(self, key, **params):
        self.used.add(key)
        return i18n.translate(key, self.lang, **params)


def _actions(req):
    """The request's actions, newest first, read from the database (the loaded list may predate the last action)."""
    return RequestAction.query.filter_by(request_id=req.id).order_by(RequestAction.id.desc()).all()


def _comment_for(req, event, ctx):
    """The stored comment of the action behind the event, or None. `system.*` comments are string keys."""
    wanted = {"request_returned": ("return",), "request_rejected": ("reject", "check"),
              "request_withdrawn": ("withdraw",)}.get(event.kind)
    if not wanted:
        return None
    for a in _actions(req):
        if a.action in wanted and not a.is_superseded:
            if not a.comment:
                return None
            return ctx.t(a.comment) if re.match(r"^system\.[a-z_.]+$", a.comment) else a.comment
    return None


def _intro(event, req, ctx):
    data = dict(event.data or {})
    kind = event.kind
    key = "mail.%s.intro" % kind
    if kind == "task_opened" or kind == "task_unassigned":
        return ctx.t(key, role=ctx.t("role." + str(data.get("role"))))
    if kind == "task_redirected":
        reason = data.get("redirect_reason") or "out_of_office"
        who = _name(data.get("assignee") or data.get("assignee_user_id"))
        return ctx.t("%s.%s" % (key, reason), who=who)
    if kind == "request_submitted":
        return ctx.t(key, number=req.number or "")
    if kind == "request_returned":
        actor = next((a.actor_user_id for a in _actions(req) if a.action == "return"), None)
        who = _name(actor) or ctx.t("role." + str(data.get("role")))
        return ctx.t(key, who=who)
    if kind == "request_rejected":
        step = data.get("step") or req.current_step or 0
        return ctx.t(key, n=step, step=ctx.t("step.%s" % step))
    if kind in ("reminder_due", "withdrawal_warning"):
        if kind == "reminder_due":
            n = int(data.get("working_days") or 0)
        else:  # the engine sends days elapsed and the limit; the email says how many are left
            n = max(int(data.get("limit") or 0) - int(data.get("working_days") or 0), 1)
        return ctx.t("%s.%s" % (key, "one" if n == 1 else "many"), n=n)
    if kind == "escalation_due":
        who = _name(data.get("assignee"))
        return ctx.t(key, who=who, n=int(data.get("working_days") or 0))
    return ctx.t(key)


def _facts(req, event, ctx):
    lang = ctx.lang
    rows = []
    title = req.position.name(lang) if req.position else ""
    count = req.positions_count or 0
    posts = ctx.t("list.posts.one") if count == 1 else ctx.t("list.posts.many", n=count)
    rows.append((ctx.t("field.position"), "%s · %s" % (title, posts) if count else title))
    if req.facility:
        rows.append((ctx.t("field.facility"), req.facility.name(lang)))
    if req.category:
        rows.append((ctx.t("field.category"), ctx.t("category." + req.category)))
    if req.reason:
        rows.append((ctx.t("field.reason"), ctx.t("reason." + req.reason)))
    if req.creator:
        rows.append((ctx.t("mail.requester"), req.creator.full_name or req.creator.username))
    if req.need_text:
        rows.append((ctx.t("field.need_text"), _short(req.need_text)))
    n_docs = RequestDocument.query.filter_by(request_id=req.id).count()
    rows.append((ctx.t("docs.title"), ctx.t("docs.count.one") if n_docs == 1 else ctx.t("docs.count.many", n=n_docs)))
    if event.kind in REQUESTER_EVENTS and req.status == "in_progress":
        names = []
        for t in req.tasks:
            if t.status == "open" and t.assignee_user_id and _name(t.assignee_user_id) not in names:
                names.append(_name(t.assignee_user_id))
        if names:
            rows.append((ctx.t("mail.waiting_on"), ", ".join(names)))
    return rows


def render_email(event, req, recipient, lang, base_url, env, ctx=None):
    """Returns (subject, html, text). `env` is the Jinja environment of the app."""
    ctx = ctx or Context(lang or recipient.language)
    number = req.number or ""
    subject = ctx.t("mail.subject", number=number, position=req.position.name(ctx.lang) if req.position else "",
                    facility=req.facility.name(ctx.lang) if req.facility else "")
    kind = EVENT_KIND[event.kind]
    page = {
        "lang": ctx.lang,
        "subject": subject,
        "label": ctx.t("mail.%s.label" % event.kind),
        "bar": BAR[kind],
        "kind": kind,
        "intro": _intro(event, req, ctx),
        "facts": _facts(req, event, ctx),
        "comment_label": ctx.t("mail.comment"),
        "comment": _comment_for(req, event, ctx),
        "button": ctx.t("action.view_request"),
        "url": request_url(base_url, req.id),
        "footer": ctx.t("mail.footer"),
    }
    html = env.get_template("mail/layout.html").render(**page)
    text = env.get_template("mail/layout.txt").render(**page)
    return subject, html, text
