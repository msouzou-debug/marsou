"""CLI: python -m vendor_cleanup <command>

  import          load input/ (four extracts or vendors_agent.csv), detect, summarize
  serve           run the review web app (waitress)
  export          write all four outputs to output/
  close-actions FILE   re-import a ticked SAP action list to close the loop
  verify-audit    check the audit log hash chain
"""

import argparse
import sys
from collections import defaultdict

from . import audit, db, detect, exports, load
from .config import load_settings
from .normalize import split_ibans


def cmd_import(settings, args):
    conn = db.connect(settings)
    import_id, vendors, source = load.run_import(conn, settings, actor=args.user)
    groups, stats = detect.persist_groups(conn, import_id, vendors, settings, actor=args.user)
    wl = detect.refresh_worklists(conn, import_id, vendors, actor=args.user)
    print_summary(conn, import_id, vendors, source, groups, stats, wl)
    exports.write_clean_vendors(conn, settings, actor=args.user)


def print_summary(conn, import_id, vendors, source, groups, stats, wl):
    vmap = {v["supplier"]: v for v in vendors}
    print(f"\n=== Vendor cleanup import #{import_id} (source: {source}) ===")
    print(f"Vendors loaded: {len(vendors)}")

    bad = load.invalid_ibans(vendors)
    all_ibans = {i for v in vendors for i in split_ibans(v['ibans'])}
    multi = [v for v in vendors if len(split_ibans(v["ibans"])) > 1]
    print(f"Distinct IBANs: {len(all_ibans)}  (mod-97 failures: {len(bad)}; vendors with >1 IBAN: {len(multi)})")

    # per-rule breakdown over the detected groups
    rule_groups = defaultdict(set)
    rule_vendors = defaultdict(set)
    for g in groups.values():
        for a, b, rule, *_ in g["edges"]:
            rule_groups[rule].add(frozenset(g["members"]))
            rule_vendors[rule].update((a, b))
    print("\nDuplicate candidates by rule:")
    labels = {
        "same_iban": "Same IBAN, different supplier",
        "same_vat": "Same VAT number",
        "same_tin": "Same TIN",
        "fuzzy_name": "Fuzzy name match (>= cutoff)",
        "same_phone": "Same telephone (supporting only)",
    }
    for rule in ("same_iban", "same_vat", "same_tin", "fuzzy_name", "same_phone"):
        if rule in rule_groups:
            print(f"  {labels[rule]:38s} {len(rule_vendors[rule]):4d} vendors in {len(rule_groups[rule]):4d} groups")

    n_groups = len(groups)
    n_members = sum(len(g["members"]) for g in groups.values())
    print(f"\nTotal candidate groups: {n_groups} ({n_members} vendors) — "
          f"new: {stats['new']}, unchanged: {stats['kept']}, reopened: {stats['reopened']}, stale: {stats['stale']}")

    print("\nWorklists (defects, not duplicates):")
    print(f"  vendors without IBAN:            {wl['no_iban']}")
    print(f"  vendors without VAT number:      {wl['no_vat']}")
    print(f"  blocked but active in comp.codes: {wl['blocked_active']}")

    print("\nTop candidate groups by score:")
    scored = sorted(groups.values(), key=lambda g: -detect.score_group(g)[0])[:8]
    for g in scored:
        score, rules = detect.score_group(g)
        names = " | ".join(
            f"{s} {vmap[s]['name'][:34]}" for s in sorted(g["members"])[:3]
        )
        extra = f" (+{len(g['members']) - 3} more)" if len(g["members"]) > 3 else ""
        print(f"  [{score:.2f}] {','.join(rules):25s} {names}{extra}")
    print()


def cmd_serve(settings, args):
    from waitress import serve as waitress_serve

    from .webapp import create_app

    app = create_app(settings)
    host = args.host or settings["server"]["host"]
    port = args.port or settings["server"]["port"]
    print(f"Review app on http://{host}:{port}")
    waitress_serve(app, host=host, port=port)


def cmd_export(settings, args):
    conn = db.connect(settings)
    paths = exports.write_all(conn, settings, actor=args.user)
    for label, p in paths.items():
        print(f"  {label:16s} {p}")


def cmd_close_actions(settings, args):
    conn = db.connect(settings)
    closed = exports.close_ticked_actions(conn, args.file, actor=args.user)
    print(f"Marked {closed} SAP action(s) as applied.")


def cmd_verify_audit(settings, args):
    conn = db.connect(settings)
    ok, bad_id = audit.verify_chain(conn)
    print("audit chain OK" if ok else f"audit chain BROKEN at row {bad_id}")
    sys.exit(0 if ok else 1)


def main(argv=None):
    parser = argparse.ArgumentParser(prog="vendor_cleanup", description=__doc__)
    parser.add_argument("--base-dir", default=None, help="app root (default: cwd)")
    parser.add_argument("--user", default="system", help="actor recorded in the audit log")
    sub = parser.add_subparsers(dest="command", required=True)
    sub.add_parser("import")
    p_serve = sub.add_parser("serve")
    p_serve.add_argument("--host", default=None)
    p_serve.add_argument("--port", type=int, default=None)
    sub.add_parser("export")
    p_close = sub.add_parser("close-actions")
    p_close.add_argument("file")
    sub.add_parser("verify-audit")

    args = parser.parse_args(argv)
    settings = load_settings(args.base_dir)
    {
        "import": cmd_import,
        "serve": cmd_serve,
        "export": cmd_export,
        "close-actions": cmd_close_actions,
        "verify-audit": cmd_verify_audit,
    }[args.command](settings, args)


if __name__ == "__main__":
    main()
