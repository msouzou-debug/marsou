"""The position request form: what applies, how it is read, validated and stored (contract 03, section 3).

Rules about which fields apply live here and nowhere else. Routes and templates ask `applicable()`.
"""
import re
from ehr.extensions import db
from ehr.models import (CATEGORIES, CostCentre, Directorate, Facility, OaySpecialty, Position, REASONS,
                        RequestLeaver, RoleAssignment, UserDirectorate)
from ehr.workflow.route import DEPARTURE_REASONS
from .request_dates import format_date, parse_date

SPECIALTY_CATEGORIES = ("medical", "allied")
EMPLOYMENTS = ("okypy_contract", "civil_servant")
MAX_LEAVER_ROWS = 50
_LEAVER_KEY = re.compile(r"^leavers\[(\d+)\]\.(name|leave_date|employment)$")

TEXT_FIELDS = ("need_text", "alternatives_text", "new_need_origin", "new_need_cover_so_far", "new_need_plan",
               "absence_text", "external_funding_text")
ID_FIELDS = ("directorate_id", "facility_id", "cost_centre_id", "position_id", "oay_specialty_id")
FLAG_FIELDS = ("absence_flag", "external_funding_flag")
ALL_FIELDS = ID_FIELDS + TEXT_FIELDS + FLAG_FIELDS + ("category", "reason", "positions_count")


def applicable(raw):
    """Names of the fields that apply for the typed category, reason and flags."""
    category, reason = raw.get("category"), raw.get("reason")
    names = {"directorate_id", "facility_id", "cost_centre_id", "category", "position_id", "positions_count",
             "reason", "need_text", "alternatives_text", "absence_flag"}
    funded = category in SPECIALTY_CATEGORIES
    if funded:
        names |= {"oay_specialty_id", "external_funding_flag"}
        if raw.get("external_funding_flag") == "yes":
            names.add("external_funding_text")
    if reason in DEPARTURE_REASONS:
        names.add("leavers")
    if reason == "new_need":
        names |= {"new_need_origin", "new_need_cover_so_far"}
        if funded:
            names.add("new_need_plan")
    if raw.get("absence_flag") == "yes":
        names.add("absence_text")
    return names


def empty_raw():
    raw = {name: "" for name in ALL_FIELDS}
    raw["leavers"] = []
    return raw


def read_form(form):
    """Raw typed values from a posted form (strings only, nothing interpreted)."""
    raw = empty_raw()
    for name in ALL_FIELDS:
        raw[name] = (form.get(name) or "").strip()
    rows = {}
    for key in form.keys():
        m = _LEAVER_KEY.match(key)
        if m and int(m.group(1)) < MAX_LEAVER_ROWS:
            rows.setdefault(int(m.group(1)), {})[m.group(2)] = (form.get(key) or "").strip()
    raw["leavers"] = [
        {"name": rows[i].get("name", ""), "leave_date": rows[i].get("leave_date", ""),
         "employment": rows[i].get("employment", "")} for i in sorted(rows)]
    return raw


def raw_from_request(req):
    """Typed-form values for a stored request (edit page)."""
    raw = empty_raw()
    for name in ID_FIELDS + ("category", "reason", "positions_count"):
        value = getattr(req, name)
        raw[name] = "" if value is None else str(value)
    for name in TEXT_FIELDS:
        raw[name] = getattr(req, name) or ""
    for name in FLAG_FIELDS:
        value = getattr(req, name)
        raw[name] = "" if value is None else ("yes" if value else "no")
    raw["leavers"] = [{"name": l.name, "leave_date": format_date(l.leave_date),
                       "employment": l.employment or ""} for l in req.leavers]
    return raw


class Lookups:
    """The lists a requester may choose from, loaded once per request."""

    def __init__(self, user, lang):
        self.lang = lang
        allowed = {r.directorate_id for r in UserDirectorate.query.filter_by(user_id=user.id)}
        for a in RoleAssignment.query.filter((RoleAssignment.user_id == user.id) |
                                             (RoleAssignment.substitute_user_id == user.id)):
            if a.directorate_id is not None and a.is_active_on():
                allowed.add(a.directorate_id)
        directorates = Directorate.query.filter_by(is_active=True).order_by(Directorate.id).all()
        # A user with no Directorate of their own (central roles) may choose any active one.
        self.directorates = [d for d in directorates if d.id in allowed] if allowed else directorates
        self.directorate_ids = {d.id for d in self.directorates}
        self.facilities = Facility.query.filter(Facility.is_active.is_(True),
                                                Facility.directorate_id.in_(self.directorate_ids or {0})).order_by(
            Facility.directorate_id, Facility.id).all()
        self.positions = Position.query.filter_by(is_active=True).order_by(Position.category, Position.id).all()
        self.cost_centres = CostCentre.query.filter_by(is_active=True).order_by(CostCentre.code).all()
        self.specialties = OaySpecialty.query.filter_by(is_active=True).order_by(OaySpecialty.name).all()
        self.facility_dir = {f.id: f.directorate_id for f in self.facilities}
        self.position_cat = {p.id: p.category for p in self.positions}
        self.cost_centre_ids = {c.id for c in self.cost_centres}
        self.specialty_ids = {s.id for s in self.specialties}

    def facility_options(self, directorate_id):
        """[(id, label, group)] filtered by Directorate; grouped by Directorate when none is chosen."""
        names = {d.id: d.name(self.lang) for d in self.directorates}
        out = []
        for f in self.facilities:
            if directorate_id is None:
                out.append((f.id, f.name(self.lang), names.get(f.directorate_id)))
            elif f.directorate_id == directorate_id:
                out.append((f.id, f.name(self.lang), None))
        return out

    def position_options(self, category):
        out = []
        for p in self.positions:
            if category is None:
                out.append((p.id, p.name(self.lang), p.category))
            elif p.category == category:
                out.append((p.id, p.name(self.lang), None))
        return out


def _int(text):
    try:
        return int(text)
    except (TypeError, ValueError):
        return None


def validate(raw, lookups, submit):
    """Return {field: message_key}. Draft: formats and choices only. Submit: everything that applies."""
    errors = {}
    names = applicable(raw)

    def required(name, key="validation.required"):
        if name in names and not raw.get(name):
            errors[name] = key

    # choices must be valid whenever something is typed
    if raw["category"] and raw["category"] not in CATEGORIES:
        errors["category"] = "validation.choose"
    if raw["reason"] and raw["reason"] not in REASONS:
        errors["reason"] = "validation.choose"
    d_id = _int(raw["directorate_id"])
    if raw["directorate_id"] and d_id not in lookups.directorate_ids:
        errors["directorate_id"] = "validation.choose"
    f_id = _int(raw["facility_id"])
    if raw["facility_id"] and (f_id not in lookups.facility_dir or
                               (d_id is not None and lookups.facility_dir[f_id] != d_id)):
        errors["facility_id"] = "validation.choose"
    p_id = _int(raw["position_id"])
    if raw["position_id"] and (p_id not in lookups.position_cat or
                               (raw["category"] in CATEGORIES and lookups.position_cat[p_id] != raw["category"])):
        errors["position_id"] = "validation.choose"
    if raw["cost_centre_id"] and _int(raw["cost_centre_id"]) not in lookups.cost_centre_ids:
        errors["cost_centre_id"] = "validation.choose"
    if "oay_specialty_id" in names and raw["oay_specialty_id"] and \
            _int(raw["oay_specialty_id"]) not in lookups.specialty_ids:
        errors["oay_specialty_id"] = "validation.choose"
    if raw["positions_count"]:
        count = _int(raw["positions_count"])
        if count is None or count < 1:
            errors["positions_count"] = "validation.min_one"
    for flag in FLAG_FIELDS:
        if flag in names and raw[flag] not in ("", "yes", "no"):
            errors[flag] = "validation.choose"

    # leavers: formats always, counts on submit
    if "leavers" in names:
        rows = raw["leavers"]
        count = _int(raw["positions_count"])
        for i, row in enumerate(rows):
            if row["leave_date"]:
                try:
                    parse_date(row["leave_date"])
                except ValueError:
                    errors["leavers[%d].leave_date" % i] = "validation.date"
            if row["employment"] and row["employment"] not in EMPLOYMENTS:
                errors["leavers[%d].employment" % i] = "validation.choose"
            if submit:
                if not row["name"]:
                    errors["leavers[%d].name" % i] = "validation.required"
                if not row["leave_date"]:
                    errors["leavers[%d].leave_date" % i] = "validation.required"
                if not row["employment"]:
                    errors["leavers[%d].employment" % i] = "validation.required"
        if count is not None and count >= 1 and len(rows) > count:
            errors["leavers"] = "validation.leavers_max"
        elif submit and not rows:
            errors["leavers"] = "validation.required"

    if submit:
        required("directorate_id", "validation.choose")
        required("facility_id", "validation.choose")
        required("cost_centre_id", "validation.choose")
        required("category", "validation.choose")
        required("position_id", "validation.choose")
        required("oay_specialty_id", "validation.choose")
        required("reason", "validation.choose")
        required("positions_count", "validation.min_one")
        for name in ("need_text", "alternatives_text", "new_need_origin", "new_need_cover_so_far",
                     "new_need_plan", "absence_text", "external_funding_text"):
            required(name)
        for flag in FLAG_FIELDS:
            required(flag, "validation.choose")
        for name in list(errors):
            if name not in names and not name.startswith("leavers"):
                errors.pop(name)
    return errors


def store(req, raw):
    """Copy applicable fields onto the request and replace its leavers. Inapplicable fields are cleared."""
    names = applicable(raw)
    for name in ID_FIELDS + ("category", "reason", "positions_count"):
        value = raw.get(name) if name in names else ""
        if name in ID_FIELDS or name == "positions_count":
            value = _int(value) if value else None
        setattr(req, name, value or None)
    for name in TEXT_FIELDS:
        setattr(req, name, raw[name] if name in names and raw[name] else None)
    for name in FLAG_FIELDS:
        setattr(req, name, None if name not in names or not raw[name] else raw[name] == "yes")
    for leaver in list(req.leavers):
        db.session.delete(leaver)
    req.leavers = []
    if "leavers" in names:
        for row in raw["leavers"]:
            when = None
            if row["leave_date"]:
                try:
                    when = parse_date(row["leave_date"])
                except ValueError:
                    when = None
            req.leavers.append(RequestLeaver(name=row["name"], leave_date=when,
                                             employment=row["employment"] or None, round=req.round or 1))


def drop_blank_leavers(raw):
    raw["leavers"] = [r for r in raw["leavers"] if r["name"] or r["leave_date"] or r["employment"]]
