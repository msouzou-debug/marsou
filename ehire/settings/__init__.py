"""Master-list settings pages. Rows are deactivated, never deleted. Every change is audited."""
from flask import Blueprint, abort, flash, redirect, render_template, request, url_for
from sqlalchemy.exc import IntegrityError

from ..auth import current_user, permission_required
from ..extensions import db
from ..workflow.numbering import valid_position_code
from ..models import ARCHIVE_SITE_CODES, CATEGORIES, ArchiveDeposit, CostCentre, Directorate, Facility, OaySpecialty, Position, audit

bp = Blueprint("settings", __name__, url_prefix="/settings")

PAGES = ("roles", "users", "holidays", "timings", "outbox", "archive")  # pages built in Phase 4, shown on the index

# kind -> model, fields. A field is (name, widget, editable_after_creation, required).
LISTS = {
    "directorate": (Directorate, [("code", "text", False, True), ("name_el", "text", True, True),
                                  ("name_en", "text", True, True), ("has_sci_director", "check", True, False)]),
    "facility": (Facility, [("directorate_id", "directorate", False, True), ("code", "text", False, True),
                            ("name_el", "text", True, True), ("name_en", "text", True, True),
                            ("archive_site_code", "site", True, False)]),
    "position": (Position, [("category", "category", False, True), ("title_el", "text", True, True),
                            ("title_en", "text", True, True), ("code", "poscode", True, False)]),
    "cost_centre": (CostCentre, [("code", "text", False, True), ("name_el", "text", True, True),
                                 ("name_en", "text", True, True)]),
    "oay_specialty": (OaySpecialty, [("name", "text", True, True)]),
}
# Label key per column.
LABELS = {
    "code": "settings.col.code", "name_el": "settings.col.name_el", "name_en": "settings.col.name_en",
    "title_el": "settings.col.name_el", "title_en": "settings.col.name_en", "name": "settings.col.name_en",
    "has_sci_director": "settings.has_sci_director", "directorate_id": "field.directorate",
    "category": "field.category", "archive_site_code": "settings.col.archive_site",
}
POSITION_LABEL = "settings.col.position_code"  # a position's `code` is the request-number part, not a unique code


def _spec(kind):
    if kind not in LISTS:
        abort(404)
    return LISTS[kind]


def _values(fields, creating):
    """Read posted values. Returns (values, problem): problem is False, True (a required value is missing) or the
    string key of a message (a value that is not allowed)."""
    values, missing = {}, False
    for name, widget, editable, required in fields:
        if not creating and not editable:
            continue
        if widget == "check":
            values[name] = request.form.get(name) == "1"
            continue
        raw = (request.form.get(name) or "").strip()
        if widget == "directorate":
            raw = int(raw) if raw.isdigit() and db.session.get(Directorate, int(raw)) else None
        elif widget == "category" and raw not in CATEGORIES:
            raw = None
        elif widget == "poscode":
            raw = raw.upper() or None
            if raw is not None and not valid_position_code(raw):
                missing = "settings.position_code_invalid"
        elif widget == "site":
            raw = raw.upper() or None
            if raw is not None and raw not in ARCHIVE_SITE_CODES:
                missing = "validation.choose"  # only the twelve codes eArchive knows
        if required and not raw:
            missing = missing or True
        values[name] = raw
    return values, missing


def _snapshot(row, fields):
    return {name: getattr(row, name) for name, *_ in fields} | {"is_active": row.is_active}


def _back(kind):
    return redirect(url_for("settings.show", kind=kind))


@bp.get("")
@permission_required("settings.manage")
def index():
    counts = {k: db.session.query(model).count() for k, (model, _f) in LISTS.items()}
    blocked = ArchiveDeposit.query.filter_by(state="blocked").count()  # the alert: deposits waiting for an administrator
    return render_template("settings/index.html", kinds=list(LISTS), counts=counts, pages=PAGES, blocked=blocked)


@bp.get("/<kind>")
@permission_required("settings.manage")
def show(kind):
    model, fields = _spec(kind)
    rows = db.session.query(model).order_by(model.id).all()
    return render_template(
        "settings/list.html", kind=kind, position_label=POSITION_LABEL, fields=fields, rows=rows, labels=LABELS, categories=CATEGORIES, site_codes=ARCHIVE_SITE_CODES,
        directorates=Directorate.query.order_by(Directorate.id).all(), kinds=list(LISTS),
    )


@bp.post("/<kind>/add")
@permission_required("settings.manage")
def add(kind):
    model, fields = _spec(kind)
    values, missing = _values(fields, creating=True)
    if missing:
        flash(missing if isinstance(missing, str) else "validation.required", "danger")
        return _back(kind)
    row = model(**values)
    db.session.add(row)
    try:
        db.session.flush()
    except IntegrityError:
        db.session.rollback()
        flash("settings.duplicate_code", "danger")
        return _back(kind)
    audit("list_changed", user_id=current_user().id, object_type=kind, object_id=row.id,
          detail={"action": "add", "after": _snapshot(row, fields)})
    db.session.commit()
    flash("settings.saved", "success")
    return _back(kind)


@bp.post("/<kind>/<int:row_id>/edit")
@permission_required("settings.manage")
def edit(kind, row_id):
    model, fields = _spec(kind)
    row = db.session.get(model, row_id) or abort(404)
    values, missing = _values(fields, creating=False)
    if missing:
        flash(missing if isinstance(missing, str) else "validation.required", "danger")
        return _back(kind)
    before = _snapshot(row, fields)
    for k, v in values.items():
        setattr(row, k, v)
    audit("list_changed", user_id=current_user().id, object_type=kind, object_id=row.id,
          detail={"action": "edit", "before": before, "after": _snapshot(row, fields)})
    db.session.commit()
    flash("settings.saved", "success")
    return _back(kind)


@bp.post("/<kind>/<int:row_id>/toggle")
@permission_required("settings.manage")
def toggle(kind, row_id):
    model, fields = _spec(kind)
    row = db.session.get(model, row_id) or abort(404)
    row.is_active = not row.is_active
    audit("list_changed", user_id=current_user().id, object_type=kind, object_id=row.id,
          detail={"action": "activate" if row.is_active else "deactivate"})
    db.session.commit()
    flash("settings.saved", "success")
    return _back(kind)


from . import archive, holidays, import_page, outbox, roles, timings, users  # noqa: E402,F401  Phase 4 pages register on `bp`
