"""The budget check of steps 2 and 4 against eFinance (contract 07, "How eHire uses the budget answer").

`lookup(code)` answers with the budget lines of a cost centre for the current year (Cyprus time), or a reason:
`off` (link `none`: nothing is asked), `unavailable` (eFinance cannot answer), `unknown_cost_centre` (404) or
`no_lines` (no budget for that year). Answers are kept in memory for 5 minutes; a failure for 30 seconds, so a
short outage does not hide the figures for long.

The warning is worked out here, on the server, when the card is drawn and again when it is posted. The engine gets
it as a plain boolean and owns the rule that a "yes" against a warning needs a comment (contract 02, B1). The
snapshot stored with the action is built here from eFinance's answer, never from what the browser sent.
"""
import json
import logging
import threading
import time
from decimal import Decimal, InvalidOperation

from ehire import localtime

from . import efinance_link
from .activity_efinance import Unavailable
from .request_amounts import format_amount
from .request_dates import format_datetime

log = logging.getLogger("ehire.efinance")

CACHE_SECONDS = 300
FAILURE_CACHE_SECONDS = 30
AMOUNTS = ("budget", "spent", "committed", "available")
# Warning codes; the string key is card.budget.warning.<code>.
NOT_AVAILABLE, BELOW_COST, NO_LINES, UNKNOWN = "not_available", "below_cost", "no_lines", "unknown_cost_centre"

_cache = {}
_lock = threading.Lock()


class Answer:
    def __init__(self, status, lines=(), as_of=None, year=None, reason=None):
        self.status = status  # lines | no_lines | unknown_cost_centre | unavailable | off
        self.lines = list(lines)
        self.as_of = as_of
        self.year = year
        self.reason = reason  # for `unavailable`: a short code, safe to log

    @property
    def answered(self):
        """eFinance gave a usable answer (lines, none, or "unknown")."""
        return self.status in ("lines", "no_lines", UNKNOWN)

    def line(self, article):
        return next((l for l in self.lines if l["article"] == article), None) if article else None


def clear_cache():
    with _lock:
        _cache.clear()


def current_year():
    return localtime.today().year


def lookup(code, year=None):
    """The budget answer for one cost-centre code. Never raises; never calls eFinance while the link is `none`."""
    if not efinance_link.is_on():
        return Answer("off")
    if not code:
        return Answer("unavailable", reason="no_cost_centre")
    year = year or current_year()
    key = ((efinance_link.client().base_url or ""), code, year)
    now = time.monotonic()
    with _lock:
        hit = _cache.get(key)
        if hit is not None and hit[0] > now:
            return hit[1]
    try:
        kind, body = efinance_link.fetch_budget(code, year)
        if kind == UNKNOWN:
            answer = Answer(UNKNOWN, year=year)
        elif not body["lines"]:
            answer = Answer("no_lines", as_of=body["as_of"], year=year)
        else:
            answer = Answer("lines", body["lines"], as_of=body["as_of"], year=year)
        ttl = CACHE_SECONDS
    except Unavailable as exc:
        log.warning("eFinance budget link unavailable: %s", exc.reason)
        answer, ttl = Answer("unavailable", year=year, reason=exc.reason), FAILURE_CACHE_SECONDS
    with _lock:
        _cache[key] = (now + ttl, answer)
    return answer


# ---------------------------------------------------------------- warnings

def _decimal(value):
    try:
        return Decimal(str(value)) if value not in (None, "") else None
    except (InvalidOperation, ValueError):
        return None


def warnings_for(answer, line, annual_cost=None):
    """Warning codes for an answer and the picked line (None: no line picked). Empty when there is nothing to say."""
    if answer.status in ("no_lines", UNKNOWN):
        return [NO_LINES if answer.status == "no_lines" else UNKNOWN]
    if line is None:
        return []
    available = line["available"]
    if available <= 0:
        return [NOT_AVAILABLE]
    cost = _decimal(annual_cost)
    if cost is not None and available < cost:
        return [BELOW_COST]
    return []


def annual_cost_of(req):
    """The annual employer cost of the new posts recorded by central HR at step 4 (its latest answer that still
    counts), as a Decimal, or None."""
    for a in reversed(req.actions):
        if a.role == "central_hr_officer" and a.action == "check" and not a.is_superseded and a.payload_json:
            try:
                return _decimal(json.loads(a.payload_json).get("new_hire_cost"))
            except (ValueError, AttributeError):
                return None
    return None


def step2_article(req):
    """The line picked at step 2 (the Accountant's latest answer that still counts), or None."""
    for a in reversed(req.actions):
        if a.role == "dir_accountant" and a.action == "check" and not a.is_superseded and a.payload_json:
            try:
                return json.loads(a.payload_json).get("budget_article") or None
            except (ValueError, AttributeError):
                return None
    return None


def _iso(moment):
    return moment.strftime("%Y-%m-%dT%H:%M:%SZ") if moment is not None else None


def snapshot(answer, line, annual_cost, code):
    """What is stored with the action: the figures seen when the answer was given. None when eFinance gave none."""
    if not answer.answered:
        return None
    found = warnings_for(answer, line, annual_cost)
    out = {"cost_centre": code, "year": answer.year, "as_of": _iso(answer.as_of), "status": answer.status,
           "warning": bool(found), "warnings": found,
           "annual_cost": str(annual_cost) if annual_cost is not None else None}
    if line is not None:
        out.update({"article": line["article"], "name_el": line["name_el"], "name_en": line["name_en"]})
        out.update({k: str(line[k]) for k in AMOUNTS})
    return out


# ---------------------------------------------------------------- reading a posted card

def read_posted(req, form, errors):
    """(article, snapshot, warning) for a step 2 or step 4 post. `article` is "" when none was picked. A picked
    article that is not among eFinance's lines is a field error. Off or unavailable: ("", None, False)."""
    code = req.cost_centre.code if req.cost_centre else None
    answer = lookup(code) if efinance_link.is_on() else Answer("off")
    if not answer.answered:
        return "", None, False
    article = (form.get("budget_article") or "").strip()
    line = answer.line(article)
    if article and line is None:
        errors["budget_article"] = "validation.choose"
        return "", None, False
    snap = snapshot(answer, line, annual_cost_of(req), code)
    return (line["article"] if line else ""), snap, bool(snap and snap["warning"])


# ---------------------------------------------------------------- showing it

def _line_view(line, lang, annual_cost, answer):
    found = warnings_for(answer, line, annual_cost)
    view = {"article": line["article"], "name": (line["name_en"] if lang == "en" and line.get("name_en") else
                                                 line["name_el"]),
            "warnings": found}
    view.update({k: format_amount(line[k]) for k in AMOUNTS})
    view["negative"] = _decimal(line["available"]) is not None and _decimal(line["available"]) <= 0
    return view


def card_view(req, role, typed, lang="el"):
    """The budget panel of a step 2 or step 4 card: {'state', 'lines', 'selected', 'as_of', 'warnings', 'year',
    'annual_cost'}. State `off` draws nothing, `unavailable` one line, the others the panel."""
    if not efinance_link.is_on():
        return {"state": "off"}
    code = req.cost_centre.code if req.cost_centre else None
    answer = lookup(code)
    if not answer.answered:
        return {"state": "unavailable"}
    cost = annual_cost_of(req)
    selected = (typed.get("budget_article") or "").strip() if typed else ""
    if not selected and role == "fin_mgmt_head":
        selected = step2_article(req) or ""
    line = answer.line(selected)
    if line is None:
        selected = ""
    return {"state": answer.status, "year": answer.year, "selected": selected,
            "as_of": format_datetime(answer.as_of) if answer.as_of else "",
            "lines": [_line_view(l, lang, cost, answer) for l in answer.lines],
            "warnings": warnings_for(answer, line, cost), "annual_cost": format_amount(cost) if cost is not None else "",
            "cost_centre": code}


def stored_view(payload, lang="el"):
    """A stored snapshot, formatted for the request page and the PDF, or None."""
    snap = payload.get("budget_snapshot") if isinstance(payload, dict) else None
    if not isinstance(snap, dict):
        return None
    as_of = efinance_link.parse_as_of(snap["as_of"]) if snap.get("as_of") else None
    view = {"status": snap.get("status"), "year": snap.get("year"), "article": snap.get("article"),
            "name": (snap.get("name_en") if lang == "en" and snap.get("name_en") else snap.get("name_el")) or "",
            "as_of": format_datetime(as_of) if as_of else "", "warnings": list(snap.get("warnings") or []),
            "warning": bool(snap.get("warning")), "cost_centre": snap.get("cost_centre") or ""}
    for k in AMOUNTS:
        view[k] = format_amount(_decimal(snap.get(k))) if snap.get(k) not in (None, "") else ""
    return view


def stored_lines(payload, translate, lang="el"):
    """The stored snapshot as [(label, value)] for the PDF and the eArchive record. `translate(key, **params)`.
    Empty when the action carries no snapshot."""
    try:
        view = stored_view(payload, lang)
    except Exception:  # a damaged snapshot is left out, never a reason to stop a deposit
        return []
    if view is None:
        return []
    out = []
    if view["article"]:
        out.append((translate("card.budget.line") + ":", "%s %s" % (view["article"], view["name"])))
        for k in AMOUNTS:
            out.append((translate("card.budget.col." + k) + ":", view[k] + " €" if view[k] else ""))
    elif view["status"] not in ("no_lines", UNKNOWN):
        out.append(("", translate("card.budget.no_line")))
    for w in view["warnings"]:
        out.append(("", translate("card.budget.stored." + w, year=view["year"], code=view["cost_centre"])))
    scope = translate("card.budget.scope", code=view["cost_centre"], year=view["year"])
    if view["as_of"]:
        scope += " · " + translate("card.budget.as_of", date=view["as_of"])
    out.append(("", scope))
    return out


def stored_text(payload, translate, lang="el"):
    """The same as one block of text (title first), for a free-text field. "" when there is no snapshot."""
    rows = stored_lines(payload, translate, lang)
    if not rows:
        return ""
    return "\n".join([translate("card.budget.title")] + [("%s %s" % (l, v)).strip() for l, v in rows])
