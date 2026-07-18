"""Flask approval + review app. Binds to the internal interface only (§10);
labels in Greek, logs in English (§13). Role separation: this app writes
approval records; ingest/extract runs never do."""

import json
from functools import wraps

from flask import (Flask, abort, flash, g, redirect, render_template, request,
                   session, url_for)

from ..audit import log as audit
from ..common import db
from ..common.config import role_of
from . import engine, notifications


def create_app(settings):
    app = Flask(__name__)
    app.secret_key = settings["server"]["secret_key"]

    def conn():
        if "db" not in g:
            g.db = db.connect(settings)
        return g.db

    @app.teardown_appcontext
    def close_db(exc):
        d = g.pop("db", None)
        if d is not None:
            d.close()

    def user():
        return session.get("user", "")

    def require_login(fn):
        @wraps(fn)
        def wrapper(*a, **kw):
            if not user():
                return redirect(url_for("login", next=request.path))
            return fn(*a, **kw)
        return wrapper

    @app.context_processor
    def inject():
        return {"user": user(), "user_roles": role_of(settings, user())}

    @app.route("/login", methods=["GET", "POST"])
    def login():
        all_users = sorted({u for members in settings["approval"]["users"].values()
                            for u in (members or [])})
        if request.method == "POST":
            email = request.form["email"].strip().lower()
            if not role_of(settings, email):
                flash("Άγνωστος χρήστης — ζητήστε προσθήκη στο settings.yaml")
            else:
                session["user"] = email
                return redirect(request.args.get("next") or url_for("home"))
        return render_template("login.html", all_users=all_users)

    @app.route("/logout")
    def logout():
        session.clear()
        return redirect(url_for("login"))

    @app.route("/")
    @require_login
    def home():
        c = conn()
        my_pending = engine.pending_for_user(c, settings, user())
        review = c.execute(
            "SELECT * FROM invoices WHERE status='needs_review' ORDER BY id DESC").fetchall()
        on_hold = c.execute(
            "SELECT * FROM invoices WHERE status='on_hold' ORDER BY id DESC").fetchall()
        counts = {r["status"]: r["c"] for r in c.execute(
            "SELECT status, COUNT(*) c FROM invoices GROUP BY status")}
        return render_template("home.html", my_pending=my_pending, review=review,
                               on_hold=on_hold, counts=counts)

    @app.route("/invoice/<int:invoice_id>")
    @require_login
    def invoice(invoice_id):
        c = conn()
        inv = c.execute("SELECT * FROM invoices WHERE id=?", (invoice_id,)).fetchone()
        if not inv:
            abort(404)
        lines = c.execute("SELECT * FROM invoice_lines WHERE invoice_id=? ORDER BY line_no",
                          (invoice_id,)).fetchall()
        findings = c.execute("SELECT * FROM findings WHERE invoice_id=? ORDER BY id",
                             (invoice_id,)).fetchall()
        approvals = c.execute("SELECT * FROM approvals WHERE invoice_id=? ORDER BY step, id",
                              (invoice_id,)).fetchall()
        frow = c.execute("SELECT * FROM files WHERE invoice_id=?", (invoice_id,)).fetchone()
        step = engine.current_step(c, invoice_id)
        snapshot = json.loads(inv["chain_snapshot"]) if inv["chain_snapshot"] else None
        can_act = False
        if step and snapshot:
            can_act = user() in [u.strip().lower() for u in snapshot["users"].get(step["role"], [])]
        conf = json.loads(inv["confidence"] or "{}")
        return render_template("invoice.html", inv=inv, lines=lines, findings=findings,
                               approvals=approvals, file=frow, step=step, can_act=can_act,
                               snapshot=snapshot, conf=conf)

    @app.route("/invoice/<int:invoice_id>/act", methods=["POST"])
    @require_login
    def act(invoice_id):
        try:
            inv = engine.act(conn(), invoice_id, user(), request.form["action"],
                             note=request.form.get("note", ""),
                             delegate_to=request.form.get("delegate_to", ""))
            if request.form["action"] == "reject":
                notifications.rejection_notice(conn(), settings, inv, request.form.get("note", ""))
            else:
                nxt = engine.current_step(conn(), invoice_id)
                if nxt is not None:
                    findings = [(f["rule"], f["severity"], f["detail"]) for f in conn().execute(
                        "SELECT * FROM findings WHERE invoice_id=?", (invoice_id,))]
                    inv2 = conn().execute("SELECT * FROM invoices WHERE id=?", (invoice_id,)).fetchone()
                    notifications.approval_request(conn(), settings, inv2, nxt, findings)
            flash("Καταχωρήθηκε")
        except engine.ApprovalError as e:
            flash(str(e))
        return redirect(url_for("invoice", invoice_id=invoice_id))

    @app.route("/invoice/<int:invoice_id>/clear/<int:finding_id>", methods=["POST"])
    @require_login
    def clear_finding(invoice_id, finding_id):
        c = conn()
        f = c.execute("SELECT * FROM findings WHERE id=? AND invoice_id=?",
                      (finding_id, invoice_id)).fetchone()
        if not f:
            abort(404)
        from datetime import datetime, timezone
        c.execute("UPDATE findings SET cleared_by=?, cleared_at=? WHERE id=?",
                  (user(), datetime.now(timezone.utc).isoformat(), finding_id))
        # release the hold once every CRITICAL flag on the invoice is cleared
        open_criticals = c.execute(
            "SELECT COUNT(*) c FROM findings WHERE invoice_id=? AND severity='CRITICAL' AND cleared_by=''",
            (invoice_id,)).fetchone()["c"]
        if open_criticals == 0:
            c.execute("UPDATE invoices SET status='analyzed' WHERE id=? AND status='on_hold'",
                      (invoice_id,))
        c.commit()
        audit.log(c, user(), "finding_cleared", f"invoice={invoice_id} finding={finding_id} "
                  f"rule={f['rule']} remaining_criticals={open_criticals}")
        flash("Η ένδειξη εκκαθαρίστηκε")
        return redirect(url_for("invoice", invoice_id=invoice_id))

    @app.route("/invoice/<int:invoice_id>/reject-file", methods=["POST"])
    @require_login
    def reject_file(invoice_id):
        """Reject an invoice straight from the review queue / CRITICAL hold —
        before it is ever parked or routed (spam, non-invoices, confirmed fraud)."""
        reason = request.form.get("reason", "").strip()
        if not reason:
            flash("Η απόρριψη απαιτεί αιτιολογία")
            return redirect(url_for("invoice", invoice_id=invoice_id))
        c = conn()
        cur = c.execute(
            "UPDATE invoices SET status='rejected', review_reason=? WHERE id=? AND status IN ('needs_review','on_hold')",
            (f"rejected before processing by {user()}: {reason}", invoice_id))
        c.commit()
        if cur.rowcount:
            audit.log(c, user(), "rejected_before_processing",
                      f"invoice={invoice_id} reason={reason}")
            flash("Το τιμολόγιο απορρίφθηκε")
        else:
            flash("Απόρριψη μόνο για τιμολόγια σε έλεγχο ή σε αναμονή")
        return redirect(url_for("invoice", invoice_id=invoice_id))

    @app.route("/invoice/<int:invoice_id>/requeue", methods=["POST"])
    @require_login
    def requeue(invoice_id):
        c = conn()
        c.execute("UPDATE invoices SET status='ingested', review_reason='' WHERE id=? AND status='needs_review'",
                  (invoice_id,))
        c.commit()
        audit.log(c, user(), "requeued", f"invoice={invoice_id}")
        flash("Θα επανεπεξεργαστεί στην επόμενη εκτέλεση")
        return redirect(url_for("invoice", invoice_id=invoice_id))

    return app
