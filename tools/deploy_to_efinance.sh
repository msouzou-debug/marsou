#!/usr/bin/env bash
#
# Installs the ΤΑΕΠ module into eFinance on 10.227.56.22, and checks that it worked.
#
#   sudo bash /home/administrator/marsou/tools/deploy_to_efinance.sh
#   sudo bash /home/administrator/marsou/tools/deploy_to_efinance.sh --dry-run
#
# Run it from the clone, as root. It touches only the ΤΑΕΠ files: taep.py, the taep_*
# templates and seed/. It never writes finance.db, settings.json or app.py.
#
# Registering the module (app.py, AREAS, base.html) is a one-off and is NOT here — see
# docs/deployment-runbook.md §2, §3 and §3a. This script is for every deploy after that.
#
# Stops at the first failure, on purpose. A half-installed module that restarted anyway
# is the outcome worth spending a few lines to avoid.
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# Overridable so the script can be exercised against a copy rather than only read.
# A deploy never sets these; the defaults are the real installation.
TARGET="${TAEP_TARGET:-/opt/finance}"
SERVICE="${TAEP_SERVICE:-finance.service}"
DRY_RUN=0
[ "${1:-}" = "--dry-run" ] && DRY_RUN=1

say() { printf '\n== %s\n' "$1"; }
run() {
    if [ "$DRY_RUN" = 1 ]; then printf '   [dry-run] %s\n' "$*"; else "$@"; fi
}

OWNER="-o finance -g finance"
if [ "$TARGET" != "/opt/finance" ]; then
    OWNER=""                       # a test copy has no finance user to own it
elif [ "$(id -u)" != 0 ]; then
    echo "Τρέξτε το με sudo."; exit 1
fi
[ -f "$REPO/taep.py" ] || { echo "Δεν βρέθηκε το taep.py στο $REPO"; exit 1; }
[ -d "$TARGET" ] || { echo "Δεν βρέθηκε το $TARGET"; exit 1; }
[ -f "$TARGET/app.py" ] || { echo "Το $TARGET δεν μοιάζει με εγκατάσταση eFinance"; exit 1; }
grep -q '"taep"' "$TARGET/app.py" || {
    echo "Το taep δεν είναι καταχωρημένο στο _MODULES του $TARGET/app.py."
    echo "Αυτό γίνεται μία φορά — δείτε docs/deployment-runbook.md §2."
    exit 1
}

# eFinance runs out of a virtualenv (/opt/finance/venv), which is where openpyxl and
# reportlab live — not system-wide. Found on 27/10/2026, when build_icd10.py failed on
# the system python with ModuleNotFoundError. The checks here had been using `python3`
# and getting away with it: taep.py defers every openpyxl and reportlab import into the
# function that needs it, so importing the module works without them. Use the
# interpreter the application actually runs under, so a check means what it says.
PY="python3"
[ -x "$TARGET/venv/bin/python3" ] && PY="$TARGET/venv/bin/python3"

say "Έκδοση που εγκαθίσταται"
git -C "$REPO" log --oneline -1
EXPECTED="$(sha256sum "$REPO/taep.py" | cut -d' ' -f1)"
echo "   taep.py sha256: ${EXPECTED:0:16}"
echo "   python: $PY"

say "Αντίγραφο ασφαλείας"
BACKUP="${TAEP_BACKUP_DIR:-/home/administrator}/prod-backup-$(date +%Y%m%d-%H%M%S)"
run cp -a "$TARGET" "$BACKUP"
echo "   $BACKUP"

say "Αντιγραφή αρχείων"
run install $OWNER -m 644 "$REPO/taep.py" "$TARGET/taep.py"
for template in "$REPO"/templates/taep_*.html; do
    run install $OWNER -m 644 "$template" "$TARGET/templates/"
    echo "   $(basename "$template")"
done
if [ -d "$TARGET/seed" ]; then
    run install $OWNER -m 644 "$REPO"/seed/*.csv "$TARGET/seed/"
    echo "   seed/*.csv"
fi
run install $OWNER -m 644 "$REPO/tools/check_readiness.py" \
    "$TARGET/check_readiness.py"

say "Επανεκκίνηση"
run systemctl restart "$SERVICE"
if [ "$DRY_RUN" = 0 ]; then
    sleep 20
    systemctl is-active --quiet "$SERVICE" || {
        echo "Η υπηρεσία ΔΕΝ ξεκίνησε. Τα τελευταία μηνύματα:"
        journalctl -u "$SERVICE" --since "-2 min" --no-pager | tail -40
        echo
        echo "Επαναφορά: sudo rm -rf $TARGET && sudo cp -a $BACKUP $TARGET && sudo systemctl restart $SERVICE"
        exit 1
    }
fi
echo "   ενεργή"

READY=0
say "Έλεγχοι"
if [ "$DRY_RUN" = 0 ]; then
    # 1. Did the install itself work? Answered first, and fatal: everything below is
    #    about the data, and there is no point reading it against the wrong code.
    INSTALLED="$(sha256sum "$TARGET/taep.py" | cut -d' ' -f1)"
    if [ "$INSTALLED" != "$EXPECTED" ]; then
        echo "ΣΦΑΛΜΑ: το εγκατεστημένο taep.py δεν ταιριάζει με το αποθετήριο."
        exit 1
    fi
    echo "   taep.py εγκαταστάθηκε και επαληθεύτηκε: ${INSTALLED:0:16}"
    echo "   Αντίγραφο ασφαλείας: $BACKUP"

    # 2. The tables. Fatal: a missing table means the restart did not take.
    echo
    "$PY" "$REPO/tools/show_taep_tables.py" "$TARGET/finance.db"

    # 3. The data. NOT fatal, and the `|| READY=$?` is why: a missing ICD-10 catalogue
    #    is a real blocker to going live and a perfectly normal state right after a
    #    deploy, since the catalogue is copied separately (§1c). Letting it abort the
    #    script meant the operator saw the blocker and never saw whether the install
    #    had worked — which happened on 27/10/2026.
    echo
    sudo -u finance env FINANCE_DB="$TARGET/finance.db" \
        "$PY" "$TARGET/check_readiness.py" || READY=$?
else
    echo "   (dry-run: δεν έγιναν έλεγχοι)"
fi

say "Μετά την εγκατάσταση"
echo "   Συνδεθείτε και ανοίξτε μια κοστολόγηση για να δείτε τις αλλαγές."
echo "   Σε πρόβλημα: sudo rm -rf $TARGET && sudo cp -a $BACKUP $TARGET && sudo systemctl restart $SERVICE"

# The deploy succeeded; the readiness verdict is passed on as the exit code so a script
# calling this one can tell "installed, not yet ready" from "installed and ready".
exit "$READY"
