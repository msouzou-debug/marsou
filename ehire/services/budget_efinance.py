"""The budget check of steps 2 and 4 against eFinance (contract 07, version 2, "How eHire uses the budget answer").

Setting `efinance_budget` picks what the cards show once the link is on:

- `exists` (default): the hospital's salary lines, each with whether a budget is loaded for the year. No amounts,
  anywhere: not on the page, not in the stored snapshot, not in the PDF, not in the eArchive comment.
- `figures`: the same lines with budget, spent, open requisitions and available, and the extra warnings on the
  available balance. Kept for when eFinance holds payroll spending; `flask efinance-budget` guards it.
- `off`: no panel and no call.

`lookup(code)` answers with the salary lines of a cost centre's hospital for the current year (Cyprus time), or a
reason: `off` (nothing is asked), `unavailable` (eFinance cannot answer), `unknown_cost_centre` (404) or `no_lines`
(no salary line). Answers are kept in memory for 5 minutes; a failure for 30 seconds, so a short outage does not hide
the panel for long.

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
from ehire.models import get_setting
from ehire.models.access import utcnow

from . import efinance_link
from .activity_efinance import Unavailable
from .request_amounts import format_amount
from .request_dates import format_datetime

log = logging.getLogger("ehire.efinance")

SETTING = "efinance_budget"
MODES = ("off", "exists", "figures")
DEFAULT_MODE = "exists"
CACHE_SECONDS = 300
FAILURE_CACHE_SECONDS = 30
AMOUNTS = ("budget", "spent", "open_requisitions", "available")  # figures mode only
# Warning codes; the string keys are card.budget.warning.<code> and card.budget.stored.<code>.
UNKNOWN, NO_BUDGET, LINE_NO_BUDGET = "unknown_cost_centre", "no_budget", "line_no_budget"
NOT_AVAILABLE, BELOW_COST = "not_available", "below_cost"  # figures mode only
WARNINGS = (NO_BUDGET, LINE_NO_BUDGET, UNKNOWN, NOT_AVAILABLE, BELOW_COST)
FIXED = (NO_BUDGET, UNKNOWN)  # do not depend on the picked line

_cache = {}
_lock = threading.Lock()


def budget_mode():
    """The `efinance_budget` setting: off, exists (default) or figures."""
    value = get_setting(SETTING, DEFAULT_MODE)
    return value if value in MODES else DEFAULT_MODE


def active_mode():
    """What the cards do now: `off` while the link is `none` or the setting is `off`, else the setting."""
    return budget_mode() if efinance_link.is_on() else "off"


class Answer:
    def __init__(self, status, lines=(), fetched_at=None, year=None, entity_code=None, reason=None):
        self.status = status  # lines | no_lines | unknown_cost_centre | unavailable | off
        self.lines = list(lines)
        self.fetched_at = fetched_at
        self.year = year
        self.entity_code = entity_code
        self.reason = reason  # for `unavailable`: a short code, safe to log

    @property
    def answered(self):
        """eFinance gave a usable answer (lines, none, or "unknown")."""
        return self.status in ("lines", "no_lines", UNKNOWN)

    @property
    def loaded(self):
        """How many salary lines have a budget loaded."""
        return sum(1 for l in self.lines if l["budget"] is not None)

    def line(self, code):
        return next((l for l in self.lines if l["budget_code"] == code), None) if code else None


def clear_cache():
    with _lock:
        _cache.clear()


def current_year():
    return localtime.today().year


def lookup(code, year=None):
    """The budget answer for one cost-centre code. Never raises; never calls eFinance in mode `off`."""
    if active_mode() == "off":
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
            answer = Answer(UNKNOWN, fetched_at=utcnow(), year=year)
        else:
            answer = Answer("lines" if body["lines"] else "no_lines", body["lines"], fetched_at=utcnow(), year=year,
                            entity_code=body["entity_code"])
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


def _line_warnings(answer, line, mode, cost):
    """The warnings that depend on the picked line."""
    if line is None or answer.loaded == 0:
        return []
    if line["budget"] is None:
        return [LINE_NO_BUDGET]
    if mode != "figures":
        return []
    available = line["available"]
    if available is None or available <= 0:
        return [NOT_AVAILABLE]
    if cost is not None and available < cost:
        return [BELOW_COST]
    return []


def warnings_for(answer, line, mode="exists", annual_cost=None):
    """Warning codes for an answer and the picked line (None: no line picked). Empty when there is nothing to say."""
    if answer.status == UNKNOWN:
        return [UNKNOWN]
    if answer.loaded == 0:
        return [NO_BUDGET]  # no salary line of the hospital has a budget loaded for the year (or there is none)
    return _line_warnings(answer, line, mode, _decimal(annual_cost))


def annual_cost_of(req):
    """The annual employer cost of the new posts recorded by central HR at step 4 (its latest answer that still
    counts), as a Decimal, or None. Used in mode `figures` only."""
    for a in reversed(req.actions):
        if a.role == "central_hr_officer" and a.action == "check" and not a.is_superseded and a.payload_json:
            try:
                return _decimal(json.loads(a.payload_json).get("new_hire_cost"))
            except (ValueError, AttributeError):
                return None
    return None


def step2_code(req):
    """The line picked at step 2 (the Accountant's latest answer that still counts), or None."""
    for a in reversed(req.actions):
        if a.role == "dir_accountant" and a.action == "check" and not a.is_superseded and a.payload_json:
            try:
                return json.loads(a.payload_json).get("budget_code") or None
            except (ValueError, AttributeError):
                return None
    return None


def _money(value):
    return str(value) if value is not None else None


def snapshot(answer, line, mode, annual_cost, code):
    """What is stored with the action. None when eFinance gave no usable answer. In mode `exists` it holds no
    amount: cost centre, entity, year, the picked code and description, whether a budget was loaded, how many salary
    lines had one, and the warnings."""
    if not answer.answered:
        return None
    found = warnings_for(answer, line, mode, annual_cost)
    out = {"mode": mode, "cost_centre": code, "entity_code": answer.entity_code, "year": answer.year,
           "status": answer.status, "salary_lines": len(answer.lines), "lines_with_budget": answer.loaded,
           "budget_loaded": (line["budget"] is not None) if line is not None else answer.loaded > 0,
           "warning": bool(found), "warnings": found}
    if line is not None:
        out.update({"budget_code": line["budget_code"], "description": line["description"]})
    if mode == "figures":
        out["annual_cost"] = _money(annual_cost)
        if line is not None:
            out.update({k: _money(line[k]) for k in AMOUNTS})
    return out


# ---------------------------------------------------------------- reading a posted card

def read_posted(req, form, errors):
    """(code, snapshot, warning) for a step 2 or step 4 post. `code` is "" when no line was picked. A picked code
    that is not among eFinance's salary lines is a field error. Off or unavailable: ("", None, False)."""
    mode = active_mode()
    if mode == "off":
        return "", None, False
    code = req.cost_centre.code if req.cost_centre else None
    answer = lookup(code)
    if not answer.answered:
        return "", None, False
    picked = (form.get("budget_code") or "").strip()
    line = answer.line(picked)
    if picked and line is None:
        errors["budget_code"] = "validation.choose"
        return "", None, False
    cost = annual_cost_of(req) if mode == "figures" else None
    snap = snapshot(answer, line, mode, cost, code)
    return (line["budget_code"] if line else ""), snap, bool(snap and snap["warning"])


# ---------------------------------------------------------------- showing it

def _line_view(line, mode, answer, cost):
    view = {"code": line["budget_code"], "description": line["description"], "loaded": line["budget"] is not None,
            "warnings": _line_warnings(answer, line, mode, cost)}
    if mode == "figures":
        view.update({k: format_amount(line[k]) for k in AMOUNTS})
        view["negative"] = line["available"] is not None and line["available"] <= 0
    return view


def card_view(req, role, typed, lang="el"):
    """The budget panel of a step 2 or step 4 card: {'state', 'mode', 'lines', 'selected', 'as_of', 'warnings',
    'year', 'annual_cost', 'cost_centre'}. State `off` draws nothing, `unavailable` one line, the others the panel.
    In mode `exists` no amount is in the view at all."""
    mode = active_mode()
    if mode == "off":
        return {"state": "off"}
    code = req.cost_centre.code if req.cost_centre else None
    answer = lookup(code)
    if not answer.answered:
        return {"state": "unavailable"}
    cost = annual_cost_of(req) if mode == "figures" else None
    selected = (typed.get("budget_code") or "").strip() if typed else ""
    if not selected and role == "fin_mgmt_head":
        selected = step2_code(req) or ""
    line = answer.line(selected)
    if line is None:
        selected = ""
    return {"state": answer.status, "mode": mode, "year": answer.year, "selected": selected,
            "as_of": format_datetime(answer.fetched_at) if answer.fetched_at else "",
            "lines": [_line_view(l, mode, answer, cost) for l in answer.lines],
            "warnings": warnings_for(answer, line, mode, cost),
            "annual_cost": format_amount(cost) if cost is not None else "", "cost_centre": code}


def stored_view(payload, lang="el"):
    """A stored snapshot, shaped for the request page and the PDF, or None. Amounts only for mode `figures`."""
    snap = payload.get("budget_snapshot") if isinstance(payload, dict) else None
    if not isinstance(snap, dict):
        return None
    mode = snap.get("mode") if snap.get("mode") in MODES else "exists"
    warnings = [w for w in (snap.get("warnings") or []) if w in WARNINGS]
    view = {"mode": mode, "status": snap.get("status"), "year": snap.get("year"), "code": snap.get("budget_code"),
            "description": snap.get("description") or "", "budget_loaded": bool(snap.get("budget_loaded")),
            "salary_lines": snap.get("salary_lines"), "lines_with_budget": snap.get("lines_with_budget"),
            "warnings": warnings, "warning": bool(snap.get("warning")),
            "cost_centre": snap.get("cost_centre") or "", "entity_code": snap.get("entity_code") or ""}
    if mode == "figures":
        for k in AMOUNTS:
            view[k] = format_amount(_decimal(snap.get(k))) if snap.get(k) not in (None, "") else ""
    return view


def stored_rows(payload, translate, lang="el"):
    """The stored snapshot as [(label, value, kind)] for the request page, the PDF and the eArchive record; kind is
    "warning" for a warning sentence, else "". `translate(key, **params)`. Empty when the action carries none."""
    try:
        view = stored_view(payload, lang)
    except Exception:  # a damaged snapshot is left out, never a reason to stop a deposit
        return []
    if view is None:
        return []
    out = []
    if view["code"]:
        out.append((translate("card.budget.line") + ":", ("%s %s" % (view["code"], view["description"])).strip(), ""))
        if view["mode"] == "figures":
            for k in AMOUNTS:
                out.append((translate("card.budget.col." + k) + ":", view[k] + " €" if view[k] else "-", ""))
        else:
            out.append(("", translate("card.budget.state.loaded" if view["budget_loaded"] else
                                      "card.budget.state.missing"), ""))
    elif view["status"] == "lines":
        out.append(("", translate("card.budget.no_line"), ""))
    if view["status"] in ("lines", "no_lines") and isinstance(view["salary_lines"], int) \
            and isinstance(view["lines_with_budget"], int):
        out.append(("", translate("card.budget.stored.loaded_count", loaded=view["lines_with_budget"],
                                  total=view["salary_lines"], year=view["year"]), ""))
    for w in view["warnings"]:
        out.append(("", translate("card.budget.stored." + w, year=view["year"], code=view["cost_centre"]), "warning"))
    if not view["warnings"]:
        out.append(("", translate("card.budget.stored.no_warning"), ""))
    if view["entity_code"]:
        scope = translate("card.budget.scope_entity", code=view["cost_centre"], entity=view["entity_code"],
                          year=view["year"])
    else:
        scope = translate("card.budget.scope", code=view["cost_centre"], year=view["year"])
    out.append(("", scope, ""))
    return out


def stored_lines(payload, translate, lang="el"):
    """stored_rows as [(label, value)], for the PDF and the eArchive record."""
    return [(label, value) for label, value, _kind in stored_rows(payload, translate, lang)]


def stored_text(payload, translate, lang="el"):
    """The same as one block of text (title first), for a free-text field. "" when there is no snapshot."""
    rows = stored_lines(payload, translate, lang)
    if not rows:
        return ""
    return "\n".join([translate("card.budget.title")] + [("%s %s" % (l, v)).strip() for l, v in rows])
