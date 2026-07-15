"""Stage 4 anomaly rules (§5). Each finding: (rule, severity, detail).
IBAN mismatch is a fraud flag — always CRITICAL."""

import re
import statistics
from datetime import datetime


def _norm_desc(desc):
    return re.sub(r"\s+", " ", (desc or "").strip().upper())


def analyze(record, vendor_account, history, settings, invoice_id=None):
    t = settings["thresholds"]
    findings = []
    prior = history.invoices_for(vendor_account, exclude_id=invoice_id)

    # first invoice ever from a new vendor
    if not prior:
        findings.append(("new_vendor", "INFO",
                         f"first invoice ever from vendor {vendor_account}"))

    # IBAN differs from the vendor's known IBAN(s) — fraud flag, always CRITICAL
    if record.get("iban"):
        known = history.known_ibans(vendor_account, exclude_id=invoice_id)
        if known and record["iban"] not in known:
            findings.append(("iban_mismatch", "CRITICAL",
                             f"invoice IBAN {record['iban']} not among the vendor's known IBANs"))

    # near-duplicate: same vendor + same amount within the window, different number
    window = int(t["dup_window_days"])
    inv_date = _d(record.get("invoice_date"))
    for p in prior:
        if p["invoice_number"] == record.get("invoice_number"):
            continue
        if abs(p["gross_total"] - record["gross_total"]) <= 0.01 and record["gross_total"]:
            pd = _d(p["invoice_date"])
            if inv_date and pd and abs((inv_date - pd).days) <= window:
                findings.append(("near_duplicate", "WARNING",
                                 f"same amount {record['gross_total']:.2f} as invoice "
                                 f"{p['invoice_number']} ({p['invoice_date']}) within {window} days"))

    # unit-price change beyond threshold for recurring items
    prior_prices = {}
    for ln in history.lines_for(vendor_account, exclude_invoice=invoice_id):
        prior_prices.setdefault(_norm_desc(ln["description"]), []).append(ln["unit_price"])
    for ln in record.get("lines", []):
        key = _norm_desc(ln["description"])
        if key in prior_prices and ln.get("unit_price"):
            base = statistics.median(prior_prices[key])
            if base:
                change = 100 * (ln["unit_price"] - base) / base
                if abs(change) > float(t["price_change_pct"]):
                    findings.append(("price_change", "WARNING",
                                     f"'{ln['description']}': unit price {ln['unit_price']:.2f} is "
                                     f"{change:+.1f}% vs median {base:.2f}"))
        # quantity spikes on recurring lines
        prior_qtys = [l["quantity"] for l in history.lines_for(vendor_account, exclude_invoice=invoice_id)
                      if _norm_desc(l["description"]) == key and l["quantity"]]
        if len(prior_qtys) >= 3 and ln.get("quantity"):
            base_q = statistics.median(prior_qtys)
            if base_q and ln["quantity"] > 3 * base_q:
                findings.append(("quantity_spike", "WARNING",
                                 f"'{ln['description']}': quantity {ln['quantity']} vs median {base_q}"))

    # monthly vendor spend z-score vs trailing 12 months
    spend = history.monthly_spend(vendor_account, exclude_id=invoice_id)
    if inv_date:
        month = inv_date.strftime("%Y-%m")
        trailing = sorted((m, v) for m, v in spend.items() if m < month)[-12:]
        values = [v for _, v in trailing]
        if len(values) >= 6:
            mean = statistics.mean(values)
            stdev = statistics.stdev(values)
            this_month = spend.get(month, 0.0) + record["gross_total"]
            if stdev > 0:
                z = (this_month - mean) / stdev
                if z > float(t["spend_zscore"]):
                    findings.append(("spend_spike", "WARNING",
                                     f"month {month} spend {this_month:.2f} is z={z:.1f} vs trailing 12m"))

    # gaps or repeats in the vendor's invoice number sequence
    seq = _numeric_tail(record.get("invoice_number", ""))
    if seq is not None:
        prior_seqs = sorted(s for s in (_numeric_tail(p["invoice_number"]) for p in prior) if s is not None)
        if seq in prior_seqs:
            findings.append(("sequence_repeat", "WARNING",
                             f"invoice number sequence value {seq} already seen for this vendor"))
        elif prior_seqs and seq > prior_seqs[-1] + 50:
            findings.append(("sequence_gap", "INFO",
                             f"invoice number jumps from {prior_seqs[-1]} to {seq}"))
        elif prior_seqs and seq < prior_seqs[-1]:
            findings.append(("sequence_backwards", "INFO",
                             f"invoice number {seq} lower than latest seen {prior_seqs[-1]}"))

    return findings


def _d(raw):
    try:
        return datetime.strptime((raw or "")[:10], "%Y-%m-%d").date()
    except ValueError:
        return None


def _numeric_tail(number):
    m = re.search(r"(\d{3,})\s*$", number or "")
    return int(m.group(1)) if m else None
