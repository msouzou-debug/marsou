"""Decisions under four-eyes (§5) — reviewer decides, approver confirms,
reviewer != approver enforced in code. Every decision is reversible (§8)."""

from datetime import datetime, timezone

from . import audit
from .load import open_items_for


def _now():
    return datetime.now(timezone.utc).isoformat()


class WorkflowError(Exception):
    pass


def _require(cond, msg):
    if not cond:
        raise WorkflowError(msg)


def record_decision(conn, group_id, action, reviewer, survivor="", reason=""):
    group = conn.execute("SELECT * FROM groups WHERE id=?", (group_id,)).fetchone()
    _require(group is not None, f"group {group_id} not found")
    _require(group["status"] in ("open", "pending_approval"), f"group {group_id} is {group['status']}")
    _require(action in ("merge", "not_duplicate", "defer"), f"bad action {action}")
    members = [r["supplier"] for r in conn.execute(
        "SELECT supplier FROM group_members WHERE group_id=?", (group_id,))]
    if action == "merge":
        _require(survivor in members, f"survivor {survivor} is not a member of group {group_id}")
    if action == "not_duplicate":
        _require(bool(reason.strip()), "not_duplicate needs a reason (it feeds the whitelist)")

    # supersede any earlier pending decision for this group
    conn.execute(
        "UPDATE decisions SET status='superseded' WHERE group_id=? AND status='pending'", (group_id,)
    )
    cur = conn.execute(
        """INSERT INTO decisions (group_id, action, survivor, reason, reviewer, reviewed_at, status)
           VALUES (?,?,?,?,?,?, 'pending')""",
        (group_id, action, survivor, reason, reviewer, _now()),
    )
    if action == "defer":
        # defer needs no approver; group simply stays open
        conn.execute("UPDATE decisions SET status='approved' WHERE id=?", (cur.lastrowid,))
    else:
        conn.execute("UPDATE groups SET status='pending_approval' WHERE id=?", (group_id,))
    conn.commit()
    audit.log(conn, reviewer, f"decision_{action}",
              f"group={group_id} survivor={survivor} reason={reason}")
    return cur.lastrowid


def approve_decision(conn, decision_id, approver, approve=True, reason=""):
    d = conn.execute("SELECT * FROM decisions WHERE id=?", (decision_id,)).fetchone()
    _require(d is not None, f"decision {decision_id} not found")
    _require(d["status"] == "pending", f"decision {decision_id} is {d['status']}")
    _require(approver.strip().lower() != d["reviewer"].strip().lower(),
             "four-eyes: approver must differ from reviewer")

    if not approve:
        conn.execute(
            "UPDATE decisions SET status='rejected', approver=?, approved_at=? WHERE id=?",
            (approver, _now(), decision_id),
        )
        conn.execute("UPDATE groups SET status='open' WHERE id=?", (d["group_id"],))
        conn.commit()
        audit.log(conn, approver, "decision_rejected", f"decision={decision_id} group={d['group_id']} {reason}")
        return

    conn.execute(
        "UPDATE decisions SET status='approved', approver=?, approved_at=? WHERE id=?",
        (approver, _now(), decision_id),
    )
    conn.execute(
        "UPDATE groups SET status='resolved', resolution=? WHERE id=?",
        (d["action"], d["group_id"]),
    )

    if d["action"] == "merge":
        members = [r["supplier"] for r in conn.execute(
            "SELECT supplier FROM group_members WHERE group_id=?", (d["group_id"],))]
        for loser in members:
            if loser == d["survivor"]:
                continue
            note = f"Duplicate of {d['survivor']} — vendor cleanup {_now()[:10]}"
            status, hold_reason = "pending", ""
            items = open_items_for(conn, loser)
            if items and items["item_count"] > 0:
                # §8: BLOCK held back until a later FBL1N export shows items cleared
                status = "held"
                hold_reason = f"{items['item_count']} open items ({items['open_amount']:.2f})"
            conn.execute(
                """INSERT INTO sap_actions (action, supplier, survivor, note, source, status, hold_reason, created_at)
                   VALUES ('BLOCK',?,?,?,?,?,?,?)
                   ON CONFLICT(action, supplier, survivor) DO UPDATE
                   SET status=CASE WHEN sap_actions.status IN ('cancelled') THEN excluded.status ELSE sap_actions.status END,
                       hold_reason=excluded.hold_reason""",
                (loser, d["survivor"], note, f"decision:{decision_id}", status, hold_reason, _now()),
            )
    elif d["action"] == "not_duplicate":
        # feed the whitelist so the pair is not regenerated on re-import
        members = sorted(r["supplier"] for r in conn.execute(
            "SELECT supplier FROM group_members WHERE group_id=?", (d["group_id"],)))
        for i in range(len(members)):
            for j in range(i + 1, len(members)):
                add_whitelist(conn, "pair", f"{members[i]}|{members[j]}",
                              f"group {d['group_id']}: {d['reason']}", approver, quiet=True)

    conn.commit()
    audit.log(conn, approver, "decision_approved", f"decision={decision_id} group={d['group_id']} action={d['action']}")


def unmerge(conn, group_id, actor, reason=""):
    """§8: reopen a merged group — cancel its BLOCK actions and mapping rows."""
    group = conn.execute("SELECT * FROM groups WHERE id=?", (group_id,)).fetchone()
    _require(group is not None, f"group {group_id} not found")
    _require(group["resolution"] == "merge" and group["status"] == "resolved",
             f"group {group_id} is not a resolved merge")
    d = conn.execute(
        "SELECT * FROM decisions WHERE group_id=? AND action='merge' AND status='approved' ORDER BY id DESC LIMIT 1",
        (group_id,),
    ).fetchone()
    conn.execute("UPDATE decisions SET status='superseded' WHERE id=?", (d["id"],))
    conn.execute(
        "UPDATE sap_actions SET status='cancelled' WHERE source=? AND status IN ('pending','held','exported')",
        (f"decision:{d['id']}",),
    )
    conn.execute("UPDATE groups SET status='open', resolution='' WHERE id=?", (group_id,))
    conn.execute(
        """INSERT INTO decisions (group_id, action, survivor, reason, reviewer, reviewed_at, status)
           VALUES (?,'unmerge','',?,?,?, 'approved')""",
        (group_id, reason, actor, _now()),
    )
    conn.commit()
    audit.log(conn, actor, "unmerge", f"group={group_id} decision={d['id']} {reason}")


def add_whitelist(conn, kind, value, reason, actor, quiet=False):
    _require(kind in ("iban", "pair"), "whitelist kind must be iban or pair")
    conn.execute(
        """INSERT INTO whitelist (kind, value, reason, created_by, created_at) VALUES (?,?,?,?,?)
           ON CONFLICT(kind, value) DO NOTHING""",
        (kind, value, reason, actor, _now()),
    )
    if not quiet:
        conn.commit()
        audit.log(conn, actor, "whitelist_add", f"{kind}={value} {reason}")


def worklist_decide(conn, item_id, action, reviewer, reason=""):
    """Mark a worklist row 'fixed in SAP' or 'accepted as-is (reason)'.
    Accepted-as-is needs the same two signatures as a merge."""
    item = conn.execute("SELECT * FROM worklist_items WHERE id=?", (item_id,)).fetchone()
    _require(item is not None, f"worklist item {item_id} not found")
    _require(item["status"] in ("open", "pending_approval"), f"item {item_id} is {item['status']}")
    _require(action in ("fixed", "accepted"), "action must be fixed or accepted")
    if action == "fixed":
        conn.execute(
            "UPDATE worklist_items SET status='fixed', reviewer=?, reviewed_at=?, reason=? WHERE id=?",
            (reviewer, _now(), reason, item_id),
        )
    else:
        _require(bool(reason.strip()), "accepted as-is needs a reason")
        conn.execute(
            "UPDATE worklist_items SET status='pending_approval', reviewer=?, reviewed_at=?, reason=? WHERE id=?",
            (reviewer, _now(), reason, item_id),
        )
    conn.commit()
    audit.log(conn, reviewer, f"worklist_{action}", f"item={item_id} {item['kind']}:{item['supplier']} {reason}")


def worklist_approve(conn, item_id, approver, approve=True):
    item = conn.execute("SELECT * FROM worklist_items WHERE id=?", (item_id,)).fetchone()
    _require(item is not None, f"worklist item {item_id} not found")
    _require(item["status"] == "pending_approval", f"item {item_id} is {item['status']}")
    _require(approver.strip().lower() != (item["reviewer"] or "").strip().lower(),
             "four-eyes: approver must differ from reviewer")
    new_status = "accepted" if approve else "open"
    conn.execute(
        "UPDATE worklist_items SET status=?, approver=?, approved_at=? WHERE id=?",
        (new_status, approver if approve else "", _now() if approve else "", item_id),
    )
    conn.commit()
    audit.log(conn, approver, "worklist_approved" if approve else "worklist_rejected",
              f"item={item_id} {item['kind']}:{item['supplier']}")
