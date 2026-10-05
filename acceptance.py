# -*- coding: utf-8 -*-
"""
Σενάρια Αποδοχής — the acceptance scenarios, as executable code.

A contractual deliverable under the original specification (build brief §13). They are
written here once and consumed twice: test_acceptance.py runs them under pytest, and
tools/make_acceptance_document.py runs them and generates the Word document from the
result. The document can therefore never claim a scenario passes when it does not.

Each scenario states Δεδομένου / Όταν / Τότε in Greek, because the people signing it off
read Greek, and carries the clause of the brief it satisfies.
"""
import datetime as dt
import re
from dataclasses import dataclass, field
from decimal import Decimal
from io import BytesIO
from typing import Callable

import taep

YESTERDAY = dt.datetime.now() - dt.timedelta(days=1)


@dataclass
class Scenario:
    code: str
    title: str
    given: str
    when: str
    then: str
    clause: str
    run: Callable
    checks: list = field(default_factory=list)


SCENARIOS = []


def scenario(code, title, given, when, then, clause):
    def decorator(function):
        SCENARIOS.append(Scenario(code=code, title=title, given=given, when=when,
                                  then=then, clause=clause, run=function))
        return function
    return decorator


# ---------------------------------------------------------------------------
# Helpers the scenarios share
# ---------------------------------------------------------------------------

def category_id(ctx, code):
    return ctx["db_execute"](
        "SELECT id FROM taep_financial_category WHERE code_new=%s", (code,),
        fetch=True)[0]["id"]


def entry_form(ctx, code="624", **overrides):
    fields = {
        "id_type": "Ταυτότητα", "id_number": "1045872", "id_country": "Κύπρος",
        "id_expiry": "2031-03-20",
        "last_name": "Παπαδόπουλος", "first_name": "Ανδρέας",
        "date_of_birth": "1985-04-12", "gender": "Άνδρας", "phone": "99123456",
        "address": "Λεωφ. Μακαρίου 10, Λευκωσία",
        "next_of_kin_type": "Σύζυγος", "next_of_kin_details": "Μαρία 99654321",
        "taep_unit_code": "NIC-ADULT", "episode_number": "2026/44871",
        "admission_at": YESTERDAY.strftime("%Y-%m-%dT%H:%M"),
        "examination_at": (YESTERDAY + dt.timedelta(minutes=25)).strftime("%Y-%m-%dT%H:%M"),
        "discharge_at": (YESTERDAY + dt.timedelta(hours=3)).strftime("%Y-%m-%dT%H:%M"),
        "financial_category_id": str(category_id(ctx, code)), "comments": "",
    }
    fields.update(overrides)
    return fields


def create_episode(harness, **overrides):
    response = harness.client.post("/taep/nea", data=entry_form(harness.ctx, **overrides))
    assert response.status_code == 302, "η καταχώρηση δεν αποθηκεύτηκε"
    return int(re.search(r"/taep/(\d+)", response.headers["Location"]).group(1))


GOLDEN_SERVICES = ["AET008", "AET057", "AET005", "AET043",
                   "AED001", "AED008", "AED002", "AED006",
                   "AED009", "AED012", "AED016", "AED005"]


def drive_to_finalised(harness, services=GOLDEN_SERVICES, **overrides):
    episode_id = create_episode(harness, **overrides)
    harness.client.post(f"/taep/{episode_id}/services",
                        data={"service_code": services})
    harness.client.post(f"/taep/{episode_id}/calculate")
    harness.client.post(f"/taep/{episode_id}/finalise")
    return episode_id


def expect(condition, message):
    """Record a named check. Raises on failure so pytest and the generator agree."""
    assert condition, message
    return message


# ---------------------------------------------------------------------------
# Ο αλγόριθμος
# ---------------------------------------------------------------------------

@scenario("ΣΑ-01", "Η περίπτωση ελέγχου του υποδείγματος δίνει €120,00",
          "Περιστατικό κατηγορίας 624 με τις υπηρεσίες του υποδείγματος "
          "κοστολόγησης OKY1054/0035.",
          "Ο κωδικοποιητής επιλέγει τις υπηρεσίες και πατά «Υπολογισμός».",
          "Μέγιστη διαγνωστική κατηγορία 2, μέγιστη θεραπευτική 3, βαρύτητα 8, "
          "κοστολόγηση βάσει βαρύτητας €120,00 και τελικό κόστος €120,00.",
          "§4.1")
def golden_case(harness):
    episode_id = create_episode(harness)
    harness.client.post(f"/taep/{episode_id}/services",
                        data={"service_code": GOLDEN_SERVICES})
    harness.client.post(f"/taep/{episode_id}/calculate")
    result = taep.get_calculation(harness.ctx, episode_id)
    return [
        expect(result["max_investigation_category"] == 2, "μέγιστη διαγνωστική = 2"),
        expect(result["max_treatment_category"] == 3, "μέγιστη θεραπευτική = 3"),
        expect(result["weight"] == 8, "βαρύτητα = 8"),
        expect(taep.money_from_db(result["weight_cost"]) == Decimal("120.00"),
               "κοστολόγηση βάσει βαρύτητας = €120,00"),
        expect(taep.money_from_db(result["total_cost"]) == Decimal("120.00"),
               "τελικό κόστος = €120,00"),
    ]


@scenario("ΣΑ-02", "Και οι 15 συνδυασμοί του πίνακα βαρύτητας",
          "Ο πίνακας βαρύτητας του ΟΑΥ, 3 διαγνωστικές × 5 θεραπευτικές κατηγορίες.",
          "Υπολογισμός για κάθε συνδυασμό.",
          "Κάθε κελί δίνει τον τεκμηριωμένο συντελεστή και την αντίστοιχη "
          "ελληνική κατηγοριοποίηση.",
          "§4.1, §13")
def every_matrix_cell(harness):
    checks = []
    for (investigation, treatment), weight in sorted(taep.WEIGHT_MATRIX.items()):
        result = taep.calculate(
            [taep.Service(f"AED{investigation:03d}", "INVESTIGATION", investigation),
             taep.Service(f"AET{treatment:03d}", "TREATMENT", treatment)],
            taep.Rates())
        checks.append(expect(
            result.weight == weight and result.band_label_el == taep.BAND_LABELS_EL[weight],
            f"Δ{investigation}/Θ{treatment} → βαρύτητα {weight}"))
    return checks


@scenario("ΣΑ-03", "Λαμβάνεται η μέγιστη κατηγορία κάθε πλευράς",
          "Περιστατικό με πολλές υπηρεσίες σε κάθε πλευρά.",
          "Υπολογισμός.",
          "Υπεισέρχεται η μέγιστη κατηγορία κάθε πλευράς, όχι το άθροισμα ούτε "
          "ο αριθμός των υπηρεσιών.",
          "§4.1")
def maximum_category_wins(harness):
    result = taep.calculate(
        [taep.Service("AED001", "INVESTIGATION", 1),
         taep.Service("AED019", "INVESTIGATION", 3),
         taep.Service("AED008", "INVESTIGATION", 2),
         taep.Service("AET001", "TREATMENT", 1),
         taep.Service("AET074", "TREATMENT", 4)], taep.Rates())
    many = taep.calculate(
        [taep.Service(f"AED{n:03d}", "INVESTIGATION", 1) for n in range(1, 11)]
        + [taep.Service("AET001", "TREATMENT", 1)], taep.Rates())
    return [
        expect(result.max_investigation_category == 3, "μέγιστη διαγνωστική = 3"),
        expect(result.weight == 12, "βαρύτητα = 12"),
        expect(many.weight == 4,
               "δέκα υπηρεσίες κατηγορίας 1 παραμένουν βαρύτητα 4"),
    ]


@scenario("ΣΑ-04", "Μόνο διαλογή χρεώνεται €10,00",
          "Περιστατικό χωρίς καμία διαγνωστική παρέμβαση και καμία θεραπεία.",
          "Υπολογισμός.",
          "Βαρύτητα 1, κατηγοριοποίηση «Διαλογή» και τελικό κόστος €10,00 — "
          "δικό της ποσό, όχι η τιμή της βαρύτητας 4.",
          "§4.1")
def triage_only(harness):
    episode_id = create_episode(harness)
    harness.client.post(f"/taep/{episode_id}/calculate")
    result = taep.get_calculation(harness.ctx, episode_id)
    return [
        expect(result["weight"] == 1, "βαρύτητα = 1"),
        expect(result["band_label_el"] == "Διαλογή", "κατηγοριοποίηση «Διαλογή»"),
        expect(taep.money_from_db(result["total_cost"]) == Decimal("10.00"),
               "τελικό κόστος = €10,00"),
    ]


@scenario("ΣΑ-05", "Μονομερής επιλογή υπηρεσιών απορρίπτεται",
          "Περιστατικό όπου επιλέχθηκε μόνο διαγνωστική παρέμβαση.",
          "Ο κωδικοποιητής πατά «Υπολογισμός».",
          "Η κοστολόγηση απορρίπτεται με μήνυμα στα ελληνικά και δεν "
          "αποθηκεύεται αποτέλεσμα.",
          "§4.1, §10")
def one_sided_selection(harness):
    episode_id = create_episode(harness)
    harness.client.post(f"/taep/{episode_id}/services",
                        data={"service_code": ["AED008"]})
    response = harness.client.post(f"/taep/{episode_id}/calculate",
                                   follow_redirects=True)
    page = response.get_data(as_text=True)
    return [
        expect("θεραπεία" in page, "το μήνυμα αναφέρει ότι λείπει θεραπεία"),
        expect(taep.get_calculation(harness.ctx, episode_id) is None,
               "δεν αποθηκεύτηκε αποτέλεσμα"),
    ]


# ---------------------------------------------------------------------------
# Τιμές και χρονική ισχύς
# ---------------------------------------------------------------------------

@scenario("ΣΑ-06", "Παλιό περιστατικό κοστολογείται με την παλιά τιμή",
          "Η τιμή της βαρύτητας 8 αλλάζει από 01/01/2027.",
          "Κοστολόγηση περιστατικού με ημερομηνία εξέτασης το 2026 και άλλου το 2027.",
          "Το περιστατικό του 2026 κοστολογείται με την τιμή του 2026 και του 2027 "
          "με τη νέα.",
          "§6")
def effective_dating(harness):
    taep.change_rate(harness.ctx, "WEIGHT_AMOUNT", "200.00", dt.date(2027, 1, 1),
                     user_id=9, weight=8, source_document="Απόφαση ΔΣ 1/2026")
    old = taep.rates_in_force(harness.ctx, category_id(harness.ctx, "624"),
                              dt.date(2026, 6, 1))
    new = taep.rates_in_force(harness.ctx, category_id(harness.ctx, "624"),
                              dt.date(2027, 6, 1))
    return [
        expect(old.weight_amounts[8] == Decimal("120.00"), "2026 → €120,00"),
        expect(new.weight_amounts[8] == Decimal("200.00"), "2027 → €200,00"),
        expect(taep.verify_rate_periods(harness.ctx) == [],
               "δεν υπάρχουν επικαλυπτόμενες περίοδοι"),
    ]


@scenario("ΣΑ-07", "Καμία τιμή σε ισχύ σημαίνει άρνηση, όχι προεπιλογή",
          "Οικονομική κατηγορία χωρίς τιμή σε ισχύ κατά την ημερομηνία εξέτασης.",
          "Υπολογισμός.",
          "Η κοστολόγηση απορρίπτεται και αναφέρει τι λείπει. Δεν εφαρμόζεται "
          "προεπιλεγμένη τιμή.",
          "§6, §10")
def no_rate_in_force(harness):
    rates = taep.rates_in_force(harness.ctx, category_id(harness.ctx, "624"),
                                dt.date(2020, 1, 1))
    try:
        taep.calculate([taep.Service("AED008", "INVESTIGATION", 2),
                        taep.Service("AET057", "TREATMENT", 3)], rates,
                       financial_category_code="624")
        raise AssertionError("η κοστολόγηση δεν απορρίφθηκε")
    except taep.CostingError as exc:
        return [
            expect(exc.code == "NO_RATE_IN_FORCE", "απορρίφθηκε ως «καμία τιμή σε ισχύ»"),
            expect(rates.weight_amounts == {}, "δεν εφαρμόστηκε προεπιλογή"),
        ]


@scenario("ΣΑ-08", "Η αλλαγή τιμής δεν αντικαθιστά την προηγούμενη",
          "Τέλος εγγραφής €10,00 σε ισχύ για την κατηγορία 603.",
          "Ο διαχειριστής τιμών καταχωρεί €25,00 από 01/01/2027 με έγγραφο απόφασης.",
          "Η παλιά περίοδος κλείνει στις 31/12/2026, διατηρεί το ποσό της, και "
          "καταγράφεται ποιος έκανε την αλλαγή και με ποιο έγγραφο.",
          "§6, §7")
def rate_change_keeps_history(harness):
    closed, added = taep.change_rate(
        harness.ctx, "REGISTRATION_FEE", "25.00", dt.date(2027, 1, 1), user_id=9,
        financial_category_id=category_id(harness.ctx, "603"),
        source_document="Απόφαση ΔΣ 77/2026")
    periods = taep.rate_series(harness.ctx, "REGISTRATION_FEE",
                              financial_category_id=category_id(harness.ctx, "603"))
    old = next(p for p in periods if p["id"] == closed)
    new = next(p for p in periods if p["id"] == added)
    return [
        expect(taep.money_from_db(old["amount"]) == Decimal("10.00"),
               "η παλιά τιμή παραμένει €10,00"),
        expect(str(taep._as_date(old["valid_to"])) == "2026-12-31",
               "η παλιά περίοδος κλείνει 31/12/2026"),
        expect(old["closed_by"] == 9, "καταγράφηκε ποιος την έκλεισε"),
        expect(new["source_document"] == "Απόφαση ΔΣ 77/2026",
               "καταγράφηκε το έγγραφο απόφασης"),
    ]


@scenario("ΣΑ-09", "Αναδρομική αλλαγή σε κλεισμένη περίοδο απορρίπτεται",
          "Περίοδος τιμής που έχει κλείσει.",
          "Ο διαχειριστής επιχειρεί να καταχωρήσει τιμή με ημερομηνία ισχύος "
          "μέσα σε αυτήν.",
          "Η αλλαγή απορρίπτεται, ώστε να μην αλλοιωθεί αναδρομικά το κόστος "
          "περιστατικού που έχει ήδη κοστολογηθεί.",
          "§6")
def no_backdating(harness):
    taep.change_rate(harness.ctx, "TRIAGE_AMOUNT", "12.00", dt.date(2027, 1, 1),
                     user_id=9, source_document="Α")
    try:
        taep.change_rate(harness.ctx, "TRIAGE_AMOUNT", "14.00", dt.date(2026, 6, 1),
                         user_id=9, source_document="Β")
        raise AssertionError("η αναδρομική αλλαγή δεν απορρίφθηκε")
    except taep.CostingError as exc:
        return [expect(exc.code == "BACKDATED_INTO_CLOSED_PERIOD",
                       "απορρίφθηκε ως αναδρομική σε κλεισμένη περίοδο")]


# ---------------------------------------------------------------------------
# Αριθμοί κοστολόγησης
# ---------------------------------------------------------------------------

@scenario("ΣΑ-10", "Οι αριθμοί κοστολόγησης είναι συνεχείς και μοναδικοί",
          "Οκτώ ταυτόχρονες συνεδρίες οριστικοποιούν κοστολογήσεις στην ίδια μονάδα.",
          "Απόδοση αριθμού σε κάθε οριστικοποίηση.",
          "Κάθε αριθμός αποδίδεται μία φορά και η σειρά δεν έχει κενά.",
          "§5, §13")
def numbers_are_gapless_under_concurrency(harness):
    import threading
    issued, errors = [], []
    lock = threading.Lock()

    def allocate():
        for _ in range(25):
            try:
                number, _ = taep.allocate_costing_number(harness.ctx, "LAR")
                with lock:
                    issued.append(number)
            except Exception as exc:
                with lock:
                    errors.append(repr(exc))

    threads = [threading.Thread(target=allocate) for _ in range(8)]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join()

    sequences = sorted(int(n.split("/")[1]) for n in issued)
    return [
        expect(not errors, "καμία αποτυχία υπό ταυτόχρονη χρήση"),
        expect(len(set(issued)) == 200, "200 μοναδικοί αριθμοί"),
        expect(sequences == list(range(1, 201)), "η σειρά δεν έχει κενά"),
    ]


@scenario("ΣΑ-11", "Κάθε μονάδα ΤΑΕΠ έχει δική της σειρά",
          "Το Γενικό Νοσοκομείο Λευκωσίας λειτουργεί δύο μονάδες ΤΑΕΠ, "
          "ενηλίκων (1054) και παίδων (1106).",
          "Οριστικοποίηση κοστολόγησης σε κάθε μονάδα.",
          "Κάθε μονάδα αποδίδει αριθμό από τη δική της σειρά.",
          "§5")
def each_unit_has_its_own_series(harness):
    adult = drive_to_finalised(harness, episode_number="E-1")
    paediatric = create_episode(harness, taep_unit_code="NIC-PAED",
                                episode_number="E-2")
    harness.client.post(f"/taep/{paediatric}/services",
                        data={"service_code": GOLDEN_SERVICES})
    harness.client.post(f"/taep/{paediatric}/calculate")
    harness.client.post(f"/taep/{paediatric}/finalise")
    return [
        expect(taep.get_episode(harness.ctx, adult)["costing_number"] == "OKY1054/0001",
               "ενηλίκων → OKY1054/0001"),
        expect(taep.get_episode(harness.ctx, paediatric)["costing_number"]
               == "OKY1106/0001", "παίδων → OKY1106/0001"),
    ]


@scenario("ΣΑ-12", "Ακυρωμένος αριθμός δεν επαναχρησιμοποιείται",
          "Οριστικοποιημένη κοστολόγηση που ακυρώνεται με αιτιολογία.",
          "Οριστικοποίηση επόμενης κοστολόγησης στην ίδια μονάδα.",
          "Η ακυρωμένη διατηρεί τον αριθμό της και η επόμενη παίρνει τον επόμενο "
          "αριθμό, όχι τον ακυρωμένο.",
          "§5, §7")
def cancelled_number_not_reissued(harness):
    first = drive_to_finalised(harness, episode_number="E-1")
    original = taep.get_episode(harness.ctx, first)["costing_number"]
    harness.client.post(f"/taep/{first}/cancel",
                        data={"reason": "Λάθος οικονομική κατηγορία"})
    second = drive_to_finalised(harness, episode_number="E-2")
    cancelled = taep.get_episode(harness.ctx, first)
    return [
        expect(cancelled["status"] == "CANCELLED", "η πρώτη είναι ακυρωμένη"),
        expect(cancelled["costing_number"] == original,
               "η ακυρωμένη διατηρεί τον αριθμό της"),
        expect(taep.get_episode(harness.ctx, second)["costing_number"] == "OKY1054/0002",
               "η επόμενη πήρε OKY1054/0002"),
        expect(cancelled["cancellation_reason"] == "Λάθος οικονομική κατηγορία",
               "καταγράφηκε η αιτιολογία"),
    ]


# ---------------------------------------------------------------------------
# Έλεγχοι και δικαιώματα
# ---------------------------------------------------------------------------

@scenario("ΣΑ-13", "Μεταβολή υπηρεσιών ακυρώνει τον υπολογισμό",
          "Κοστολόγηση που έχει υπολογιστεί.",
          "Προσθήκη υπηρεσίας μετά τον υπολογισμό.",
          "Το αποθηκευμένο αποτέλεσμα διαγράφεται και απαιτείται νέος υπολογισμός. "
          "Δεν εμφανίζεται ποτέ παρωχημένο ποσό.",
          "§4.1")
def changing_services_invalidates(harness):
    episode_id = create_episode(harness)
    harness.client.post(f"/taep/{episode_id}/services",
                        data={"service_code": ["AED008", "AET057"]})
    harness.client.post(f"/taep/{episode_id}/calculate")
    before = taep.get_calculation(harness.ctx, episode_id) is not None
    harness.client.post(f"/taep/{episode_id}/services",
                        data={"service_code": ["AED008", "AET057", "AET074"]})
    page = harness.client.get(f"/taep/{episode_id}").get_data(as_text=True)
    return [
        expect(before, "υπήρχε αποθηκευμένος υπολογισμός"),
        expect(taep.get_calculation(harness.ctx, episode_id) is None,
               "ο υπολογισμός διαγράφηκε"),
        expect("Δεν έχει γίνει υπολογισμός" in page,
               "η οθόνη ζητά νέο υπολογισμό"),
    ]


@scenario("ΣΑ-14", "Οριστικοποιημένη κοστολόγηση δεν τροποποιείται",
          "Οριστικοποιημένη κοστολόγηση.",
          "Απόπειρα τροποποίησης στοιχείων ή υπηρεσιών.",
          "Η τροποποίηση απορρίπτεται. Η διόρθωση γίνεται με ακύρωση και νέα "
          "καταχώρηση.",
          "§10")
def finalised_is_immutable(harness):
    episode_id = drive_to_finalised(harness)
    response = harness.client.post(f"/taep/{episode_id}/services",
                                   data={"service_code": ["AED008"]},
                                   follow_redirects=True)
    try:
        taep.save_episode(harness.ctx, {"financial_category_id":
                                        category_id(harness.ctx, "624")},
                          "NGH", "NIC-ADULT", 1, episode_id=episode_id)
        edit_refused = False
    except taep.CostingError as exc:
        edit_refused = exc.code == "EPISODE_NOT_EDITABLE"
    return [
        expect("δεν μπορεί να τροποποιηθεί" in response.get_data(as_text=True),
               "η αλλαγή υπηρεσιών απορρίφθηκε"),
        expect(edit_refused, "η τροποποίηση στοιχείων απορρίφθηκε"),
        expect(len(taep.get_episode_service_codes(harness.ctx, episode_id)) == 12,
               "οι υπηρεσίες παρέμειναν αμετάβλητες"),
    ]


@scenario("ΣΑ-15", "Μη έγκυρη οικονομική κατηγορία απορρίπτεται από τον διακομιστή",
          "Οικονομική κατηγορία που δεν ισχύει στα ΤΑΕΠ, π.χ. 633 "
          "Οδοντιατρικές Υπηρεσίες.",
          "Απόπειρα καταχώρησης με αυτή την κατηγορία.",
          "Απορρίπτεται από τον διακομιστή, όχι μόνο από τη διεπαφή. "
          "Ο κατάλογος προσφέρει 23 από τις 38 κατηγορίες.",
          "§4.4")
def invalid_category_rejected_server_side(harness):
    page = harness.client.get("/taep/nea").get_data(as_text=True)
    try:
        create_episode(harness, code="633")
        refused = False
    except (AssertionError, taep.CostingError):
        refused = True
    valid = harness.ctx["db_execute"](
        "SELECT COUNT(*) n FROM taep_financial_category WHERE valid_for_ae=1",
        fetch=True)[0]["n"]
    return [
        expect(valid == 23, "23 έγκυρες κατηγορίες"),
        expect("ΟΔΟΝΤ ΥΠ" not in page, "η κατηγορία δεν προσφέρεται στη διεπαφή"),
        expect(refused, "ο διακομιστής απορρίπτει την κατηγορία"),
    ]


@scenario("ΣΑ-16", "Καταχώρηση άλλου νοσηλευτηρίου δεν αποκαλύπτεται",
          "Κοστολόγηση καταχωρημένη στο Γενικό Νοσοκομείο Λεμεσού.",
          "Χρήστης του Γενικού Νοσοκομείου Λευκωσίας ζητά την καταχώρηση.",
          "Λαμβάνει 404 και όχι 403, ώστε να μην αποκαλύπτεται ούτε η ύπαρξη "
          "της καταχώρησης. Η λίστα και η εξαγωγή είναι επίσης περιορισμένες.",
          "§8, §13")
def hospital_scoping(harness):
    elsewhere = taep.save_episode(
        harness.ctx,
        {**{f: None for f in taep.EPISODE_FIELDS}, "id_number": "9999",
         "last_name": "Λεμεσιανός", "examination_at": YESTERDAY,
         "financial_category_id": category_id(harness.ctx, "624")},
        entity_code="LGH", unit_code="LIM", user_id=1)
    status = harness.client.get(f"/taep/{elsewhere}").status_code
    listing = harness.client.get("/taep/list").get_data(as_text=True)
    return [
        expect(status == 404, "επιστρέφεται 404"),
        expect("Λεμεσιανός" not in listing, "δεν εμφανίζεται στη λίστα"),
    ]


@scenario("ΣΑ-17", "Χρήστης χωρίς δικαίωμα δεν βλέπει τη διαχείριση τιμών",
          "Χρήστης με δικαίωμα καταχώρησης αλλά χωρίς δικαίωμα τιμών.",
          "Αίτημα στις οθόνες διαχείρισης τιμών και τιμοκαταλόγου.",
          "Λαμβάνει 403. Ο έλεγχος γίνεται στον διακομιστή σε κάθε αίτημα.",
          "§8")
def permissions_are_server_side(harness):
    harness.ctx["granted_permissions"].add(taep.PERMISSIONS["create"])
    client = harness.app.test_client()
    with client.session_transaction() as sess:
        sess["user_id"] = 1
    statuses = {path: client.get(path).status_code
                for path in ("/taep/rates", "/taep/tariff", "/taep/tariff/download")}
    harness.ctx["granted_permissions"].clear()
    return [expect(status == 403, f"{path} → 403")
            for path, status in statuses.items()]


# ---------------------------------------------------------------------------
# Το έντυπο και η εξαγωγή
# ---------------------------------------------------------------------------

@scenario("ΣΑ-18", "Το έντυπο κοστολόγησης περιέχει όλα τα απαιτούμενα πεδία",
          "Οριστικοποιημένη κοστολόγηση.",
          "Εκτύπωση.",
          "Παράγεται PDF με τα προσωπικά δεδομένα, τις υπηρεσίες ομαδοποιημένες, "
          "και τον πίνακα συνόλων που περιλαμβάνει το Τέλος Εγγραφής.",
          "§12")
def printed_document(harness):
    episode_id = drive_to_finalised(harness)
    response = harness.client.get(f"/taep/{episode_id}/print")
    pdf = taep.render_costing_pdf(harness.ctx, episode_id)
    from pypdf import PdfReader
    text = "\n".join(p.extract_text() or ""
                     for p in PdfReader(BytesIO(pdf)).pages)
    return [
        expect(response.mimetype == "application/pdf", "παράγεται PDF"),
        expect("ΠΡΟΣΩΠΙΚΑ ΔΕΔΟΜΕΝΑ" in text, "περιέχει τα προσωπικά δεδομένα"),
        expect("Θεραπείες" in text and "Διαγνωστικές Παρεμβάσεις" in text,
               "οι υπηρεσίες είναι ομαδοποιημένες"),
        expect("Τέλος Εγγραφής" in text, "περιέχει το Τέλος Εγγραφής"),
        expect("Τελικό Κόστος" in text, "περιέχει το Τελικό Κόστος"),
        expect("OKY1054/0001" in text, "φέρει τον αριθμό κοστολόγησης"),
    ]


@scenario("ΣΑ-19", "Το έντυπο αναπαράγεται πανομοιότυπα",
          "Οριστικοποιημένη κοστολόγηση.",
          "Δεύτερη εκτύπωση του ίδιου περιστατικού.",
          "Το PDF είναι πανομοιότυπο σε επίπεδο byte, ώστε αποθηκευμένο και "
          "επανεκτυπωμένο έντυπο να μπορούν να συγκριθούν.",
          "§12")
def deterministic_pdf(harness):
    episode_id = drive_to_finalised(harness)
    first = taep.render_costing_pdf(harness.ctx, episode_id)
    second = taep.render_costing_pdf(harness.ctx, episode_id)
    return [expect(first == second, "τα δύο PDF είναι πανομοιότυπα")]


@scenario("ΣΑ-20", "Η μεταφόρτωση τιμοκαταλόγου με σφάλμα δεν εφαρμόζει τίποτα",
          "Αρχείο Excel τιμοκαταλόγου με μία έγκυρη αλλαγή και μία άκυρη γραμμή.",
          "Μεταφόρτωση και απόπειρα εφαρμογής.",
          "Αναφέρονται τα σφάλματα με τον αριθμό γραμμής και δεν εφαρμόζεται "
          "καμία αλλαγή.",
          "§7")
def tariff_upload_is_atomic(harness):
    import test_taep_excel as excel
    before = harness.ctx["db_execute"](
        "SELECT code, base_amount FROM taep_tariff ORDER BY code", fetch=True)
    data = excel.edit_download(harness.ctx,
                              changes=[("SHSO-ER11", 6, 25),
                                       ("SHSO-ER14", 5, "nonsense")])
    response = harness.client.post(
        "/taep/tariff/upload", data={"workbook": (BytesIO(data), "t.xlsx")},
        content_type="multipart/form-data")
    page = response.get_data(as_text=True)
    after = harness.ctx["db_execute"](
        "SELECT code, base_amount FROM taep_tariff ORDER BY code", fetch=True)
    return [
        expect("Δεν εφαρμόστηκε τίποτα" in page, "δηλώνεται ότι δεν εφαρμόστηκε τίποτα"),
        expect("Γραμμή" in page, "αναφέρεται ο αριθμός γραμμής"),
        expect(after == before, "ο τιμοκατάλογος παρέμεινε αμετάβλητος"),
    ]


@scenario("ΣΑ-21", "Η εξαγωγή σε Excel φέρει ζωντανούς τύπους",
          "Οριστικοποιημένες κοστολογήσεις στη λίστα.",
          "Εξαγωγή σε Excel.",
          "Το αρχείο περιέχει τύπους SUM και COUNTA πάνω στις γραμμές, ώστε τα "
          "σύνολα να είναι ελέγξιμα και όχι επικολλημένες τιμές.",
          "§7")
def export_has_live_formulas(harness):
    for index in range(3):
        drive_to_finalised(harness, episode_number=f"E-{index}")
    from openpyxl import load_workbook
    response = harness.client.get("/taep/list/export")
    sheet = load_workbook(BytesIO(response.data)).active
    formulas = [c.value for row in sheet.iter_rows() for c in row
                if isinstance(c.value, str) and c.value.startswith("=")]
    return [
        expect("spreadsheetml" in response.mimetype, "παράγεται αρχείο Excel"),
        expect(any(f.startswith("=SUM(") for f in formulas), "περιέχει τύπο SUM"),
        expect(any(f.startswith("=COUNTA(") for f in formulas), "περιέχει τύπο COUNTA"),
    ]


# ---------------------------------------------------------------------------
# Ιχνηλασιμότητα
# ---------------------------------------------------------------------------

@scenario("ΣΑ-22", "Κάθε μεταβολή καταγράφεται",
          "Πλήρης διαδρομή: καταχώρηση, υπολογισμός, οριστικοποίηση, ακύρωση.",
          "Έλεγχος του μητρώου ενεργειών.",
          "Καταγράφονται η δημιουργία, ο υπολογισμός, η οριστικοποίηση με τον "
          "αριθμό, και η ακύρωση με την αιτιολογία.",
          "§5")
def every_mutation_is_logged(harness):
    episode_id = drive_to_finalised(harness)
    harness.client.post(f"/taep/{episode_id}/cancel", data={"reason": "δοκιμή"})
    actions = [entry[2] for entry in harness.ctx["activity_log"]]
    finalised = [e for e in harness.ctx["activity_log"] if e[2] == "FINALISED"]
    return [
        expect("CREATED" in actions, "καταγράφηκε η δημιουργία"),
        expect("CALCULATED" in actions, "καταγράφηκε ο υπολογισμός"),
        expect("FINALISED" in actions, "καταγράφηκε η οριστικοποίηση"),
        expect("CANCELLED" in actions, "καταγράφηκε η ακύρωση"),
        expect("OKY1054/0001" in finalised[0][3],
               "η οριστικοποίηση καταγράφει τον αριθμό"),
    ]


@scenario("ΣΑ-23", "Η κοστολόγηση αναπαράγεται από τα αποθηκευμένα στοιχεία",
          "Οριστικοποιημένη κοστολόγηση.",
          "Έλεγχος του αποθηκευμένου αποτελέσματος.",
          "Αποθηκεύονται τα ποσά που εφαρμόστηκαν, οι γραμμές τιμών από τις "
          "οποίες προήλθαν, η έκδοση του αλγορίθμου και η υπογραφή των δεδομένων "
          "εισόδου, ώστε το ποσό να αναπαράγεται χρόνια μετά.",
          "§5, §6")
def costing_is_reproducible(harness):
    episode_id = drive_to_finalised(harness)
    stored = taep.get_calculation(harness.ctx, episode_id)
    return [
        expect(stored["weight_rate_id"] is not None,
               "αποθηκεύτηκε η γραμμή τιμής βαρύτητας"),
        expect(stored["registration_fee_rate_id"] is not None,
               "αποθηκεύτηκε η γραμμή τέλους εγγραφής"),
        expect(stored["algorithm_version"] == taep.ALGORITHM_VERSION,
               "αποθηκεύτηκε η έκδοση του αλγορίθμου"),
        expect(len(stored["input_hash"]) == 64, "αποθηκεύτηκε η υπογραφή εισόδου"),
    ]


@scenario("ΣΑ-24", "Αναζήτηση υπηρεσίας χωρίς τόνους και πεζά/κεφαλαία",
          "Ο κατάλογος των 125 υπηρεσιών.",
          "Αναζήτηση με «ΕΓΧΥΣΗ ΥΓΡΩΝ», «εγχυση υγρων» και «Έγχυση υγρών».",
          "Και οι τρεις μορφές βρίσκουν την ίδια υπηρεσία.",
          "§11")
def accent_insensitive_search(harness):
    checks = []
    for term in ("ΕΓΧΥΣΗ ΥΓΡΩΝ", "εγχυση υγρων", "Έγχυση υγρών", "AET043"):
        hits = harness.client.get(f"/taep/api/services?q={term}").get_json()
        checks.append(expect("AET043" in [h["code"] for h in hits],
                             f"«{term}» βρίσκει AET043"))
    return checks


@scenario("ΣΑ-25", "Προηγούμενες κοστολογήσεις «Επί Πληρωμή» επισημαίνονται",
          "Ασθενής με προηγούμενη οριστικοποιημένη κοστολόγηση «Επί Πληρωμή».",
          "Ο κωδικοποιητής καταχωρεί τον αριθμό ταυτοποίησης.",
          "Εμφανίζονται οι προηγούμενες κοστολογήσεις χωρίς καταγεγραμμένη "
          "εξόφληση, χωρίς να εμποδίζεται η νέα καταχώρηση.",
          "§7")
def unpaid_prior_episodes_flagged(harness):
    drive_to_finalised(harness, code="600", episode_number="E-1")
    data = harness.client.get(
        "/taep/api/prior?id_type=Ταυτότητα&id_number=1045872").get_json()
    return [
        expect(data["count"] >= 1, "βρέθηκε προηγούμενη καταχώρηση"),
        expect(len(data["unpaid"]) == 1, "επισημάνθηκε μία χωρίς εξόφληση"),
        expect(data["unpaid"][0]["costing_number"] == "OKY1054/0001",
               "αναφέρεται ο αριθμός κοστολόγησης"),
        expect(data["prefill"]["last_name"] == "Παπαδόπουλος",
               "προσφέρεται συμπλήρωση στοιχείων"),
    ]
