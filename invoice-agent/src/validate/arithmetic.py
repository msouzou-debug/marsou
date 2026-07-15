"""Stage 3: arithmetic must add up — hard failure otherwise."""

TOLERANCE = 0.02  # rounding tolerance in currency units


def check(record):
    """Return list of failure strings (empty = pass)."""
    failures = []
    net, vat, gross = record["net_total"], record["vat_total"], record["gross_total"]
    if gross and abs((net + vat) - gross) > TOLERANCE:
        failures.append(f"net + VAT != gross ({net:.2f} + {vat:.2f} != {gross:.2f})")

    if record.get("net_by_rate"):
        by_rate = sum(record["net_by_rate"].values())
        if abs(by_rate - net) > TOLERANCE:
            failures.append(f"sum of per-rate nets != net total ({by_rate:.2f} != {net:.2f})")
    if record.get("vat_by_rate"):
        by_rate = sum(record["vat_by_rate"].values())
        if abs(by_rate - vat) > TOLERANCE:
            failures.append(f"sum of per-rate VAT != VAT total ({by_rate:.2f} != {vat:.2f})")
        for rate, net_amount in record.get("net_by_rate", {}).items():
            expected = round(net_amount * float(rate) / 100, 2)
            actual = record["vat_by_rate"].get(rate, 0.0)
            if abs(expected - actual) > max(TOLERANCE, 0.01 * expected):
                failures.append(f"VAT at {rate}% inconsistent ({actual:.2f} vs expected {expected:.2f})")

    lines = record.get("lines") or []
    if lines:
        line_sum = sum(ln["line_total"] for ln in lines)
        if net and abs(line_sum - net) > TOLERANCE:
            failures.append(f"line sums != net total ({line_sum:.2f} != {net:.2f})")
        for ln in lines:
            if ln.get("quantity") and ln.get("unit_price"):
                expected = round(ln["quantity"] * ln["unit_price"], 2)
                if abs(expected - ln["line_total"]) > TOLERANCE:
                    failures.append(
                        f"line {ln['line_no']}: qty*price != total ({expected:.2f} != {ln['line_total']:.2f})")
    return failures
