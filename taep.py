"""
ΤΑΕΠ — Κοστολόγηση Περιστατικού for non-GESY patients.

eFinance module. Follows the module contract in the eFinance DESIGN.md:
SCHEMA_STATEMENTS / ALTER_STATEMENTS / seed(ctx) / register(app, ctx).

This file is in two halves, deliberately:

  1. The costing engine — pure functions, zero I/O, no framework imports, no
     database access. It is ΟΑΥ's algorithm, not ours. It is the part that must
     survive every future rewrite of everything around it. Do not put a query,
     a request object or a clock in it.
  2. Schema, seed loader and (Phase 2) routes — everything that touches the world.

Comments and identifiers are English per the build brief §2, which differs from the
Greek used elsewhere in eFinance. Raised with Πληροφορικής; brief wins for this module.

Phase 1 scope: halves 1 and 2 minus routes. register() arrives with Phase 2.
"""

import csv
import datetime as dt
import hashlib
import os
import re
import unicodedata
from dataclasses import dataclass, field
from decimal import Decimal, ROUND_HALF_UP

ALGORITHM_VERSION = "1.0.0"

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
SEED_DIR = os.path.join(BASE_DIR, "seed")


# ===========================================================================
# 1. COSTING ENGINE — pure. No I/O below this line until section 2.
# ===========================================================================

INVESTIGATION = "INVESTIGATION"
TREATMENT = "TREATMENT"

# The weight matrix is ΟΑΥ's and is fixed. It lives here as a constant rather than
# being read from the database at calculation time, so that a stray UPDATE on the
# weight_matrix table cannot silently change every price in the hospital. seed()
# writes this same constant into the table for reference and audit, and
# verify_weight_matrix() checks the two still agree.
#
#   (max investigation category, max treatment category) -> weight
WEIGHT_MATRIX = {
    (1, 1): 4,  (1, 2): 4,  (1, 3): 8,  (1, 4): 8,  (1, 5): 12,
    (2, 1): 4,  (2, 2): 4,  (2, 3): 8,  (2, 4): 12, (2, 5): 12,
    (3, 1): 12, (3, 2): 12, (3, 3): 12, (3, 4): 12, (3, 5): 12,
}

TRIAGE_WEIGHT = 1

# Band labels. Both languages come from the "Care Levels" sheet of the A&E catalogue
# (seed/care_levels.csv) — they are the organisation's own wording, not a translation
# we made. AELEVEL1/2/3 map to weights 4/8/12; TRIAGE to weight 1.
BAND_LABELS_EN = {
    1: "Triage",
    4: "Low cost combination of investigation and treatment",
    8: "Standard cost combination of investigation and treatment",
    12: "High cost combination of investigation and treatment",
}

BAND_LABELS_EL = {
    1: "Διαλογή",
    4: "Συνδυασμός διάγνωσης και θεραπείας χαμηλού κόστους",
    8: "Συνδυασμός διάγνωσης και θεραπείας μέσου κόστους",
    12: "Συνδυασμός διάγνωσης και θεραπείας υψηλού κόστους",
}

# Ruling of Μονάδα Ελέγχου Εσόδων, 22/09/2026, item 4:
#   «δεν έχει τιμή μονάδας, η κοστολόγηση της βαρύτητας (60-120-180) γίνεται
#    βάση του αλγόριθμου ΤΑΕΠ»
#
# There is no per-category unit price. The weight maps straight to an amount, the
# same amount in every hospital and for every financial category. The €15.00 figure
# we derived from the sample document was arithmetic (8 × 15 = 120), not a rate —
# it happens to reproduce this scale, which is why the golden case still holds.
#
WEIGHT_PRICE_SCALE = {
    4: Decimal("60.00"),
    8: Decimal("120.00"),
    12: Decimal("180.00"),
}

# Ruling of 23/09/2026, item 1: «10 ευρώ». Triage is its own amount and is not on the
# 60/120/180 scale — it is not the weight-4 price, nor a unit price times one.
TRIAGE_PRICE = Decimal("10.00")

PRICE_TYPES = ("fixed", "fixed_plus_hourly", "fixed_plus_consumables", "tariff_lookup")

CENT = Decimal("0.01")


class CostingError(Exception):
    """A validation failure the clerk must see, in Greek, per the build brief §10.

    Carries a stable `code` for tests and logs, and `message_el` for the screen.
    """

    def __init__(self, code, message_el):
        super().__init__(f"{code}: {message_el}")
        self.code = code
        self.message_el = message_el


def money(value):
    """Round to two decimals, half-up.

    Python's default is banker's rounding, which would round 0.125 to 0.12 and lose
    a cent against every hand-checked figure the Μονάδα produces. Applied once per
    component, never to an intermediate value, per the brief §13.
    """
    return Decimal(value).quantize(CENT, rounding=ROUND_HALF_UP)


def fold_greek(text):
    """Accent-, case- and final-sigma-insensitive key for Greek text.

    «ΑΚΤΙΝΟΓΡΑΦΙΑ», «ακτινογραφία» and «ακτινογραφια» must all match (brief §11).
    PostgreSQL's unaccent is not available on MySQL, so folding happens here and the
    folded value is what gets stored and compared. eFinance already does the same in
    oayrecon.py; this is that approach, not a second one.
    """
    decomposed = unicodedata.normalize("NFD", (text or "").lower())
    stripped = "".join(c for c in decomposed if unicodedata.category(c) != "Mn")
    return stripped.replace("\u03c2", "\u03c3").strip()


@dataclass(frozen=True)
class Service:
    """A row of seed/services.csv, as selected on form 1-125."""
    code: str
    service_type: str
    category: int
    description_el: str = ""


@dataclass(frozen=True)
class Rates:
    """The amounts in force on the examination date.

    weight_amounts maps weight -> amount (the 60/120/180 scale). triage_amount is
    separate and currently unconfirmed. None anywhere means no rate in force, which
    blocks rather than falling back to a default: a silent default is how wrong bills
    get issued (brief §6).

    tariff_applies comes from the financial category, not from a branch in code. The
    Μονάδα ruled that tariff charges arise only where the patient is self-paying —
    600 ΕΠΙ ΠΛΗΡΩΜΗ, 602 ΕΥΡΩΚΑΡΤΑ, 640 ΒΡΕΤΑΝΙΚΕΣ ΒΑΣΕΙΣ.
    """
    weight_amounts: dict = field(default_factory=lambda: dict(WEIGHT_PRICE_SCALE))
    triage_amount: Decimal = TRIAGE_PRICE
    registration_fee: Decimal = Decimal("0.00")
    tariff_applies: bool = False
    weight_rate_id: int = None
    registration_fee_rate_id: int = None


@dataclass(frozen=True)
class TariffLine:
    """One optional extra charge, priced from a tariff rather than the weight."""
    tariff_code: str
    description: str
    price_type: str
    base_amount: Decimal = Decimal("0.00")
    hourly_amount: Decimal = None
    quantity: int = 1
    hours: Decimal = None
    consumables_amount: Decimal = None
    consumables_note: str = None
    radiology_cpt: str = None
    radiology_price: Decimal = None


@dataclass(frozen=True)
class CostedLine:
    """A tariff line after pricing. Suppressed lines print at zero with a reason."""
    tariff_code: str
    description: str
    quantity: int
    line_total: Decimal
    suppressed: bool = False
    suppression_reason_el: str = None


@dataclass(frozen=True)
class CostingResult:
    max_investigation_category: int
    max_treatment_category: int
    weight: int
    band_label_en: str
    band_label_el: str
    is_triage_only: bool
    weight_amount_applied: Decimal
    weight_rate_id: int
    registration_fee_applied: Decimal
    registration_fee_rate_id: int
    weight_cost: Decimal
    tariff_total: Decimal
    total_cost: Decimal
    lines: tuple = ()
    algorithm_version: str = ALGORITHM_VERSION
    input_hash: str = ""
    warnings_el: tuple = ()
    # Non-empty means the episode may be calculated and shown, but not finalised.
    blocking_issues_el: tuple = ()

    @property
    def can_finalise(self):
        return not self.blocking_issues_el


def resolve_weight(investigation_categories, treatment_categories):
    """The ΟΑΥ rule: maximum category on each side indexes the matrix.

    «λαμβάνεται υπόψη η εκάστοτε μέγιστη κατηγορία» — not the sum, not the count,
    not the average. Triage is never an input; it is the absence of both sides.

    Returns (max_investigation, max_treatment, weight, is_triage_only).
    """
    investigations = list(investigation_categories)
    treatments = list(treatment_categories)

    if not investigations and not treatments:
        return None, None, TRIAGE_WEIGHT, True

    if not investigations:
        raise CostingError(
            "MISSING_INVESTIGATION",
            "Δεν έχει επιλεγεί καμία διαγνωστική παρέμβαση. "
            "Όταν επιλέγονται υπηρεσίες, απαιτείται τουλάχιστον μία διαγνωστική "
            "παρέμβαση και τουλάχιστον μία θεραπεία.",
        )
    if not treatments:
        raise CostingError(
            "MISSING_TREATMENT",
            "Δεν έχει επιλεγεί καμία θεραπεία. "
            "Όταν επιλέγονται υπηρεσίες, απαιτείται τουλάχιστον μία διαγνωστική "
            "παρέμβαση και τουλάχιστον μία θεραπεία.",
        )

    max_investigation = max(investigations)
    max_treatment = max(treatments)

    try:
        weight = WEIGHT_MATRIX[(max_investigation, max_treatment)]
    except KeyError:
        raise CostingError(
            "MATRIX_CELL_MISSING",
            f"Δεν υπάρχει συντελεστής βαρύτητας για τον συνδυασμό "
            f"διαγνωστικής κατηγορίας {max_investigation} και θεραπευτικής "
            f"κατηγορίας {max_treatment}.",
        ) from None
    return max_investigation, max_treatment, weight, False


def price_tariff_line(line):
    """Price one tariff line. Returns a CostedLine.

    Quantity multiplies the base amount. Hours and consumables are charged once per
    line, not per unit — a three-hour infusion is one line with hours=3, not three
    lines. Confirm with the Μονάδα if any tariff is ever billed otherwise.
    """
    if line.price_type not in PRICE_TYPES:
        raise CostingError(
            "UNKNOWN_PRICE_TYPE",
            f"Άγνωστος τύπος τιμολόγησης «{line.price_type}» για τον κωδικό "
            f"{line.tariff_code}.",
        )
    if line.quantity is None or line.quantity < 1:
        raise CostingError(
            "BAD_QUANTITY",
            f"Η ποσότητα για τον κωδικό {line.tariff_code} πρέπει να είναι "
            f"τουλάχιστον 1.",
        )

    quantity = Decimal(line.quantity)

    if line.price_type == "tariff_lookup":
        if line.radiology_price is None:
            raise CostingError(
                "MISSING_CPT",
                f"Ο κωδικός {line.tariff_code} χρεώνεται ανάλογα με το ανατομικό "
                f"σημείο. Επιλέξτε εξέταση από τον τιμοκατάλογο Ακτινοδιαγνωστικής.",
            )
        total = Decimal(line.radiology_price) * quantity

    elif line.price_type == "fixed_plus_hourly":
        if line.hours is None or Decimal(line.hours) <= 0:
            raise CostingError(
                "MISSING_HOURS",
                f"Ο κωδικός {line.tariff_code} χρεώνεται με ωριαία επιβάρυνση. "
                f"Καταχωρήστε αριθμό ωρών μεγαλύτερο του μηδενός.",
            )
        hourly = Decimal(line.hourly_amount or 0)
        total = Decimal(line.base_amount) * quantity + hourly * Decimal(line.hours)

    elif line.price_type == "fixed_plus_consumables":
        consumables = Decimal(line.consumables_amount or 0)
        if consumables > 0 and not (line.consumables_note or "").strip():
            raise CostingError(
                "MISSING_CONSUMABLES_NOTE",
                f"Καταχωρήθηκε ποσό αναλωσίμων για τον κωδικό {line.tariff_code} "
                f"χωρίς αιτιολογία. Η σημείωση αναλωσίμων είναι υποχρεωτική.",
            )
        total = Decimal(line.base_amount) * quantity + consumables

    else:  # fixed
        total = Decimal(line.base_amount) * quantity

    return CostedLine(
        tariff_code=line.tariff_code,
        description=line.description,
        quantity=line.quantity,
        line_total=money(total),
    )


def pick_rate(rate_rows, on_date, entity_code=None):
    """The rate in force on `on_date`, or None.

    A costing must always use the rate in force on the EXAMINATION date, not today's
    (brief §6). An auditor asking in 2031 why a 2026 episode cost €120 gets the answer
    from the data, not from someone's memory.

    rate_rows: dicts with valid_from, valid_to (None = open), amount, id, entity_code.
    A row carrying an entity_code overrides a row with none — a hospital-specific rate
    beats the national one for the same period.
    """
    candidates = []
    for row in rate_rows:
        valid_from = row.get("valid_from")
        valid_to = row.get("valid_to")
        if valid_from is not None and on_date < valid_from:
            continue
        if valid_to is not None and on_date > valid_to:
            continue
        row_entity = row.get("entity_code")
        if row_entity and row_entity != entity_code:
            continue
        candidates.append(row)

    if not candidates:
        return None

    # Hospital-specific first, then the latest period that has started.
    # A row with no valid_from sorts oldest — it has always been in force.
    candidates.sort(
        key=lambda r: (1 if r.get("entity_code") else 0,
                       r.get("valid_from") or dt.date.min),
        reverse=True)

    best = candidates[0]
    ties = [c for c in candidates
            if bool(c.get("entity_code")) == bool(best.get("entity_code"))
            and c.get("valid_from") == best.get("valid_from")]
    if len(ties) > 1:
        raise CostingError(
            "OVERLAPPING_RATES",
            f"Βρέθηκαν {len(ties)} επικαλυπτόμενες τιμές σε ισχύ για την ίδια "
            f"ημερομηνία. Η κοστολόγηση δεν μπορεί να συνεχιστεί μέχρι να "
            f"διορθωθεί ο πίνακας τιμών.",
        )
    return best


def compute_input_hash(service_codes, tariff_lines, financial_category_code, service_date):
    """SHA-256 over the inputs that determine the price (brief §5).

    A recalculation producing a different hash is a new calculation, not an amendment.
    Service codes are sorted so selection order never changes the hash.
    """
    parts = [
        f"algorithm={ALGORITHM_VERSION}",
        f"category={financial_category_code}",
        f"date={service_date}",
        "services=" + ",".join(sorted(service_codes)),
    ]
    for line in sorted(tariff_lines, key=lambda l: (l.tariff_code, l.radiology_cpt or "")):
        parts.append(
            "tariff=" + "|".join(str(v) for v in (
                line.tariff_code, line.price_type, line.quantity,
                line.hours or "", line.consumables_amount or "",
                line.radiology_cpt or "", line.radiology_price or "",
            ))
        )
    return hashlib.sha256("\n".join(parts).encode("utf-8")).hexdigest()


def calculate(selected_services, rates, tariff_lines=(), financial_category_code=None,
              service_date=None):
    """Price one ΤΑΕΠ episode.

        TOTAL = weight_amount + tariff_total

    The weight amount comes from the 60/120/180 scale, not from a per-category unit
    price — see WEIGHT_PRICE_SCALE. The registration fee is carried but is €0.00 for
    every category under the Μονάδα's ruling of 22/09/2026; see the note there.

    selected_services: iterable of Service. Empty means triage only.
    rates:             the amounts in force on the examination date.
    tariff_lines:      iterable of TariffLine. Only permitted where the financial
                       category is self-paying (rates.tariff_applies).

    Raises CostingError, with a Greek message, rather than returning a wrong number.
    """
    services = list(selected_services)
    lines_in = list(tariff_lines)
    blocking = []
    warnings = []

    unknown = [s.code for s in services
               if s.service_type not in (INVESTIGATION, TREATMENT)]
    if unknown:
        raise CostingError(
            "UNKNOWN_SERVICE_TYPE",
            f"Άγνωστος τύπος υπηρεσίας για τους κωδικούς: {', '.join(sorted(unknown))}.",
        )

    investigation_categories = [s.category for s in services if s.service_type == INVESTIGATION]
    treatment_categories = [s.category for s in services if s.service_type == TREATMENT]

    max_investigation, max_treatment, weight, is_triage_only = resolve_weight(
        investigation_categories, treatment_categories)

    # Triage carries its own amount. It is not the weight-4 amount, and it is not a
    # unit price multiplied by one. The Μονάδα has not yet confirmed it.
    if is_triage_only:
        weight_amount = rates.triage_amount
        missing_what = "το ποσό διαλογής (triage)"
    else:
        weight_amount = (rates.weight_amounts or {}).get(weight)
        missing_what = f"το ποσό για τη βαρύτητα {weight}"

    if weight_amount is None:
        raise CostingError(
            "NO_RATE_IN_FORCE",
            f"Δεν έχει καθοριστεί {missing_what} κατά την ημερομηνία εξέτασης "
            f"(οικονομική κατηγορία {financial_category_code}). Η κοστολόγηση δεν "
            f"μπορεί να ολοκληρωθεί.",
        )

    weight_amount = money(weight_amount)

    # Tariff charges arise only for self-paying categories. Where they do not apply,
    # a supplied line is refused rather than quietly zeroed — the clerk should not
    # have been offered it, and silently dropping it hides a UI fault.
    if lines_in and not rates.tariff_applies:
        raise CostingError(
            "TARIFF_NOT_ALLOWED",
            f"Οι πρόσθετες χρεώσεις τιμοκαταλόγου δεν ισχύουν για την οικονομική "
            f"κατηγορία {financial_category_code}. Εφαρμόζονται μόνο στις κατηγορίες "
            f"που πληρώνει ο ίδιος ο ασθενής.",
        )

    costed_lines = tuple(price_tariff_line(line) for line in lines_in)
    tariff_total = money(sum((l.line_total for l in costed_lines), Decimal("0.00")))

    if rates.registration_fee is None:
        registration_fee = None
        blocking.append(
            f"Δεν έχει επιβεβαιωθεί τέλος εγγραφής για την οικονομική κατηγορία "
            f"{financial_category_code}."
        )
    else:
        registration_fee = money(rates.registration_fee)

    total_cost = (None if registration_fee is None
                  else money(weight_amount + registration_fee + tariff_total))

    return CostingResult(
        max_investigation_category=max_investigation,
        max_treatment_category=max_treatment,
        weight=weight,
        band_label_en=BAND_LABELS_EN[weight],
        band_label_el=BAND_LABELS_EL[weight],
        is_triage_only=is_triage_only,
        weight_amount_applied=weight_amount,
        weight_rate_id=rates.weight_rate_id,
        registration_fee_applied=registration_fee,
        registration_fee_rate_id=rates.registration_fee_rate_id,
        weight_cost=weight_amount,
        tariff_total=tariff_total,
        total_cost=total_cost,
        lines=costed_lines,
        blocking_issues_el=tuple(blocking),
        input_hash=compute_input_hash(
            [s.code for s in services], lines_in, financial_category_code, service_date),
        warnings_el=tuple(warnings),
    )


# ===========================================================================
# 2. SCHEMA, SEED LOADER — everything below touches the world.
# ===========================================================================
#
# Hospitals are NOT a table here. eFinance already has entities(code, name, type)
# with type='hospital', seeded with the same codes as eMAP and eQuality, plus
# user_entities, user_entity() and can_access_entity(). Episodes carry
# entity_code and reuse that scoping. See docs/adr/001-application-stack.md.
#
# Audit likewise reuses the core activity_log via ctx['log_activity'].

SCHEMA_STATEMENTS = [
    """CREATE TABLE IF NOT EXISTS taep_financial_category (
        id INTEGER PRIMARY KEY {AUTO_INCREMENT},
        code_new VARCHAR(10) UNIQUE NOT NULL,
        name_el VARCHAR(200) NOT NULL,
        code_old_ei VARCHAR(10),
        code_old_taep VARCHAR(10),
        note_el TEXT,
        valid_for_ae TINYINT DEFAULT 1,
        -- Ruling 2: tariff charges arise only where the patient pays for themselves
        -- (600, 602, 640). A flag on the row, never a branch in code.
        tariff_applies TINYINT DEFAULT 0,
        requires_payer TINYINT DEFAULT 0,
        payer_el VARCHAR(200),
        fee_status VARCHAR(20) DEFAULT 'UNCONFIRMED',
        active TINYINT DEFAULT 1
    ){ENGINE}""",

    """CREATE TABLE IF NOT EXISTS taep_service (
        code VARCHAR(10) PRIMARY KEY,
        service_type VARCHAR(15) NOT NULL,
        category SMALLINT NOT NULL,
        category_code VARCHAR(10),
        description_el VARCHAR(500) NOT NULL,
        active TINYINT DEFAULT 1,
        valid_from DATE,
        valid_to DATE
    ){ENGINE}""",

    """CREATE TABLE IF NOT EXISTS taep_weight_matrix (
        id INTEGER PRIMARY KEY {AUTO_INCREMENT},
        investigation_category SMALLINT,
        treatment_category SMALLINT,
        weight SMALLINT NOT NULL,
        band_label_en VARCHAR(200),
        band_label_el VARCHAR(200),
        UNIQUE (investigation_category, treatment_category)
    ){ENGINE}""",

    # Never UPDATE a rate: close the old row (valid_to, closed_by) and insert a new
    # one. The brief §5 asks for a Postgres exclusion constraint to stop two periods
    # for the same key overlapping. MySQL and SQLite have no EXCLUDE, so the unique
    # key below is a backstop only and the real check runs in the application, inside
    # the same transaction as the insert. See ADR-001 consequence (2).
    """CREATE TABLE IF NOT EXISTS taep_rate (
        id INTEGER PRIMARY KEY {AUTO_INCREMENT},
        -- Ruling 4: the amount is a function of the weight alone. It is national and
        -- the same for every financial category, so financial_category_id is NULL on
        -- a WEIGHT_AMOUNT row and reserved for any future category-specific price.
        financial_category_id INT,
        entity_code VARCHAR(10),
        rate_type VARCHAR(25) NOT NULL,   -- WEIGHT_AMOUNT | TRIAGE_AMOUNT | REGISTRATION_FEE | REGISTRATION_DEPOSIT
        weight SMALLINT,                  -- 4, 8 or 12 on a WEIGHT_AMOUNT row; NULL otherwise
        amount DECIMAL(15,2) NOT NULL,
        valid_from DATE NOT NULL,
        valid_to DATE,
        source_document VARCHAR(300),
        created_by INT,
        created_at DATETIME,
        closed_by INT,
        closed_at DATETIME,
        UNIQUE (financial_category_id, entity_code, rate_type, weight, valid_from)
    ){ENGINE}""",

    """CREATE TABLE IF NOT EXISTS taep_tariff (
        id INTEGER PRIMARY KEY {AUTO_INCREMENT},
        tariff_scope VARCHAR(10) DEFAULT 'GENERAL',
        financial_category_id INT,
        code VARCHAR(20) NOT NULL,
        description_el VARCHAR(500),
        group_el VARCHAR(200),
        price_type VARCHAR(30) NOT NULL,
        base_amount DECIMAL(15,2) DEFAULT 0.00,
        hourly_amount DECIMAL(15,2),
        price_raw VARCHAR(300),
        load_status VARCHAR(20) DEFAULT 'OK',
        valid_from DATE,
        valid_to DATE,
        source_document VARCHAR(300),
        active TINYINT DEFAULT 1
    ){ENGINE}""",

    """CREATE TABLE IF NOT EXISTS taep_radiology_tariff (
        id INTEGER PRIMARY KEY {AUTO_INCREMENT},
        cpt_code VARCHAR(20) NOT NULL,
        group_en VARCHAR(100),
        description_en VARCHAR(500),
        description_el VARCHAR(500),
        price_eur DECIMAL(15,2),
        valid_from DATE,
        valid_to DATE,
        active TINYINT DEFAULT 1,
        UNIQUE (cpt_code, valid_from)
    ){ENGINE}""",

    """CREATE TABLE IF NOT EXISTS taep_episode (
        id INTEGER PRIMARY KEY {AUTO_INCREMENT},
        entity_code VARCHAR(10) NOT NULL,
        costing_number VARCHAR(30) UNIQUE,
        episode_number VARCHAR(50),
        financial_category_id INT,
        first_name VARCHAR(100),
        last_name VARCHAR(100),
        date_of_birth DATE,
        gender VARCHAR(10),
        phone VARCHAR(50),
        address VARCHAR(300),
        id_type VARCHAR(30),
        id_number VARCHAR(50),
        id_country VARCHAR(60),
        id_expiry DATE,
        next_of_kin_type VARCHAR(50),
        next_of_kin_details VARCHAR(300),
        comments TEXT,
        admission_at DATETIME,
        examination_at DATETIME,
        discharge_at DATETIME,
        status VARCHAR(12) DEFAULT 'DRAFT',
        created_by INT,
        created_at DATETIME,
        updated_by INT,
        updated_at DATETIME,
        cancelled_by INT,
        cancelled_at DATETIME,
        cancellation_reason VARCHAR(500),
        UNIQUE (entity_code, episode_number)
    ){ENGINE}""",

    """CREATE TABLE IF NOT EXISTS taep_episode_service (
        id INTEGER PRIMARY KEY {AUTO_INCREMENT},
        episode_id INT NOT NULL,
        service_code VARCHAR(10) NOT NULL,
        added_by INT,
        added_at DATETIME,
        UNIQUE (episode_id, service_code)
    ){ENGINE}""",

    """CREATE TABLE IF NOT EXISTS taep_episode_tariff_line (
        id INTEGER PRIMARY KEY {AUTO_INCREMENT},
        episode_id INT NOT NULL,
        tariff_id INT,
        radiology_cpt VARCHAR(20),
        description_snapshot VARCHAR(500),
        quantity INT DEFAULT 1,
        hours DECIMAL(15,2),
        consumables_amount DECIMAL(15,2),
        consumables_note VARCHAR(500),
        line_total DECIMAL(15,2),
        suppressed TINYINT DEFAULT 0,
        added_by INT,
        added_at DATETIME
    ){ENGINE}""",

    """CREATE TABLE IF NOT EXISTS taep_costing_result (
        episode_id INT PRIMARY KEY,
        calculated_at DATETIME,
        calculated_by INT,
        max_investigation_category SMALLINT,
        max_treatment_category SMALLINT,
        weight SMALLINT,
        band_label_en VARCHAR(200),
        band_label_el VARCHAR(200),
        is_triage_only TINYINT DEFAULT 0,
        weight_amount_applied DECIMAL(15,2),
        weight_rate_id INT,
        registration_fee_applied DECIMAL(15,2),
        registration_fee_rate_id INT,
        weight_cost DECIMAL(15,2),
        tariff_total DECIMAL(15,2),
        total_cost DECIMAL(15,2),
        algorithm_version VARCHAR(20),
        input_hash VARCHAR(64)
    ){ENGINE}""",

    # v1: the table exists so that payment, payer invoicing and SAP export are
    # additions rather than migrations. Nothing writes to it yet (brief §2).
    """CREATE TABLE IF NOT EXISTS taep_settlement (
        episode_id INT PRIMARY KEY,
        status VARCHAR(20),
        settled_at DATETIME,
        settled_by INT,
        reference VARCHAR(100)
    ){ENGINE}""",
]

ALTER_STATEMENTS = []


class SeedError(Exception):
    """A defect in the master data that must stop the boot rather than be worked around."""


def _read_seed(name):
    path = os.path.join(SEED_DIR, name)
    if not os.path.exists(path):
        raise SeedError(f"Seed file missing: {path}")
    with open(path, encoding="utf-8") as handle:
        return list(csv.DictReader(handle))


def _decimal_or_none(raw):
    raw = (raw or "").strip()
    if not raw:
        return None
    try:
        return money(Decimal(raw))
    except Exception:
        return None


def load_services(rows):
    """Validate and normalise services.csv.

    Fails hard on a duplicate code.

    The CSV used in Phase 1 was a corrupted extract that split AET092 across two rows
    three weight bands apart; keeping the last row silently would have priced a
    nasogastric tube as thrombolysis. seed/services.csv is now generated from the
    source catalogue by tools/import_catalogue.py and carries no duplicates, but the
    check stays: a bad extract must stop the boot, not reach a patient's bill.
    """
    seen = {}
    duplicates = []
    services = []

    for row in rows:
        code = (row["code"] or "").strip()
        if not code:
            raise SeedError("services.csv contains a row with no code")
        if code in seen:
            duplicates.append((code, seen[code], row["description_el"]))
            continue
        seen[code] = row["description_el"]

        service_type = (row["service_type"] or "").strip().upper()
        if service_type not in (INVESTIGATION, TREATMENT):
            raise SeedError(f"{code}: unknown service_type {service_type!r}")

        category = int(row["category"])
        limit = 3 if service_type == INVESTIGATION else 5
        if not 1 <= category <= limit:
            raise SeedError(
                f"{code}: category {category} out of range for {service_type} (1..{limit})")

        services.append(Service(code=code, service_type=service_type, category=category,
                                description_el=(row["description_el"] or "").strip()))

    if duplicates:
        detail = "; ".join(
            f"{code} used for both {first!r} and {second!r}"
            for code, first, second in duplicates)
        raise SeedError(
            f"Duplicate service codes in services.csv — {detail}. "
            f"Μονάδα Ελέγχου Εσόδων must reassign one code before go-live "
            f"(build brief §9.1). Refusing to load.")

    return services


def verify_weight_matrix(rows):
    """Check seed/weight_matrix.csv still agrees with the WEIGHT_MATRIX constant.

    The constant is authoritative — it is the algorithm. This catches a CSV that has
    drifted from it, which would otherwise be invisible until an auditor asked why a
    price changed.
    """
    from_csv = {}
    for row in rows:
        investigation = row["investigation_category"].strip()
        treatment = row["treatment_category"].strip()
        if investigation == "-" or treatment == "-":
            continue  # the triage row; triage is handled in code, not the matrix
        key = (int(investigation.split()[-1]), int(treatment.split()[-1]))
        from_csv[key] = int(row["weight"])

    if from_csv != WEIGHT_MATRIX:
        differences = sorted(
            set(from_csv.items()) ^ set(WEIGHT_MATRIX.items()))
        raise SeedError(
            f"seed/weight_matrix.csv disagrees with the WEIGHT_MATRIX constant "
            f"in taep.py: {differences}. The matrix is ΟΑΥ's and is not ours to "
            f"change on either side — resolve before loading.")
    return True


def parse_tariff_price(code, price_raw):
    """Classify a price_raw cell from extra_charges.csv into a price_type.

    Returns (price_type, base_amount, hourly_amount, load_status). A cell that cannot
    be parsed into a clean type comes back UNPARSED with a zero amount, so that the
    load report can list it for the Μονάδα rather than the loader guessing. Splitting
    multi-tier prices into separate rows is done here and not by hand (brief §4.3).
    """
    raw = (price_raw or "").strip()
    if not raw:
        return "fixed", None, None, "UNPARSED"

    # Folded so that accents in the source text cannot change how a price is read.
    folded = fold_greek(raw)

    # "Χρέωση ανάλογα με το ανατομικό σημείο..." — price comes from the CPT picker.
    if "ανατομικ" in folded:
        return "tariff_lookup", Decimal("0.00"), None, "OK"

    amounts = [Decimal(m.replace(",", ".")) for m in re.findall(r"\d+(?:[.,]\d+)?", raw)]
    lowered = folded

    if "ανα ωρα" in lowered:
        if len(amounts) >= 2:
            return "fixed_plus_hourly", money(amounts[0]), money(amounts[1]), "OK"
        return "fixed_plus_hourly", None, None, "UNPARSED"

    if "αναλωσ" in lowered:
        # ER13 is a single base plus consumables; ER16 is three tiers plus consumables
        # and needs the tiers named before it can be loaded (brief §9.7).
        if len(amounts) == 1:
            return "fixed_plus_consumables", money(amounts[0]), None, "OK"
        return "fixed_plus_consumables", None, None, "UNPARSED_MULTI_TIER"

    if len(amounts) == 1:
        return "fixed", money(amounts[0]), None, "OK"

    if len(amounts) > 1:
        # e.g. ER2 "15€ / 60€ / 70€" — three distinct tariffs sharing one source row.
        return "fixed", None, None, "UNPARSED_MULTI_TIER"

    return "fixed", None, None, "UNPARSED"


def build_load_report():
    """What the seed files load as. Pure apart from reading the CSVs."""
    services = load_services(_read_seed("services.csv"))
    verify_weight_matrix(_read_seed("weight_matrix.csv"))

    categories = _read_seed("financial_categories.csv")
    levels = _read_seed("care_levels.csv")

    unparsed = []
    for row in _read_seed("extra_charges.csv"):
        price_type, base, hourly, status = parse_tariff_price(row["code"], row["price_raw"])
        if status != "OK":
            unparsed.append({"code": row["code"], "price_raw": row["price_raw"],
                             "status": status})

    return {
        "services_loaded": len(services),
        "investigations": sum(1 for s in services if s.service_type == INVESTIGATION),
        "treatments": sum(1 for s in services if s.service_type == TREATMENT),
        "care_levels": len(levels),
        "categories_total": len(categories),
        "categories_valid_for_ae": sum(1 for c in categories if c["valid_for_ae"] == "TRUE"),
        "categories_with_tariff": [c["code_new"] for c in categories
                                   if c["tariff_applies"] == "TRUE"],
        "tariff_rows_needing_coder_choice": unparsed,
        "radiology_rows": len(_read_seed("radiology_tariff.csv")),
    }


def assert_finalisable(result):
    """Raise unless the costing may be finalised. Called on the finalise path only.

    Calculation is permissive so the clerk always sees what can be priced;
    finalisation is strict because it allocates a costing number and prints a bill.
    """
    if result.blocking_issues_el:
        raise CostingError("NOT_FINALISABLE", " ".join(result.blocking_issues_el))
    return True


COSTING_NUMBER_PREFIX = "OKY"


def format_costing_number(hospital_number, sequence):
    """Build a costing number: OKY<hospital><NNNN>.

    Ruling of 23/09/2026, item 4: «κωδικός ανά νοσηλευτήριο και μοναδικός αύξων
    αριθμός». The sample document reads OKY1054/0035, so 1054 is the hospital's own
    number and 0035 the sequence.

    The sequence is per hospital, gapless, allocated at finalisation and never reused;
    a cancelled costing keeps its number. Allocation is the caller's job — this
    function only formats, so that it stays pure and testable.

    The nine hospitals' numbers are not yet known; only 1054 appears in the sample.
    """
    if not str(hospital_number).strip():
        raise CostingError(
            "NO_HOSPITAL_NUMBER",
            "Δεν έχει οριστεί κωδικός νοσηλευτηρίου για τη σύνθεση του αριθμού "
            "κοστολόγησης.",
        )
    if not isinstance(sequence, int) or sequence < 1:
        raise CostingError(
            "BAD_SEQUENCE",
            "Ο αύξων αριθμός κοστολόγησης πρέπει να είναι θετικός ακέραιος.",
        )
    return f"{COSTING_NUMBER_PREFIX}{str(hospital_number).strip()}/{sequence:04d}"
