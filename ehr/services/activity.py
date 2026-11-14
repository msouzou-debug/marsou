"""Where the step 2 activity figures come from (setting `activity_provider`).

`manual`: the Directorate Accountant types every line (ManualEntryProvider).
`efinance`: visits, procedures and revenue arrive from eFinance (EFinanceActivityProvider) and show read-only;
the server takes its own copy of the figures, never the posted values. When eFinance has no figures or can't be
reached, the card falls back to typing and the stored row says so.

The figures a page showed are held in a small server-side cache (request and specialty, ten minutes), so the post
uses what the user saw and a user cannot change them.
"""
import json
import threading
import time
from datetime import date, datetime, timezone
from decimal import Decimal

from flask import current_app

from ehr.models import get_setting

from .activity_efinance import EFinanceClient

PERIODS = ("prev_year", "ytd")
LINES = ("visits", "procedures", "revenue", "payroll_cost", "headcount")
PROVIDED = frozenset({"visits", "procedures", "revenue"})
PROVIDERS = ("manual", "efinance")
CACHE_SECONDS = 600
FAILURE_CACHE_SECONDS = 30


class Outcome:
    """What a provider answered for one request and specialty."""

    def __init__(self, status, figures=None, reason=None, snapshot=None, request_id=None, specialty_id=None):
        self.status = status  # figures | no_data | unavailable
        self.figures = figures  # {'data_month': 'YYYY-MM', 'prev_year': {...}, 'ytd': {...}}
        self.reason = reason
        self.snapshot = snapshot  # dict stored in request_financials.source_snapshot_json
        self.request_id = request_id
        self.specialty_id = specialty_id

    @property
    def ok(self):
        return self.status == "figures"

    @property
    def data_month(self):
        return date(int(self.figures["data_month"][:4]), int(self.figures["data_month"][5:7]), 1)


class ActivityProvider:
    """Interface. A provider names the lines it fills and answers for one request and specialty."""

    name = "manual"
    source = "manual"
    provided_lines = frozenset()  # lines shown read-only in the card

    def is_read_only(self, line):
        return line in self.provided_lines

    def lookup(self, req, specialty):
        return None


class ManualEntryProvider(ActivityProvider):
    """All five lines and the data month are typed."""


class EFinanceActivityProvider(ActivityProvider):
    name = "efinance"
    source = "provider"
    provided_lines = PROVIDED

    def __init__(self, client):
        self.client = client

    def lookup(self, req, specialty):
        code = req.facility.code if req.facility is not None else ""
        names = [specialty.name]
        try:
            extra = json.loads(specialty.aliases_json) if specialty.aliases_json else []
        except ValueError:
            extra = []
        names += [a for a in extra if isinstance(a, str) and a.strip() and a not in names]
        status, value, matched = self.client.fetch(code, names)
        stamp = datetime.now(timezone.utc).isoformat(timespec="seconds")
        ask = {"facility_code": code, "specialty": matched or specialty.name}
        if status == "figures":
            snap = {"source": "efinance", "fetched_at": stamp, "request": ask, "response": _jsonable(value, ask)}
            return Outcome("figures", figures=value, snapshot=snap, request_id=req.id, specialty_id=specialty.id)
        reason = value if status == "unavailable" else "no_data"
        snap = {"source": "manual", "provider": "efinance", "reason": reason, "fetched_at": stamp,
                "request": {"facility_code": code, "specialty": specialty.name, "tried": names}}
        return Outcome(status, reason=reason, snapshot=snap, request_id=req.id, specialty_id=specialty.id)


def _jsonable(figures, ask):
    out = dict(ask)
    out["data_month"] = figures["data_month"]
    for period in PERIODS:
        p = figures[period]
        out[period] = {"year": p["year"], "visits": p["visits"], "procedures": p["procedures"],
                       "revenue": str(p["revenue"])}
    return out


# ---------------------------------------------------------------- settings and provider choice

def link_configured():
    return _client().configured()


def _client():
    cfg = current_app.config
    return EFinanceClient(cfg.get("EHR_EFINANCE_URL", ""), cfg.get("EHR_EFINANCE_TOKEN", ""),
                          cfg.get("EHR_EFINANCE_TIMEOUT", 5), cfg.get("EHR_EFINANCE_CA_FILE", ""))


def chosen_provider_name():
    value = get_setting("activity_provider", "manual")
    return value if value in PROVIDERS else "manual"


def get_provider():
    """The provider the setting asks for. `efinance` without a configured link behaves as `manual`."""
    if chosen_provider_name() == "efinance":
        client = _client()
        if client.configured():
            return EFinanceActivityProvider(client)
    return ManualEntryProvider()


# ---------------------------------------------------------------- cache of what the page showed

_cache = {}
_lock = threading.Lock()


def clear_cache():
    with _lock:
        _cache.clear()


def lookup(req, specialty, provider=None, force=False):
    """Outcome for this request and specialty. Cached for a few minutes; `force` asks again (refresh button)."""
    provider = provider or get_provider()
    key = (req.id, specialty.id)
    now = time.monotonic()
    if not force:
        with _lock:
            hit = _cache.get(key)
        if hit and hit[0] > now:
            return hit[1]
    outcome = provider.lookup(req, specialty)
    ttl = CACHE_SECONDS if outcome.status != "unavailable" else FAILURE_CACHE_SECONDS
    with _lock:
        if len(_cache) > 500:
            for k in [k for k, v in _cache.items() if v[0] <= now]:
                del _cache[k]
        _cache[key] = (now + ttl, outcome)
    return outcome


# ---------------------------------------------------------------- the accountant card

def _fmt_whole(value):
    from .request_amounts import format_whole
    return format_whole(value)


def card_view(req, typed, force=False):
    """(typed, fin) for the accountant card.

    `typed` is what the form holds (a failed post, or a refresh). With the efinance provider and figures, the three
    provider lines and the data month in `typed` are replaced by the figures. `fin` tells the template what to say.
    """
    from .request_amounts import format_amount, format_month
    from ehr.models import OaySpecialty
    typed = typed.to_dict() if hasattr(typed, "to_dict") else dict(typed or {})
    provider = get_provider()
    fin = {"enabled": provider.name == "efinance", "readonly": False, "notice": None, "month": ""}
    if not fin["enabled"]:
        return typed, fin
    chosen = (typed.get("oay_specialty_id") or "").strip() or (str(req.oay_specialty_id) if req.oay_specialty_id else "")
    specialty = None
    if chosen.isdigit():
        specialty = OaySpecialty.query.filter_by(id=int(chosen), is_active=True).first()
    if specialty is not None:
        typed["oay_specialty_id"] = str(specialty.id)
    if specialty is None:
        fin["readonly"] = True  # figures come once a specialty is chosen
        return typed, fin
    outcome = lookup(req, specialty, provider, force)
    if not outcome.ok:
        fin["notice"] = "card.fin.no_data" if outcome.status == "no_data" else "card.fin.unavailable"
        if force:  # a new specialty: the lines from the last one must not stay behind as typed values
            for period in PERIODS:
                for line in PROVIDED:
                    typed.pop("fin.%s.%s" % (period, line), None)
            typed.pop("oay_data_month", None)
        return typed, fin
    fin["readonly"] = True
    month = outcome.data_month
    fin["month"] = format_month(month)
    for period in PERIODS:
        p = outcome.figures[period]
        typed["fin.%s.visits" % period] = _fmt_whole(p["visits"])
        typed["fin.%s.procedures" % period] = _fmt_whole(p["procedures"])
        typed["fin.%s.revenue" % period] = format_amount(Decimal(p["revenue"]))
    typed["oay_data_month"] = fin["month"]
    if not (typed.get("payroll_to_month") or "").strip():
        typed["payroll_to_month"] = fin["month"]
    return typed, fin
