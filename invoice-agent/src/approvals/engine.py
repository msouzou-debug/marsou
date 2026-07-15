"""Approval engine (§6): value-based, config-driven, four-eyes always.

Routing: an invoice of gross value V needs sequential approval from every
chain role from clerk up to and including the FIRST role whose approve_up_to
>= V — and if that yields fewer than four_eyes_minimum distinct people, the
chain extends one more step up. The chain snapshot is stored on the invoice,
so limit changes never affect chains already in flight.
"""

import json
from datetime import datetime, timezone

from ..audit import log as audit


class ApprovalError(Exception):
    pass


def _now():
    return datetime.now(timezone.utc).isoformat()


def required_steps(gross, approval_cfg):
    """Return the list of chain steps (dicts) this value requires."""
    chain = approval_cfg["chain"]
    steps = [chain[0]]  # preparer, eyes #1
    for step in chain[1:]:
        steps.append(step)
        if float(step["approve_up_to"]) >= gross:
            break
    else:
        raise ApprovalError(f"no chain step covers gross {gross}")
    while len(steps) < int(approval_cfg["four_eyes_minimum"]) and len(steps) < len(chain):
        steps.append(chain[len(steps)])
    return steps


def route(conn, invoice_id, settings, preparer, actor="system"):
    """Create the pending approval steps + snapshot for an invoice."""
    inv = conn.execute("SELECT * FROM invoices WHERE id=?", (invoice_id,)).fetchone()
    if inv is None:
        raise ApprovalError(f"invoice {invoice_id} not found")
    if conn.execute("SELECT 1 FROM approvals WHERE invoice_id=?", (invoice_id,)).fetchone():
        return  # already routed
    cfg = settings["approval"]
    steps = required_steps(inv["gross_total"], cfg)

    snapshot = {
        "routed_at": _now(),
        "gross": inv["gross_total"],
        "four_eyes_minimum": cfg["four_eyes_minimum"],
        "steps": [{"role": s["role"], "approve_up_to": str(s["approve_up_to"])} for s in steps],
        "users": {s["role"]: cfg["users"].get(s["role"], []) for s in steps},
        "preparer": preparer,
    }
    conn.execute("UPDATE invoices SET chain_snapshot=? WHERE id=?",
                 (json.dumps(snapshot), invoice_id))

    for n, step in enumerate(steps):
        action = "pending"
        user = ""
        acted_at = ""
        if n == 0:
            action, user, acted_at = "approved", preparer, _now()  # preparer confirms by preparing
        conn.execute(
            """INSERT INTO approvals (invoice_id, step, role, user, action, acted_at)
               VALUES (?,?,?,?,?,?)""",
            (invoice_id, n, step["role"], user, action, acted_at),
        )
    conn.commit()
    audit.log(conn, actor, "approval_routed",
              f"invoice={invoice_id} gross={inv['gross_total']:.2f} "
              f"steps={[s['role'] for s in steps]}")
    return [s["role"] for s in steps]


def current_step(conn, invoice_id):
    return conn.execute(
        """SELECT * FROM approvals WHERE invoice_id=? AND action='pending'
           ORDER BY step LIMIT 1""", (invoice_id,)).fetchone()


def pending_for_user(conn, settings, email):
    """Invoices whose current pending step's role includes this user (per the
    invoice's own chain snapshot, not today's config)."""
    email = email.strip().lower()
    out = []
    for inv in conn.execute(
            "SELECT * FROM invoices WHERE chain_snapshot != '' AND status NOT IN ('rejected','approved')"):
        step = current_step(conn, inv["id"])
        if step is None:
            continue
        snapshot = json.loads(inv["chain_snapshot"])
        users = [u.strip().lower() for u in snapshot["users"].get(step["role"], [])]
        if email in users:
            out.append((inv, step))
    return out


def act(conn, invoice_id, email, action, note="", delegate_to=""):
    """approve | reject | delegate on the invoice's current pending step."""
    email = email.strip().lower()
    inv = conn.execute("SELECT * FROM invoices WHERE id=?", (invoice_id,)).fetchone()
    step = current_step(conn, invoice_id)
    if step is None:
        raise ApprovalError("no pending approval step")
    snapshot = json.loads(inv["chain_snapshot"])
    allowed = [u.strip().lower() for u in snapshot["users"].get(step["role"], [])]
    if email not in allowed:
        raise ApprovalError(f"{email} may not act for role {step['role']}")
    # four-eyes: nobody signs twice; the preparer never approves (self_approval forbidden)
    earlier = {r["user"].strip().lower() for r in conn.execute(
        "SELECT user FROM approvals WHERE invoice_id=? AND action IN ('approved','delegated') AND step<?",
        (invoice_id, step["step"])) if r["user"]}
    if email in earlier or email == (snapshot.get("preparer") or "").strip().lower() and step["step"] > 0:
        raise ApprovalError("four-eyes: you already acted on this invoice (self-approval forbidden)")

    if action == "approve":
        conn.execute("UPDATE approvals SET action='approved', user=?, acted_at=?, note=? WHERE id=?",
                     (email, _now(), note, step["id"]))
        if current_step(conn, invoice_id) is None:
            distinct = {r["user"].strip().lower() for r in conn.execute(
                "SELECT user FROM approvals WHERE invoice_id=? AND action='approved'", (invoice_id,))}
            if len(distinct) < int(snapshot["four_eyes_minimum"]):
                raise ApprovalError("four-eyes violated: not enough distinct signers")  # defensive
            conn.execute("UPDATE invoices SET status='approved' WHERE id=?", (invoice_id,))
    elif action == "reject":
        if not note.strip():
            raise ApprovalError("rejection requires a reason")
        conn.execute("UPDATE approvals SET action='rejected', user=?, acted_at=?, note=? WHERE id=?",
                     (email, _now(), note, step["id"]))
        conn.execute("UPDATE invoices SET status='rejected', review_reason=? WHERE id=?",
                     (f"rejected by {email}: {note}", invoice_id))
    elif action == "delegate":
        if not delegate_to.strip():
            raise ApprovalError("delegate needs a target user")
        conn.execute("UPDATE approvals SET action='delegated', user=?, acted_at=?, note=? WHERE id=?",
                     (email, _now(), f"delegated to {delegate_to}: {note}", step["id"]))
        # new pending step for the same role, restricted to the delegate
        conn.execute(
            "INSERT INTO approvals (invoice_id, step, role, user, action) VALUES (?,?,?,?, 'pending')",
            (invoice_id, step["step"], step["role"], "", ))
        snapshot["users"][step["role"]] = [delegate_to]
        conn.execute("UPDATE invoices SET chain_snapshot=? WHERE id=?",
                     (json.dumps(snapshot), invoice_id))
    else:
        raise ApprovalError(f"unknown action {action}")
    conn.commit()
    audit.log(conn, email, f"approval_{action}",
              f"invoice={invoice_id} step={step['step']} role={step['role']} {note}")
    return inv


def due_reminders(conn, settings):
    """(approval_row, kind) pairs needing a reminder or escalation."""
    cfg = settings["approval"]
    now = datetime.now(timezone.utc)
    out = []
    for row in conn.execute(
            """SELECT a.*, i.gross_total, i.vendor_name FROM approvals a
               JOIN invoices i ON i.id = a.invoice_id
               WHERE a.action='pending' AND a.notified_at != ''"""):
        notified = datetime.fromisoformat(row["notified_at"])
        hours = (now - notified).total_seconds() / 3600
        if hours >= float(cfg["escalate_after_hours"]) and not row["escalated_at"]:
            out.append((row, "escalate"))
        elif hours >= float(cfg["reminder_after_hours"]) and not row["reminded_at"]:
            out.append((row, "remind"))
    return out
