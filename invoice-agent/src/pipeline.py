"""The daily pipeline (§5): ingest -> extract -> validate -> analyze -> alert
-> park prep -> approval routing. Called by run_daily.py and the tests."""

import json
from datetime import datetime, timezone

from .analyze import anomalies
from .analyze.history import History
from .approvals import engine, notifications
from .audit import log as audit
from .extract import normalize
from .ingest import dedupe, folder_watch
from .sap import park_file
from .validate import arithmetic, duplicates, master_data, vat


def _now():
    return datetime.now(timezone.utc).isoformat()


def process_file(conn, settings, file_id, master, hist, actor="system"):
    """Stages 2–4 + 6-prep + 7 for one ingested file. Returns the invoice id."""
    frow = conn.execute("SELECT * FROM files WHERE id=?", (file_id,)).fetchone()
    record, review_reason = normalize.extract_file(frow["path"], frow["original_name"])

    cur = conn.execute(
        "INSERT INTO invoices (file_id, status, created_at) VALUES (?, 'ingested', ?)",
        (file_id, _now()))
    invoice_id = cur.lastrowid
    conn.execute("UPDATE files SET invoice_id=? WHERE id=?", (invoice_id, file_id))

    if record is None:  # Stage 2 could not produce a record at all
        conn.execute("UPDATE invoices SET status='needs_review', review_reason=? WHERE id=?",
                     (review_reason, invoice_id))
        conn.commit()
        audit.log(conn, actor, "extract_failed", f"invoice={invoice_id} {review_reason}")
        return invoice_id

    _store_record(conn, invoice_id, record, settings)

    # confidence gate: any critical field below threshold -> review, never onward
    threshold = settings["extraction"]["confidence_threshold"]
    weak = normalize.low_confidence_fields(record, threshold)
    if weak:
        conn.execute("UPDATE invoices SET status='needs_review', review_reason=? WHERE id=?",
                     (f"low confidence on critical field(s): {', '.join(weak)}", invoice_id))
        conn.commit()
        audit.log(conn, actor, "extract_low_confidence", f"invoice={invoice_id} fields={weak}")
        return invoice_id
    conn.execute("UPDATE invoices SET status='extracted' WHERE id=?", (invoice_id,))

    # Stage 3 — validation (hard failures stop the invoice)
    failures = arithmetic.check(record)
    failures += vat.check(record, settings,
                          known_vat_cores=master.vat_cores if master else set())
    master_failures, vendor_account = (
        master_data.check(record, master) if master
        else (["vendor master not loaded"], ""))
    failures += master_failures
    conn.execute("UPDATE invoices SET vendor_account=? WHERE id=?", (vendor_account, invoice_id))
    failures += duplicates.check(conn, record, vendor_account, own_invoice_id=invoice_id)
    if failures:
        conn.execute("UPDATE invoices SET status='needs_review', review_reason=? WHERE id=?",
                     ("; ".join(failures), invoice_id))
        conn.commit()
        audit.log(conn, actor, "validation_failed", f"invoice={invoice_id} {'; '.join(failures)}")
        return invoice_id
    conn.execute("UPDATE invoices SET status='validated' WHERE id=?", (invoice_id,))
    dedupe.archive_file(settings, conn, file_id, vendor_account)

    # Stage 4 — analyze vs history (through the vendor-cleanup mapping)
    findings = anomalies.analyze(record, vendor_account, hist, settings, invoice_id=invoice_id)
    for rule, severity, detail in findings:
        conn.execute(
            "INSERT INTO findings (invoice_id, rule, severity, detail, created_at) VALUES (?,?,?,?,?)",
            (invoice_id, rule, severity, detail, _now()))
    conn.execute("UPDATE invoices SET status='analyzed' WHERE id=?", (invoice_id,))
    conn.commit()

    # Stage 5 — CRITICAL stops the invoice until a human clears the flag
    inv = conn.execute("SELECT * FROM invoices WHERE id=?", (invoice_id,)).fetchone()
    criticals = [f for f in findings if f[1] == "CRITICAL"]
    if criticals:
        conn.execute("UPDATE invoices SET status='on_hold' WHERE id=?", (invoice_id,))
        conn.commit()
        notifications.critical_alert(conn, settings, inv, findings)
        audit.log(conn, actor, "critical_hold", f"invoice={invoice_id} rules={[c[0] for c in criticals]}")
        return invoice_id

    # Stage 6 prep — GL assignment (vendor default -> keyword rules -> review)
    unmapped = park_file.assign_gl(conn, invoice_id, record, vendor_account, settings)
    if unmapped:
        conn.execute("UPDATE invoices SET status='needs_review', review_reason=? WHERE id=?",
                     (f"no GL rule matched line(s) {unmapped} — never guess silently", invoice_id))
        conn.commit()
        audit.log(conn, actor, "gl_unmapped", f"invoice={invoice_id} lines={unmapped}")
        return invoice_id
    conn.execute("UPDATE invoices SET status='park_ready' WHERE id=?", (invoice_id,))
    conn.commit()

    # Stage 7 — approval routing (parallel to parking)
    preparer = settings["approval"]["users"]["clerk"][0]
    engine.route(conn, invoice_id, settings, preparer, actor=actor)
    inv = conn.execute("SELECT * FROM invoices WHERE id=?", (invoice_id,)).fetchone()
    step = engine.current_step(conn, invoice_id)
    if step is not None:
        notifications.approval_request(conn, settings, inv, step, findings)
    return invoice_id


def _store_record(conn, invoice_id, record, settings):
    entity = next((e["code"] for e in settings["entities"] if e.get("default")),
                  settings["entities"][0]["code"])
    conn.execute(
        """UPDATE invoices SET vendor_name=?, vendor_vat=?, vendor_tin=?, invoice_number=?, invoice_date=?,
           due_date=?, currency=?, net_by_rate=?, vat_by_rate=?, net_total=?, vat_total=?,
           gross_total=?, iban=?, po_number=?, entity=?, extraction_source=?, confidence=?
           WHERE id=?""",
        (record["vendor_name"], record["vendor_vat"], record["vendor_tin"], record["invoice_number"],
         record["invoice_date"], record["due_date"], record["currency"],
         json.dumps(record["net_by_rate"]), json.dumps(record["vat_by_rate"]),
         record["net_total"], record["vat_total"], record["gross_total"], record["iban"],
         record["po_number"], entity, record["source"],
         json.dumps(record.get("confidence", {})), invoice_id))
    lines = record.get("lines") or [park_file._whole_invoice_line(record)]
    for ln in lines:
        conn.execute(
            """INSERT INTO invoice_lines (invoice_id, line_no, description, quantity,
               unit_price, line_total, vat_rate) VALUES (?,?,?,?,?,?,?)""",
            (invoice_id, ln["line_no"], ln.get("description", ""), ln.get("quantity", 1),
             ln.get("unit_price", 0), ln.get("line_total", 0), ln.get("vat_rate", 0)))
    conn.commit()


def run_once(conn, settings, graph_client=None, actor="system", send_digest=True):
    """One full daily run. graph_client=None skips the mailbox (e.g. not configured)."""
    run = conn.execute("INSERT INTO runs (started_at, trigger) VALUES (?, 'manual')", (_now(),))
    run_id = run.lastrowid
    conn.commit()
    stats = {"files": 0, "invoices": 0, "review": 0, "on_hold": 0, "park_ready": 0}

    # Stage 1 — ingest
    new_files = []
    if graph_client is not None:
        from .ingest import graph_mail
        new_files += graph_mail.ingest_mailbox(conn, settings, graph_client, actor)
    else:
        audit.log(conn, actor, "ingest_mailbox_skipped", "no Graph client configured")
    new_files += folder_watch.scan(conn, settings, actor)
    stats["files"] = len(new_files)

    # vendor master sync (the contract with the vendor-cleanup app)
    try:
        master = master_data.load_vendor_master(settings)
        master_data.sync_vendors_table(conn, settings, master)
    except FileNotFoundError as e:
        audit.log(conn, actor, "vendor_master_missing", str(e))
        master = None
    mapping = master_data.load_mapping(settings)
    if mapping is None:
        audit.log(conn, actor, "vendor_mapping_missing",
                  "vendor_mapping.csv not published — shadow-mode gate not met")
    hist = History(conn, mapping or {})

    # Stages 2–7 per file
    for fid in new_files:
        iid = process_file(conn, settings, fid, master, hist, actor)
        stats["invoices"] += 1
        status = conn.execute("SELECT status FROM invoices WHERE id=?", (iid,)).fetchone()["status"]
        if status == "needs_review":
            stats["review"] += 1
        elif status == "on_hold":
            stats["on_hold"] += 1
        elif status == "park_ready":
            stats["park_ready"] += 1

    # Stage 6 — park files per entity (skipped in shadow mode)
    park_file.write_park_files(conn, settings, actor)

    # reminders / escalations
    for row, kind in engine.due_reminders(conn, settings):
        inv = conn.execute("SELECT * FROM invoices WHERE id=?", (row["invoice_id"],)).fetchone()
        snapshot = json.loads(inv["chain_snapshot"])
        col = "reminded_at" if kind == "remind" else "escalated_at"
        to = snapshot["users"].get(row["role"], [])
        if kind == "escalate":
            roles = [s["role"] for s in snapshot["steps"]]
            nxt = roles[min(roles.index(row["role"]) + 1, len(roles) - 1)]
            to = to + snapshot["users"].get(nxt, [])
        notifications.send(conn, settings, to,
                           f"[{kind}] invoice {inv['invoice_number']} still pending your approval",
                           f"<p>Pending since {row['notified_at']}. Gross "
                           f"{inv['gross_total']:.2f} {inv['currency']}.</p>", actor=actor)
        conn.execute(f"UPDATE approvals SET {col}=? WHERE id=?", (_now(), row["id"]))
        conn.commit()

    # Stage 5 — daily digest
    if send_digest:
        from .reports import daily_digest
        daily_digest.send_digest(conn, settings, actor)

    conn.execute("UPDATE runs SET finished_at=?, stats=? WHERE id=?",
                 (_now(), json.dumps(stats), run_id))
    conn.commit()
    audit.log(conn, actor, "run_complete", json.dumps(stats))
    return stats
