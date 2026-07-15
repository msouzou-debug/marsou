"""CLI: python -m daspani <επιστολή.pdf> <ΧΡΕΩΣΕΙΣ_ΕΙΔΙΚΟΙ_ΑΣΤΥΦΥΛΑΚΕΣ_2026.xlsx>"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

from openpyxl import load_workbook

from . import claude_extract, pdf_images, verify
from .claude_extract import DEFAULT_MODEL, ExtractionError
from .excel_write import (
    ExcelWriteError,
    get_analysis_sheet,
    month_block,
    output_path_for,
    write_workbook,
)
from .models import GREEK_MONTHS, normalize_month
from .report import print_final_report, print_verification

RETRY_DPI = 300  # Υψηλότερη ανάλυση για επανάληψη όταν τα σύνολα δεν κλείνουν.
YES_ANSWERS = ("ν", "ναι", "nai", "y", "yes")


def _extract_all_rows(pdf_path: str, dpi: int, model: str) -> list:
    """Διαβάζει όλες τις σελίδες πίνακα (2..τέλος) και επιστρέφει τις γραμμές."""
    pages = pdf_images.page_count(pdf_path)
    if pages < 2:
        raise ExtractionError("Το PDF έχει μόνο μία σελίδα — αναμένονται σελίδες πίνακα μετά την επιστολή.")
    chunks = []
    for page_index in range(1, pages):
        print(f"  Σελίδα {page_index + 1}/{pages}: απόδοση σε εικόνα ({dpi} dpi, +90°)…")
        png = pdf_images.render_page(pdf_path, page_index, dpi=dpi, rotate=90)
        parts = pdf_images.split_tall_image(png)
        for j, part in enumerate(parts, 1):
            suffix = f" (τμήμα {j}/{len(parts)})" if len(parts) > 1 else ""
            print(f"    Ανάγνωση πίνακα μέσω Claude API{suffix}…")
            chunks.append(claude_extract.extract_table_rows(part, model=model))
    return claude_extract.merge_rows(chunks)


def _confirm(question: str) -> bool:
    return input(f"{question} [ναι/όχι]: ").strip().lower() in YES_ANSWERS


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        prog="daspani",
        description="Μεταφορά μηνιαίας «Δαπάνης Ειδικών Αστυφυλάκων» από σαρωμένο PDF "
                    "στο φύλλο «Ανάλυση» του workbook Excel.",
    )
    parser.add_argument("pdf", help="Το σαρωμένο PDF της επιστολής (σελ. 1 επιστολή, σελ. 2+ πίνακας)")
    parser.add_argument("workbook", help="Το υπάρχον αρχείο ΧΡΕΩΣΕΙΣ ΕΙΔΙΚΟΙ ΑΣΤΥΦΥΛΑΚΕΣ (με φύλλα ΣΥΝΟΠΤΙΚΟ/Ανάλυση)")
    parser.add_argument("--minas", help="Μήνας μισθών (π.χ. ΑΠΡΙΛΙΟΣ). Αν λείπει, διαβάζεται από την επιστολή.")
    parser.add_argument("--istoriko", metavar="ΠΕΡΣΙΝΟ.xlsx",
                        help="Περσινό workbook για συμπλήρωση ΑΔΤ/νοσηλευτηρίου στους πρώτους μήνες της χρονιάς")
    parser.add_argument("--model", default=DEFAULT_MODEL, help=f"Μοντέλο Claude (προεπιλογή: {DEFAULT_MODEL})")
    parser.add_argument("--dpi", type=int, default=pdf_images.DEFAULT_DPI, help="Ανάλυση απόδοσης σελίδων")
    parser.add_argument("--sto-idio", action="store_true",
                        help="Εγγραφή απευθείας στο ίδιο αρχείο (μετά από επιβεβαίωση) αντί για νέο αντίγραφο")
    parser.add_argument("--yes", action="store_true",
                        help="Χωρίς ερωτήσεις επιβεβαίωσης (επιτρέπει και αντικατάσταση υπάρχοντος μήνα/αρχείου)")
    args = parser.parse_args(argv)

    for path, what in ((args.pdf, "PDF"), (args.workbook, "workbook")):
        if not Path(path).is_file():
            print(f"Σφάλμα: δεν βρέθηκε το αρχείο {what}: {path}", file=sys.stderr)
            return 2

    try:
        # 1. Σύνολα-ελέγχου από τη σελίδα 1.
        print("Σελίδα 1: ανάγνωση συνόλων-ελέγχου της επιστολής μέσω Claude API…")
        letter_png = pdf_images.render_page(args.pdf, 0, dpi=args.dpi, rotate=0)
        totals = claude_extract.extract_totals(letter_png, model=args.model)

        # 2. Μήνας.
        month = normalize_month(args.minas) if args.minas else totals.minas_misthon
        if not month:
            print("Σφάλμα: δεν προσδιορίστηκε ο μήνας μισθών. Δώστε τον με --minas, "
                  f"π.χ. --minas ΑΠΡΙΛΙΟΣ (έγκυροι: {', '.join(GREEK_MONTHS)})", file=sys.stderr)
            return 2
        totals.minas_misthon = month
        print(f"Μήνας μισθών: {month} {totals.etos}"
              + (f" — Επιδόματα {totals.minas_epidomaton}" if totals.minas_epidomaton else ""))

        # 3. Ονομαστικός πίνακας.
        rows = _extract_all_rows(args.pdf, args.dpi, args.model)

        # 4. Έλεγχος συνόλων· αν δεν κλείνουν, μία αυτόματη επανάληψη σε υψηλότερη ανάλυση.
        verify.basic_row_checks(rows)
        checks = verify.column_checks(rows, totals)
        if not verify.all_ok(checks) and args.dpi < RETRY_DPI:
            print(f"\n⚠ Κάποια σύνολα δεν κλείνουν — επανάληψη ανάγνωσης σε {RETRY_DPI} dpi…")
            rows_retry = _extract_all_rows(args.pdf, RETRY_DPI, args.model)
            verify.basic_row_checks(rows_retry)
            checks_retry = verify.column_checks(rows_retry, totals)
            if sum(c.ok for c in checks_retry) > sum(c.ok for c in checks):
                rows, checks = rows_retry, checks_retry

        # 5. Έλεγχοι συνέπειας ανά γραμμή (σήμανση, όχι απόρριψη).
        verify.consistency_checks(rows, tim_rate=verify.infer_tim_rate(totals))
        derived = verify.derived_checks(rows, totals)

        # 6. Εμφάνιση αποτελέσματος ελέγχου ΠΡΙΝ από κάθε εγγραφή.
        print_verification(rows, totals, checks, derived)
        if not verify.all_ok(checks):
            print("⚠ ΠΡΟΣΟΧΗ: Κάποιες στήλες ΔΕΝ κλείνουν με την επιστολή (ανοχή ±0,05 €).")
            print("  Ελέγξτε τις σημειωμένες γραμμές πριν συνεχίσετε.")

        # Υπάρχει ήδη ο μήνας στο workbook; (idempotency: αντικατάσταση, όχι διπλοεγγραφή)
        ws = get_analysis_sheet(load_workbook(args.workbook, read_only=True))
        month_exists = month_block(ws, month) is not None
        if month_exists and not args.yes:
            if not _confirm(f"Ο μήνας {month} υπάρχει ήδη στο «Ανάλυση». Να αντικατασταθεί το μπλοκ του;"):
                print("Ακυρώθηκε — δεν έγινε καμία εγγραφή.")
                return 1

        out_path = Path(args.workbook) if args.sto_idio else output_path_for(args.workbook, month)
        if not args.yes:
            target = "στο ΙΔΙΟ αρχείο" if args.sto_idio else f"στο νέο αρχείο {out_path.name}"
            if out_path.exists() and not args.sto_idio:
                target += " (υπάρχει ήδη — θα αντικατασταθεί)"
            if not _confirm(f"Συνέχεια με εγγραφή {target};"):
                print("Ακυρώθηκε — δεν έγινε καμία εγγραφή.")
                return 1

        # 7. Εγγραφή.
        result = write_workbook(
            args.workbook, month, rows,
            replace_existing=month_exists,
            save_path=str(out_path),
            history_workbook=args.istoriko,
        )

        # 8. Τελική αναφορά.
        print_final_report(rows, checks, derived, result)
        return 0

    except (ExtractionError, ExcelWriteError) as exc:
        print(f"\nΣφάλμα: {exc}", file=sys.stderr)
        return 1
    except KeyboardInterrupt:
        print("\nΔιακόπηκε από τον χρήστη.", file=sys.stderr)
        return 130


if __name__ == "__main__":
    sys.exit(main())
