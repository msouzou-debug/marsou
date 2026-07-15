"""Email notifications (Stage 5 + §6 mechanics).

Transports: outbox (write .eml files to output/outbox — dev default and audit
fallback), smtp (internal relay), graph (send as the shared mailbox).
Every send is audit-logged.
"""

import os
from datetime import datetime, timezone
from email.message import EmailMessage

from ..audit import log as audit


def send(conn, settings, to, subject, html_body, actor="system"):
    transport = (settings.get("notifications") or {}).get("transport", "outbox")
    msg = EmailMessage()
    msg["From"] = settings["mailbox"]["address"]
    msg["To"] = ", ".join(to if isinstance(to, (list, tuple)) else [to])
    msg["Subject"] = subject
    msg["Date"] = datetime.now(timezone.utc).strftime("%a, %d %b %Y %H:%M:%S +0000")
    msg.set_content("HTML email — open in an HTML-capable client.")
    msg.add_alternative(html_body, subtype="html")

    if transport == "smtp":
        import smtplib

        host = os.environ.get("SMTP_HOST", "localhost")
        port = int(os.environ.get("SMTP_PORT", "25"))
        with smtplib.SMTP(host, port, timeout=30) as s:
            s.send_message(msg)
    elif transport == "graph":
        raise NotImplementedError("graph sendMail transport: enable once IT approves Mail.Send")
    else:  # outbox
        outbox = os.path.join(settings["folders"]["output_root"], "outbox")
        os.makedirs(outbox, exist_ok=True)
        stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S%f")
        with open(os.path.join(outbox, f"{stamp}.eml"), "wb") as f:
            f.write(bytes(msg))
    audit.log(conn, actor, "email_sent", f"to={msg['To']} subject={subject} transport={transport}")


def approval_request(conn, settings, invoice, step, findings):
    """Email the role's users their approval request with summary + link."""
    import json

    snapshot = json.loads(invoice["chain_snapshot"])
    to = snapshot["users"].get(step["role"], [])
    if not to:
        return
    url = f"http://{settings['server']['host']}:{settings['server']['port']}/invoice/{invoice['id']}"
    rows = "".join(f"<li>[{sev}] {rule}: {detail}</li>" for rule, sev, detail in findings)
    body = f"""<p>Invoice awaiting your approval (role: <b>{step['role']}</b>).</p>
<table border="1" cellpadding="4">
<tr><td>Vendor</td><td>{invoice['vendor_name']} ({invoice['vendor_account']})</td></tr>
<tr><td>Invoice</td><td>{invoice['invoice_number']} of {invoice['invoice_date']}</td></tr>
<tr><td>Gross</td><td>{invoice['gross_total']:.2f} {invoice['currency']}</td></tr>
</table>
<p>Findings:</p><ul>{rows or '<li>none</li>'}</ul>
<p><a href="{url}">Open in the approval app</a></p>"""
    send(conn, settings, to, f"[Invoice approval] {invoice['vendor_name']} "
         f"{invoice['invoice_number']} — {invoice['gross_total']:.2f} EUR", body)
    conn.execute("UPDATE approvals SET notified_at=? WHERE id=?",
                 (datetime.now(timezone.utc).isoformat(), step["id"]))
    conn.commit()


def critical_alert(conn, settings, invoice, findings):
    to = settings["alerts"]["critical_to"]
    rows = "".join(f"<li><b>{rule}</b>: {detail}</li>" for rule, sev, detail in findings
                   if sev == "CRITICAL")
    body = f"""<p><b>CRITICAL finding — invoice stopped until a human clears the flag.</b></p>
<p>Vendor {invoice['vendor_name']} ({invoice['vendor_account']}),
invoice {invoice['invoice_number']}, gross {invoice['gross_total']:.2f} {invoice['currency']}.</p>
<ul>{rows}</ul>
<p><a href="http://{settings['server']['host']}:{settings['server']['port']}/invoice/{invoice['id']}">Review and clear</a></p>"""
    send(conn, settings, to, f"[CRITICAL] {invoice['vendor_name']} invoice "
         f"{invoice['invoice_number']}", body)


def rejection_notice(conn, settings, invoice, reason):
    import json

    preparer = (json.loads(invoice["chain_snapshot"] or "{}").get("preparer")
                or settings["approval"]["users"]["clerk"][0])
    send(conn, settings, [preparer],
         f"[Rejected] invoice {invoice['invoice_number']} ({invoice['vendor_name']})",
         f"<p>Returned to the review queue.</p><p>Reason: {reason}</p>")
