"""Stage 3: match the invoice to a vendor account in the vendor master — the
clean vendors_agent.csv published by the vendor-cleanup app.

Matching order: VAT number first, then name, then TIN. Any TWO of the three
signals agreeing on the same account is a pass (VAT + name is the canonical
case). A single-signal match is not trusted on its own — it goes to the
review queue with an explanation of what disagreed.

Also loads the merged-account mapping for Stage 4 history folding.
"""

import csv
import os
import re
import unicodedata
from datetime import datetime, timezone

try:
    from rapidfuzz import fuzz, process as fuzz_process
except ImportError:  # pragma: no cover — fuzzy name matching degrades to exact
    fuzz = fuzz_process = None

NAME_FUZZY_CUTOFF = 90

# ---- normalization -----------------------------------------------------------

_GREEK = {"Α": "A", "Β": "V", "Γ": "G", "Δ": "D", "Ε": "E", "Ζ": "Z", "Η": "I",
          "Θ": "TH", "Ι": "I", "Κ": "K", "Λ": "L", "Μ": "M", "Ν": "N", "Ξ": "X",
          "Ο": "O", "Π": "P", "Ρ": "R", "Σ": "S", "Τ": "T", "Υ": "Y", "Φ": "F",
          "Χ": "CH", "Ψ": "PS", "Ω": "O", "Ϊ": "I", "Ϋ": "Y"}
_SUFFIXES = ("LIMITED", "PUBLIC", "LTD", "LLC", "PLC", "CO", "ΛΤΔ", "ΛΙΜΙΤΕΔ")


def _norm_id(v):
    v = re.sub(r"[^A-Z0-9]", "", (v or "").upper())
    return v[2:] if v.startswith("CY") else v


def norm_name(name):
    s = "".join(c for c in unicodedata.normalize("NFD", (name or "").upper())
                if unicodedata.category(c) != "Mn")
    s = "".join(_GREEK.get(c, c) for c in s)
    s = s.replace("&", " AND ")
    s = re.sub(r"[^A-Z0-9 ]+", " ", s)
    tokens = [t for t in s.split() if t and t not in _SUFFIXES]
    return " ".join(sorted(tokens))


# ---- vendor master -----------------------------------------------------------

class VendorMaster:
    def __init__(self, vendors):
        self.vendors = vendors                       # account -> record
        self.by_vat, self.by_tin, self.by_name = {}, {}, {}
        for v in vendors.values():
            if v["vat_core"]:
                self.by_vat.setdefault(v["vat_core"], v)
            if v["tin_core"]:
                self.by_tin.setdefault(v["tin_core"], v)
            if v["name_norm"]:
                self.by_name.setdefault(v["name_norm"], v)
        self._names = list(self.by_name)

    @property
    def vat_cores(self):
        return set(self.by_vat)

    def match_name(self, name):
        """Exact normalized match, else fuzzy >= NAME_FUZZY_CUTOFF."""
        n = norm_name(name)
        if not n:
            return None
        if n in self.by_name:
            return self.by_name[n]
        if fuzz_process and self._names:
            hit = fuzz_process.extractOne(n, self._names, scorer=fuzz.token_sort_ratio,
                                          score_cutoff=NAME_FUZZY_CUTOFF)
            if hit:
                return self.by_name[hit[0]]
        return None


def load_vendor_master(settings):
    path = settings["vendor_master"]["vendors_csv"]
    if not os.path.exists(path):
        raise FileNotFoundError(
            f"vendor master not found at {path} — run the vendor-cleanup export first")
    vendors = {}
    with open(path, encoding="utf-8-sig") as f:
        for row in csv.DictReader(f):
            vendors[row["Supplier"]] = {
                "account": row["Supplier"],
                "name": row["Name"],
                "name_norm": norm_name(row["Name"]),
                "vat": row["VAT"],
                "vat_core": _norm_id(row["VAT"]),
                "tin": row.get("TIN", ""),
                "tin_core": _norm_id(row.get("TIN", "")),
                "ibans": [i.strip() for i in (row["IBANs"] or "").split(";") if i.strip()],
                "blocked": (row.get("blocked") or "").strip(),
            }
    return VendorMaster(vendors)


def load_mapping(settings):
    """old_supplier -> surviving_supplier from the vendor-cleanup app."""
    path = settings["vendor_master"]["mapping_csv"]
    if not os.path.exists(path):
        return None  # not published yet — shadow-mode gate not met
    with open(path, encoding="utf-8-sig") as f:
        return {r["old_supplier"]: r["surviving_supplier"] for r in csv.DictReader(f)}


def sync_vendors_table(conn, settings, master=None):
    """Mirror the master into the local vendors table; extend known IBANs with
    config/vendors.yaml expected_ibans."""
    master = master or load_vendor_master(settings)
    overrides = settings.get("vendors_overrides") or {}
    now = datetime.now(timezone.utc).isoformat()
    for account, v in master.vendors.items():
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
    return len(master.vendors)


# ---- matching ----------------------------------------------------------------

def match_vendor(record, master):
    """Return (account, signals, detail). Signals is the subset of
    {vat, name, tin} that agree on the winning account."""
    hits = {}  # account -> set of signals, in VAT -> name -> TIN order
    vat_hit = master.by_vat.get(_norm_id(record.get("vendor_vat")))
    if vat_hit:
        hits.setdefault(vat_hit["account"], set()).add("vat")
    name_hit = master.match_name(record.get("vendor_name"))
    if name_hit:
        hits.setdefault(name_hit["account"], set()).add("name")
    tin_hit = master.by_tin.get(_norm_id(record.get("vendor_tin")))
    if tin_hit:
        hits.setdefault(tin_hit["account"], set()).add("tin")

    if not hits:
        return "", set(), "no match by VAT, name or TIN"
    account, signals = max(hits.items(), key=lambda kv: (len(kv[1]), "vat" in kv[1]))
    others = {a: s for a, s in hits.items() if a != account}
    detail = f"matched {account} by {'+'.join(sorted(signals))}"
    if others:
        detail += "; conflicting: " + ", ".join(
            f"{a} by {'+'.join(sorted(s))}" for a, s in others.items())
    return account, signals, detail


def check(record, master):
    """Two agreeing signals = pass; one = review; zero = review.
    Returns (failures, account)."""
    account, signals, detail = match_vendor(record, master)
    if not account:
        return [f"vendor not in the vendor master ({detail}; "
                f"VAT '{record.get('vendor_vat')}', name '{record.get('vendor_name')}')"], ""
    vendor = master.vendors[account]
    if len(signals) < 2:
        only = next(iter(signals))
        mismatches = []
        if "vat" not in signals and record.get("vendor_vat"):
            mismatches.append(f"invoice VAT '{record['vendor_vat']}' vs master '{vendor['vat']}'")
        if "name" not in signals and record.get("vendor_name"):
            mismatches.append(f"invoice name '{record['vendor_name']}' vs master '{vendor['name']}'")
        return [f"vendor match too weak: {only} only ({detail}; {'; '.join(mismatches) or 'other fields absent'})"], account
    if vendor["blocked"]:
        return [f"vendor {account} is blocked in the vendor master"], account
    return [], account
