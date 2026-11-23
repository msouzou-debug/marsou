"""Cost centres follow eFinance (contract 07, section 1). `sync()` is what the nightly `flask sync-cost-centres` and the
"Sync now" button in Settings both run.

One transaction and one audit row (`list_changed`, source `efinance_sync`) for an applied list. Rows are switched
off, never deleted. A code starting with `T-` (test data typed in eHire) is left alone when eFinance does not list it.
Safety stop: an answer with no rows, or with fewer than half the active cost centres eHire has, changes nothing.
The last run is kept in two settings rows (`efinance_sync_last`, `efinance_cc_etag`), so no migration is needed.
"""
import json
import logging
from dataclasses import dataclass, field

from ehire.extensions import db
from ehire.models import CostCentre, Directorate, Setting, audit, get_setting
from ehire.models.access import utcnow

from . import efinance_link
from .activity_efinance import Unavailable

log = logging.getLogger("ehire.efinance")

LAST_KEY = "efinance_sync_last"
ETAG_KEY = "efinance_cc_etag"
TEST_PREFIX = "T-"
CODES_CAP = 40  # changed codes kept per kind in the audit row; the rest are counted
KINDS = ("added", "updated", "deactivated", "reactivated")


@dataclass
class SyncResult:
    ok: bool
    outcome: str  # changed | unchanged | failed | off
    reason: str = None  # failed: safety_stop, empty, timeout, http_401, bad_json, not_configured...
    counts: dict = field(default_factory=lambda: {k: 0 for k in KINDS})
    codes: dict = field(default_factory=lambda: {k: [] for k in KINDS})
    unknown_entities: list = field(default_factory=list)
    total: int = 0

    def line(self):
        """One line for the cron log. Never holds a token or a name."""
        if self.outcome == "off":
            return "skipped: efinance_link=none"
        if not self.ok:
            return "failed: %s (nothing changed)" % self.reason
        text = "%s: added=%d updated=%d deactivated=%d reactivated=%d total=%d" % (
            self.outcome, self.counts["added"], self.counts["updated"], self.counts["deactivated"],
            self.counts["reactivated"], self.total)
        if self.unknown_entities:
            text += " unknown_entities=%s" % ",".join(self.unknown_entities)
        return text


def _set(key, value):
    row = db.session.get(Setting, key)
    if row is None:
        row = Setting(key=key)
        db.session.add(row)
    row.value, row.updated_at = value, utcnow()


def forget_etag():
    """Called when a cost centre is changed by hand: the next sync then reads the whole list and sets it back."""
    row = db.session.get(Setting, ETAG_KEY)
    if row is not None and row.value:
        row.value = None


def last_run():
    """{'at': ISO UTC, 'ok', 'outcome', 'reason', 'counts', 'unknown_entities'} or None."""
    try:
        value = json.loads(get_setting(LAST_KEY, "") or "null")
    except ValueError:
        return None
    return value if isinstance(value, dict) else None


def _record(result):
    _set(LAST_KEY, json.dumps({"at": utcnow().strftime("%Y-%m-%dT%H:%M:%SZ"), "ok": result.ok,
                               "outcome": result.outcome, "reason": result.reason, "counts": result.counts,
                               "unknown_entities": result.unknown_entities[:20], "total": result.total},
                              sort_keys=True))


def _fail(reason):
    db.session.rollback()
    result = SyncResult(ok=False, outcome="failed", reason=reason)
    log.warning("cost-centre sync failed: %s", reason)
    _record(result)
    db.session.commit()
    return result


def _directorates():
    return {(d.code or "").strip().upper(): d.id for d in Directorate.query.all()}


def sync(user_id=None):
    """Run one sync. Returns a SyncResult; never raises for an eFinance problem."""
    if not efinance_link.is_on():
        return SyncResult(ok=True, outcome="off")
    etag = get_setting(ETAG_KEY, "") or None
    try:
        kind, new_etag, answer = efinance_link.fetch_cost_centres(etag)
    except Unavailable as exc:
        return _fail(exc.reason)
    if kind == "unchanged":
        result = SyncResult(ok=True, outcome="unchanged", total=CostCentre.query.filter_by(is_active=True).count())
        _record(result)
        db.session.commit()
        return result

    rows = answer["rows"]
    active_here = CostCentre.query.filter(CostCentre.is_active.is_(True),
                                          ~CostCentre.code.startswith(TEST_PREFIX)).count()
    active_there = sum(1 for r in rows if r["active"])
    if not rows:
        return _fail("empty")
    if active_there * 2 < active_here:
        return _fail("safety_stop")

    result = SyncResult(ok=True, outcome="unchanged", total=len(rows))
    by_code = {c.code: c for c in CostCentre.query.all()}
    directorates = _directorates()
    unknown = set()

    def note(kind_, code):
        result.counts[kind_] += 1
        if len(result.codes[kind_]) < CODES_CAP:
            result.codes[kind_].append(code)

    listed = set()
    for r in rows:
        listed.add(r["code"])
        entity = (r["entity_code"] or "").strip().upper()
        directorate_id = directorates.get(entity) if entity else None
        if entity and directorate_id is None:
            unknown.add(entity)
        name_en = r["name_en"] or r["name_el"]  # eHire needs an English name; eFinance may have none
        row = by_code.get(r["code"])
        if row is None:
            db.session.add(CostCentre(code=r["code"], name_el=r["name_el"], name_en=name_en, is_active=r["active"],
                                      directorate_id=directorate_id))
            note("added", r["code"])
            continue
        changed = (row.name_el, row.name_en, row.directorate_id) != (r["name_el"], name_en, directorate_id)
        row.name_el, row.name_en, row.directorate_id = r["name_el"], name_en, directorate_id
        if row.is_active != r["active"]:
            row.is_active = r["active"]
            note("reactivated" if r["active"] else "deactivated", r["code"])
        elif changed:
            note("updated", r["code"])
    for code, row in by_code.items():
        if code not in listed and row.is_active and not code.startswith(TEST_PREFIX):
            row.is_active = False  # missing from eFinance: switched off, never deleted
            note("deactivated", code)

    result.unknown_entities = sorted(unknown)
    if any(result.counts.values()):
        result.outcome = "changed"
        more = {k: result.counts[k] - len(result.codes[k]) for k in KINDS if result.counts[k] > len(result.codes[k])}
        detail = {"source": "efinance_sync", "action": "sync", "counts": result.counts, "codes": result.codes,
                  "unknown_entities": result.unknown_entities[:20]}
        if more:
            detail["codes_not_listed"] = more
        if answer["as_of"] is not None:
            detail["as_of"] = answer["as_of"].strftime("%Y-%m-%dT%H:%M:%SZ")
        audit("list_changed", user_id=user_id, object_type="cost_centre", object_id="efinance_sync", detail=detail)
    _set(ETAG_KEY, new_etag)
    _record(result)
    try:
        db.session.commit()
    except Exception:
        db.session.rollback()
        log.exception("cost-centre sync could not be stored")
        return _fail("store_failed")
    return result
