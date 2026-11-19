"""The email log: every email the app made, newest first, and a safe preview of the stored HTML.

While the backend is outbox_only this is how admins and testers read emails.
"""
from flask import abort, make_response, render_template, url_for

from ..auth import permission_required
from ..extensions import db
from ..models import MailOutbox, User
from ..mail.layout import LOGO_CID, LOGO_STATIC
from . import bp

LIMIT = 200
# The stored HTML is shown in a sandboxed iframe (srcdoc, no allow-* flags). The page also forbids images, frames
# of other origins, forms and scripts from anywhere but this server. The only image allowed is this server's own
# (the mail logo: cid: URLs do not resolve in a browser, so the preview points them at the static file).
PREVIEW_CSP = ("default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self'; form-action 'none'; "
               "base-uri 'none'; frame-ancestors 'self'")


def preview_html(html):
    """The stored HTML for the preview only: the inline logo becomes the app's own static URL."""
    return (html or "").replace("cid:" + LOGO_CID, url_for("static", filename=LOGO_STATIC))


@bp.get("/outbox")
@permission_required("settings.manage")
def outbox():
    rows = MailOutbox.query.order_by(MailOutbox.id.desc()).limit(LIMIT).all()
    names = {u.id: u.full_name or u.username for u in User.query.filter(User.id.in_({r.to_user_id for r in rows}))} if rows else {}
    return render_template("settings/outbox.html", rows=rows, names=names)


@bp.get("/outbox/<int:mail_id>")
@permission_required("settings.manage")
def outbox_show(mail_id):
    row = db.session.get(MailOutbox, mail_id) or abort(404)
    resp = make_response(render_template("settings/outbox_show.html", row=row, preview=preview_html(row.html)))
    resp.headers["Content-Security-Policy"] = PREVIEW_CSP
    resp.headers["X-Content-Type-Options"] = "nosniff"
    resp.headers["Cache-Control"] = "private, no-store"
    return resp
