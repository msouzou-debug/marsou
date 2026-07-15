"""Stage 3: vendor must exist in the vendor master — the clean
vendors_agent.csv published by the vendor-cleanup app (the contract file).
Also loads the merged-account mapping for Stage 4 history folding."""

import csv
import os
import re
from datetime import datetime, timezone


def _norm_vat(v):
    v = re.sub(r"[^A-Z0-9]", "", (v or "").upper())
    return v[2:] if v.startswith("CY") else v


def load_vendor_master(settings):
    """Return {vat_core: vendor_row} and {account: vendor_row}."""
    path = settings["vendor_master"]["vendors_csv"]
    if not os.path.exists(path):
        raise FileNotFoundError(
            f"vendor master not found at {path} — run the vendor-cleanup export first")
    by_vat, by_account = {}, {}
    with open(path, encoding="utf-8-sig") as f:
        for row in csv.DictReader(f):
            rec = {
                "account": row["Supplier"],
                "name": row["Name"],
                "vat": row["VAT"],
                "vat_core": _norm_vat(row["VAT"]),
                "ibans": [i.strip() for i in (row["IBANs"] or "").split(";") if i.strip()],
                "blocked": (row.get("blocked") or "").strip(),
            }
            by_account[rec["account"]] = rec
            if rec["vat_core"]:
                by_vat.setdefault(rec["vat_core"], rec)
    return by_vat, by_account


def load_mapping(settings):
    """old_supplier -> surviving_supplier from the vendor-cleanup app."""
    path = settings["vendor_master"]["mapping_csv"]
    if not os.path.exists(path):
        return None  # not published yet — shadow-mode gate not met
    with open(path, encoding="utf-8-sig") as f:
        return {r["old_supplier"]: r["surviving_supplier"] for r in csv.DictReader(f)}


def sync_vendors_table(conn, settings):
    """Mirror the master into the local vendors table; extend known IBANs with
    config/vendors.yaml expected_ibans. Keeps first_seen across syncs."""
    _, by_account = load_vendor_master(settings)
    overrides = settings.get("vendors_overrides") or {}
    now = datetime.now(timezone.utc).isoformat()
    for account, v in by_account.items():
        ibans = list(v["ibans"])
        for extra in (overrides.get(account) or {}).get("expected_ibans", []):
            if extra not in ibans:
                ibans.append(extra)
        conn.execute(
            """INSERT INTO vendors (account, name, vat, known_ibans, blocked, first_seen)
               VALUES (?,?,?,?,?,?)
               ON CONFLICT(account) DO UPDATE SET
                 name=excluded.name, vat=excluded.vat,
                 known_ibans=excluded.known_ibans, blocked=excluded.blocked""",
            (account, v["name"], v["vat"], "; ".join(ibans), v["blocked"], now),
        )
    conn.commit()
    return len(by_account)


def check(record, by_vat):
    """Match the invoice to a vendor account by VAT. Returns (failures, account)."""
    vat_core = _norm_vat(record["vendor_vat"])
    vendor = by_vat.get(vat_core)
    if not vendor:
        return [f"vendor VAT {record['vendor_vat']} not in the vendor master"], ""
    if vendor["blocked"]:
        return [f"vendor {vendor['account']} is blocked in the vendor master"], vendor["account"]
    return [], vendor["account"]
