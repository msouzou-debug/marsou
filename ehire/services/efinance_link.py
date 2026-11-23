"""eHire's side of the eFinance link (docs/contracts/07-efinance-link.md): the switch, the address rule and the two
read-only endpoints, with every value checked before it is used.

Standard library only, through the existing client in activity_efinance (no redirects, no system proxies, a timeout,
a size cap). Only a cost-centre code, a year and an article code leave this server. The token comes from the
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
COST_CENTRES_PATH = "/api/v1/ehire/cost-centres"
BUDGET_PATH = "/api/v1/ehire/budget"
COST_CENTRES_MAX_BYTES = 4 * 1024 * 1024  # about 1,700 rows is well under 1 MB
BUDGET_MAX_BYTES = 256 * 1024
MAX_ROWS = 20000
MAX_LINES = 500
MAX_AMOUNT = Decimal("9999999999.99")
_LOOPBACK = ("127.0.0.1", "localhost", "::1")
_CODE = re.compile(r"^[^\s\x00-\x1f\x7f]{1,20}$")  # cost_centre.code is String(20)
_ARTICLE = re.compile(r"^[^\s\x00-\x1f\x7f]{1,40}$")
_ENTITY = re.compile(r"^[A-Za-z0-9_\-]{1,20}$")


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
    """A decimal string with up to two decimals ('250000.00', '-12.50'); a whole int is accepted too. Never a float."""
    if isinstance(value, bool) or not isinstance(value, (int, str)):
        raise Unavailable("bad_value")
    text = str(value).strip()
    if not re.match(r"^-?\d{1,10}(\.\d{1,2})?$", text):
        raise Unavailable("bad_value")
    try:
        number = Decimal(text)
    except InvalidOperation:  # pragma: no cover  the pattern rules it out
        raise Unavailable("bad_value")
    if abs(number) > MAX_AMOUNT:
        raise Unavailable("bad_value")
    return number.quantize(Decimal("0.01"))


def validate_cost_centres(body):
    """The decoded cost-centre answer -> {'as_of': datetime|None, 'rows': [{code, name_el, name_en, entity_code,
    active}]}. One bad row makes the whole answer unusable: nothing is applied from a list that is half right."""
    if not isinstance(body, dict) or not isinstance(body.get("cost_centres"), list):
        raise Unavailable("bad_value")
    as_of = parse_as_of(body["as_of"]) if body.get("as_of") not in (None, "") else None
    rows, seen = [], set()
    if len(body["cost_centres"]) > MAX_ROWS:
        raise Unavailable("too_large")
    for item in body["cost_centres"]:
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
        rows.append({"code": code, "name_el": _text(item.get("name_el"), 200),
                     "name_en": _text(item.get("name_en"), 200, required=False), "entity_code": entity,
                     "active": active})
    return {"as_of": as_of, "rows": rows}


def validate_budget(body, cost_centre, year, article=None):
    """The decoded budget answer -> {'as_of', 'year', 'entity_code', 'lines': [{article, name_el, name_en, budget,
    spent, committed, available}]} with Decimals. The answer must be about what was asked."""
    if not isinstance(body, dict) or not isinstance(body.get("lines"), list):
        raise Unavailable("bad_value")
    if body.get("cost_centre") != cost_centre or body.get("year") != year or isinstance(body.get("year"), bool):
        raise Unavailable("mismatch")
    currency = body.get("currency")
    if currency not in (None, "EUR"):
        raise Unavailable("bad_value")
    if len(body["lines"]) > MAX_LINES:
        raise Unavailable("too_large")
    lines, seen = [], set()
    for item in body["lines"]:
        if not isinstance(item, dict):
            raise Unavailable("bad_value")
        code = item.get("article")
        if not isinstance(code, str) or not _ARTICLE.match(code) or code in seen:
            raise Unavailable("bad_value")
        if article is not None and code != article:
            raise Unavailable("mismatch")
        seen.add(code)
        lines.append({"article": code, "name_el": _text(item.get("name_el"), 300),
                      "name_en": _text(item.get("name_en"), 300, required=False),
                      "budget": money(item.get("budget")), "spent": money(item.get("spent")),
                      "committed": money(item.get("committed")), "available": money(item.get("available"))})
    entity = body.get("entity_code")
    return {"as_of": parse_as_of(body.get("as_of")), "year": year, "lines": lines,
            "entity_code": entity if isinstance(entity, str) else None}


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


def fetch_budget(cost_centre, year, article=None):
    """('lines', validated answer) or ('unknown_cost_centre', None) after a 404. Raises Unavailable."""
    params = {"cost_centre": cost_centre, "year": str(year)}
    if article:
        params["article"] = article
    status, _headers, body = _usable_client().get_json(BUDGET_PATH, params, max_bytes=BUDGET_MAX_BYTES,
                                                        pass_codes=(404,))
    if status == 404:
        return "unknown_cost_centre", None
    if status != 200:
        raise Unavailable("http_%d" % status)
    return "lines", validate_budget(body, cost_centre, year, article)
