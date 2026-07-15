"""Εμφάνιση αποτελεσμάτων ελέγχου και τελικής αναφοράς στον χρήστη."""

from __future__ import annotations

from .excel_write import WriteResult
from .models import LetterTotals, TableRow
from .verify import ColumnCheck


def print_verification(rows: list[TableRow], totals: LetterTotals, checks: list[ColumnCheck]) -> None:
    print()
    print("═" * 72)
    print(f"  ΕΛΕΓΧΟΣ ΣΥΝΟΛΩΝ — Μισθοί {totals.minas_misthon} {totals.etos}"
          + (f" / Επιδόματα {totals.minas_epidomaton}" if totals.minas_epidomaton else ""))
    print("═" * 72)
    print(f"  Γραμμές που διαβάστηκαν από το PDF: {len(rows)}")
    print()
    print(f"  {'Στήλη':<34}{'Πίνακας':>12}{'Επιστολή':>12}{'Διαφορά':>10}")
    print("  " + "─" * 68)
    for c in checks:
        status = "✓ OK" if c.ok else f"✗ {c.diff:+.2f}"
        print(f"  {c.label:<34}{c.table_sum:>12,.2f}{c.letter_total:>12,.2f}{status:>10}")
    print("  " + "─" * 68)
    print(f"  Επιστολή — Εισφορά Εργοδότη: {totals.eisfora:,.2f}   "
          f"Διοικητικά 10%: {totals.dioikitika:,.2f}   Γενικό Σύνολο: {totals.geniko:,.2f}")

    flagged = [r for r in rows if r.needs_review]
    if flagged:
        print()
        print(f"  Γραμμές για χειροκίνητο έλεγχο ({len(flagged)}):")
        for r in flagged:
            who = f"ΑΚΑ {r.aka}" if r.aka else "(χωρίς ΑΚΑ)"
            print(f"   • Α/Α {r.aa or '—'} {who} {r.name}: {'; '.join(r.review_reasons)}")
    print()


def print_final_report(rows: list[TableRow], checks: list[ColumnCheck], result: WriteResult) -> None:
    print()
    print("═" * 72)
    print("  ΤΕΛΙΚΗ ΑΝΑΦΟΡΑ")
    print("═" * 72)
    print(f"  Γραμμές PDF: {len(rows)}   Ταίριαξαν σε υπάρχουσες: {result.matched}   "
          f"Νέες γραμμές: {result.inserted}   Παραλείφθηκαν (διπλές): {result.skipped_duplicates}")
    for c in checks:
        status = "OK" if c.ok else f"ΔΙΑΦΟΡΑ {c.diff:+.2f} €"
        print(f"  {c.label}: {status}")
    if result.unmatched_akas:
        print("  Α.Κ.Α. που δεν υπήρχαν στο φύλλο (προστέθηκαν ως νέες γραμμές):")
        for a in result.unmatched_akas:
            print(f"   • {a}")
    flagged = [r for r in rows if r.needs_review]
    if flagged:
        print(f"  Γραμμές για χειροκίνητο έλεγχο: {len(flagged)} (βλ. παραπάνω)")
    for w in result.warnings:
        print(f"  ⚠ {w}")
    print(f"\n  Αποθηκεύτηκε: {result.output_path}")
    print("  Ανοίξτε το αρχείο στο Excel για recalculation (ΣΥΝΟΠΤΙΚΟ, ΕΛΕΓΧΟΣ ΣΥΝΟΛΩΝ).")
    print()
