"""POST /me/out-of-office: a holder of an approver role switches out of office on or off (contract 03, section 1)."""
from datetime import datetime, timezone

from flask import Blueprint, abort, redirect, request, url_for

from ..auth import current_user, login_required
from ..extensions import db
from ..models import User
from ..services import out_of_office as ooo
from ..services.request_dates import parse_date
from ..services.request_flash import flash_key

bp = Blueprint("me", __name__, url_prefix="/me")


def _date(name):
    raw = (request.form.get(name) or "").strip()
    return parse_date(raw) if raw else None


@bp.post("/out-of-office")
@login_required
def out_of_office():
    user = current_user()
    if not ooo.is_approver(user):
        abort(404)
    back = redirect(url_for("requests.index"))
    if (request.form.get("state") or "") != "on":
        ooo.switch_off(user)
        flash_key("ooo.saved_off", "success")
        return back
    try:
        date_from, date_to = _date("date_from"), _date("date_to")
    except ValueError:
        flash_key("validation.date", "danger")
        return back
    if date_from and date_to and date_to < date_from:
        flash_key("ooo.invalid_dates", "danger")
        return back
    if not ooo.substitutes_of(user):
        flash_key("ooo.no_substitute", "danger")
        return back
    moved = ooo.switch_on(user, date_from, date_to, datetime.now(timezone.utc))
    flash_key("ooo.saved_on", "success")
    targets = []
    for _task, to in moved:
        if to is not None:
            name = db.session.get(User, to).full_name
            if name not in targets:
                targets.append(name)
    count = sum(1 for _t, to in moved if to is not None)
    if count:
        flash_key("ooo.moved.one" if count == 1 else "ooo.moved.many", "info", n=count, who=", ".join(targets))
    return back
