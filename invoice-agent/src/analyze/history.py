"""Stage 4 history access. All history queries fold merged vendor accounts
through the vendor-cleanup mapping (old_supplier -> surviving_supplier), so
the anomaly baselines combine the historical spend of accounts that were
merged in the master (vendor-cleanup brief §6.2)."""

import json


class History:
    def __init__(self, conn, mapping=None):
        self.conn = conn
        self.mapping = mapping or {}

    def canonical(self, account):
        return self.mapping.get(account, account)

    def _family(self, account):
        """The surviving account plus every old account mapped onto it."""
        survivor = self.canonical(account)
        family = {survivor} | {old for old, new in self.mapping.items() if new == survivor}
        return sorted(family)

    def invoices_for(self, account, exclude_id=None):
        family = self._family(account)
        q = (f"SELECT * FROM invoices WHERE vendor_account IN ({','.join('?' * len(family))}) "
             "AND status NOT IN ('rejected','needs_review') AND id != ? ORDER BY invoice_date")
        return self.conn.execute(q, (*family, exclude_id or -1)).fetchall()

    def lines_for(self, account, exclude_invoice=None):
        family = self._family(account)
        q = (f"""SELECT l.*, i.invoice_date FROM invoice_lines l
                 JOIN invoices i ON i.id = l.invoice_id
                 WHERE i.vendor_account IN ({','.join('?' * len(family))})
                 AND i.status NOT IN ('rejected','needs_review') AND i.id != ?""")
        return self.conn.execute(q, (*family, exclude_invoice or -1)).fetchall()

    def monthly_spend(self, account, exclude_id=None):
        """{yyyy-mm: gross} across the mapped family."""
        out = {}
        for inv in self.invoices_for(account, exclude_id):
            month = (inv["invoice_date"] or "")[:7]
            if month:
                out[month] = out.get(month, 0.0) + inv["gross_total"]
        return out

    def known_ibans(self, account, exclude_id=None):
        family = self._family(account)
        ibans = set()
        for acc in family:
            row = self.conn.execute("SELECT known_ibans FROM vendors WHERE account=?", (acc,)).fetchone()
            if row and row["known_ibans"]:
                ibans.update(i.strip() for i in row["known_ibans"].split(";") if i.strip())
        # plus every IBAN previously seen on accepted invoices — but never the
        # invoice under analysis itself
        for inv in self.invoices_for(account, exclude_id=exclude_id):
            if inv["iban"]:
                ibans.add(inv["iban"])
        return ibans


def record_from_row(row):
    r = dict(row)
    r["net_by_rate"] = json.loads(r.get("net_by_rate") or "{}")
    r["vat_by_rate"] = json.loads(r.get("vat_by_rate") or "{}")
    return r
