"""eHire's side of the eFinance link (docs/contracts/07-efinance-link.md): the switch, the address rule and the two
read-only endpoints, with every value checked before it is used.

Standard library only, through the existing client in activity_efinance (no redirects, no system proxies, a timeout,
a size cap). Only a cost-centre code and a year leave this server. The token comes from the
environment file and is never logged, stored or shown.
"""
import logging
import re
from datetime import datetime, timezone
from decimal import Decimal, InvalidOperation
from urllib.parse import urlsplit

from flask import current_app

from ehire.models import get_setting

from .activity_efinance import EFinanceClient, Unavailable

log = logging.getLogger("ehire.efinance")

NAMES = ("none", "http")
SETTING = "efinance_link"
COST_CENTRES_PATH = "/api/ehire/cost-centres"
BUDGET_PATH = "/api/ehire/budget"
COST_CENTRES_MAX_BYTES = 4 * 1024 * 1024  # about 1,700 rows is well under 1 MB
BUDGET_MAX_BYTES = 256 * 1024
MAX_ROWS = 20000
MAX_LINES = 500
MAX_AMOUNT = Decimal("9999999999.99")
_LOOPBACK = ("127.0.0.1", "localhost", "::1")
_CODE = re.compile(r"^[^\s\x00-\x1f\x7f]{1,20}$")  # cost_centre.code is String(20)
_ARTICLE = re.compile(r"^[^\s\x00-\x1f\x7f]{1,40}$")
_ENTITY = re.compile(r"^[A-Za-z0-9_\-]{1,20}$")
_WORD = re.compile(r"^[A-Za-z0-9_\-]{1,60}$")  # `level`, `spent_covers`


class LinkError(Exception):
    """The settings do not allow a call. The message is plain English for an operator and never holds the token."""


def link_name():
    value = get_setting(SETTING, "none")
    return value if value in NAMES else "none"


def is_on():
    return link_name() == "http"


def check_settings(cfg=None):
    """Problems with EHIRE_EFINANCE_URL / _TOKEN as a list of plain sentences (empty when the link can be used).
    Plain http only to a loopback host; anything else needs https (the certificate is always checked)."""
    cfg = cfg if cfg is not None else current_app.config
    problems = []
    url = (cfg.get("EHIRE_EFINANCE_URL") or "").strip()
    if not url:
        problems.append("EHIRE_EFINANCE_URL is empty (on the server: http://127.0.0.1:5004).")
    else:
        try:
            parts = urlsplit(url)
            parts.port  # noqa: B018  raises ValueError for a bad port
        except ValueError:
            parts = None
        if parts is None or not parts.hostname:
            problems.append("EHIRE_EFINANCE_URL is not a valid address.")
        elif parts.username or parts.password or parts.query or parts.fragment:
            problems.append("EHIRE_EFINANCE_URL must be only the address (no sign-in details, query or fragment).")
        elif parts.scheme == "http" and parts.hostname not in _LOOPBACK:
            problems.append("EHIRE_EFINANCE_URL uses plain http to another machine; use https, or 127.0.0.1.")
        elif parts.scheme not in ("http", "https"):
            problems.append("EHIRE_EFINANCE_URL must start with http:// or https://.")
    if not (cfg.get("EHIRE_EFINANCE_TOKEN") or "").strip():
        problems.append("EHIRE_EFINANCE_TOKEN is empty (Marios copies it file to file).")
    return problems


def client():
    cfg = current_app.config
    return EFinanceClient(cfg.get("EHIRE_EFINANCE_URL", ""), cfg.get("EHIRE_EFINANCE_TOKEN", ""),
                          cfg.get("EHIRE_EFINANCE_TIMEOUT", 5), cfg.get("EHIRE_EFINANCE_CA_FILE", ""))


def _usable_client():
    problems = check_settings()
    found = client()
    if problems or not found.configured():
        raise Unavailable("not_configured")
    return found


# ---------------------------------------------------------------- checking values

def parse_as_of(value):
    """eFinance's `as_of` (ISO 8601, `Z` or an offset) as an aware UTC datetime. Python 3.10 reads no `Z`."""
    if not isinstance(value, str) or not value.strip() or len(value) > 40:
        raise Unavailable("bad_value")
    text = value.strip()
    if text.endswith(("Z", "z")):
        text = text[:-1] + "+00:00"
    try:
        moment = datetime.fromisoformat(text)
    except ValueError:
        raise Unavailable("bad_value")
    if moment.tzinfo is None:
        moment = moment.replace(tzinfo=timezone.utc)
    return moment.astimezone(timezone.utc)


def _text(value, limit, required=True):
    if value is None and not required:
        return None
    if not isinstance(value, str):
        raise Unavailable("bad_value")
    text = value.strip()
    if (required and not text) or len(text) > limit or re.search(r"[\x00-\x1f\x7f]", text):
        raise Unavailable("bad_value")
    return text or None


def money(value):
    """An amount as eFinance sends it: a JSON number or a decimal string ('250000.00', '-12.50'), at most two decimals,
    or null (None). Never a bool, an exponent in a string, a thousands separator, NaN or infinity."""
    if value is None:
        return None
    if isinstance(value, bool) or not isinstance(value, (int, float, str)):
        raise Unavailable("bad_value")
    if isinstance(value, float):
        if value != value or value in (float("inf"), float("-inf")):
            raise Unavailable("bad_value")
        text = repr(value)
        if "e" in text or "E" in text:
            text = format(Decimal(text), "f")
    else:
        text = str(value).strip()
    if not re.match(r"^-?\d{1,10}(\.\d+)?$", text):
        raise Unavailable("bad_value")
    try:
        number = Decimal(text)
    except InvalidOperation:  # pragma: no cover  the pattern rules it out
        raise Unavailable("bad_value")
    if number != number.quantize(Decimal("0.01")) or abs(number) > MAX_AMOUNT:
        raise Unavailable("bad_value")  # more than two decimals that are not zero, or out of range
    return number.quantize(Decimal("0.01"))


def validate_cost_centres(body):
    """The decoded cost-centre answer -> {'as_of': datetime|None, 'rows': [{code, name_el, name_en, entity_code,
    active}]}. The list is under `items` (contract 07, version 2) or `cost_centres`; the Greek name under `name` or
    `name_el`; an optional `name_en`. Extra fields are ignored. One bad row makes the whole answer unusable: nothing
    is applied from a list that is half right."""
    if not isinstance(body, dict):
        raise Unavailable("bad_value")
    items = body.get("items") if "items" in body else body.get("cost_centres")
    if not isinstance(items, list):
        raise Unavailable("bad_value")
    as_of = parse_as_of(body["as_of"]) if body.get("as_of") not in (None, "") else None
    rows, seen = [], set()
    if len(items) > MAX_ROWS:
        raise Unavailable("too_large")
    for item in items:
        if not isinstance(item, dict):
            raise Unavailable("bad_value")
        code = item.get("code")
        if not isinstance(code, str) or not _CODE.match(code) or code in seen:
            raise Unavailable("bad_value")
        seen.add(code)
        entity = item.get("entity_code")
        if entity is not None and (not isinstance(entity, str) or not _ENTITY.match(entity)):
            raise Unavailable("bad_value")
        active = item.get("active")
        if not isinstance(active, bool):
            raise Unavailable("bad_value")
        name = item.get("name") if item.get("name") is not None else item.get("name_el")
        rows.append({"code": code, "name_el": _text(name, 200),
                     "name_en": _text(item.get("name_en"), 200, required=False), "entity_code": entity,
                     "active": active})
    return {"as_of": as_of, "rows": rows}


def _payroll(value):
    if value is None:
        return False
    if not isinstance(value, bool):
        raise Unavailable("bad_value")
    return value


def _year(value):
    if isinstance(value, bool):
        return None
    if isinstance(value, int):
        return value
    if isinstance(value, str) and re.match(r"^\d{4}$", value.strip()):
        return int(value.strip())
    return None


def validate_budget(body, cost_centre, year):
    """The decoded budget answer -> {'year', 'entity_code', 'level', 'lines': [{budget_code, description, payroll,
    budget, spent, open_requisitions, available, budget_updated_at, spent_covers}]}, salary lines only (`payroll`
    true), amounts as Decimal or None. The answer must be about what was asked. Every line needs a `budget_code`;
    amounts and dates are read on the salary lines, the only ones eHire uses. Extra fields are ignored."""
    if not isinstance(body, dict) or not isinstance(body.get("lines"), list):
        raise Unavailable("bad_value")
    if body.get("cost_centre") != cost_centre or _year(body.get("year")) != year:
        raise Unavailable("mismatch")
    if len(body["lines"]) > MAX_LINES:
        raise Unavailable("too_large")
    entity = body.get("entity_code")
    if entity is not None and (not isinstance(entity, str) or not _ENTITY.match(entity)):
        raise Unavailable("bad_value")
    level = body.get("level")
    if level is not None and (not isinstance(level, str) or not _WORD.match(level)):
        raise Unavailable("bad_value")
    lines, seen = [], set()
    for item in body["lines"]:
        if not isinstance(item, dict):
            raise Unavailable("bad_value")
        code = item.get("budget_code")
        if not isinstance(code, str) or not _ARTICLE.match(code) or code in seen:
            raise Unavailable("bad_value")
        seen.add(code)
        if not _payroll(item.get("payroll")):
            continue  # not a salary line: eHire does not use it (contract 07, section 2)
        updated = item.get("budget_updated_at")
        covers = item.get("spent_covers")
        if covers is not None and (not isinstance(covers, str) or not _WORD.match(covers)):
            raise Unavailable("bad_value")
        lines.append({"budget_code": code, "description": _text(item.get("description"), 300, required=False) or "",
                      "payroll": True, "budget": money(item.get("budget")), "spent": money(item.get("spent")),
                      "open_requisitions": money(item.get("open_requisitions")),
                      "available": money(item.get("available")),
                      "budget_updated_at": parse_as_of(updated) if updated not in (None, "") else None,
                      "spent_covers": covers})
    return {"year": year, "lines": lines, "entity_code": entity, "level": level}


# ---------------------------------------------------------------- the two calls

def fetch_cost_centres(etag=None):
    """('unchanged', etag, None) after a 304, or ('list', etag or None, validated list). Raises Unavailable."""
    headers = {"If-None-Match": etag} if etag else None
    status, answer_headers, body = _usable_client().get_json(
        COST_CENTRES_PATH, max_bytes=COST_CENTRES_MAX_BYTES, headers=headers, pass_codes=(304,))
    new_etag = (answer_headers.get("ETag") or "").strip() if answer_headers is not None else ""
    new_etag = new_etag if 0 < len(new_etag) <= 200 and new_etag.isprintable() else None
    if status == 304:
        return "unchanged", etag, None
    if status != 200:
        raise Unavailable("http_%d" % status)
    return "list", new_etag, validate_cost_centres(body)


def fetch_budget(cost_centre, year):
    """('lines', validated answer) or ('unknown_cost_centre', None) after a 404. Raises Unavailable. Asks for salary
    lines only (`payroll=1`, which eFinance may ignore) and filters again in validate_budget."""
    params = {"cost_centre": cost_centre, "year": str(year), "payroll": "1"}
    status, _headers, body = _usable_client().get_json(BUDGET_PATH, params, max_bytes=BUDGET_MAX_BYTES,
                                                        pass_codes=(404,))
    if status == 404:
        return "unknown_cost_centre", None
    if status != 200:
        raise Unavailable("http_%d" % status)
    return "lines", validate_budget(body, cost_centre, year)
