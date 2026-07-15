"""Εμφάνιση αποτελεσμάτων ελέγχου και τελικής αναφοράς στον χρήστη."""

from __future__ import annotations

from .excel_write import WriteResult
from .models import LetterTotals, TableRow
from .verify import ColumnCheck


def print_verification(
    rows: list[TableRow],
    totals: LetterTotals,
    checks: list[ColumnCheck],
    derived: list[ColumnCheck] | None = None,
) -> None:
    print()
    print("═" * 76)
    print(f"  ΕΛΕΓΧΟΣ ΣΥΝΟΛΩΝ — Μισθοί {totals.minas_misthon} {totals.etos}"
          + (f" / Επιδόματα {totals.minas_epidomaton}" if totals.minas_epidomaton else ""))
    print("═" * 76)
    print(f"  Γραμμές που διαβάστηκαν από το PDF: {len(rows)}")
    print()
    print(f"  {'Στήλη':<38}{'Πίνακας':>12}{'Επιστολή':>12}{'Διαφορά':>10}")
    print("  " + "─" * 72)
    for c in checks:
        status = "✓ OK" if c.ok else f"✗ {c.diff:+.2f}"
        print(f"  {c.label:<38}{c.table_sum:>12,.2f}{c.letter_total:>12,.2f}{status:>10}")
    if derived:
        print("  " + "·" * 72)
        for c in derived:
            status = "✓ OK" if c.ok else f"✗ {c.diff:+.2f}"
            print(f"  {c.label:<38}{c.table_sum:>12,.2f}{c.letter_total:>12,.2f}{status:>10}")
    print("  " + "─" * 72)

    flagged = [r for r in rows if r.needs_review]
    if flagged:
        print()
        print(f"  Γραμμές για χειροκίνητο έλεγχο ({len(flagged)}):")
        for r in flagged:
            who = f"ΑΚΑ {r.aka}" if r.aka else "(χωρίς ΑΚΑ)"
            print(f"   • Α/Α {r.aa or '—'} {who} {r.name}: {'; '.join(r.review_reasons)}")
    print()


def print_final_report(
    rows: list[TableRow],
    checks: list[ColumnCheck],
    derived: list[ColumnCheck],
    result: WriteResult,
) -> None:
    print()
    print("═" * 76)
    print("  ΤΕΛΙΚΗ ΑΝΑΦΟΡΑ")
    print("═" * 76)
    action = "αντικαταστάθηκε το υπάρχον μπλοκ" if result.replaced_existing else "νέο μπλοκ στο τέλος"
    print(f"  Γραμμές PDF: {len(rows)}   Γράφτηκαν στο «Ανάλυση»: {result.written} "
          f"(γραμμές {result.first_row}–{result.last_row}, {action})")
    if result.filled_from_history:
        print(f"  ΑΔΤ που συμπληρώθηκαν από προηγούμενους μήνες: {result.filled_from_history}")
    for c in checks + derived:
        status = "OK" if c.ok else f"ΔΙΑΦΟΡΑ {c.diff:+.2f} €"
        print(f"  {c.label}: {status}")
    flagged = [r for r in rows if r.needs_review]
    if flagged:
        print(f"  Γραμμές για χειροκίνητο έλεγχο: {len(flagged)} (βλ. παραπάνω)")
    for w in result.warnings:
        print(f"  ⚠ {w}")
    print(f"\n  Αποθηκεύτηκε: {result.output_path}")
    print("  Το ΣΥΝΟΠΤΙΚΟ ενημερώνεται μόνο του (SUMIFS) με το άνοιγμα στο Excel.")
    print()
