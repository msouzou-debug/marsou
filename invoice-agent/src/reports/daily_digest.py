"""Stage 5 — one daily digest email: plain, scannable HTML. No dashboards."""

from datetime import date, datetime, timedelta, timezone

from ..approvals.notifications import send


def _count(conn, sql, *args):
    return conn.execute(sql, args).fetchone()[0]


def build_html(conn, settings, since_iso):
    received = _count(conn, "SELECT COUNT(*) FROM files WHERE received_at >= ?", since_iso)
    extracted = _count(conn, "SELECT COUNT(*) FROM invoices WHERE created_at >= ? AND status != 'needs_review'", since_iso)
    park_ready = _count(conn, "SELECT COUNT(*) FROM invoices WHERE status IN ('park_ready','parked')")
    review = _count(conn, "SELECT COUNT(*) FROM invoices WHERE status='needs_review'")
    on_hold = _count(conn, "SELECT COUNT(*) FROM invoices WHERE status='on_hold'")

    finding_rows = "".join(
        f"<tr><td>{r['severity']}</td><td>{r['rule']}</td><td>{r['vendor_name']} "
        f"{r['invoice_number']}</td><td>{r['detail']}</td></tr>"
        for r in conn.execute(
            """SELECT f.severity, f.rule, f.detail, i.vendor_name, i.invoice_number
               FROM findings f JOIN invoices i ON i.id=f.invoice_id
               WHERE f.created_at >= ? ORDER BY
               CASE f.severity WHEN 'CRITICAL' THEN 0 WHEN 'WARNING' THEN 1 ELSE 2 END""",
            (since_iso,)))

    # top movers vs last month (vendor gross this month vs previous)
    this_month = date.today().strftime("%Y-%m")
    prev_month = (date.today().replace(day=1) - timedelta(days=1)).strftime("%Y-%m")
    movers = conn.execute(
        """SELECT vendor_name,
                  SUM(CASE WHEN substr(invoice_date,1,7)=? THEN gross_total ELSE 0 END) AS cur,
                  SUM(CASE WHEN substr(invoice_date,1,7)=? THEN gross_total ELSE 0 END) AS prev
           FROM invoices WHERE status NOT IN ('rejected','needs_review')
           GROUP BY vendor_account HAVING cur > 0 OR prev > 0
           ORDER BY ABS(cur - prev) DESC LIMIT 10""", (this_month, prev_month)).fetchall()
    mover_rows = "".join(
        f"<tr><td>{m['vendor_name']}</td><td align=right>{m['prev']:.2f}</td>"
        f"<td align=right>{m['cur']:.2f}</td><td align=right>{m['cur']-m['prev']:+.2f}</td></tr>"
        for m in movers)

    return f"""<h2>Invoice agent — daily digest {date.today().isoformat()}</h2>
<table border="1" cellpadding="4">
<tr><td>Files received</td><td align=right>{received}</td></tr>
<tr><td>Invoices extracted</td><td align=right>{extracted}</td></tr>
<tr><td>Park-ready / parked</td><td align=right>{park_ready}</td></tr>
<tr><td>Queued for human review</td><td align=right>{review}</td></tr>
<tr><td>On hold (CRITICAL flag)</td><td align=right>{on_hold}</td></tr>
</table>
<h3>Findings</h3>
<table border="1" cellpadding="4"><tr><th>Severity</th><th>Rule</th><th>Invoice</th><th>Detail</th></tr>
{finding_rows or '<tr><td colspan=4>none</td></tr>'}</table>
<h3>Top movers vs last month</h3>
<table border="1" cellpadding="4"><tr><th>Vendor</th><th>{prev_month}</th><th>{this_month}</th><th>Δ</th></tr>
{mover_rows or '<tr><td colspan=4>none</td></tr>'}</table>"""


def send_digest(conn, settings, actor="system"):
    since = (datetime.now(timezone.utc) - timedelta(hours=24)).isoformat()
    html = build_html(conn, settings, since)
    send(conn, settings, settings["alerts"]["digest_to"],
         f"Invoice agent digest {date.today().isoformat()}", html, actor=actor)
