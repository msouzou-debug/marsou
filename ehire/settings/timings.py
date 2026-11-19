"""Times and limits: whole numbers of 1 or more. Escalation must come after the reminder."""
from datetime import datetime, timezone

from flask import flash, redirect, render_template, request, url_for

from ..auth import current_user, permission_required
from ..extensions import db
from ..models import Setting, audit, get_setting
from ..services import activity
from ..services.request_flash import flash_key
from . import bp

KEYS = (("reminder_days", 2), ("escalation_days", 5), ("returned_timeout_days", 30), ("max_file_mb", 20))


def _current():
    return {key: get_setting(key, default) for key, default in KEYS}


def _provider_context(chosen=None):
    return {"provider": chosen or activity.chosen_provider_name(), "link_configured": activity.link_configured()}


def _whole(text):
    text = (text or "").strip()
    return int(text) if text.isdigit() and int(text) >= 1 else None


@bp.route("/timings", methods=["GET", "POST"])
@permission_required("settings.manage")
def timings():
    if request.method == "GET":
        return render_template("settings/timings.html", values=_current(), errors={}, keys=[k for k, _d in KEYS],
                               **_provider_context())
    typed, errors = {}, {}
    for key, _default in KEYS:
        typed[key] = (request.form.get(key) or "").strip()
        if _whole(typed[key]) is None:
            errors[key] = "settings.number_invalid"
    chosen = (request.form.get("activity_provider") or "").strip() or None  # absent: leave the setting alone
    if chosen is not None and chosen not in activity.PROVIDERS:
        errors["activity_provider"] = "validation.choose"
    elif chosen == "efinance" and not activity.link_configured():
        errors["activity_provider"] = "settings.activity_provider.not_configured"
    if not errors and _whole(typed["escalation_days"]) <= _whole(typed["reminder_days"]):
        errors["escalation_days"] = "settings.escalation_order"
    if errors:
        return render_template("settings/timings.html", values=typed, errors=errors, keys=[k for k, _d in KEYS],
                               **_provider_context(chosen or activity.chosen_provider_name())), 400
    before, me = _current(), current_user().id
    for key, _default in KEYS:
        value = str(_whole(typed[key]))
        if str(before[key]) == value:
            continue
        row = db.session.get(Setting, key)
        if row is None:
            row = Setting(key=key)
            db.session.add(row)
        row.value, row.updated_by, row.updated_at = value, me, datetime.now(timezone.utc)
        audit("setting_changed", user_id=me, object_type="setting", object_id=key,
              detail={"before": before[key], "after": value})
    if chosen is not None and chosen != activity.chosen_provider_name():
        row = db.session.get(Setting, "activity_provider")
        if row is None:
            row = Setting(key="activity_provider")
            db.session.add(row)
        audit("setting_changed", user_id=me, object_type="setting", object_id="activity_provider",
              detail={"before": activity.chosen_provider_name(), "after": chosen})
        row.value, row.updated_by, row.updated_at = chosen, me, datetime.now(timezone.utc)
    db.session.commit()
    flash("settings.saved", "success")
    return redirect(url_for("settings.timings"))
