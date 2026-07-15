"""Stage 3: exact duplicate — same vendor + same invoice number already in
the DB is a hard failure. (Near-duplicates are Stage 4's job.)"""


def check(conn, record, vendor_account, own_invoice_id=None):
    if not record.get("invoice_number") or not vendor_account:
        return []
    row = conn.execute(
        """SELECT id FROM invoices
           WHERE vendor_account=? AND invoice_number=? AND status != 'rejected' AND id != ?""",
        (vendor_account, record["invoice_number"], own_invoice_id or -1),
    ).fetchone()
    if row:
        return [f"duplicate: invoice {record['invoice_number']} for vendor "
                f"{vendor_account} already registered (id {row['id']})"]
    return []
