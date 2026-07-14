"""Flask review app — queue, side-by-side group view, four-eyes approvals,
worklists, whitelist, exports. Runs on-prem behind waitress; identity is the
user's AD email chosen at login and checked against config/settings.yaml roles.
"""

from functools import wraps

from flask import (Flask, abort, flash, g, redirect, render_template, request,
                   session, url_for)

from . import db, detect, exports, load, workflow
from .config import role_of


def create_app(settings):
    app = Flask(__name__)
    app.secret_key = settings["server"]["secret_key"]
    app.config["SETTINGS"] = settings

    def conn():
        if "db" not in g:
            g.db = db.connect(settings)
        return g.db

    @app.teardown_appcontext
    def close_db(exc):
        d = g.pop("db", None)
        if d is not None:
            d.close()

    def current_user():
        return session.get("user", "")

    def roles():
        return role_of(settings, current_user())

    def require_role(*needed):
        def deco(fn):
            @wraps(fn)
            def wrapper(*a, **kw):
                if not current_user():
                    return redirect(url_for("login", next=request.path))
                if needed and not (set(needed) & set(roles())):
                    abort(403)
                return fn(*a, **kw)
            return wrapper
        return deco

    @app.context_processor
    def inject():
        return {"user": current_user(), "user_roles": roles()}

    # ---- auth -------------------------------------------------------------
    @app.route("/login", methods=["GET", "POST"])
    def login():
        all_users = sorted(
            {e for members in settings["roles"].values() for e in (members or [])}
        )
        if request.method == "POST":
            email = request.form["email"].strip().lower()
            if not role_of(settings, email):
                flash("Unknown user — ask an admin to add you to config/settings.yaml")
            else:
                session["user"] = email
                return redirect(request.args.get("next") or url_for("queue"))
        return render_template("login.html", all_users=all_users)

    @app.route("/logout")
    def logout():
        session.clear()
        return redirect(url_for("login"))

    # ---- queue + group view ------------------------------------------------
    @app.route("/")
    @require_role("reviewer", "approver")
    def queue():
        status = request.args.get("status", "open")
        c = conn()
        groups = c.execute(
            """SELECT g.*, COUNT(m.supplier) AS n_members
               FROM groups g JOIN group_members m ON m.group_id = g.id
               WHERE g.status = ? GROUP BY g.id ORDER BY g.score DESC, g.id""",
            (status,),
        ).fetchall()
        vmap = {v["supplier"]: v for v in db.current_vendors(c)}
        previews = {
            gr["id"]: [
                (s, (vmap.get(s) or {"name": "?"})["name"])
                for s in [r["supplier"] for r in c.execute(
                    "SELECT supplier FROM group_members WHERE group_id=? ORDER BY supplier LIMIT 4",
                    (gr["id"],))]
            ]
            for gr in groups
        }
        counts = {r["status"]: r["c"] for r in c.execute(
            "SELECT status, COUNT(*) c FROM groups GROUP BY status")}
        return render_template("queue.html", groups=groups, previews=previews,
                               status=status, counts=counts)

    @app.route("/group/<int:group_id>")
    @require_role("reviewer", "approver")
    def group_view(group_id):
        c = conn()
        gr = c.execute("SELECT * FROM groups WHERE id=?", (group_id,)).fetchone()
        if not gr:
            abort(404)
        members = [r["supplier"] for r in c.execute(
            "SELECT supplier FROM group_members WHERE group_id=? ORDER BY supplier", (group_id,))]
        vmap = {v["supplier"]: v for v in db.current_vendors(c)}
        vendors = [vmap.get(s) for s in members]
        edges = c.execute("SELECT * FROM group_edges WHERE group_id=?", (group_id,)).fetchall()
        proposal = detect.propose_survivor(
            [s for s in members if s in vmap], vmap) if any(s in vmap for s in members) else ""
        open_items = {s: load.open_items_for(c, s) for s in members}
        decisions = c.execute(
            "SELECT * FROM decisions WHERE group_id=? ORDER BY id DESC", (group_id,)).fetchall()
        return render_template("group.html", gr=gr, members=members, vendors=vendors,
                               edges=edges, proposal=proposal, open_items=open_items,
                               decisions=decisions)

    @app.route("/group/<int:group_id>/decide", methods=["POST"])
    @require_role("reviewer")
    def decide(group_id):
        action = request.form["action"]
        try:
            workflow.record_decision(
                conn(), group_id, action, current_user(),
                survivor=request.form.get("survivor", ""),
                reason=request.form.get("reason", ""),
            )
            if action == "not_duplicate" and request.form.get("whitelist_iban"):
                workflow.add_whitelist(conn(), "iban", request.form["whitelist_iban"],
                                       request.form.get("reason", ""), current_user())
            flash(f"Recorded: {action}")
        except workflow.WorkflowError as e:
            flash(str(e))
        return redirect(url_for("group_view", group_id=group_id))

    @app.route("/group/<int:group_id>/unmerge", methods=["POST"])
    @require_role("approver")
    def unmerge_group(group_id):
        try:
            workflow.unmerge(conn(), group_id, current_user(),
                             reason=request.form.get("reason", ""))
            flash("Merge reversed — group reopened, mapping and BLOCK actions withdrawn")
        except workflow.WorkflowError as e:
            flash(str(e))
        return redirect(url_for("group_view", group_id=group_id))

    # ---- approvals ----------------------------------------------------------
    @app.route("/approvals")
    @require_role("approver")
    def approvals():
        c = conn()
        pending = c.execute(
            """SELECT d.*, g.score, g.rules FROM decisions d JOIN groups g ON g.id=d.group_id
               WHERE d.status='pending' ORDER BY d.id""").fetchall()
        wl_pending = c.execute(
            "SELECT * FROM worklist_items WHERE status='pending_approval' ORDER BY id").fetchall()
        return render_template("approvals.html", pending=pending, wl_pending=wl_pending)

    @app.route("/approvals/<int:decision_id>", methods=["POST"])
    @require_role("approver")
    def approve(decision_id):
        try:
            workflow.approve_decision(conn(), decision_id, current_user(),
                                      approve=request.form["verdict"] == "approve",
                                      reason=request.form.get("reason", ""))
            flash("Decision " + ("approved" if request.form["verdict"] == "approve" else "rejected"))
        except workflow.WorkflowError as e:
            flash(str(e))
        return redirect(url_for("approvals"))

    @app.route("/approvals/worklist/<int:item_id>", methods=["POST"])
    @require_role("approver")
    def approve_worklist(item_id):
        try:
            workflow.worklist_approve(conn(), item_id, current_user(),
                                      approve=request.form["verdict"] == "approve")
            flash("Worklist item " + ("approved" if request.form["verdict"] == "approve" else "sent back"))
        except workflow.WorkflowError as e:
            flash(str(e))
        return redirect(url_for("approvals"))

    # ---- worklists -----------------------------------------------------------
    @app.route("/worklists")
    @require_role("reviewer", "approver")
    def worklists():
        kind = request.args.get("kind", "no_iban")
        c = conn()
        items = c.execute(
            "SELECT * FROM worklist_items WHERE kind=? AND status IN ('open','pending_approval') ORDER BY supplier",
            (kind,)).fetchall()
        vmap = {v["supplier"]: v for v in db.current_vendors(c)}
        counts = {r["kind"]: r["c"] for r in c.execute(
            "SELECT kind, COUNT(*) c FROM worklist_items WHERE status IN ('open','pending_approval') GROUP BY kind")}
        return render_template("worklists.html", items=items, kind=kind, vmap=vmap, counts=counts)

    @app.route("/worklists/<int:item_id>/decide", methods=["POST"])
    @require_role("reviewer")
    def worklist_decide(item_id):
        try:
            workflow.worklist_decide(conn(), item_id, request.form["action"],
                                     current_user(), reason=request.form.get("reason", ""))
            flash("Recorded")
        except workflow.WorkflowError as e:
            flash(str(e))
        return redirect(url_for("worklists", kind=request.form.get("kind", "no_iban")))

    # ---- whitelist -----------------------------------------------------------
    @app.route("/whitelist", methods=["GET", "POST"])
    @require_role("reviewer", "approver")
    def whitelist():
        c = conn()
        if request.method == "POST":
            try:
                workflow.add_whitelist(c, request.form["kind"], request.form["value"].strip(),
                                       request.form["reason"], current_user())
                flash("Whitelist entry added — takes effect on the next import")
            except workflow.WorkflowError as e:
                flash(str(e))
            return redirect(url_for("whitelist"))
        entries = c.execute("SELECT * FROM whitelist ORDER BY id DESC").fetchall()
        return render_template("whitelist.html", entries=entries)

    # ---- exports ---------------------------------------------------------------
    @app.route("/exports", methods=["GET", "POST"])
    @require_role("reviewer", "approver")
    def exports_view():
        c = conn()
        paths = None
        if request.method == "POST":
            paths = exports.write_all(c, settings, actor=current_user())
            flash("All four outputs written to output/")
        stats = exports.progress_stats(c)
        return render_template("exports.html", stats=stats, paths=paths,
                               out_dir=settings["paths"]["output_dir"])

    return app
