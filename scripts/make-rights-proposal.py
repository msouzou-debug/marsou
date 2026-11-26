#!/usr/bin/env python3
"""Build the decision workbook on the rights matrix (26/11/2026).

    .venv/bin/python scripts/make-rights-proposal.py

Writes docs/decisions/eHire-rights-matrix-proposal-2026-11-26.xlsx. Nothing in the app reads it.

The ✓ marks are worked out from ehire/seed_data.json (`role_permissions`); role and screen names are read from
ehire/i18n/el.json and en.json, so the workbook always uses the labels the app shows. Every total on the summary
sheet is a formula. `--check` rebuilds nothing: it opens the saved file and checks it against the seed file.
"""
import json
import os
import sys

from openpyxl import Workbook, load_workbook
from openpyxl.styles import Alignment, Border, Font, PatternFill, Side
from openpyxl.utils import get_column_letter
from openpyxl.worksheet.datavalidation import DataValidation

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "docs", "decisions", "eHire-rights-matrix-proposal-2026-11-26.xlsx")

with open(os.path.join(ROOT, "ehire", "seed_data.json"), encoding="utf-8") as fh:
    ROLE_PERMISSIONS = json.load(fh)["role_permissions"]
with open(os.path.join(ROOT, "ehire", "i18n", "el.json"), encoding="utf-8") as fh:
    EL = json.load(fh)
with open(os.path.join(ROOT, "ehire", "i18n", "en.json"), encoding="utf-8") as fh:
    EN = json.load(fh)

ROLES = list(ROLE_PERMISSIONS)  # the order of the seed file: Directorate roles, central roles, viewer, admin
TICK = "✓"
LOCKED, EDITABLE, DISCUSS = "Κλειδωμένο", "Αλλάζει", "Να συζητηθεί"
CHOICES = (EDITABLE, LOCKED, DISCUSS)

SHEET_HELP, SHEET_RIGHTS, SHEET_RULES, SHEET_SUM = "Οδηγίες", "Δικαιώματα", "Σταθεροί κανόνες", "Σύνοψη"


def el(key):
    return EL[key]  # a missing key stops the build: the workbook must not invent a label


def en(key):
    return EN[key]


def q(key):
    """A screen label in Greek quotation marks."""
    return "«%s»" % el(key)


def qe(key):
    return "“%s”" % en(key)


# ---------------------------------------------------------------- the proposed rights
# today: ("keys", [...]) a role has it when it holds any of these keys in the seed file;
#        ("everyone",) no key guards it today, every signed-in person who can open the request has it;
#        ("nobody",)   it does not exist yet.

A_REQ = ("Αιτήματα", "Requests")
A_AUD = ("Έλεγχος", "Audit")
A_USR = ("Χρήστες και ρόλοι", "Users and roles")
A_LST = ("Λίστες", "Lists")
A_SYS = ("Λειτουργία", "Operation")

S = "settings.manage"

RIGHTS = [
    dict(area=A_REQ, el="Δημιουργία αιτήματος", en="Create a request",
         what_el="Νέο αίτημα, αποθήκευση ως πρόχειρο, υποβολή, διόρθωση και επανυποβολή αιτήματος που επιστράφηκε, "
                 "προσθήκη εγγράφων στο δικό του αίτημα.",
         what_en="New request, save as draft, submit, correct and resubmit a returned request, add documents to "
                 "one's own request.",
         today=("keys", ["request.create"]), key="request.create", rec=EDITABLE,
         why_el="Δεν αγγίζει τη διαδρομή έγκρισης. Με ένα ✓ ο Διαχειριστής θα υποβάλλει αιτήματα χωρίς να οριστεί "
                "Αιτητής σε Διεύθυνση. Προσοχή: όποιος το χάσει δεν μπορεί να επανυποβάλει αίτημα που του επιστράφηκε.",
         why_en="It does not touch the approval route. One tick lets the Administrator raise requests without being "
                "made a Requester of a Directorate. Note: whoever loses it cannot resubmit a request returned to them."),
    dict(area=A_REQ, el="Προβολή των δικών του αιτημάτων", en="See one's own requests",
         what_el="Βλέπει τα αιτήματα που δημιούργησε ο ίδιος, και τα πρόχειρα.",
         what_en="Sees the requests they created, drafts included.",
         today=("keys", ["request.view_own"]), key="request.view_own", rec=LOCKED,
         why_el="Το έχουν όλοι οι ρόλοι. Ο κώδικας δεν ελέγχει καν το κλειδί: όποιος δημιούργησε ένα αίτημα το "
                "βλέπει πάντα. Χωρίς αυτό ο Αιτητής δεν θα έβλεπε την επιστροφή.",
         why_en="Every role has it. The code never checks the key: whoever created a request always sees it. "
                "Without it a Requester would not see a return."),
    dict(area=A_REQ, el="Προβολή όλων των αιτημάτων της Διεύθυνσής του", en="See every request of one's Directorate",
         what_el="Βλέπει όλα τα υποβληθέντα αιτήματα της Διεύθυνσης όπου κατέχει ρόλο ή αναπληρώνει.",
         what_en="Sees every submitted request of the Directorate where they hold a role or stand in.",
         today=("keys", ["request.view_directorate"]), key="request.view_directorate", rec=LOCKED,
         why_el="Το τι βλέπει κάποιος βγαίνει από τον ρόλο και τη Διεύθυνσή του, όχι από το κλειδί (κανόνας στο "
                "φύλλο «Σταθεροί κανόνες»). Αν γίνει δικαίωμα, αλλάζει ποιος βλέπει προσωπικά δεδομένα.",
         why_en="What a person sees comes from their role and Directorate, not from the key (see the fixed rules "
                "sheet). Turning it into a right changes who sees personal data."),
    dict(area=A_REQ, el="Προβολή όλων των αιτημάτων του Οργανισμού", en="See every request in the organisation",
         what_el="Βλέπει όλα τα υποβληθέντα αιτήματα, από κάθε Διεύθυνση, στην καρτέλα %s." % q("list.tab.all"),
         what_en="Sees every submitted request, from any Directorate, on the %s tab." % qe("list.tab.all"),
         today=("keys", ["request.view_all"]), key="request.view_all", rec=LOCKED,
         why_el="Σήμερα το δίνει το όνομα του ρόλου (κεντρικοί ρόλοι, %s, %s), όχι το κλειδί. Οι κεντρικοί ρόλοι το "
                "χρειάζονται για να ελέγξουν, και ο %s υπάρχει μόνο γι' αυτό."
                % (el("role.viewer"), el("role.admin"), el("role.viewer")),
         why_en="Today the role's name grants it (central roles, %s, %s), not the key. Central roles need it to do "
                "their checks, and the %s exists only for this." % (en("role.viewer"), en("role.admin"), en("role.viewer"))),
    dict(area=A_REQ, el="Εξαγωγή της λίστας αιτημάτων σε Excel", en="Export the request list to Excel",
         what_el="Το κουμπί %s στη λίστα. Το αρχείο περιέχει μόνο όσα αιτήματα βλέπει ήδη ο χρήστης." % q("list.export"),
         what_en="The %s button on the list. The file holds only the requests the person already sees." % qe("list.export"),
         today=("keys", ["request.view_all", "request.view_directorate"]),
         key="request.view_all ή request.view_directorate", rec=EDITABLE,
         why_el="Μόνο προβολή. Δεν δείχνει τίποτα παραπάνω από τη λίστα, και κάθε εξαγωγή γράφεται στο %s."
                % el("nav.audit"),
         why_en="Viewing only. It shows nothing beyond the list, and every export is written to the %s." % en("nav.audit")),
    dict(area=A_REQ, el="Απάντηση σε βήμα έγκρισης", en="Answer an approval step",
         what_el="Έλεγχος, γνώμη, έγκριση, απόρριψη ή επιστροφή, όταν το αίτημα περιμένει τον ίδιο.",
         what_en="Check, opinion, approval, rejection or return, when the request is waiting for them.",
         today=("keys", ["request.act"]), key="request.act", rec=LOCKED,
         why_el="Το ποιος απαντά το ορίζει η διαδρομή: μόνο όποιος έχει το βήμα, ποτέ ο αιτητής του αιτήματος. "
                "Σήμερα το κλειδί ορίζει μόνο ποια καρτέλα ανοίγει πρώτη. Ο %s δεν απαντά ποτέ." % el("role.viewer"),
         why_en="The route decides who answers: only the person holding the step, never the request's own requester. "
                "Today the key only picks which tab opens first. The %s never answers." % en("role.viewer")),
    dict(area=A_REQ, el="Προβολή και κατέβασμα των εγγράφων ενός αιτήματος", en="View and download a request's documents",
         what_el="Ανοίγει ή κατεβάζει τα συνημμένα έγγραφα των αιτημάτων που βλέπει.",
         what_en="Opens or downloads the documents attached to the requests they see.",
         today=("everyone",), key="κανένα: όποιος βλέπει το αίτημα / none: whoever sees the request", rec=EDITABLE,
         why_el="Τα έγγραφα έχουν προσωπικά δεδομένα. Όσοι εγκρίνουν τα χρειάζονται, άρα τα κελιά τους μένουν "
                "κλειδωμένα. Για %s και %s είναι επιλογή σας." % (el("role.viewer"), el("role.admin")),
         why_en="Documents carry personal data. Approvers need them, so their cells stay locked. For the %s and the "
                "%s it is your choice." % (en("role.viewer"), en("role.admin"))),

    dict(area=A_AUD, el=el("nav.audit"), en=en("nav.audit"),
         what_el="Βλέπει τη σελίδα %s: ποιος έκανε τι και πότε, με φίλτρα." % q("nav.audit"),
         what_en="Sees the %s page: who did what and when, with filters." % qe("nav.audit"),
         today=("keys", ["audit.view"]), key="audit.view", rec=EDITABLE,
         why_el="Μόνο προβολή· το ημερολόγιο δεν αλλάζει από καμία οθόνη. Χρήσιμο αν το θέλει και ο Εσωτερικός "
                "Έλεγχος ως %s." % el("role.viewer"),
         why_en="Viewing only; no screen changes the log. Useful if Internal Audit should have it as a %s."
                % en("role.viewer")),

    dict(area=A_USR, el="%s: προβολή" % el("settings.users"), en="%s: view" % en("settings.users"),
         what_el="Βλέπει τη λίστα %s και τη σελίδα κάθε χρήστη: λογαριασμός, ρόλοι, Διευθύνσεις, ποιον αναπληρώνει."
                 % q("settings.users"),
         what_en="Sees the %s list and each person's page: account, roles, Directorates, whom they cover for."
                 % qe("settings.users"),
         today=("keys", [S]), key=S, rec=EDITABLE,
         why_el="Μόνο προβολή. Βοηθά όποιον πρέπει να ξέρει ποιος εγκρίνει τι, χωρίς να μπορεί να το αλλάξει.",
         why_en="Viewing only. It helps someone who must know who approves what, without being able to change it."),
    dict(area=A_USR, el="%s: προσθήκη, αλλαγή, ενεργοποίηση" % el("settings.users"),
         en="%s: add, change, switch on or off" % en("settings.users"),
         what_el="Προσθέτει χρήστη (τοπικό ή Active Directory), αλλάζει τα στοιχεία του, ενεργοποιεί ή απενεργοποιεί "
                 "λογαριασμό.",
         what_en="Adds a user (local or Active Directory), changes their details, switches an account on or off.",
         today=("keys", [S]), key=S, rec=LOCKED,
         why_el="Μένει στον Διαχειριστή. Αν το χάσει, κανείς δεν ενεργοποιεί λογαριασμούς· αν το πάρει άλλος, "
                "απενεργοποιεί εγκρίνοντες και οι εργασίες τους μετακινούνται.",
         why_en="Stays with the Administrator. If he loses it nobody can activate accounts; if someone else gets it "
                "they can switch approvers off and their tasks move."),
    dict(area=A_USR, el=el("settings.user.set_password"), en=en("settings.user.set_password"),
         what_el="Ορίζει προσωρινό κωδικό σε τοπικό λογαριασμό άλλου χρήστη και καθαρίζει το κλείδωμα μετά από "
                 "αποτυχημένες προσπάθειες.",
         what_en="Sets a temporary password on another person's local account and clears the lock after failed "
                 "attempts.",
         today=("keys", [S]), key=S, rec=LOCKED,
         why_el="Όποιος ορίζει τον κωδικό ενός εγκρίνοντος μπορεί να συνδεθεί ως εκείνος και να απαντήσει στη θέση του.",
         why_en="Whoever sets an approver's password can sign in as that approver and answer in their place."),
    dict(area=A_USR, el=el("settings.roles"), en=en("settings.roles"),
         what_el="Ορίζει Κάτοχο και αναπληρωτή για κάθε ρόλο και Διεύθυνση, Αιτητές, Χρήστες προβολής και "
                 "Διαχειριστές, από τη σελίδα %s ή από τη σελίδα του χρήστη." % q("settings.roles"),
         what_en="Appoints the holder and the substitute of each role and Directorate, Requesters, Viewers and "
                 "Administrators, on the %s page or on the person's page." % qe("settings.roles"),
         today=("keys", [S]), key=S, rec=LOCKED,
         why_el="Εδώ ορίζεται ποιος εγκρίνει. Όποιος το έχει βάζει τον εαυτό του σε οποιοδήποτε βήμα ή φτιάχνει νέο "
                "Διαχειριστή.",
         why_en="This is where it is set who approves. Whoever has it can put themselves on any step or create a new "
                "Administrator."),
    dict(area=A_USR, el="Πίνακας δικαιωμάτων (νέο)", en="Rights matrix (new)",
         what_el="Αλλάζει τα ✓ του πίνακα δικαιωμάτων, όταν χτιστεί.",
         what_en="Changes the ticks of the rights matrix, once it is built.",
         today=("nobody",), key="δεν υπάρχει ακόμη / does not exist yet", rec=LOCKED,
         why_el="Μόνο ο Διαχειριστής, όπως στο eFinance και στο eCapital. Αλλιώς ένας ρόλος δίνει δικαιώματα στον "
                "εαυτό του.",
         why_en="The Administrator only, as in eFinance and eCapital. Otherwise a role could give itself rights."),
    dict(area=A_USR, el=el("import.menu"), en=en("import.menu"),
         what_el="Ανεβάζει αρχείο Excel που προσθέτει ή αλλάζει μαζικά χρήστες, Κατόχους ρόλων και τις λίστες.",
         what_en="Uploads an Excel file that adds or changes users, role holders and the lists in bulk.",
         today=("keys", [S]), key=S, rec=LOCKED,
         why_el="Κάνει μαζικά ό,τι κάνουν οι γραμμές «%s» και «%s», άρα ακολουθεί το ίδιο κλείδωμα."
                % (el("settings.users"), el("settings.roles")),
         why_en="It does in bulk what the “%s” and “%s” rows do, so it follows the same lock."
                % (en("settings.users"), en("settings.roles"))),

    dict(area=A_LST, el=el("settings.list.directorate"), en=en("settings.list.directorate"),
         what_el="Προσθέτει, μετονομάζει ή απενεργοποιεί Διεύθυνση και σημειώνει το %s." % q("settings.has_sci_director"),
         what_en="Adds, renames or deactivates a Directorate and sets %s." % qe("settings.has_sci_director"),
         today=("keys", [S]), key=S, rec=LOCKED,
         why_el="Το %s αλλάζει τη διαδρομή των νέων αιτημάτων: με αυτό ζητείται ή όχι η γνώμη του Επιστημονικού "
                "Διευθυντή." % q("settings.has_sci_director"),
         why_en="%s changes the route of new requests: it decides whether the Scientific Director's opinion is asked."
                % qe("settings.has_sci_director")),
    dict(area=A_LST, el=el("settings.list.facility"), en=en("settings.list.facility"),
         what_el="Προσθέτει, μετονομάζει ή απενεργοποιεί νοσοκομείο ή δομή και ορίζει τον κωδικό τοποθεσίας του eArchive.",
         what_en="Adds, renames or deactivates a hospital or facility and sets its eArchive site code.",
         today=("keys", [S]), key=S, rec=EDITABLE,
         why_el="Συντήρηση λίστας. Δεν επηρεάζει ποιος εγκρίνει.",
         why_en="List upkeep. It does not affect who approves."),
    dict(area=A_LST, el=el("settings.list.position"), en=en("settings.list.position"),
         what_el="Προσθέτει, μετονομάζει ή απενεργοποιεί θέση και ορίζει τον κωδικό θέσης για τον αριθμό αιτήματος.",
         what_en="Adds, renames or deactivates a position and sets the position code used in request numbers.",
         today=("keys", [S]), key=S, rec=EDITABLE,
         why_el="Συντήρηση λίστας. Θα μπορούσε να την κρατά το Ανθρώπινο Δυναμικό.",
         why_en="List upkeep. HR could keep it."),
    dict(area=A_LST, el=el("settings.list.cost_centre"), en=en("settings.list.cost_centre"),
         what_el="Αλλάζει με το χέρι κέντρο κόστους ή τη Διεύθυνσή του. Με τη σύνδεση ανοιχτή, ο επόμενος "
                 "συγχρονισμός το επαναφέρει στις τιμές του eFinance.",
         what_en="Changes a cost centre or its Directorate by hand. With the link on, the next sync puts it back to "
                 "eFinance's values.",
         today=("keys", [S]), key=S, rec=EDITABLE,
         why_el="Κύρια πηγή είναι το eFinance, άρα μια αλλαγή με το χέρι κρατά ως τον επόμενο συγχρονισμό.",
         why_en="eFinance is the master list, so a change by hand lasts until the next sync."),
    dict(area=A_LST, el=el("settings.list.oay_specialty"), en=en("settings.list.oay_specialty"),
         what_el="Προσθέτει, μετονομάζει ή απενεργοποιεί ειδικότητα ΟΑΥ.",
         what_en="Adds, renames or deactivates an ΟΑΥ specialty.",
         today=("keys", [S]), key=S, rec=EDITABLE,
         why_el="Συντήρηση λίστας.", why_en="List upkeep."),

    dict(area=A_SYS, el="%s: %s" % (el("settings.efinance.title"), el("settings.efinance.sync_now")),
         en="%s: %s" % (en("settings.efinance.title"), en("settings.efinance.sync_now")),
         what_el="Βλέπει την κατάσταση της σύνδεσης και πατά %s για τα κέντρα κόστους." % q("settings.efinance.sync_now"),
         what_en="Sees the state of the link and presses %s for the cost centres." % qe("settings.efinance.sync_now"),
         today=("keys", [S]), key=S, rec=EDITABLE,
         why_el="Κάνει ό,τι κάνει και ο νυχτερινός συγχρονισμός των 02:40. Το άνοιγμα και το κλείσιμο της σύνδεσης "
                "γίνονται μόνο από τον διακομιστή.",
         why_en="It does what the nightly sync at 02:40 does. Switching the link on or off happens on the server only."),
    dict(area=A_SYS, el=el("settings.holidays"), en=en("settings.holidays"),
         what_el="Προσθέτει ή αφαιρεί αργίες. Οι αργίες δεν μετρούν στις εργάσιμες ημέρες.",
         what_en="Adds or removes public holidays. Holidays do not count as working days.",
         today=("keys", [S]), key=S, rec=EDITABLE,
         why_el="Συντήρηση μία φορά τον χρόνο. Μετακινεί υπενθυμίσεις κατά μία ημέρα, τίποτα παραπάνω.",
         why_en="Upkeep once a year. It moves reminders by a day, nothing more."),
    dict(area=A_SYS, el=el("settings.timings"), en=en("settings.timings"),
         what_el="Ορίζει ημέρες υπενθύμισης και κλιμάκωσης, ημέρες ως την αυτόματη απόσυρση αιτήματος που "
                 "επιστράφηκε, μέγιστο μέγεθος αρχείου και την πηγή των στοιχείων ΟΑΥ.",
         what_en="Sets the reminder and escalation days, the days until a returned request is withdrawn "
                 "automatically, the largest file size and where the ΟΑΥ figures come from.",
         today=("keys", [S]), key=S, rec=LOCKED,
         why_el="Με όριο 1 ημέρα αποσύρονται αυτόματα όλα τα αιτήματα που έχουν επιστραφεί, και η απόσυρση δεν "
                "αναιρείται.",
         why_en="With a limit of 1 day every returned request is withdrawn automatically, and a withdrawal cannot be "
                "undone."),
    dict(area=A_SYS, el=el("settings.outbox"), en=en("settings.outbox"),
         what_el="Βλέπει ποια email έστειλε το eHire, σε ποιον, και το κείμενό τους.",
         what_en="Sees which emails eHire sent, to whom, and their text.",
         today=("keys", [S]), key=S, rec=EDITABLE,
         why_el="Μόνο προβολή. Χρήσιμο σε όποιον απαντά στο «δεν μου ήρθε email».",
         why_en="Viewing only. Useful to whoever answers “I never got the email”."),
    dict(area=A_SYS, el="%s: προβολή και PDF αιτήματος" % el("settings.archive"),
         en="%s: view, and the request PDF" % en("settings.archive"),
         what_el="Βλέπει την ουρά των αποστολών και ανοίγει το PDF του αιτήματος (%s)." % q("settings.archive.view_pdf"),
         what_en="Sees the queue of deposits and opens the request PDF (%s)." % qe("settings.archive.view_pdf"),
         today=("keys", [S]), key=S, rec=EDITABLE,
         why_el="Μόνο προβολή, αλλά το PDF έχει ολόκληρο το αίτημα με προσωπικά δεδομένα. Δώστε το μόνο σε ρόλο "
                "που βλέπει ήδη όλα τα αιτήματα.",
         why_en="Viewing only, but the PDF holds the whole request with personal data. Give it only to a role that "
                "already sees every request."),
    dict(area=A_SYS, el="%s: %s" % (el("settings.archive"), el("settings.archive.retry")),
         en="%s: %s" % (en("settings.archive"), en("settings.archive.retry")),
         what_el="Βάζει ξανά στην ουρά μια αποστολή που απέτυχε ή έχει μπλοκαριστεί.",
         what_en="Queues again a deposit that failed or is blocked.",
         today=("keys", [S]), key=S, rec=EDITABLE,
         why_el="Στέλνει ξανά το ίδιο αντίγραφο. Δεν αλλάζει το περιεχόμενό του ούτε το αίτημα.",
         why_en="It sends the same copy again. It changes neither its content nor the request."),
    dict(area=A_SYS, el="%s: %s και αρχεία UAT" % (el("nav.manuals"), el("manuals.admin_guide")),
         en="%s: %s and UAT files" % (en("nav.manuals"), en("manuals.admin_guide")),
         what_el="Βλέπει στα %s τον %s, το σχέδιο και τα σενάρια δοκιμών. Τον %s τον βλέπουν όλοι."
                 % (q("nav.manuals"), el("manuals.admin_guide"), el("manuals.user_guide")),
         what_en="Sees the %s, the test plan and the test scripts under %s. Everyone sees the %s."
                 % (en("manuals.admin_guide"), qe("nav.manuals"), en("manuals.user_guide")),
         today=("keys", [S]), key=S, rec=EDITABLE,
         why_el="Μόνο ανάγνωση.", why_en="Reading only."),
]


def has_today(right, role):
    kind = right["today"][0]
    if kind == "everyone":
        return True
    if kind == "nobody":
        return False
    return any(k in ROLE_PERMISSIONS[role] for k in right["today"][1])


# ---------------------------------------------------------------- fixed rules (never in the matrix)
C02, C03 = "Συμβόλαιο 02", "Συμβόλαιο 03"
RULES = [
    ("Η διαδρομή έγκρισης: ποιος ρόλος ερωτάται σε κάθε βήμα βγαίνει από την κατηγορία της θέσης και τη Διεύθυνση.",
     "The approval route: which role is asked at each step follows from the position's category and the Directorate.",
     "%s, R1–R3 · ehire/workflow/route.py" % C02),
    ("Η διαδρομή αποθηκεύεται στην υποβολή. Μια μεταγενέστερη αλλαγή κανόνων δεν αλλάζει αίτημα που τρέχει.",
     "The route is stored at submission. A later change of rules does not reroute a request in progress.",
     "%s, R4" % C02),
    ("Τα βήματα γίνονται με τη σειρά. «Όχι» στο διαθέσιμο κονδύλι ή στην πίστωση απορρίπτει το αίτημα.",
     "Steps happen in order. A “No” on funds or on credit rejects the request.",
     "%s, T1–T7" % C02),
    ("Κανείς δεν απαντά σε αίτημα που υπέβαλε ο ίδιος, ούτε ο Διαχειριστής. Η εργασία πάει στον αναπληρωτή ή στον "
     "προϊστάμενο.",
     "Nobody answers a request they submitted, the Administrator included. The task goes to the substitute or the "
     "line manager.",
     "%s, C3 και σφάλμα own_request · απόφαση Μάριου" % C02),
    ("Σε μια εργασία απαντά μόνο όποιος την έχει εκείνη τη στιγμή.",
     "Only the person who holds a task at that moment can answer it.",
     "%s, C7 και σφάλμα not_your_task" % C02),
    ("Η εργασία πάει στον Κάτοχο του ρόλου· αν είναι εκτός γραφείου, στον αναπληρωτή. Εκτός γραφείου δηλώνει μόνο "
     "Κάτοχος ρόλου που εγκρίνει.",
     "A task goes to the holder of the role; when the holder is out of office, to the substitute. Only the holder "
     "of an approving role can declare out of office.",
     "%s, C1, C2, C4, C6" % C02),
    ("Όταν αλλάζει Κάτοχος ή αναπληρωτής ή απενεργοποιείται λογαριασμός, οι εργασίες που περιμένουν μετακινούνται "
     "μόνες τους. Καμία εργασία δεν πάει σε απενεργοποιημένο λογαριασμό.",
     "When a holder or substitute changes or an account is switched off, waiting tasks move by themselves. No task "
     "ever goes to a switched-off account.",
     "%s, C8 · απόφαση Μάριου 26/11/2026" % C02),
    ("Αν δεν μένει κανείς για μια εργασία, μένει χωρίς υπεύθυνο και ενημερώνονται οι Διαχειριστές.",
     "When nobody is left for a task it stays unassigned and the Administrators are told.",
     "%s, C5 · ehire/services/notify.py" % C02),
    ("Μόνο ο αιτητής υποβάλλει, επανυποβάλλει και αποσύρει το αίτημά του. Το διορθώνει μόνο όσο είναι πρόχειρο ή "
     "έχει επιστραφεί.",
     "Only the requester submits, resubmits and withdraws their request. They can correct it only while it is a "
     "draft or returned.",
     "%s, T1, T9, T11 και σφάλμα not_requester" % C02),
    ("Η Διεύθυνση ενός αιτήματος δεν αλλάζει μετά την πρώτη υποβολή. Ουσιώδης αλλαγή στην επανυποβολή το γυρίζει "
     "στο βήμα 2.",
     "A request's Directorate cannot change after the first submission. A material change on resubmission sends it "
     "back to step 2.",
     "%s, T9b, O1 και σφάλμα directorate_locked" % C02),
    ("Σχόλιο είναι υποχρεωτικό σε απόρριψη, επιστροφή, απόσυρση, αρνητική γνώμη, «Ελλιπής» και «Όχι», και σε «Ναι» "
     "παρά την προειδοποίηση προϋπολογισμού.",
     "A comment is required on a rejection, a return, a withdrawal, a negative opinion, “Incomplete” and “No”, and "
     "on a “Yes” against a budget warning.",
     "%s, O4, B1" % C02),
    ("Ποιος βλέπει ένα αίτημα: ο αιτητής τα δικά του· Κάτοχος ή αναπληρωτής ρόλου Διεύθυνσης όσα είναι της "
     "Διεύθυνσής του· κεντρικοί ρόλοι, Χρήστης προβολής και Διαχειριστής όλα· όποιος έχει εργασία σε αίτημα, αυτό "
     "το αίτημα.",
     "Who sees a request: the requester their own; the holder or substitute of a Directorate role those of that "
     "Directorate; central roles, the Viewer and the Administrator all; anyone with a task on a request, that "
     "request.",
     "%s, ενότητα 2 · ehire/auth/visibility.py" % C03),
    ("Το πρόχειρο το βλέπει μόνο όποιος το έγραψε.",
     "A draft is seen only by the person who wrote it.",
     "%s, ενότητα 2" % C03),
    ("Ο αιτητής βλέπει το αποτέλεσμα κάθε βήματος και το σχόλιο μόνο σε επιστροφή, απόρριψη ή απόσυρση.",
     "The requester sees each step's outcome, and the comment only on a return, rejection or withdrawal.",
     "%s, ενότητα 2 (ανοιχτό σημείο προς τον Μάριο)" % C03),
    ("Τα έγγραφα ακολουθούν το αίτημα. Έγγραφο προσθέτει ή αφαιρεί μόνο ο αιτητής, όσο το αίτημα είναι πρόχειρο ή "
     "έχει επιστραφεί.",
     "Documents follow the request. Only the requester adds or removes one, while the request is a draft or returned.",
     "%s, ενότητα 1 · ehire/documents/routes.py" % C03),
    ("Ο Χρήστης προβολής δεν μπαίνει σε καμία διαδρομή, άρα δεν απαντά ποτέ.",
     "The Viewer is on no route, so never answers.",
     "%s, R1–R3" % C02),
    ("Ένας Κάτοχος και ένας αναπληρωτής ανά ρόλο και Διεύθυνση. Πολλοί μόνο οι Αιτητές, οι Χρήστες προβολής και οι "
     "Διαχειριστές.",
     "One holder and one substitute per role and Directorate. Only Requesters, Viewers and Administrators can be many.",
     "Απόφαση Μάριου 26/11/2026 · ehire/services/role_admin.py"),
    ("Κανείς δεν αφαιρεί τον δικό του ρόλο Διαχειριστή ούτε απενεργοποιεί τον δικό του λογαριασμό. Ο τελευταίος "
     "ενεργός Διαχειριστής δεν αφαιρείται.",
     "Nobody removes their own Administrator role or switches off their own account. The last active Administrator "
     "cannot be removed.",
     "Απόφαση Μάριου 26/11/2026 · ehire/services/role_admin.py"),
    ("Το Ημερολόγιο ελέγχου δεν αλλάζει από καμία οθόνη.",
     "No screen changes the audit log.",
     "Συμβόλαιο 01 · ehire/audit"),
    ("Τα email δεν καταγράφουν ενέργεια: ένα κουμπί, «Προβολή αιτήματος», μετά σύνδεση.",
     "Emails never record an action: one button, “View request”, then sign-in.",
     "Απόφαση έργου (memory.md)"),
    ("Υπενθύμιση, κλιμάκωση και αυτόματη απόσυρση μετρούν εργάσιμες ημέρες. Οι αριθμοί ορίζονται στις ρυθμίσεις· ο "
     "κανόνας όχι.",
     "Reminder, escalation and automatic withdrawal count working days. The numbers are settings; the rule is not.",
     "%s, W1–W5" % C02),
    ("Σελίδα για την οποία λείπει το δικαίωμα απαντά «δεν βρέθηκε» (404), όπως μια σελίδα που δεν υπάρχει.",
     "A page for which the right is missing answers “not found” (404), like a page that does not exist.",
     "%s, ενότητα 2 · ehire/auth/decorators.py" % C03),
]

# ---------------------------------------------------------------- look
NAVY, BLUE, GREEN, GREY_TEXT, GREY_LIGHT, INPUT = "0A2C49", "1873B8", "8BC53F", "58595B", "EAEAEA", "EEF6E2"
FONT = "Arial"
THIN = Side(style="thin", color="DBE3EA")
BORDER = Border(left=THIN, right=THIN, top=THIN, bottom=THIN)


def font(**kw):
    kw.setdefault("name", FONT)
    kw.setdefault("size", 10)
    kw.setdefault("color", "222222")
    return Font(**kw)


def head(cell, rotate=False):
    cell.font = font(bold=True, color="FFFFFF")
    cell.fill = PatternFill("solid", fgColor=NAVY)
    cell.alignment = Alignment(wrap_text=True, vertical="bottom" if rotate else "center",
                               horizontal="center" if rotate else "left", text_rotation=90 if rotate else 0)
    cell.border = BORDER


def body(cell, center=False, bold=False, fill=None, color="222222", size=10):
    cell.font = font(bold=bold, color=color, size=size)
    cell.alignment = Alignment(wrap_text=True, vertical="top", horizontal="center" if center else "left")
    cell.border = BORDER
    if fill:
        cell.fill = PatternFill("solid", fgColor=fill)


def title(ws, text_el, text_en, last_col):
    ws["A1"] = "%s  ·  %s" % (text_el, text_en)
    ws["A1"].font = font(bold=True, size=14, color=NAVY)
    ws["A1"].alignment = Alignment(vertical="center")
    ws.row_dimensions[1].height = 26
    for col in range(1, last_col + 1):  # the brand's accent rule under the title
        ws.cell(row=1, column=col).border = Border(bottom=Side(style="medium", color=GREEN))


def page(ws, landscape=True, paper=9, repeat=None, one_page=False):
    ws.page_setup.orientation = "landscape" if landscape else "portrait"
    ws.page_setup.paperSize = paper  # 9 = A4, 8 = A3
    ws.page_setup.fitToWidth = 1
    ws.page_setup.fitToHeight = 1 if one_page else 0
    ws.sheet_properties.pageSetUpPr.fitToPage = True
    ws.page_margins.left = ws.page_margins.right = 0.4
    ws.page_margins.top = ws.page_margins.bottom = 0.5
    ws.oddFooter.left.text = "eHire · ΟΚΥπΥ · 26/11/2026"
    ws.oddFooter.right.text = "&P / &N"
    if repeat:
        ws.print_title_rows = repeat


def lines(text, width):
    """Rough count of wrapped lines, for the row height."""
    return sum(max(1, -(-len(part) // max(1, int(width * 1.05)))) for part in str(text).split("\n"))


# ---------------------------------------------------------------- sheets
HDR = 4  # header row of the rights sheet
FIRST = HDR + 1
LAST = HDR + len(RIGHTS)
# columns of the rights sheet
C_NO, C_AREA, C_EL, C_EN, C_WEL, C_WEN, C_KEY = 1, 2, 3, 4, 5, 6, 7
C_ROLE0 = 8
C_REC = C_ROLE0 + len(ROLES)
C_YEL, C_YEN, C_DEC, C_NOTE = C_REC + 1, C_REC + 2, C_REC + 3, C_REC + 4


def col(n):
    return get_column_letter(n)


def rng(n):
    return "'%s'!$%s$%d:$%s$%d" % (SHEET_RIGHTS, col(n), FIRST, col(n), LAST)


def build_help(wb):
    ws = wb.active
    ws.title = SHEET_HELP
    title(ws, "eHire: πίνακας δικαιωμάτων, πρόταση προς απόφαση", "eHire: rights matrix, proposal for decision", 3)
    ws.column_dimensions["A"].width = 78
    ws.column_dimensions["B"].width = 2  # a gap, so the two languages never touch
    ws.column_dimensions["C"].width = 78
    n_locked = sum(1 for r in RIGHTS if r["rec"] == LOCKED)
    n = len(RIGHTS)
    example = RIGHTS[20]  # public holidays
    rows = [
        ("h", "Τι είναι", "What this is"),
        ("p", "Σήμερα τα δικαιώματα στο eHire είναι σταθερά: 7 δικαιώματα μοιρασμένα σε 12 ρόλους. Στις 20/11/2026 "
              "αποφασίσατε να αποκτήσει το eHire πίνακα δικαιωμάτων όπως του eFinance, όπου ο Διαχειριστής σημειώνει "
              "τι επιτρέπεται σε κάθε ρόλο. Πριν χτιστεί, χρειάζεται να ξέρουμε ποια δικαιώματα θα αλλάζουν από την "
              "οθόνη και ποια όχι.",
              "Today the rights in eHire are fixed: 7 rights shared among 12 roles. On 20/11/2026 you decided that "
              "eHire gets a rights matrix like eFinance's, where the Administrator ticks what each role may do. "
              "Before it is built we need to know which rights can be changed on screen and which cannot."),
        ("p", "Το φύλλο «%s» χωρίζει τα 7 σημερινά σε %d πιο συγκεκριμένα, ένα για κάθε πράγμα που ελέγχει ο "
              "κώδικας. Τα ✓ δείχνουν ποιος ρόλος το έχει σήμερα και βγαίνουν από το αρχείο ehire/seed_data.json."
              % (SHEET_RIGHTS, n),
              "The “%s” sheet splits today's 7 into %d finer ones, one for each thing the code checks. The ticks "
              "show which role has it today and come from the file ehire/seed_data.json." % (SHEET_RIGHTS, n)),
        ("h", "Πώς συμπληρώνεται", "How to fill it in"),
        ("p", "Στη στήλη «Απόφαση» (τα πράσινα κελιά) διαλέξτε από τη λίστα ένα από τα τρία, για κάθε γραμμή:",
              "In the “Απόφαση” column (the green cells) pick one of three from the list, for every row:"),
        ("p", "«%s»: ο Διαχειριστής θα μπορεί να το δίνει σε ρόλους ή να το παίρνει πίσω." % EDITABLE,
              "“%s” (Editable): the Administrator will be able to give it to roles or take it back." % EDITABLE),
        ("p", "«%s»: μένει όπως είναι σήμερα και δεν αλλάζει από την οθόνη." % LOCKED,
              "“%s” (Locked): it stays as it is today and cannot be changed on screen." % LOCKED),
        ("p", "«%s»: θέλει κουβέντα πριν αποφασιστεί. Γράψτε δίπλα, στο «Σχόλιο», τι σας προβληματίζει." % DISCUSS,
              "“%s” (To discuss): it needs a talk first. Write what bothers you beside it, under “Σχόλιο”." % DISCUSS),
        ("p", "Η στήλη «Πρόταση» δείχνει τι προτείνω και οι δύο επόμενες γιατί. Προτείνω «%s» για %d από τα %d: όσα "
              "θα άφηναν κάποιον να παρακάμψει τη διαδρομή έγκρισης ή να αφήσει το eHire χωρίς Διαχειριστή."
              % (LOCKED, n_locked, n),
              "The “Πρόταση” column shows what I recommend and the next two say why. I recommend “%s” for %d of the "
              "%d: the ones that would let someone get around the approval route or leave eHire without an "
              "Administrator." % (LOCKED, n_locked, n)),
        ("p", "Παράδειγμα: στη γραμμή «%s» η πρόταση είναι «%s». Αν συμφωνείτε, διαλέγετε «%s» στην «Απόφαση»."
              % (example["el"], example["rec"], example["rec"]),
              "Example: on the “%s” row the recommendation is “%s”. If you agree, you pick “%s” under “Απόφαση”."
              % (example["en"], example["rec"], example["rec"])),
        ("h", "Τι να έχετε υπόψη", "What to keep in mind"),
        ("p", "Το κλείδωμα αφορά ολόκληρη τη γραμμή. Σε γραμμή που «%s» μπορούν να μείνουν κλειδωμένα λίγα κελιά, "
              "όπως κάνουν το eFinance και το eCapital· όπου το προτείνω, το γράφω στην αιτιολόγηση." % EDITABLE,
              "A lock covers the whole row. On a row marked “%s” a few cells can still stay locked, as eFinance and "
              "eCapital do; where I suggest that, the reason says so." % EDITABLE),
        ("p", "Τρία από τα 7 σημερινά δικαιώματα δεν ελέγχουν αυτό που λέει το όνομά τους: το request.view_own δεν "
              "ελέγχεται πουθενά, το request.act ορίζει μόνο ποια καρτέλα ανοίγει πρώτη και το request.view_all "
              "μόνο το κουμπί της εξαγωγής. Το ποιος βλέπει και ποιος απαντά το ορίζουν ο ρόλος και η διαδρομή.",
              "Three of today's 7 rights do not control what their name says: request.view_own is checked nowhere, "
              "request.act only picks which tab opens first and request.view_all only the export button. Who sees "
              "and who answers is decided by the role and the route."),
        ("p", "Το φύλλο «%s» έχει τους κανόνες της διαδρομής που δεν θα μπουν ποτέ στον πίνακα. Εκεί δεν χρειάζεται "
              "να συμπληρώσετε κάτι." % SHEET_RULES,
              "The “%s” sheet lists the rules of the route that will never be in the matrix. There is nothing to "
              "fill in there." % SHEET_RULES),
        ("p", "Δεν μπαίνουν στον πίνακα όσα γίνονται μόνο από τον διακομιστή: άνοιγμα της σύνδεσης με το eFinance, "
              "αποστολή στο eArchive, τρόπος ελέγχου προϋπολογισμού, πρόθεμα αριθμού αιτήματος.",
              "Things done on the server only are not in the matrix: switching on the eFinance link, sending to "
              "eArchive, the budget check's mode, the request-number prefix."),
        ("h", "Τι ακολουθεί", "What happens next"),
        ("p", "Στείλτε πίσω το αρχείο συμπληρωμένο. Το φύλλο «%s» δείχνει πόσες γραμμές μένουν χωρίς απόφαση. Με τις "
              "αποφάσεις σας γράφεται το συμβόλαιο του πίνακα και χτίζεται σε έκδοση μετά το UAT. Ως τότε δεν "
              "αλλάζει τίποτα στο eHire." % SHEET_SUM,
              "Send the file back filled in. The “%s” sheet shows how many rows are still undecided. Your decisions "
              "become the contract for the matrix, which is built in a release after UAT. Until then nothing "
              "changes in eHire." % SHEET_SUM),
        ("s", "Η διαίρεση σε %d γραμμές είναι δική μου πρόταση από τον κώδικα της 26/11/2026 (rc13). Το αρχείο "
              "ξαναχτίζεται με scripts/make-rights-proposal.py." % n,
              "The split into %d rows is my proposal from the code as of 26/11/2026 (rc13). The file is rebuilt with "
              "scripts/make-rights-proposal.py." % n),
    ]
    r = 3
    for kind, text_el, text_en in rows:
        for c, text in ((1, text_el), (3, text_en)):
            cell = ws.cell(row=r, column=c, value=text)
            if kind == "h":
                cell.font = font(bold=True, size=11, color="FFFFFF")
                cell.fill = PatternFill("solid", fgColor=NAVY)
                cell.alignment = Alignment(vertical="center", indent=1)
            else:
                cell.font = font(size=10, italic=(kind == "s"), color=GREY_TEXT if kind == "s" else "222222")
                cell.alignment = Alignment(wrap_text=True, vertical="top")
        ws.row_dimensions[r].height = 20 if kind == "h" else 13.5 * max(lines(text_el, 78), lines(text_en, 78)) + 5
        r += 1
    ws.sheet_view.showGridLines = False
    page(ws, one_page=True)


def build_rights(wb):
    ws = wb.create_sheet(SHEET_RIGHTS)
    title(ws, "Δικαιώματα: ποια θα αλλάζει ο Διαχειριστής", "Rights: which ones the Administrator may change", C_NOTE)
    ws["A2"] = ("✓ = ο ρόλος το έχει σήμερα (από το seed_data.json).  Συμπληρώστε μόνο τα πράσινα κελιά: «Απόφαση» "
                "από τη λίστα, «Σχόλιο» αν θέλετε.   ·   ✓ = the role has it today (from seed_data.json).  Fill in "
                "the green cells only: “Απόφαση” from the list, “Σχόλιο” if you wish.")
    ws["A2"].font = font(color=GREY_TEXT)
    ws.row_dimensions[2].height = 16
    heads = {
        C_NO: "#", C_AREA: "Περιοχή\nArea", C_EL: "Δικαίωμα", C_EN: "Right",
        C_WEL: "Τι επιτρέπει", C_WEN: "What it lets a person do", C_KEY: "Σημερινό κλειδί\nToday's key",
        C_REC: "Πρόταση\nRecommendation\n(%s = Locked,\n%s = Editable)" % (LOCKED, EDITABLE),
        C_YEL: "Γιατί", C_YEN: "Why",
        C_DEC: "Απόφαση\nDecision", C_NOTE: "Σχόλιο\nComment",
    }
    widths = {C_NO: 4, C_AREA: 12, C_EL: 25, C_EN: 23, C_WEL: 38, C_WEN: 36, C_KEY: 19, C_REC: 17,
              C_YEL: 40, C_YEN: 38, C_DEC: 15, C_NOTE: 26}
    for c, text in heads.items():
        head(ws.cell(row=HDR, column=c, value=text))
        ws.column_dimensions[col(c)].width = widths[c]
    for i, role in enumerate(ROLES):
        c = C_ROLE0 + i
        head(ws.cell(row=HDR, column=c, value="%s\n%s" % (el("role." + role), en("role." + role))), rotate=True)
        ws.column_dimensions[col(c)].width = 6.5
    for c in (C_DEC, C_NOTE):
        ws.cell(row=HDR, column=c).fill = PatternFill("solid", fgColor=BLUE)
    ws.row_dimensions[HDR].height = 190

    for n, right in enumerate(RIGHTS, start=1):
        r = HDR + n
        zebra = "F6F8FA" if n % 2 == 0 else None
        body(ws.cell(row=r, column=C_NO, value=n), center=True, fill=zebra, color=GREY_TEXT)
        body(ws.cell(row=r, column=C_AREA, value="%s\n%s" % right["area"]), fill=zebra, color=GREY_TEXT)
        body(ws.cell(row=r, column=C_EL, value=right["el"]), bold=True, fill=zebra)
        body(ws.cell(row=r, column=C_EN, value=right["en"]), bold=True, fill=zebra)
        body(ws.cell(row=r, column=C_WEL, value=right["what_el"]), fill=zebra)
        body(ws.cell(row=r, column=C_WEN, value=right["what_en"]), fill=zebra)
        body(ws.cell(row=r, column=C_KEY, value=right["key"]), fill=zebra, color=GREY_TEXT, size=9)
        for i, role in enumerate(ROLES):
            cell = ws.cell(row=r, column=C_ROLE0 + i, value=TICK if has_today(right, role) else None)
            body(cell, center=True, bold=True, fill=zebra, color=NAVY, size=12)
            cell.alignment = Alignment(horizontal="center", vertical="center")
        locked = right["rec"] == LOCKED
        body(ws.cell(row=r, column=C_REC, value=right["rec"]), bold=True, fill=GREY_LIGHT if locked else zebra,
             color=NAVY if locked else "3F7A12")
        body(ws.cell(row=r, column=C_YEL, value=right["why_el"]), fill=zebra)
        body(ws.cell(row=r, column=C_YEN, value=right["why_en"]), fill=zebra)
        body(ws.cell(row=r, column=C_DEC), bold=True, fill=INPUT)
        body(ws.cell(row=r, column=C_NOTE), fill=INPUT)
        need = max(lines(right["el"], widths[C_EL] * 0.9), lines(right["en"], widths[C_EN] * 0.9),
                   lines(right["what_el"], widths[C_WEL]), lines(right["what_en"], widths[C_WEN]),
                   lines(right["why_el"], widths[C_YEL]), lines(right["why_en"], widths[C_YEN]),
                   lines(right["key"], widths[C_KEY]), 2)
        ws.row_dimensions[r].height = 13.5 * need + 6

    dv = DataValidation(type="list", formula1='"%s"' % ",".join(CHOICES), allow_blank=True, showDropDown=False)
    dv.errorTitle, dv.error = "Απόφαση", "Διαλέξτε από τη λίστα: %s." % ", ".join(CHOICES)
    dv.promptTitle, dv.prompt = "Απόφαση", "%s · %s · %s" % CHOICES
    dv.showErrorMessage = dv.showInputMessage = True
    ws.add_data_validation(dv)
    dv.add("%s%d:%s%d" % (col(C_DEC), FIRST, col(C_DEC), LAST))

    ws.freeze_panes = ws.cell(row=FIRST, column=C_EN)  # header rows and the Greek name stay in view
    ws.auto_filter.ref = "%s%d:%s%d" % (col(C_NO), HDR, col(C_NOTE), LAST)
    ws.sheet_view.zoomScale = 90
    page(ws, paper=8, repeat="%d:%d" % (HDR, HDR))  # A3 landscape, one page wide


def build_rules(wb):
    ws = wb.create_sheet(SHEET_RULES)
    title(ws, "Σταθεροί κανόνες: δεν μπαίνουν ποτέ στον πίνακα", "Fixed rules: never in the matrix", 4)
    ws["A2"] = ("Ισχύουν για όλους, ό,τι κι αν έχει ο πίνακας δικαιωμάτων. Αλλάζουν μόνο με απόφαση και νέα έκδοση."
                "   ·   They hold for everyone, whatever the matrix says. They change only by a decision and a new "
                "release.")
    ws["A2"].font = font(color=GREY_TEXT)
    for c, (text, width) in enumerate((("#", 4), ("Κανόνας", 70), ("Rule", 66), ("Από πού προκύπτει\nWhere it comes from", 40)),
                                      start=1):
        head(ws.cell(row=4, column=c, value=text))
        ws.column_dimensions[col(c)].width = width
    ws.row_dimensions[4].height = 30
    for n, (rule_el, rule_en, source) in enumerate(RULES, start=1):
        r = 4 + n
        zebra = "F6F8FA" if n % 2 == 0 else None
        body(ws.cell(row=r, column=1, value=n), center=True, fill=zebra, color=GREY_TEXT)
        body(ws.cell(row=r, column=2, value=rule_el), fill=zebra)
        body(ws.cell(row=r, column=3, value=rule_en), fill=zebra)
        body(ws.cell(row=r, column=4, value=source), fill=zebra, color=GREY_TEXT, size=9)
        ws.row_dimensions[r].height = 13.5 * max(lines(rule_el, 70), lines(rule_en, 66), lines(source, 40)) + 6
    ws.freeze_panes = "A5"
    page(ws, repeat="4:4")


def build_summary(wb):
    ws = wb.create_sheet(SHEET_SUM)
    title(ws, "Σύνοψη", "Summary", 3)
    ws["A2"] = ("Όλοι οι αριθμοί είναι τύποι πάνω στο φύλλο «%s» και αλλάζουν μόνοι τους.   ·   Every number is a "
                "formula over the “%s” sheet and updates by itself." % (SHEET_RIGHTS, SHEET_RIGHTS))
    ws["A2"].font = font(color=GREY_TEXT)
    for c, width in ((1, 52), (2, 46), (3, 12)):
        ws.column_dimensions[col(c)].width = width
    rec, dec, name = rng(C_REC), rng(C_DEC), rng(C_EL)
    r = 4

    def section(text_el, text_en, label="Πλήθος\nCount"):
        nonlocal r
        for c, text in ((1, text_el), (2, text_en), (3, label)):
            head(ws.cell(row=r, column=c, value=text))
        ws.cell(row=r, column=3).alignment = Alignment(horizontal="center", vertical="center", wrap_text=True)
        ws.row_dimensions[r].height = 30
        r += 1

    def line(text_el, text_en, formula, strong=False):
        nonlocal r
        body(ws.cell(row=r, column=1, value=text_el), bold=strong)
        body(ws.cell(row=r, column=2, value=text_en), bold=strong)
        cell = ws.cell(row=r, column=3, value=formula)
        body(cell, center=True, bold=True, color=NAVY, fill=GREY_LIGHT if strong else None)
        cell.number_format = "0"
        ws.row_dimensions[r].height = 13.5 * max(lines(text_el, 52), lines(text_en, 46)) + 5
        r += 1
        return "$C$%d" % (r - 1)

    section("Η πρόταση", "The proposal")
    total = line("Δικαιώματα στην πρόταση", "Rights in the proposal", "=COUNTA(%s)" % name, strong=True)
    line("Πρόταση «%s»" % LOCKED, "Recommended “%s” (Locked)" % LOCKED, '=COUNTIF(%s,"%s")' % (rec, LOCKED))
    line("Πρόταση «%s»" % EDITABLE, "Recommended “%s” (Editable)" % EDITABLE, '=COUNTIF(%s,"%s")' % (rec, EDITABLE))
    r += 1
    section("Οι αποφάσεις σας", "Your decisions")
    line("Απόφαση «%s»" % EDITABLE, "Decided “%s” (Editable)" % EDITABLE, '=COUNTIF(%s,"%s")' % (dec, EDITABLE))
    line("Απόφαση «%s»" % LOCKED, "Decided “%s” (Locked)" % LOCKED, '=COUNTIF(%s,"%s")' % (dec, LOCKED))
    line("Απόφαση «%s»" % DISCUSS, "Decided “%s” (To discuss)" % DISCUSS, '=COUNTIF(%s,"%s")' % (dec, DISCUSS))
    line("Χωρίς απόφαση ακόμη", "Still undecided", "=%s-COUNTA(%s)" % (total, dec), strong=True)
    line("Αποφάσεις διαφορετικές από την πρόταση", "Decisions that differ from the recommendation",
         '=SUMPRODUCT((%s<>"")*(%s<>%s))' % (dec, dec, rec))
    r += 1
    section("Δικαιώματα ανά ρόλο σήμερα (από τα %d)" % len(RIGHTS), "Rights per role today (out of %d)" % len(RIGHTS),
            "✓")
    for i, role in enumerate(ROLES):
        line(el("role." + role), en("role." + role), '=COUNTIF(%s,"%s")' % (rng(C_ROLE0 + i), TICK))
    ws.freeze_panes = "A4"
    ws.sheet_view.showGridLines = False
    page(ws)


def build():
    wb = Workbook()
    build_help(wb)
    build_rights(wb)
    build_rules(wb)
    build_summary(wb)
    for ws in wb.worksheets:
        assert len(ws.title) <= 31
    wb.active = 1  # open on the sheet to fill in
    wb.properties.title = "eHire rights matrix proposal 2026-11-26"
    wb.properties.creator = "eHire"
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    wb.save(OUT)
    return OUT


# ---------------------------------------------------------------- check
def check(path=OUT):
    """Open the saved file and compare it with the seed file. Returns the list of problems (empty when sound)."""
    problems = []
    wb = load_workbook(path)
    ws = wb[SHEET_RIGHTS]
    header = [ws.cell(row=HDR, column=C_ROLE0 + i).value for i in range(len(ROLES))]
    for role, text in zip(ROLES, header):
        if text != "%s\n%s" % (EL["role." + role], EN["role." + role]):
            problems.append("role header %s: %r" % (role, text))
    seed_keys = sorted({k for keys in ROLE_PERMISSIONS.values() for k in keys})
    used = sorted({k for right in RIGHTS if right["today"][0] == "keys" for k in right["today"][1]})
    if seed_keys != used:
        problems.append("keys in seed %s, keys used by rows %s" % (seed_keys, used))
    if ws.max_row != LAST:
        problems.append("rights sheet ends at row %d, expected %d" % (ws.max_row, LAST))
    for n, right in enumerate(RIGHTS):
        r = FIRST + n
        if ws.cell(row=r, column=C_EL).value != right["el"]:
            problems.append("row %d is not %s" % (r, right["el"]))
        for i, role in enumerate(ROLES):
            kind = right["today"][0]
            if kind == "keys":  # straight from the seed file, not through has_today()
                expected = bool(set(right["today"][1]) & set(ROLE_PERMISSIONS[role]))
            else:
                expected = kind == "everyone"
            got = ws.cell(row=r, column=C_ROLE0 + i).value
            if got not in (TICK, None) or (got == TICK) != expected:
                problems.append("tick mismatch: row %d (%s), role %s: sheet %r, seed says %s"
                                % (r, right["en"], role, got, expected))
        if ws.cell(row=r, column=C_REC).value not in (LOCKED, EDITABLE):
            problems.append("row %d: recommendation %r" % (r, ws.cell(row=r, column=C_REC).value))
        if ws.cell(row=r, column=C_DEC).value is not None:
            problems.append("row %d: decision cell is not empty" % r)
    covered = set()
    for dv in ws.data_validations.dataValidation:
        if dv.type == "list" and dv.formula1 == '"%s"' % ",".join(CHOICES):
            for cell_range in dv.sqref.ranges:
                for row in ws[cell_range.coord]:
                    for cell in (row if isinstance(row, tuple) else (row,)):
                        covered.add(cell.coordinate)
    for r in range(FIRST, LAST + 1):
        if "%s%d" % (col(C_DEC), r) not in covered:
            problems.append("no dropdown on %s%d" % (col(C_DEC), r))
    sm = wb[SHEET_SUM]
    formulas = 0
    for row in sm.iter_rows(min_row=4):
        value = row[2].value
        if value is None or str(value).startswith(("Πλήθος", TICK)):
            continue
        if isinstance(value, str) and value.startswith("="):
            formulas += 1
        else:
            problems.append("summary %s holds a typed value: %r" % (row[2].coordinate, value))
    if formulas != 8 + len(ROLES):
        problems.append("summary has %d formulas, expected %d" % (formulas, 8 + len(ROLES)))
    return problems


if __name__ == "__main__":
    if "--check" not in sys.argv:
        print("wrote", os.path.relpath(build(), ROOT))
    found = check()
    for problem in found:
        print("PROBLEM:", problem)
    print("check: %d rights, %d fixed rules, %d problems" % (len(RIGHTS), len(RULES), len(found)))
    sys.exit(1 if found else 0)
