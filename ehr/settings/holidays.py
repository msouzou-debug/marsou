"""Public holidays. Working days for reminders, escalation and the returned-request timeout come from this table."""
from datetime import date

from flask import abort, flash, redirect, render_template, request, url_for
from sqlalchemy import extract

from ..auth import current_user, permission_required
from ..extensions import db
from ..models import PublicHoliday, audit
from ..services.request_dates import parse_date
from . import bp


@bp.get("/holidays")
@permission_required("settings.manage")
def holidays():
    years = sorted({h.date.year for h in PublicHoliday.query.all()} | {date.today().year}, reverse=True)
    year = request.args.get("year", type=int) or date.today().year
    rows = (PublicHoliday.query.filter(extract("year", PublicHoliday.date) == year)
            .order_by(PublicHoliday.date).all())
    return render_template("settings/holidays.html", rows=rows, years=years, year=year)


@bp.post("/holidays/add")
@permission_required("settings.manage")
def holidays_add():
    name_el, name_en = (request.form.get("name_el") or "").strip(), (request.form.get("name_en") or "").strip()
    try:
        day = parse_date(request.form.get("date"))
    except ValueError:
        flash("validation.date", "danger")
        return redirect(url_for("settings.holidays"))
    back = redirect(url_for("settings.holidays", year=day.year))
    if not name_el or not name_en:
        flash("validation.required", "danger")
        return back
    if db.session.get(PublicHoliday, day) is not None:
        flash("settings.holiday_duplicate", "danger")
        return back
    db.session.add(PublicHoliday(date=day, name_el=name_el, name_en=name_en))
    audit("setting_changed", user_id=current_user().id, object_type="public_holiday", object_id=day.isoformat(),
          detail={"action": "add", "date": day, "name_el": name_el, "name_en": name_en})
    db.session.commit()
    flash("settings.saved", "success")
    return back


@bp.post("/holidays/<day>/remove")
@permission_required("settings.manage")
def holidays_remove(day):
    try:
        key = date.fromisoformat(day)
    except ValueError:
        abort(404)
    row = db.session.get(PublicHoliday, key) or abort(404)
    audit("setting_changed", user_id=current_user().id, object_type="public_holiday", object_id=day,
          detail={"action": "remove", "date": key, "name_el": row.name_el, "name_en": row.name_en})
    db.session.delete(row)
    db.session.commit()
    flash("settings.saved", "success")
    return redirect(url_for("settings.holidays", year=key.year))
