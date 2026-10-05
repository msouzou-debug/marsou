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

# The date the Μονάδα's rulings take effect. Rates before this are not modelled.
RATES_IN_FORCE_FROM = "2026-01-01"

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


def money_from_db(value):
    """Turn whatever the driver hands back for a money column into an exact Decimal.

    MySQL's DECIMAL(15,2) comes back as Decimal. SQLite has no decimal type: a
    DECIMAL(15,2) column has NUMERIC affinity, so the string "10.00" is stored and
    returned as the float 10.0. Going through str() keeps two-decimal money exact in
    both modes; never let a float reach the arithmetic.
    """
    if value is None:
        return None
    if isinstance(value, Decimal):
        return money(value)
    return money(Decimal(str(value)))


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
        -- series_key identifies the rate series as a NULL-free string, because the
        -- obvious UNIQUE key does not work: financial_category_id and entity_code are
        -- NULL on a national row, and SQL treats NULLs as distinct, so a UNIQUE over
        -- them lets two concurrent changes both insert. Measured: six threads, six
        -- rows with the same valid_from. The NULL columns stay for querying; this
        -- column is the uniqueness guard.
        series_key VARCHAR(120) NOT NULL DEFAULT '',
        UNIQUE (series_key, valid_from)
    ){ENGINE}""",

    """CREATE TABLE IF NOT EXISTS taep_tariff (
        id INTEGER PRIMARY KEY {AUTO_INCREMENT},
        tariff_scope VARCHAR(10) DEFAULT 'GENERAL',
        financial_category_id INT,
        code VARCHAR(20) NOT NULL,
        description_el VARCHAR(500),
        group_el VARCHAR(200),
        tier_label_el VARCHAR(200),
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

    # A ΤΑΕΠ unit is finer-grained than an eFinance entity: Γενικό Νοσοκομείο
    # Λευκωσίας runs two units, adults (1054) and paediatrics (1106), on one entity.
    # The costing-number sequence is per UNIT; access control stays per entity.
    #
    # host_entity_code is effective-dated because the paediatric unit is due to move
    # to Μακάριος ΙΙΙ: close the row and open a new one, never UPDATE in place.
    """CREATE TABLE IF NOT EXISTS taep_unit (
        id INTEGER PRIMARY KEY {AUTO_INCREMENT},
        unit_code VARCHAR(20) NOT NULL,
        name_el VARCHAR(200) NOT NULL,
        taep_number VARCHAR(10) NOT NULL,
        host_entity_code VARCHAR(10) NOT NULL,
        host_valid_from DATE,
        host_valid_to DATE,
        note_el VARCHAR(500),
        active TINYINT DEFAULT 1,
        UNIQUE (unit_code, host_valid_from)
    ){ENGINE}""",

    # Every costing number ever allocated, one row each, never deleted. A ledger
    # rather than a counter: the UNIQUE key is what makes allocation safe under
    # concurrency, because eFinance's db_execute commits per call and a transaction
    # cannot be held across two of them. See allocate_costing_number().
    """CREATE TABLE IF NOT EXISTS taep_costing_number (
        id INTEGER PRIMARY KEY {AUTO_INCREMENT},
        unit_code VARCHAR(20) NOT NULL,
        sequence_number INT NOT NULL,
        costing_number VARCHAR(30),
        allocated_at DATETIME,
        allocated_by INT,
        episode_id INT,
        UNIQUE (unit_code, sequence_number)
    ){ENGINE}""",

    """CREATE TABLE IF NOT EXISTS taep_episode (
        id INTEGER PRIMARY KEY {AUTO_INCREMENT},
        entity_code VARCHAR(10) NOT NULL,   -- for access control
        taep_unit_code VARCHAR(20) NOT NULL, -- for the costing-number sequence
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


# ---------------------------------------------------------------------------
# Schema rendering and the seed loader
# ---------------------------------------------------------------------------

def render_schema(statement, use_mysql):
    """Fill the {AUTO_INCREMENT} / {ENGINE} placeholders, as eFinance's core does."""
    if use_mysql:
        return statement.replace("{AUTO_INCREMENT}", "AUTO_INCREMENT").replace(
            "{ENGINE}", " ENGINE=InnoDB DEFAULT CHARSET=utf8mb4")
    # SQLite: INTEGER PRIMARY KEY already autoincrements, so the keyword is dropped.
    return statement.replace("{AUTO_INCREMENT}", "").replace("{ENGINE}", "")


def _bool(raw):
    return 1 if str(raw).strip().upper() == "TRUE" else 0


def _money_or_none(raw):
    raw = (raw or "").strip()
    return None if raw == "" else str(money(Decimal(raw)))


def _insert_many(db, table, columns, rows, chunk=200):
    """Insert rows in batches.

    eFinance's db_execute opens a connection per call, which is right for gunicorn but
    means a row-at-a-time seed costs one connection per row — 550 of them for this
    master data, and minutes of wall clock on SQLite where every commit fsyncs. One
    multi-row INSERT per chunk keeps the same contract and the same SQL dialect on both
    MySQL and SQLite.
    """
    if not rows:
        return
    placeholders = "(" + ",".join(["%s"] * len(columns)) + ")"
    prefix = f"INSERT INTO {table} ({', '.join(columns)}) VALUES "
    for start in range(0, len(rows), chunk):
        batch = rows[start:start + chunk]
        sql = prefix + ",".join([placeholders] * len(batch))
        params = tuple(value for row in batch for value in row)
        db(sql, params)


def seed(ctx):
    """Load the master data. Idempotent: each table is filled only if empty.

    Runs at boot under eFinance's init_db lock, per the module contract.
    """
    db = ctx["db_execute"]
    empty = lambda sql: not (db(sql, fetch=True) or [])

    if empty("SELECT id FROM taep_financial_category LIMIT 1"):
        _insert_many(db, "taep_financial_category",
                     ["code_new", "name_el", "code_old_ei", "code_old_taep", "note_el",
                      "valid_for_ae", "tariff_applies", "requires_payer", "payer_el",
                      "fee_status", "active"],
                     [(r["code_new"], r["name_el"], r["code_old_ei"] or None,
                       r["code_old_taep"] or None, r["note_el"] or None,
                       _bool(r["valid_for_ae"]), _bool(r["tariff_applies"]),
                       _bool(r["requires_payer"]), r["payer_el"] or None,
                       r["fee_status"], 1)
                      for r in _read_seed("financial_categories.csv")])

    if empty("SELECT code FROM taep_service LIMIT 1"):
        _insert_many(db, "taep_service",
                     ["code", "service_type", "category", "category_code",
                      "description_el", "active"],
                     [(s.code, s.service_type, s.category, f"AECAT{s.category}",
                       s.description_el, 1)
                      for s in load_services(_read_seed("services.csv"))])

    if empty("SELECT id FROM taep_weight_matrix LIMIT 1"):
        verify_weight_matrix(_read_seed("weight_matrix.csv"))
        _insert_many(db, "taep_weight_matrix",
                     ["investigation_category", "treatment_category", "weight",
                      "band_label_en", "band_label_el"],
                     [(investigation, treatment, weight,
                       BAND_LABELS_EN[weight], BAND_LABELS_EL[weight])
                      for (investigation, treatment), weight
                      in sorted(WEIGHT_MATRIX.items())])

    if empty("SELECT id FROM taep_unit LIMIT 1"):
        _insert_many(db, "taep_unit",
                     ["unit_code", "name_el", "taep_number", "host_entity_code",
                      "host_valid_from", "host_valid_to", "note_el", "active"],
                     [(r["unit_code"], r["name_el"], r["taep_number"],
                       r["host_entity_code"], r["host_valid_from"] or None,
                       r["host_valid_to"] or None, r["note_el"] or None, 1)
                      for r in _read_seed("taep_units.csv")])

    if empty("SELECT id FROM taep_tariff LIMIT 1"):
        _insert_many(db, "taep_tariff",
                     ["tariff_scope", "code", "description_el", "group_el",
                      "tier_label_el", "price_type", "base_amount", "hourly_amount",
                      "price_raw", "load_status", "active"],
                     [("GENERAL", r["code"], r["description_el"], r["group_el"],
                       r["tier_label_el"] or None, r["price_type"],
                       _money_or_none(r["base_amount"]),
                       _money_or_none(r["hourly_amount"]), r["price_raw"],
                       r["load_status"], 1)
                      for r in _read_seed("tariff.csv")])

    if empty("SELECT id FROM taep_radiology_tariff LIMIT 1"):
        _insert_many(db, "taep_radiology_tariff",
                     ["cpt_code", "group_en", "description_en", "description_el",
                      "price_eur", "active"],
                     [(r["cpt_code"], r["group_en"] or None, r["description_en"],
                       r["description_el"], _money_or_none(r["price_eur"]), 1)
                      for r in _read_seed("radiology_tariff.csv")])

    # The weight scale, triage amount and registration fees as effective-dated rate
    # rows, opened from the Μονάδα's rulings. No valid_to, so these are in force.
    if empty("SELECT id FROM taep_rate LIMIT 1"):
        source = "Μονάδα Ελέγχου Εσόδων 22/09–05/10/2026"
        def rate_row(category_id, rate_type, weight, amount):
            return (category_id, rate_type, weight, amount, RATES_IN_FORCE_FROM, source,
                    rate_series_key(rate_type, category_id, None, weight))

        rates = [rate_row(None, "WEIGHT_AMOUNT", weight, str(amount))
                 for weight, amount in sorted(WEIGHT_PRICE_SCALE.items())]
        rates.append(rate_row(None, "TRIAGE_AMOUNT", None, str(TRIAGE_PRICE)))

        ids = {r["code_new"]: r["id"] for r in db(
            "SELECT id, code_new FROM taep_financial_category", fetch=True)}
        for row in _read_seed("financial_categories.csv"):
            category_id = ids.get(row["code_new"])
            if category_id is None:
                continue
            rates.append(rate_row(category_id, "REGISTRATION_FEE", None,
                                  row["registration_fee_eur"]))
            if row["registration_deposit_eur"]:
                rates.append(rate_row(category_id, "REGISTRATION_DEPOSIT", None,
                                      row["registration_deposit_eur"]))
        _insert_many(db, "taep_rate",
                     ["financial_category_id", "rate_type", "weight", "amount",
                      "valid_from", "source_document", "series_key"], rates)


# ---------------------------------------------------------------------------
# Costing numbers: gapless, per unit, never reused
# ---------------------------------------------------------------------------

NUMBER_ALLOCATION_ATTEMPTS = 8


def allocate_costing_number(ctx, unit_code, now=None, user_id=None, episode_id=None):
    """Allocate the next costing number for a ΤΑΕΠ unit. Gapless, unique, never reused.

    The constraint is eFinance's DB layer: db_execute opens a connection and commits per
    call, so a transaction cannot span two calls. Anything of the form "read the last
    number, then write the next one" therefore races between the read and the write.

    Two attempts at this failed before the current one, and both are worth recording:

      * A counter incremented and read back with a second SELECT issued duplicate
        numbers — four threads, forty allocations, twenty-four distinct numbers.
      * Deriving the next number with a SELECT MAX and claiming it with an INSERT
        guarded by a UNIQUE key was correct but not durable: every loser of a race
        re-read the same MAX and collided again, and at eight threads a thread could
        lose its whole retry budget. Making losers walk upward instead helped but still
        gave up at sixteen threads, and a loser cannot simply jump ahead because
        skipping a number would leave a gap.

    So the read and the write are now ONE statement. MAX is evaluated inside the INSERT,
    under the write lock, so there is no window between deciding the number and taking
    it. The retry loop remains only for the rare engine that lets two such statements
    collide on the UNIQUE key.

    Returns (costing_number, sequence). A cancelled costing keeps its number; the ledger
    row stays and nothing is ever reissued.
    """
    db = ctx["db_execute"]
    unit = db("SELECT taep_number FROM taep_unit WHERE unit_code=%s AND active=1",
              (unit_code,), fetch=True)
    if not unit:
        raise CostingError("UNKNOWN_UNIT", f"Άγνωστη μονάδα ΤΑΕΠ «{unit_code}».")

    taep_number = unit[0]["taep_number"]
    stamp = now or dt.datetime.now()

    for _ in range(NUMBER_ALLOCATION_ATTEMPTS):
        try:
            row_id = db(
                """INSERT INTO taep_costing_number
                   (unit_code, sequence_number, allocated_at, allocated_by, episode_id)
                   SELECT %s, COALESCE(MAX(sequence_number), 0) + 1, %s, %s, %s
                   FROM taep_costing_number WHERE unit_code = %s""",
                (unit_code, stamp, user_id, episode_id, unit_code), lastrowid=True)
        except Exception as exc:
            if _is_duplicate_key(exc):
                continue
            raise

        # Reading back by our own row id is safe: no other session can have it.
        rows = db("SELECT sequence_number FROM taep_costing_number WHERE id=%s",
                  (row_id,), fetch=True)
        sequence = int(rows[0]["sequence_number"])
        costing_number = format_costing_number(taep_number, sequence)
        db("UPDATE taep_costing_number SET costing_number=%s WHERE id=%s",
           (costing_number, row_id))
        return costing_number, sequence

    raise CostingError(
        "NUMBER_ALLOCATION_FAILED",
        f"Δεν ήταν δυνατή η απόδοση αριθμού κοστολόγησης για τη μονάδα "
        f"{unit_code} μετά από {NUMBER_ALLOCATION_ATTEMPTS} προσπάθειες. "
        f"Δοκιμάστε ξανά.",
    )


def _is_duplicate_key(exc):
    """True for a unique-constraint violation on MySQL or SQLite.

    Matched on the message because the module must not import either driver — it runs
    against whichever eFinance is configured for.
    """
    text = str(exc).lower()
    return ("unique constraint failed" in text          # SQLite
            or "duplicate entry" in text                # MySQL
            or getattr(exc, "errno", None) == 1062)     # MySQL ER_DUP_ENTRY


def last_allocated_sequence(ctx, unit_code):
    """The highest sequence issued for a unit, or 0. Reporting only, never allocation."""
    rows = ctx["db_execute"](
        """SELECT COALESCE(MAX(sequence_number), 0) AS last
           FROM taep_costing_number WHERE unit_code = %s""", (unit_code,), fetch=True)
    return int(rows[0]["last"])


# ---------------------------------------------------------------------------
# Queries — the read side the routes sit on
# ---------------------------------------------------------------------------

def list_ae_categories(ctx):
    """The 23 ΤΑΕΠ-valid categories, for the picker. The other 15 are never offered."""
    return ctx["db_execute"](
        """SELECT id, code_new, name_el, tariff_applies, requires_payer, payer_el
           FROM taep_financial_category
           WHERE valid_for_ae = 1 AND active = 1
           ORDER BY code_new""", fetch=True) or []


def get_category(ctx, category_id):
    rows = ctx["db_execute"](
        "SELECT * FROM taep_financial_category WHERE id=%s", (category_id,), fetch=True)
    return rows[0] if rows else None


def search_services(ctx, term, limit=25):
    """Accent- and case-insensitive search over code and description.

    MySQL has no unaccent, so the folding happens in Python over the service list. 125
    rows is small enough that this is cheaper than a stored normalised column and a
    migration — revisit only if the catalogue grows by an order of magnitude.
    """
    rows = ctx["db_execute"](
        """SELECT code, service_type, category, description_el
           FROM taep_service WHERE active = 1 ORDER BY code""", fetch=True) or []
    needle = fold_greek(term)
    if not needle:
        return rows[:limit]
    hits = [r for r in rows
            if needle in fold_greek(r["code"]) or needle in fold_greek(r["description_el"])]
    # Code matches first: a clerk typing AET043 wants that row at the top.
    hits.sort(key=lambda r: (0 if needle in fold_greek(r["code"]) else 1, r["code"]))
    return hits[:limit]


def get_services(ctx, codes):
    """Service rows for the given codes, as engine Service objects."""
    if not codes:
        return []
    placeholders = ",".join(["%s"] * len(codes))
    rows = ctx["db_execute"](
        f"""SELECT code, service_type, category, description_el
            FROM taep_service WHERE code IN ({placeholders})""",
        tuple(codes), fetch=True) or []
    return [Service(r["code"], r["service_type"], int(r["category"]),
                    r["description_el"]) for r in rows]


def rates_in_force(ctx, category_id, on_date, entity_code=None):
    """Build a Rates from the rate rows in force on `on_date`.

    Uses pick_rate per rate type so the examination date, not today, decides — the
    whole point of §6. Returns None for anything with no row in force rather than
    defaulting.
    """
    rows = ctx["db_execute"](
        """SELECT id, rate_type, weight, amount, valid_from, valid_to, entity_code
           FROM taep_rate
           WHERE financial_category_id IS NULL OR financial_category_id = %s""",
        (category_id,), fetch=True) or []

    def of_type(rate_type, weight=None):
        return [r for r in rows if r["rate_type"] == rate_type
                and (weight is None or _as_int(r["weight"]) == weight)]

    weight_amounts, weight_rate_id = {}, None
    for weight in sorted(WEIGHT_PRICE_SCALE):
        chosen = pick_rate(_dated(of_type("WEIGHT_AMOUNT", weight)), on_date, entity_code)
        if chosen:
            weight_amounts[weight] = money_from_db(chosen["amount"])
            weight_rate_id = chosen["id"]

    triage = pick_rate(_dated(of_type("TRIAGE_AMOUNT")), on_date, entity_code)
    fee = pick_rate(_dated(of_type("REGISTRATION_FEE")), on_date, entity_code)

    category = get_category(ctx, category_id)
    return Rates(
        weight_amounts=weight_amounts,
        triage_amount=money_from_db(triage["amount"]) if triage else None,
        registration_fee=money_from_db(fee["amount"]) if fee else None,
        tariff_applies=bool(category and _as_int(category["tariff_applies"])),
        weight_rate_id=weight_rate_id,
        registration_fee_rate_id=fee["id"] if fee else None,
    )


def _as_int(value):
    return None if value is None else int(value)


def _dated(rows):
    """Normalise valid_from/valid_to to dates for pick_rate."""
    out = []
    for row in rows:
        row = dict(row)
        row["valid_from"] = _as_date(row.get("valid_from"))
        row["valid_to"] = _as_date(row.get("valid_to"))
        out.append(row)
    return out


def _as_date(value):
    if value is None or isinstance(value, dt.date) and not isinstance(value, dt.datetime):
        return value
    if isinstance(value, dt.datetime):
        return value.date()
    return dt.date.fromisoformat(str(value)[:10])


def unit_for_entity(ctx, entity_code, on_date=None):
    """The ΤΑΕΠ units hosted by an entity on a date.

    More than one is normal: Γενικό Νοσοκομείο Λευκωσίας hosts the adult and the
    paediatric unit, so the clerk picks. The host is effective-dated because the
    paediatric unit moves to Μακάριος ΙΙΙ.
    """
    on_date = on_date or dt.date.today()
    rows = ctx["db_execute"](
        """SELECT unit_code, name_el, taep_number, host_valid_from, host_valid_to
           FROM taep_unit WHERE host_entity_code = %s AND active = 1
           ORDER BY unit_code""", (entity_code,), fetch=True) or []
    live = []
    for row in rows:
        valid_from, valid_to = _as_date(row["host_valid_from"]), _as_date(row["host_valid_to"])
        if valid_from and on_date < valid_from:
            continue
        if valid_to and on_date > valid_to:
            continue
        live.append(row)
    return live


def find_prior_episodes(ctx, id_type, id_number, entity_code=None):
    """Prior episodes for the same identification (screen 1).

    Deliberately NOT scoped to one hospital: a patient who attended Limassol last month
    and Nicosia today is the same patient, and an unpaid prior episode elsewhere is
    exactly what the clerk needs to see. Only non-clinical fields are returned.
    """
    if not (id_number or "").strip():
        return []
    return ctx["db_execute"](
        """SELECT e.id, e.costing_number, e.entity_code, e.examination_at, e.status,
                  e.first_name, e.last_name, e.date_of_birth, e.gender, e.phone,
                  e.address, e.id_type, e.id_number, e.id_country, e.id_expiry,
                  e.next_of_kin_type, e.next_of_kin_details,
                  c.code_new AS category_code, c.name_el AS category_name,
                  r.total_cost
           FROM taep_episode e
           LEFT JOIN taep_financial_category c ON e.financial_category_id = c.id
           LEFT JOIN taep_costing_result r ON r.episode_id = e.id
           WHERE e.id_type = %s AND e.id_number = %s AND e.status <> 'CANCELLED'
           ORDER BY e.examination_at DESC""",
        (id_type, id_number.strip()), fetch=True) or []


def unpaid_self_pay_episodes(prior):
    """Of the prior episodes, the finalised self-pay ones with nothing settled.

    v1 has no settlement data, so "unpaid" means finalised under ΕΠΙ ΠΛΗΡΩΜΗ with no
    settlement row. That is the honest definition until v2 records payment, and the
    warning says so rather than implying a confirmed debt.
    """
    return [p for p in prior
            if p.get("category_code") == "600" and p.get("status") == "FINALISED"]


# ---------------------------------------------------------------------------
# Episode persistence
# ---------------------------------------------------------------------------

EPISODE_FIELDS = (
    "episode_number", "first_name", "last_name", "date_of_birth", "gender", "phone",
    "address", "id_type", "id_number", "id_country", "id_expiry", "next_of_kin_type",
    "next_of_kin_details", "comments", "admission_at", "examination_at", "discharge_at",
)

EDITABLE_STATUSES = ("DRAFT", "CALCULATED")


def validate_episode(data):
    """Brief §10. Returns (errors, warnings), both lists of Greek strings.

    Errors block the save; warnings do not. Expired identity documents are common in
    this population, so that one warns.
    """
    errors, warnings = [], []
    now = dt.datetime.now()

    admission = data.get("admission_at")
    examination = data.get("examination_at")
    discharge = data.get("discharge_at")

    for label, value in (("εισαγωγής", admission), ("εξέτασης", examination),
                         ("εξιτηρίου", discharge)):
        if value and value > now:
            errors.append(f"Η ημερομηνία και ώρα {label} δεν μπορεί να είναι "
                          f"στο μέλλον.")

    if admission and examination and examination < admission:
        errors.append("Η ώρα εξέτασης δεν μπορεί να προηγείται της ώρας εισαγωγής.")
    if examination and discharge and discharge < examination:
        errors.append("Η ώρα εξιτηρίου δεν μπορεί να προηγείται της ώρας εξέτασης.")

    date_of_birth = data.get("date_of_birth")
    if date_of_birth:
        if date_of_birth >= now.date():
            errors.append("Η ημερομηνία γέννησης πρέπει να είναι στο παρελθόν.")
        else:
            age = (now.date() - date_of_birth).days // 365
            if age > 110:
                warnings.append(f"Η ημερομηνία γέννησης δίνει ηλικία {age} ετών. "
                                f"Επιβεβαιώστε ότι είναι σωστή.")

    if not (data.get("id_number") or "").strip():
        errors.append("Ο αριθμός ταυτοποίησης είναι υποχρεωτικός.")

    expiry = data.get("id_expiry")
    if expiry and examination and expiry < examination.date():
        warnings.append("Το έγγραφο ταυτοποίησης είχε λήξει κατά την ημερομηνία "
                        "εξέτασης.")

    if not data.get("financial_category_id"):
        errors.append("Η οικονομική κατηγορία είναι υποχρεωτική.")

    return errors, warnings


def save_episode(ctx, data, entity_code, unit_code, user_id, episode_id=None):
    """Insert or update a DRAFT/CALCULATED episode. Returns the episode id.

    A FINALISED episode is never edited — it is cancelled and re-entered (brief §10).
    """
    db = ctx["db_execute"]
    now = dt.datetime.now()

    category = get_category(ctx, data.get("financial_category_id"))
    if category is None:
        raise CostingError("UNKNOWN_CATEGORY",
                           "Η οικονομική κατηγορία δεν βρέθηκε.")
    # The picker only offers the 23, but a UI filter is not a control (brief §4.4).
    if not _as_int(category["valid_for_ae"]):
        raise CostingError(
            "CATEGORY_NOT_VALID_AT_AE",
            f"Η οικονομική κατηγορία {category['code_new']} "
            f"«{category['name_el']}» δεν ισχύει στα ΤΑΕΠ.")

    if episode_id:
        existing = get_episode(ctx, episode_id)
        if existing is None:
            raise CostingError("EPISODE_NOT_FOUND", "Η καταχώρηση δεν βρέθηκε.")
        if existing["status"] not in EDITABLE_STATUSES:
            raise CostingError(
                "EPISODE_NOT_EDITABLE",
                f"Η καταχώρηση είναι «{existing['status']}» και δεν μπορεί να "
                f"τροποποιηθεί. Ακυρώστε την και καταχωρήστε νέα.")
        assignments = ", ".join(f"{f}=%s" for f in EPISODE_FIELDS)
        db(f"""UPDATE taep_episode SET {assignments}, financial_category_id=%s,
               updated_by=%s, updated_at=%s WHERE id=%s""",
           tuple(data.get(f) for f in EPISODE_FIELDS)
           + (data["financial_category_id"], user_id, now, episode_id))
        ctx["log_activity"]("taep_episode", episode_id, "UPDATED",
                            f"Ενημέρωση καταχώρησης {episode_id}")
        return episode_id

    columns = ", ".join(EPISODE_FIELDS)
    placeholders = ", ".join(["%s"] * len(EPISODE_FIELDS))
    new_id = db(f"""INSERT INTO taep_episode
                    (entity_code, taep_unit_code, financial_category_id, status,
                     created_by, created_at, {columns})
                    VALUES (%s,%s,%s,'DRAFT',%s,%s,{placeholders})""",
                (entity_code, unit_code, data["financial_category_id"], user_id, now)
                + tuple(data.get(f) for f in EPISODE_FIELDS),
                lastrowid=True)
    ctx["log_activity"]("taep_episode", new_id, "CREATED",
                        f"Νέα καταχώρηση ΤΑΕΠ στη μονάδα {unit_code}")
    return new_id


def get_episode(ctx, episode_id):
    rows = ctx["db_execute"]("SELECT * FROM taep_episode WHERE id=%s",
                             (episode_id,), fetch=True)
    return rows[0] if rows else None


def set_episode_services(ctx, episode_id, codes, user_id):
    """Replace the selected services. Any stored calculation becomes invalid.

    Brief §4.1: adding or removing a service after a calculation invalidates the
    result. Deleting the costing_result row is what enforces that — the UI cannot
    show a stale number because there is no number to show.
    """
    db = ctx["db_execute"]
    now = dt.datetime.now()
    db("DELETE FROM taep_episode_service WHERE episode_id=%s", (episode_id,))
    _insert_many(db, "taep_episode_service",
                 ["episode_id", "service_code", "added_by", "added_at"],
                 [(episode_id, code, user_id, now) for code in dict.fromkeys(codes)])
    db("DELETE FROM taep_costing_result WHERE episode_id=%s", (episode_id,))
    db("UPDATE taep_episode SET status='DRAFT', updated_by=%s, updated_at=%s "
       "WHERE id=%s AND status='CALCULATED'", (user_id, now, episode_id))


def get_episode_service_codes(ctx, episode_id):
    rows = ctx["db_execute"](
        "SELECT service_code FROM taep_episode_service WHERE episode_id=%s "
        "ORDER BY service_code", (episode_id,), fetch=True) or []
    return [r["service_code"] for r in rows]


def store_calculation(ctx, episode_id, result, user_id):
    """Persist a calculation and mark the episode CALCULATED.

    Stores the amounts applied AND the rate_id rows they came from, so the figure can
    be reproduced in 2031 from stored inputs (brief §5).
    """
    db = ctx["db_execute"]
    now = dt.datetime.now()
    db("DELETE FROM taep_costing_result WHERE episode_id=%s", (episode_id,))
    db("""INSERT INTO taep_costing_result
          (episode_id, calculated_at, calculated_by, max_investigation_category,
           max_treatment_category, weight, band_label_en, band_label_el,
           is_triage_only, weight_amount_applied, weight_rate_id,
           registration_fee_applied, registration_fee_rate_id, weight_cost,
           tariff_total, total_cost, algorithm_version, input_hash)
          VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)""",
       (episode_id, now, user_id, result.max_investigation_category,
        result.max_treatment_category, result.weight, result.band_label_en,
        result.band_label_el, 1 if result.is_triage_only else 0,
        str(result.weight_amount_applied), result.weight_rate_id,
        None if result.registration_fee_applied is None
        else str(result.registration_fee_applied),
        result.registration_fee_rate_id, str(result.weight_cost),
        str(result.tariff_total),
        None if result.total_cost is None else str(result.total_cost),
        result.algorithm_version, result.input_hash))
    db("UPDATE taep_episode SET status='CALCULATED', updated_by=%s, updated_at=%s "
       "WHERE id=%s AND status='DRAFT'", (user_id, now, episode_id))
    ctx["log_activity"]("taep_episode", episode_id, "CALCULATED",
                        f"Βαρύτητα {result.weight}, σύνολο {result.total_cost}")


def get_calculation(ctx, episode_id):
    rows = ctx["db_execute"]("SELECT * FROM taep_costing_result WHERE episode_id=%s",
                             (episode_id,), fetch=True)
    return rows[0] if rows else None


def finalise_episode(ctx, episode_id, result, user_id):
    """Allocate the costing number and lock the episode. Returns the number.

    Refuses if the calculation on screen is not the calculation stored — the clerk must
    have pressed Υπολογισμός on exactly what is being finalised, which input_hash
    proves. Also refuses if anything blocks finalisation (an unset registration fee).
    """
    db = ctx["db_execute"]
    episode = get_episode(ctx, episode_id)
    if episode is None:
        raise CostingError("EPISODE_NOT_FOUND", "Η καταχώρηση δεν βρέθηκε.")
    if episode["status"] == "FINALISED":
        raise CostingError(
            "ALREADY_FINALISED",
            f"Η καταχώρηση έχει ήδη οριστικοποιηθεί με αριθμό "
            f"{episode['costing_number']}.")
    if episode["status"] == "CANCELLED":
        raise CostingError("EPISODE_CANCELLED", "Η καταχώρηση έχει ακυρωθεί.")

    stored = get_calculation(ctx, episode_id)
    if stored is None:
        raise CostingError(
            "NOT_CALCULATED",
            "Απαιτείται υπολογισμός πριν την οριστικοποίηση.")
    if stored["input_hash"] != result.input_hash:
        raise CostingError(
            "STALE_CALCULATION",
            "Οι υπηρεσίες ή τα στοιχεία άλλαξαν μετά τον υπολογισμό. "
            "Πατήστε «Υπολογισμός» ξανά.")

    assert_finalisable(result)

    now = dt.datetime.now()
    costing_number, sequence = allocate_costing_number(
        ctx, episode["taep_unit_code"], now=now, user_id=user_id, episode_id=episode_id)
    db("""UPDATE taep_episode SET status='FINALISED', costing_number=%s,
          updated_by=%s, updated_at=%s WHERE id=%s""",
       (costing_number, user_id, now, episode_id))
    ctx["log_activity"]("taep_episode", episode_id, "FINALISED",
                        f"Αριθμός {costing_number}, σύνολο {result.total_cost}")
    return costing_number, sequence


def cancel_episode(ctx, episode_id, reason, user_id):
    """Cancel a costing. The number is retained and never reissued (brief §5)."""
    if not (reason or "").strip():
        raise CostingError("NO_CANCELLATION_REASON",
                           "Η αιτιολογία ακύρωσης είναι υποχρεωτική.")
    episode = get_episode(ctx, episode_id)
    if episode is None:
        raise CostingError("EPISODE_NOT_FOUND", "Η καταχώρηση δεν βρέθηκε.")
    if episode["status"] == "CANCELLED":
        raise CostingError("EPISODE_CANCELLED", "Η καταχώρηση έχει ήδη ακυρωθεί.")

    now = dt.datetime.now()
    ctx["db_execute"](
        """UPDATE taep_episode SET status='CANCELLED', cancelled_by=%s,
           cancelled_at=%s, cancellation_reason=%s WHERE id=%s""",
        (user_id, now, reason.strip(), episode_id))
    ctx["log_activity"]("taep_episode", episode_id, "CANCELLED", reason.strip())


def assert_finalisable(result):
    """Raise unless the costing may be finalised. Called on the finalise path only.

    Calculation is permissive so the clerk always sees what can be priced;
    finalisation is strict because it allocates a costing number and prints a bill.
    """
    if result.blocking_issues_el:
        raise CostingError("NOT_FINALISABLE", " ".join(result.blocking_issues_el))
    return True


COSTING_NUMBER_PREFIX = "OKY"


def format_costing_number(unit_number, sequence):
    """Build a costing number: OKY<unit><NNNN>.

    Ruling of 23/09/2026: «κωδικός ανά νοσηλευτήριο και μοναδικός αύξων αριθμός».
    The sample document reads OKY1054/0035 — 1054 is the unit's number, 0035 the
    sequence. All eight unit numbers were confirmed on 02/10/2026.

    The number belongs to the ΤΑΕΠ UNIT, not the hospital: Γενικό Νοσοκομείο
    Λευκωσίας runs two units with two numbers, 1054 and 1106.

    The sequence is per unit, gapless, allocated at finalisation and never reused; a
    cancelled costing keeps its number. Allocation is the caller's job — this function
    only formats, so that it stays pure and testable.
    """
    if not str(unit_number).strip():
        raise CostingError(
            "NO_UNIT_NUMBER",
            "Δεν έχει οριστεί κωδικός μονάδας ΤΑΕΠ για τη σύνθεση του αριθμού "
            "κοστολόγησης.",
        )
    if not isinstance(sequence, int) or sequence < 1:
        raise CostingError(
            "BAD_SEQUENCE",
            "Ο αύξων αριθμός κοστολόγησης πρέπει να είναι θετικός ακέραιος.",
        )
    return f"{COSTING_NUMBER_PREFIX}{str(unit_number).strip()}/{sequence:04d}"

# ---------------------------------------------------------------------------
# The printed document (brief §12)
# ---------------------------------------------------------------------------
#
# reportlab, because that is what eFinance already uses. Rendered deterministically:
# every value comes from stored data, including the generation timestamp, so the same
# episode produces the same bytes. Nothing is read from live rates at print time.

PDF_FONT = "Helvetica"
PDF_FONT_BOLD = "Helvetica-Bold"


def _register_greek_font():
    """Register a font with Greek coverage, falling back to Helvetica.

    reportlab's built-in Type1 fonts are Latin-1 only, so Greek text renders as blanks.
    DejaVuSans ships with matplotlib and most Linux images and covers Greek.
    """
    global PDF_FONT, PDF_FONT_BOLD
    from reportlab.pdfbase import pdfmetrics
    from reportlab.pdfbase.ttfonts import TTFont

    if PDF_FONT != "Helvetica":
        return PDF_FONT, PDF_FONT_BOLD

    candidates = [
        ("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
         "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"),
        ("/usr/share/fonts/TTF/DejaVuSans.ttf",
         "/usr/share/fonts/TTF/DejaVuSans-Bold.ttf"),
    ]
    for regular, bold in candidates:
        if os.path.exists(regular) and os.path.exists(bold):
            pdfmetrics.registerFont(TTFont("TaepSans", regular))
            pdfmetrics.registerFont(TTFont("TaepSans-Bold", bold))
            PDF_FONT, PDF_FONT_BOLD = "TaepSans", "TaepSans-Bold"
            break
    return PDF_FONT, PDF_FONT_BOLD


def format_eur(value):
    """Greek money format: full stop for thousands, comma for decimals."""
    if value is None:
        return "—"
    text = f"{money_from_db(value):,.2f}"
    return text.replace(",", "\x00").replace(".", ",").replace("\x00", ".")


def _format_datetime(value):
    if value is None:
        return ""
    if isinstance(value, str):
        return value[:16].replace("T", " ")
    if isinstance(value, dt.datetime):
        return value.strftime("%d/%m/%Y %H:%M")
    return value.strftime("%d/%m/%Y")


def costing_document_data(ctx, episode_id):
    """Everything the printed document needs, read from stored data only."""
    episode = get_episode(ctx, episode_id)
    if episode is None:
        raise CostingError("EPISODE_NOT_FOUND", "Η καταχώρηση δεν βρέθηκε.")
    result = get_calculation(ctx, episode_id)
    if result is None:
        raise CostingError("NOT_CALCULATED", "Δεν υπάρχει αποθηκευμένος υπολογισμός.")

    category = get_category(ctx, episode["financial_category_id"])
    unit = ctx["db_execute"](
        "SELECT name_el, taep_number FROM taep_unit WHERE unit_code=%s",
        (episode["taep_unit_code"],), fetch=True)
    services = ctx["db_execute"](
        """SELECT s.code, s.service_type, s.category, s.description_el
           FROM taep_episode_service es
           JOIN taep_service s ON s.code = es.service_code
           WHERE es.episode_id = %s ORDER BY s.code""", (episode_id,), fetch=True) or []
    lines = ctx["db_execute"](
        """SELECT description_snapshot, quantity, line_total, suppressed
           FROM taep_episode_tariff_line WHERE episode_id = %s ORDER BY id""",
        (episode_id,), fetch=True) or []

    return {
        "episode": episode,
        "result": result,
        "category": category,
        "unit": unit[0] if unit else None,
        "treatments": [s for s in services if s["service_type"] == TREATMENT],
        "investigations": [s for s in services if s["service_type"] == INVESTIGATION],
        "tariff_lines": lines,
    }


def render_costing_pdf(ctx, episode_id):
    """Render the Κοστολόγηση Περιστατικού as A4 PDF bytes."""
    from io import BytesIO
    from reportlab.lib.pagesizes import A4
    from reportlab.lib.units import mm
    from reportlab.pdfgen import canvas as pdfcanvas

    font, font_bold = _register_greek_font()
    data = costing_document_data(ctx, episode_id)
    episode, result = data["episode"], data["result"]

    buffer = BytesIO()
    # invariant=1 stops reportlab stamping /CreationDate and a random document id, so
    # the same episode renders byte-identically (brief §12). Without it two renders of
    # one episode differ, and a stored PDF cannot be checked against a fresh one.
    pdf = pdfcanvas.Canvas(buffer, pagesize=A4, invariant=1)
    pdf.setProducer("OKYpY eFinance TAEP")
    pdf.setTitle(f"Κοστολόγηση Περιστατικού {episode['costing_number'] or ''}")
    width, height = A4
    left, right = 18 * mm, width - 18 * mm

    def header(page):
        pdf.setFont(font_bold, 13)
        pdf.drawCentredString(width / 2, height - 20 * mm, "ΚΟΣΤΟΛΟΓΗΣΗ ΠΕΡΙΣΤΑΤΙΚΟΥ")
        pdf.line(left, height - 22 * mm, right, height - 22 * mm)
        pdf.setFont(font, 8)
        pdf.drawString(left, height - 26 * mm, "ΟΚΥπΥ — Οργανισμός Κρατικών Υπηρεσιών Υγείας")
        pdf.drawRightString(right, height - 26 * mm,
                            f"Αρ. Κοστολόγησης: {episode['costing_number'] or '—'}")
        return height - 34 * mm

    def footer(page):
        pdf.setFont(font, 7)
        pdf.line(left, 16 * mm, right, 16 * mm)
        pdf.drawString(left, 12 * mm,
                       f"Αρ. Κοστολόγησης {episode['costing_number'] or '—'} · "
                       f"Δημιουργήθηκε {_format_datetime(result['calculated_at'])} · "
                       f"Αλγόριθμος {result['algorithm_version']}")
        pdf.drawRightString(right, 12 * mm, f"Σελίδα {page}")

    page = 1
    y = header(page)

    # Block one — personal data. Repeats on every page, as the sample does.
    def personal_block(y):
        pdf.setFont(font_bold, 9)
        pdf.drawString(left, y, "ΠΡΟΣΩΠΙΚΑ ΔΕΔΟΜΕΝΑ")
        y -= 4 * mm
        pdf.setFont(font, 8)
        rows = [
            ("Επώνυμο", episode["last_name"], "Όνομα", episode["first_name"]),
            ("Ημ. Γέννησης", _format_datetime(episode["date_of_birth"]),
             "Φύλο", episode["gender"]),
            ("Τηλέφωνο", episode["phone"], "Οικονομική Κατηγορία",
             f"{data['category']['code_new']} {data['category']['name_el']}"
             if data["category"] else ""),
            ("Διεύθυνση", episode["address"], "", ""),
            ("Ταυτοποίηση", f"{episode['id_type'] or ''} {episode['id_number'] or ''}",
             "Χώρα", episode["id_country"]),
            ("Λήξη Εγγράφου", _format_datetime(episode["id_expiry"]),
             "Αρ. Επεισοδίου", episode["episode_number"]),
            ("Νοσηλευτήριο", data["unit"]["name_el"] if data["unit"] else
             episode["entity_code"], "", ""),
            ("Εισαγωγή", _format_datetime(episode["admission_at"]),
             "Εξέταση", _format_datetime(episode["examination_at"])),
            ("Εξιτήριο", _format_datetime(episode["discharge_at"]),
             "Συγγενής", f"{episode['next_of_kin_type'] or ''} "
                         f"{episode['next_of_kin_details'] or ''}"),
        ]
        for label_a, value_a, label_b, value_b in rows:
            pdf.drawString(left, y, f"{label_a}:")
            pdf.drawString(left + 28 * mm, y, str(value_a or ""))
            if label_b:
                pdf.drawString(left + 95 * mm, y, f"{label_b}:")
                pdf.drawString(left + 130 * mm, y, str(value_b or ""))
            y -= 4 * mm
        if episode["comments"]:
            pdf.drawString(left, y, "Σχόλια:")
            pdf.drawString(left + 28 * mm, y, str(episode["comments"])[:110])
            y -= 4 * mm
        return y - 2 * mm

    y = personal_block(y)
    pdf.line(left, y, right, y)
    y -= 6 * mm

    # Block two — the services, grouped as the sample groups them.
    pdf.setFont(font_bold, 9)
    pdf.drawString(left, y, "ΚΟΣΤΟΛΟΓΗΣΗ")
    y -= 5 * mm

    for title, rows in (("--------Θεραπείες--------", data["treatments"]),
                        ("--------Διαγνωστικές Παρεμβάσεις--------",
                         data["investigations"])):
        pdf.setFont(font_bold, 8)
        pdf.drawString(left, y, title)
        y -= 4 * mm
        pdf.setFont(font, 8)
        if not rows:
            pdf.drawString(left + 4 * mm, y, "—")
            y -= 4 * mm
        for row in rows:
            if y < 45 * mm:
                footer(page)
                pdf.showPage()
                page += 1
                y = personal_block(header(page))
                pdf.setFont(font, 8)
            pdf.drawString(left + 4 * mm, y,
                           f"{row['code']} - {row['description_el']}")
            y -= 4 * mm
        y -= 2 * mm

    # Itemised tariff lines, above the totals. A patient asked to pay for a lumbar
    # puncture is entitled to see the line (brief §12).
    if data["tariff_lines"]:
        pdf.setFont(font_bold, 8)
        pdf.drawString(left, y, "Δραστηριότητες βάσει τιμοκαταλόγου")
        y -= 4 * mm
        pdf.setFont(font, 8)
        for line in data["tariff_lines"]:
            if y < 45 * mm:
                footer(page)
                pdf.showPage()
                page += 1
                y = personal_block(header(page))
                pdf.setFont(font, 8)
            label = str(line["description_snapshot"])[:78]
            if _as_int(line["suppressed"]):
                label += "  (δεν χρεώνεται)"
            pdf.drawString(left + 4 * mm, y, label)
            pdf.drawRightString(right - 22 * mm, y, f"x{line['quantity']}")
            pdf.drawRightString(right, y, format_eur(line["line_total"]))
            y -= 4 * mm
        y -= 2 * mm

    # Block three — the totals, in the order the brief fixes.
    if y < 60 * mm:
        footer(page)
        pdf.showPage()
        page += 1
        y = personal_block(header(page))

    totals_left = left + 55 * mm
    pdf.line(totals_left, y, right, y)
    y -= 5 * mm

    # The band label goes on its own line under its caption. Side by side it collides
    # with the caption — «Συνδυασμός διάγνωσης και θεραπείας μέσου κόστους» is wider
    # than the space left over, and the two strings overprint. Caught by reading the
    # rendered PDF back rather than by looking at it.
    pdf.setFont(font, 8)
    pdf.drawString(totals_left, y, "Κατηγοριοποίηση βάσει βαρύτητας")
    y -= 4.5 * mm
    pdf.setFont(font_bold, 8)
    pdf.drawString(totals_left + 3 * mm, y,
                   str(result["band_label_el"] or result["band_label_en"] or ""))
    y -= 5.5 * mm

    money_rows = [
        ("Κοστολόγηση βάσει βαρύτητας €", format_eur(result["weight_cost"])),
        ("Τέλος Εγγραφής €", format_eur(result["registration_fee_applied"])),
        ("Κοστολόγηση δραστηριοτήτων βάσει τιμοκαταλόγου €",
         format_eur(result["tariff_total"])),
    ]
    pdf.setFont(font, 8)
    amount_column = right - 22 * mm
    for label, value in money_rows:
        # Shrink rather than overprint if a label ever outgrows its column.
        size = 8
        while pdf.stringWidth(label, font, size) > (amount_column - totals_left - 2 * mm):
            size -= 0.5
            if size <= 6:
                break
        pdf.setFont(font, size)
        pdf.drawString(totals_left, y, label)
        pdf.setFont(font, 8)
        pdf.drawRightString(right, y, str(value))
        y -= 4.5 * mm

    pdf.line(totals_left, y + 1 * mm, right, y + 1 * mm)
    y -= 5 * mm
    pdf.setFont(font_bold, 11)
    pdf.drawString(totals_left, y, "Τελικό Κόστος €")
    pdf.drawRightString(right, y, format_eur(result["total_cost"]))

    footer(page)
    pdf.showPage()
    pdf.save()
    return buffer.getvalue()


# ---------------------------------------------------------------------------
# Rate administration (brief §6, §7 screen 4)
# ---------------------------------------------------------------------------
#
# Never UPDATE a rate. Closing one period and opening the next is the only way to
# change a price: it is permission-gated, it records who and from which document, and
# it must not create an overlap.
#
# PostgreSQL would enforce the no-overlap rule with an exclusion constraint. MySQL and
# SQLite have none (ADR-001 consequence 2), and eFinance's db_execute commits per call
# so the close and the insert cannot share a transaction. So:
#
#   * the UNIQUE key on (category, entity, type, weight, valid_from) stops two rows
#     from starting on the same day, which is what a concurrent change would produce;
#   * the new row is inserted BEFORE the old one is closed, so a failure leaves an
#     overlap rather than a gap. Both block costing, but an overlap is visible in the
#     data and repairable, where a gap silently reads as "no rate set";
#   * verify_rate_periods() re-checks afterwards and is available as a health check.

RATE_TYPES = ("WEIGHT_AMOUNT", "TRIAGE_AMOUNT", "REGISTRATION_FEE",
              "REGISTRATION_DEPOSIT")


def rate_series_key(rate_type, financial_category_id=None, entity_code=None,
                   weight=None):
    """A NULL-free identifier for one rate series. See taep_rate.series_key."""
    return "|".join((
        rate_type,
        "*" if financial_category_id is None else str(financial_category_id),
        "*" if entity_code is None else str(entity_code),
        "*" if weight is None else str(weight),
    ))


def _rate_key_clause(rate_type, financial_category_id, entity_code, weight):
    """SQL fragment and params matching one rate series. NULL needs IS NULL, not =."""
    clauses = ["rate_type = %s"]
    params = [rate_type]
    for column, value in (("financial_category_id", financial_category_id),
                          ("entity_code", entity_code), ("weight", weight)):
        if value is None:
            clauses.append(f"{column} IS NULL")
        else:
            clauses.append(f"{column} = %s")
            params.append(value)
    return " AND ".join(clauses), tuple(params)


def rate_series(ctx, rate_type, financial_category_id=None, entity_code=None,
                weight=None):
    """Every period for one rate series, oldest first. The history an auditor reads."""
    clause, params = _rate_key_clause(rate_type, financial_category_id, entity_code,
                                      weight)
    return ctx["db_execute"](
        f"""SELECT id, rate_type, financial_category_id, entity_code, weight, amount,
                   valid_from, valid_to, source_document, created_by, created_at,
                   closed_by, closed_at
            FROM taep_rate WHERE {clause}
            ORDER BY valid_from, id""", params, fetch=True) or []


def verify_rate_periods(ctx):
    """Every rate series with overlapping or duplicated periods. Empty means healthy.

    The check an exclusion constraint would have done for us. Run it after a change and
    in a health check; a non-empty result means a costing in that series will refuse to
    price rather than pick one arbitrarily.
    """
    rows = ctx["db_execute"](
        """SELECT id, rate_type, financial_category_id, entity_code, weight,
                  valid_from, valid_to
           FROM taep_rate ORDER BY rate_type, financial_category_id, entity_code,
                                   weight, valid_from, id""", fetch=True) or []
    series = {}
    for row in rows:
        key = (row["rate_type"], row["financial_category_id"], row["entity_code"],
               _as_int(row["weight"]))
        series.setdefault(key, []).append(row)

    problems = []
    for key, periods in series.items():
        periods = sorted(periods, key=lambda r: (_as_date(r["valid_from"]), r["id"]))
        for earlier, later in zip(periods, periods[1:]):
            earlier_to = _as_date(earlier["valid_to"])
            later_from = _as_date(later["valid_from"])
            if earlier_to is None or earlier_to >= later_from:
                problems.append({
                    "key": key, "first_id": earlier["id"], "second_id": later["id"],
                    "detail": (f"η περίοδος {earlier['id']} "
                               f"({earlier['valid_from']}–{earlier['valid_to'] or '∞'}) "
                               f"επικαλύπτεται με την {later['id']} "
                               f"(από {later['valid_from']})"),
                })
    return problems


def change_rate(ctx, rate_type, amount, effective_from, user_id,
                financial_category_id=None, entity_code=None, weight=None,
                source_document=None):
    """Close the current period and open a new one from `effective_from`.

    Returns (closed_rate_id or None, new_rate_id). Raises CostingError rather than
    leaving the series in a state a costing would read wrongly.
    """
    db = ctx["db_execute"]

    if rate_type not in RATE_TYPES:
        raise CostingError("UNKNOWN_RATE_TYPE",
                           f"Άγνωστος τύπος τιμής «{rate_type}».")
    if rate_type == "WEIGHT_AMOUNT" and weight is None:
        raise CostingError("WEIGHT_REQUIRED",
                           "Η τιμή βαρύτητας απαιτεί τον συντελεστή βαρύτητας.")
    if rate_type != "WEIGHT_AMOUNT" and weight is not None:
        raise CostingError("WEIGHT_NOT_ALLOWED",
                           f"Ο τύπος τιμής «{rate_type}» δεν φέρει συντελεστή "
                           f"βαρύτητας.")
    if not (source_document or "").strip():
        raise CostingError(
            "NO_SOURCE_DOCUMENT",
            "Απαιτείται αναφορά στο έγγραφο απόφασης για κάθε αλλαγή τιμής.")

    effective_from = _as_date(effective_from)
    try:
        amount = money(Decimal(str(amount)))
    except Exception:
        raise CostingError("BAD_AMOUNT", f"Μη έγκυρο ποσό «{amount}».") from None
    if amount < 0:
        raise CostingError("BAD_AMOUNT", "Το ποσό δεν μπορεί να είναι αρνητικό.")

    periods = rate_series(ctx, rate_type, financial_category_id, entity_code, weight)
    now = dt.datetime.now()

    # Refuse to open a period that starts inside or before a period already closed:
    # backdating silently rewrites what a past costing would reproduce.
    for period in periods:
        valid_to = _as_date(period["valid_to"])
        if valid_to is not None and effective_from <= valid_to:
            raise CostingError(
                "BACKDATED_INTO_CLOSED_PERIOD",
                f"Η ημερομηνία ισχύος {effective_from} πέφτει μέσα σε κλεισμένη "
                f"περίοδο (έως {valid_to}). Οι αναδρομικές διορθώσεις γίνονται με "
                f"χωριστή απόφαση.")

    open_period = next((p for p in periods if _as_date(p["valid_to"]) is None), None)
    if open_period is not None:
        open_from = _as_date(open_period["valid_from"])
        if effective_from <= open_from:
            raise CostingError(
                "EFFECTIVE_DATE_NOT_AFTER_CURRENT",
                f"Η νέα τιμή πρέπει να ισχύει μετά την {open_from}, που είναι η "
                f"έναρξη της τρέχουσας περιόδου.")

    # Insert first, so a failure leaves an overlap (visible) rather than a gap (silent).
    try:
        new_id = db(
            """INSERT INTO taep_rate (financial_category_id, entity_code, rate_type,
               weight, amount, valid_from, source_document, created_by, created_at,
               series_key)
               VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)""",
            (financial_category_id, entity_code, rate_type, weight, str(amount),
             effective_from, source_document.strip(), user_id, now,
             rate_series_key(rate_type, financial_category_id, entity_code, weight)),
            lastrowid=True)
    except Exception as exc:
        if _is_duplicate_key(exc):
            raise CostingError(
                "RATE_ALREADY_STARTS_THEN",
                f"Υπάρχει ήδη τιμή που ισχύει από {effective_from} για αυτή τη "
                f"σειρά. Ανανεώστε τη σελίδα και ελέγξτε την τρέχουσα τιμή.") from None
        raise

    closed_id = None
    if open_period is not None:
        closed_id = open_period["id"]
        db("""UPDATE taep_rate SET valid_to=%s, closed_by=%s, closed_at=%s
              WHERE id=%s AND valid_to IS NULL""",
           (effective_from - dt.timedelta(days=1), user_id, now, closed_id))

    problems = verify_rate_periods(ctx)
    relevant = [p for p in problems
                if p["first_id"] == closed_id or p["second_id"] == new_id]
    if relevant:
        raise CostingError(
            "OVERLAPPING_RATE_PERIODS",
            "Η αλλαγή άφησε επικαλυπτόμενες περιόδους τιμών: "
            + "· ".join(p["detail"] for p in relevant))

    ctx["log_activity"]("taep_rate", new_id, "RATE_CHANGED",
                        f"{rate_type} "
                        f"{'βαρύτητα ' + str(weight) if weight else ''} "
                        f"= {amount} από {effective_from} "
                        f"(έγγραφο: {source_document.strip()})")
    return closed_id, new_id


RATE_STATE_SET = "SET"
RATE_STATE_EXEMPT = "EXEMPT"
RATE_STATE_UNCONFIRMED = "UNCONFIRMED"


def rate_overview(ctx, on_date=None):
    """The rate screen: one row per ΤΑΕΠ-valid category with its current fee state.

    Three states must look different, because conflating them is how a wrong bill gets
    issued (UI brief §7): a set value, an exempt €0.00 with the note that justifies it,
    and an unconfirmed value that blocks finalisation.
    """
    on_date = _as_date(on_date or dt.date.today())
    categories = list_ae_categories(ctx)
    overview = []
    for category in categories:
        fee_periods = _dated(rate_series(ctx, "REGISTRATION_FEE", category["id"]))
        current = pick_rate(fee_periods, on_date)
        row = ctx["db_execute"](
            "SELECT note_el, fee_status FROM taep_financial_category WHERE id=%s",
            (category["id"],), fetch=True)[0]

        if current is None:
            state = RATE_STATE_UNCONFIRMED
            amount = None
        elif money_from_db(current["amount"]) == 0 and (row["note_el"] or "").strip():
            state = RATE_STATE_EXEMPT
            amount = Decimal("0.00")
        else:
            state = RATE_STATE_SET
            amount = money_from_db(current["amount"])

        deposit = pick_rate(
            _dated(rate_series(ctx, "REGISTRATION_DEPOSIT", category["id"])), on_date)

        overview.append({
            "category_id": category["id"],
            "code": category["code_new"],
            "name_el": category["name_el"],
            "registration_fee": amount,
            "fee_state": state,
            "valid_from": None if current is None else _as_date(current["valid_from"]),
            "source_document": None if current is None else current["source_document"],
            "note_el": row["note_el"],
            "deposit": None if deposit is None else money_from_db(deposit["amount"]),
            "tariff_applies": bool(_as_int(category["tariff_applies"])),
            "payer_el": category["payer_el"],
        })
    return overview


def weight_scale_overview(ctx, on_date=None):
    """The national weight scale and the triage amount in force, with their periods."""
    on_date = _as_date(on_date or dt.date.today())
    scale = []
    for weight in sorted(WEIGHT_PRICE_SCALE):
        current = pick_rate(_dated(rate_series(ctx, "WEIGHT_AMOUNT", weight=weight)),
                            on_date)
        scale.append({
            "weight": weight,
            "band_label_el": BAND_LABELS_EL[weight],
            "amount": None if current is None else money_from_db(current["amount"]),
            "valid_from": None if current is None else _as_date(current["valid_from"]),
            "source_document": None if current is None else current["source_document"],
        })
    triage = pick_rate(_dated(rate_series(ctx, "TRIAGE_AMOUNT")), on_date)
    scale.append({
        "weight": TRIAGE_WEIGHT,
        "band_label_el": BAND_LABELS_EL[TRIAGE_WEIGHT],
        "amount": None if triage is None else money_from_db(triage["amount"]),
        "valid_from": None if triage is None else _as_date(triage["valid_from"]),
        "source_document": None if triage is None else triage["source_document"],
    })
    return scale


# ---------------------------------------------------------------------------
# Excel: the tariff round trip and the episode export (brief §7)
# ---------------------------------------------------------------------------
#
# openpyxl, already an eFinance dependency. The tariff workbook is downloaded, edited,
# uploaded, shown as a diff and applied in one go — never partially (brief §7).

TARIFF_SHEET = "Τιμοκατάλογος ΤΑΕΠ"
TARIFF_COLUMNS = [
    ("code", "Κωδικός"),
    ("description_el", "Περιγραφή"),
    ("group_el", "Ομάδα"),
    ("tier_label_el", "Κλίμακα"),
    ("price_type", "Τύπος τιμής"),
    ("base_amount", "Βασικό ποσό €"),
    ("hourly_amount", "Ωριαία επιβάρυνση €"),
    ("active", "Ενεργό"),
]


def _workbook_bytes(workbook):
    from io import BytesIO
    buffer = BytesIO()
    workbook.save(buffer)
    return buffer.getvalue()


def export_tariff_workbook(ctx):
    """The current tariff as a workbook the rates admin edits and uploads back."""
    from openpyxl import Workbook
    from openpyxl.styles import Font, PatternFill

    rows = ctx["db_execute"](
        """SELECT code, description_el, group_el, tier_label_el, price_type,
                  base_amount, hourly_amount, active
           FROM taep_tariff ORDER BY code""", fetch=True) or []

    workbook = Workbook()
    sheet = workbook.active
    sheet.title = TARIFF_SHEET
    sheet.append([label for _, label in TARIFF_COLUMNS])
    for cell in sheet[1]:
        cell.font = Font(bold=True, color="FFFFFF")
        cell.fill = PatternFill("solid", fgColor="1F3864")

    for row in rows:
        sheet.append([
            row["code"], row["description_el"], row["group_el"],
            row["tier_label_el"], row["price_type"],
            None if row["base_amount"] is None else float(money_from_db(row["base_amount"])),
            None if row["hourly_amount"] is None else float(money_from_db(row["hourly_amount"])),
            "ΝΑΙ" if _as_int(row["active"]) else "ΟΧΙ",
        ])

    for column, width in zip("ABCDEFGH", (16, 60, 30, 34, 24, 14, 18, 8)):
        sheet.column_dimensions[column].width = width
    sheet.freeze_panes = "A2"
    for row_index in range(2, sheet.max_row + 1):
        for column in ("F", "G"):
            sheet[f"{column}{row_index}"].number_format = "#,##0.00"

    notes = workbook.create_sheet("Οδηγίες")
    for line in (
        "Επεξεργαστείτε μόνο αυτό το αρχείο και ανεβάστε το ξανά.",
        "",
        "Ο κωδικός ταυτοποιεί τη γραμμή — μην τον αλλάζετε.",
        "Νέος κωδικός σημαίνει νέα χρέωση. Κωδικός που λείπει σημαίνει απενεργοποίηση.",
        "Έγκυροι τύποι τιμής: " + ", ".join(PRICE_TYPES) + ".",
        "Το «Ωριαία επιβάρυνση» αφορά μόνο τον τύπο fixed_plus_hourly.",
        "Ο τύπος tariff_lookup δεν φέρει ποσό· η τιμή προκύπτει από τον τιμοκατάλογο "
        "Ακτινοδιαγνωστικής.",
        "",
        "Μετά το ανέβασμα εμφανίζονται οι διαφορές προς επιβεβαίωση. Τίποτα δεν "
        "εφαρμόζεται πριν επιβεβαιώσετε, και εφαρμόζονται όλες μαζί ή καμία.",
    ):
        notes.append([line])
    notes.column_dimensions["A"].width = 100

    return _workbook_bytes(workbook)


def read_tariff_workbook(data):
    """Parse an uploaded tariff workbook. Returns (rows, errors).

    Validation is strict and reported per row with its spreadsheet row number, because
    "row 34 is wrong" is actionable and "the file is invalid" is not.
    """
    from io import BytesIO
    from openpyxl import load_workbook

    try:
        workbook = load_workbook(BytesIO(data), data_only=True)
    except Exception:
        return [], [{"row": None, "message": "Το αρχείο δεν είναι έγκυρο βιβλίο Excel."}]

    if TARIFF_SHEET in workbook.sheetnames:
        sheet = workbook[TARIFF_SHEET]
    else:
        sheet = workbook.worksheets[0]

    header = [str(c.value or "").strip() for c in sheet[1]]
    expected = [label for _, label in TARIFF_COLUMNS]
    if header[:len(expected)] != expected:
        return [], [{"row": 1, "message":
                     "Οι επικεφαλίδες δεν ταιριάζουν. Κατεβάστε ξανά το αρχείο και "
                     "επεξεργαστείτε εκείνο."}]

    rows, errors, seen = [], [], {}
    for index in range(2, sheet.max_row + 1):
        values = [sheet.cell(index, column).value
                  for column in range(1, len(TARIFF_COLUMNS) + 1)]
        if all(v is None or str(v).strip() == "" for v in values):
            continue

        record = dict(zip([key for key, _ in TARIFF_COLUMNS],
                          [None if v is None else str(v).strip() for v in values]))
        code = record["code"]

        if not code:
            errors.append({"row": index, "message": "Λείπει ο κωδικός."})
            continue
        if code in seen:
            errors.append({"row": index,
                           "message": f"Ο κωδικός {code} εμφανίζεται ξανά "
                                      f"(γραμμή {seen[code]})."})
            continue
        seen[code] = index

        if record["price_type"] not in PRICE_TYPES:
            errors.append({"row": index,
                           "message": f"Μη έγκυρος τύπος τιμής "
                                      f"«{record['price_type']}» για τον {code}."})
            continue

        for field, label in (("base_amount", "βασικό ποσό"),
                             ("hourly_amount", "ωριαία επιβάρυνση")):
            raw = record[field]
            if raw in (None, ""):
                record[field] = None
                continue
            try:
                amount = money(Decimal(str(raw).replace(",", ".")))
            except Exception:
                errors.append({"row": index,
                               "message": f"Μη έγκυρο {label} «{raw}» για τον {code}."})
                record[field] = None
                continue
            if amount < 0:
                errors.append({"row": index,
                               "message": f"Το {label} για τον {code} δεν μπορεί να "
                                          f"είναι αρνητικό."})
            record[field] = amount

        if record["price_type"] == "fixed_plus_hourly" and record["hourly_amount"] is None:
            errors.append({"row": index,
                           "message": f"Ο τύπος fixed_plus_hourly απαιτεί ωριαία "
                                      f"επιβάρυνση ({code})."})
        if record["price_type"] != "tariff_lookup" and record["base_amount"] is None:
            errors.append({"row": index,
                           "message": f"Λείπει το βασικό ποσό για τον {code}."})

        record["active"] = 0 if str(record["active"] or "").upper() in ("ΟΧΙ", "NO",
                                                                        "0", "FALSE") else 1
        record["row"] = index
        rows.append(record)

    return rows, errors


def diff_tariff(ctx, uploaded):
    """What an uploaded tariff would change. Shown before anything is applied.

    Returns added / changed / deactivated, each with enough detail to review: for a
    changed row, both the old and the new value of every field that moved.
    """
    current = {r["code"]: r for r in ctx["db_execute"](
        """SELECT code, description_el, group_el, tier_label_el, price_type,
                  base_amount, hourly_amount, active
           FROM taep_tariff""", fetch=True) or []}

    comparable = ("description_el", "group_el", "tier_label_el", "price_type")
    money_fields = ("base_amount", "hourly_amount")
    added, changed = [], []

    for record in uploaded:
        existing = current.get(record["code"])
        if existing is None:
            added.append(record)
            continue
        differences = {}
        for field in comparable:
            before = (existing[field] or "")
            after = (record[field] or "")
            if before != after:
                differences[field] = (before, after)
        for field in money_fields:
            before = money_from_db(existing[field])
            after = record[field]
            if before != after:
                differences[field] = (before, after)
        if _as_int(existing["active"]) != record["active"]:
            differences["active"] = (_as_int(existing["active"]), record["active"])
        if differences:
            changed.append({"code": record["code"], "row": record["row"],
                            "differences": differences, "record": record})

    uploaded_codes = {r["code"] for r in uploaded}
    deactivated = [r for code, r in sorted(current.items())
                   if code not in uploaded_codes and _as_int(r["active"])]

    return {"added": added, "changed": changed, "deactivated": deactivated}


def apply_tariff(ctx, uploaded, user_id):
    """Apply an uploaded tariff. All of it or none of it (brief §7).

    db_execute commits per call, so "none of it" cannot rely on a rollback. Instead the
    whole file is validated and diffed first and only then written, and nothing in the
    write step can fail on data the diff has already checked. A row that still fails
    stops the run and is reported with what had been applied, rather than being
    swallowed.
    """
    rows, errors = (uploaded, []) if isinstance(uploaded, list) else uploaded
    if errors:
        raise CostingError(
            "TARIFF_FILE_INVALID",
            f"Το αρχείο έχει {len(errors)} σφάλματα και δεν εφαρμόστηκε τίποτα.")
    if not rows:
        raise CostingError("TARIFF_FILE_EMPTY", "Το αρχείο δεν περιέχει γραμμές.")

    difference = diff_tariff(ctx, rows)
    db = ctx["db_execute"]
    now = dt.datetime.now()
    applied = {"added": 0, "changed": 0, "deactivated": 0}

    for record in difference["added"]:
        db("""INSERT INTO taep_tariff (tariff_scope, code, description_el, group_el,
              tier_label_el, price_type, base_amount, hourly_amount, load_status,
              valid_from, source_document, active)
              VALUES ('GENERAL',%s,%s,%s,%s,%s,%s,%s,'OK',%s,%s,%s)""",
           (record["code"], record["description_el"], record["group_el"],
            record["tier_label_el"], record["price_type"],
            None if record["base_amount"] is None else str(record["base_amount"]),
            None if record["hourly_amount"] is None else str(record["hourly_amount"]),
            now.date(), f"Μεταφόρτωση Excel {now:%d/%m/%Y}", record["active"]))
        applied["added"] += 1

    for entry in difference["changed"]:
        record = entry["record"]
        db("""UPDATE taep_tariff SET description_el=%s, group_el=%s, tier_label_el=%s,
              price_type=%s, base_amount=%s, hourly_amount=%s, active=%s,
              source_document=%s WHERE code=%s""",
           (record["description_el"], record["group_el"], record["tier_label_el"],
            record["price_type"],
            None if record["base_amount"] is None else str(record["base_amount"]),
            None if record["hourly_amount"] is None else str(record["hourly_amount"]),
            record["active"], f"Μεταφόρτωση Excel {now:%d/%m/%Y}", record["code"]))
        applied["changed"] += 1

    for record in difference["deactivated"]:
        db("UPDATE taep_tariff SET active=0 WHERE code=%s", (record["code"],))
        applied["deactivated"] += 1

    ctx["log_activity"]("taep_tariff", 0, "TARIFF_UPLOADED",
                        f"Προστέθηκαν {applied['added']}, άλλαξαν "
                        f"{applied['changed']}, απενεργοποιήθηκαν "
                        f"{applied['deactivated']}")
    return applied


def export_episodes_workbook(ctx, entity_code, filters=None):
    """The episode list as a workbook, exporting what the filters show (brief §7)."""
    from openpyxl import Workbook
    from openpyxl.styles import Font, PatternFill

    episodes = list_episodes(ctx, entity_code, filters, limit=50000)
    workbook = Workbook()
    sheet = workbook.active
    sheet.title = "Καταχωρήσεις ΤΑΕΠ"

    headers = ["Αρ. Κοστολόγησης", "Αρ. Επεισοδίου", "Ημ/νία Εξέτασης", "Επώνυμο",
               "Όνομα", "Τύπος ταυτοπ.", "Αρ. ταυτοποίησης", "Μονάδα ΤΑΕΠ",
               "Κωδ. Κατηγορίας", "Οικονομική Κατηγορία", "Βαρύτητα",
               "Τελικό Κόστος €", "Κατάσταση"]
    sheet.append(headers)
    for cell in sheet[1]:
        cell.font = Font(bold=True, color="FFFFFF")
        cell.fill = PatternFill("solid", fgColor="1F3864")

    status_el = {"DRAFT": "Πρόχειρο", "CALCULATED": "Υπολογισμένο",
                 "FINALISED": "Οριστικοποιημένο", "CANCELLED": "Ακυρωμένο"}
    for episode in episodes:
        total = money_from_db(episode["total_cost"])
        sheet.append([
            episode["costing_number"], episode["episode_number"],
            _format_datetime(episode["examination_at"]),
            episode["last_name"], episode["first_name"], episode["id_type"],
            episode["id_number"], episode["taep_unit_code"],
            episode["category_code"], episode["category_name"],
            _as_int(episode["weight"]),
            None if total is None else float(total),
            status_el.get(episode["status"], episode["status"]),
        ])

    last = sheet.max_row
    for row_index in range(2, last + 1):
        sheet[f"L{row_index}"].number_format = "#,##0.00"

    if last > 1:
        # A live total, so the figure in the workbook is auditable rather than pasted.
        sheet.cell(row=last + 2, column=11, value="Σύνολο").font = Font(bold=True)
        total_cell = sheet.cell(row=last + 2, column=12, value=f"=SUM(L2:L{last})")
        total_cell.font = Font(bold=True)
        total_cell.number_format = "#,##0.00"
        sheet.cell(row=last + 3, column=11, value="Καταχωρήσεις").font = Font(bold=True)
        sheet.cell(row=last + 3, column=12,
                   value=f"=COUNTA(A2:A{last})").font = Font(bold=True)

    for column, width in zip("ABCDEFGHIJKLM",
                             (20, 16, 18, 20, 18, 14, 18, 14, 14, 34, 10, 16, 20)):
        sheet.column_dimensions[column].width = width
    sheet.freeze_panes = "A2"
    sheet.auto_filter.ref = f"A1:M{last}"

    return _workbook_bytes(workbook)


# ---------------------------------------------------------------------------
# Go-live readiness (Phase 4)
# ---------------------------------------------------------------------------

EXPECTED_COUNTS = {
    "taep_financial_category": 38,
    "taep_service": 125,
    "taep_weight_matrix": 15,
    "taep_unit": 8,
    "taep_tariff": 52,
    "taep_radiology_tariff": 305,
}


def readiness_report(ctx, on_date=None):
    """Whether an installation is fit to issue costings. Returns a list of findings.

    Each finding is {level, check, detail}: 'blocker' means do not go live, 'warning'
    means go live knowing this. An empty list means ready.

    Written for the person doing the rollout, who needs to know whether THIS install is
    sound — not whether the code is correct, which the tests answer.
    """
    db = ctx["db_execute"]
    on_date = _as_date(on_date or dt.date.today())
    findings = []

    def add(level, check, detail):
        findings.append({"level": level, "check": check, "detail": detail})

    # 1. Schema
    for table in list(EXPECTED_COUNTS) + ["taep_episode", "taep_costing_result",
                                          "taep_costing_number", "taep_settlement",
                                          "taep_rate", "taep_episode_service",
                                          "taep_episode_tariff_line"]:
        try:
            db(f"SELECT 1 FROM {table} LIMIT 1", fetch=True)
        except Exception:
            add("blocker", "σχήμα", f"ο πίνακας {table} δεν υπάρχει")

    if any(f["check"] == "σχήμα" for f in findings):
        return findings        # nothing else can be checked without the tables

    # 2. Master data loaded, at the counts the source files hold
    for table, expected in EXPECTED_COUNTS.items():
        actual = db(f"SELECT COUNT(*) AS n FROM {table}", fetch=True)[0]["n"]
        if actual == 0:
            add("blocker", "δεδομένα", f"ο πίνακας {table} είναι κενός — "
                                       f"δεν έχει εκτελεστεί το seed")
        elif actual != expected:
            add("warning", "δεδομένα",
                f"ο πίνακας {table} έχει {actual} γραμμές, αναμενόμενες {expected}")

    # 3. The weight matrix in the table must still agree with the algorithm
    rows = db("SELECT investigation_category i, treatment_category t, weight "
              "FROM taep_weight_matrix", fetch=True) or []
    if {(r["i"], r["t"]): r["weight"] for r in rows} != WEIGHT_MATRIX:
        add("blocker", "αλγόριθμος",
            "ο πίνακας βαρύτητας στη βάση διαφέρει από τον αλγόριθμο στον κώδικα")

    # 4. Rates in force today
    scale = weight_scale_overview(ctx, on_date)
    missing = [str(row["weight"]) for row in scale if row["amount"] is None]
    if missing:
        add("blocker", "τιμές",
            f"δεν υπάρχει ποσό σε ισχύ για τη βαρύτητα {', '.join(missing)}")

    unconfirmed = [row["code"] for row in rate_overview(ctx, on_date)
                   if row["fee_state"] == RATE_STATE_UNCONFIRMED]
    if unconfirmed:
        add("blocker", "τέλη εγγραφής",
            f"δεν έχει οριστεί τέλος εγγραφής για τις κατηγορίες "
            f"{', '.join(unconfirmed)} — οι κοστολογήσεις τους θα μπλοκάρουν")

    # 5. No overlapping rate periods — the check MySQL cannot enforce for us
    for problem in verify_rate_periods(ctx):
        add("blocker", "επικάλυψη τιμών", problem["detail"])

    # 6. Units: a number each, no duplicates, and a host that resolves today
    units = db("SELECT unit_code, name_el, taep_number, host_entity_code "
               "FROM taep_unit WHERE active=1", fetch=True) or []
    numbers = [u["taep_number"] for u in units]
    if len(numbers) != len(set(numbers)):
        add("blocker", "μονάδες ΤΑΕΠ", "δύο μονάδες μοιράζονται τον ίδιο κωδικό")
    for unit in units:
        if not (unit["taep_number"] or "").strip():
            add("blocker", "μονάδες ΤΑΕΠ",
                f"η μονάδα {unit['unit_code']} δεν έχει κωδικό αριθμού κοστολόγησης")
    hosted = {u["unit_code"] for entity in {u["host_entity_code"] for u in units}
              for u in unit_for_entity(ctx, entity, on_date)}
    for unit in units:
        if unit["unit_code"] not in hosted:
            add("warning", "μονάδες ΤΑΕΠ",
                f"η μονάδα {unit['unit_code']} δεν φιλοξενείται σε κανένα "
                f"νοσηλευτήριο στις {on_date} — ελέγξτε τις ημερομηνίες ισχύος")

    # 7. Tariff rows that cannot be priced
    unresolved = db("SELECT code, load_status FROM taep_tariff "
                    "WHERE active=1 AND load_status NOT IN ('OK','SPLIT')",
                    fetch=True) or []
    if unresolved:
        add("warning", "τιμοκατάλογος",
            f"{len(unresolved)} ενεργές γραμμές χωρίς δομημένη τιμή: "
            f"{', '.join(r['code'] for r in unresolved[:6])}")

    # 8. Costing-number sequences must have no gaps
    for unit in units:
        issued = db("""SELECT sequence_number FROM taep_costing_number
                       WHERE unit_code=%s ORDER BY sequence_number""",
                    (unit["unit_code"],), fetch=True) or []
        sequences = [int(r["sequence_number"]) for r in issued]
        if sequences and sequences != list(range(1, len(sequences) + 1)):
            add("blocker", "αριθμοί κοστολόγησης",
                f"η σειρά της μονάδας {unit['unit_code']} έχει κενά")

    # 9. Episodes finalised without a number, or numbered without being finalised
    orphans = db("""SELECT COUNT(*) AS n FROM taep_episode
                    WHERE status='FINALISED' AND (costing_number IS NULL
                          OR costing_number='')""", fetch=True)[0]["n"]
    if orphans:
        add("blocker", "ακεραιότητα",
            f"{orphans} οριστικοποιημένες κοστολογήσεις χωρίς αριθμό")

    premature = db("""SELECT COUNT(*) AS n FROM taep_episode
                      WHERE costing_number IS NOT NULL AND costing_number <> ''
                            AND status NOT IN ('FINALISED','CANCELLED')""",
                   fetch=True)[0]["n"]
    if premature:
        add("blocker", "ακεραιότητα",
            f"{premature} μη οριστικοποιημένες κοστολογήσεις με αριθμό")

    return findings


def readiness_summary(findings):
    """One line per level, for a log or a status page."""
    blockers = [f for f in findings if f["level"] == "blocker"]
    warnings = [f for f in findings if f["level"] == "warning"]
    if not findings:
        return "Έτοιμο για παραγωγική λειτουργία."
    parts = []
    if blockers:
        parts.append(f"{len(blockers)} εμπόδια")
    if warnings:
        parts.append(f"{len(warnings)} προειδοποιήσεις")
    return "Δεν είναι έτοιμο: " + ", ".join(parts) if blockers else \
           "Έτοιμο με " + ", ".join(parts) + "."


# ---------------------------------------------------------------------------
# 3. ROUTES — Phase 2, the clerk path
# ---------------------------------------------------------------------------
#
# Flask is imported inside register() on purpose. The costing engine above must stay
# unit-testable with no framework installed (brief §2), and a module-level import would
# make importing taep at all require Flask.

PERMISSIONS = {
    "create": "taep.create",
    "finalise": "taep.finalise",
    "cancel": "taep.cancel",
    "rates": "taep.rates",
    "admin": "taep.admin",
}

# The brief §8 lists five roles. They are permission keys here, not new roles:
# eFinance already has roles, a role_permissions table and a user-administration
# screen, so a second set would be two places to get wrong. Add these to eFinance's
# PERMISSIONS_CATALOG and grant them to whichever existing roles the Μονάδα decides.
#
#   taep.create    κωδικοποιητής — create, edit own draft, calculate, print, list
#   taep.finalise  allocate a costing number and lock the episode
#   taep.cancel    hospital_admin — cancel a finalised costing, reason mandatory
#   taep.rates     rates_admin — rates and tariffs, no clinical data
#   taep.admin     system_admin
PERMISSIONS_CATALOG_EL = {
    "taep.create": "ΤΑΕΠ — καταχώρηση και κοστολόγηση",
    "taep.finalise": "ΤΑΕΠ — οριστικοποίηση και εκτύπωση",
    "taep.cancel": "ΤΑΕΠ — ακύρωση κοστολόγησης",
    "taep.rates": "ΤΑΕΠ — διαχείριση τιμών και τιμοκαταλόγου",
    "taep.admin": "ΤΑΕΠ — διαχείριση συστήματος",
}


def _parse_date(raw):
    raw = (raw or "").strip()
    if not raw:
        return None
    try:
        return dt.date.fromisoformat(raw)
    except ValueError:
        raise CostingError("BAD_DATE", f"Μη έγκυρη ημερομηνία «{raw}».")


def _parse_datetime(raw):
    raw = (raw or "").strip().replace("T", " ")
    if not raw:
        return None
    for fmt in ("%Y-%m-%d %H:%M:%S", "%Y-%m-%d %H:%M", "%d/%m/%Y %H:%M"):
        try:
            return dt.datetime.strptime(raw, fmt)
        except ValueError:
            continue
    raise CostingError("BAD_DATETIME", f"Μη έγκυρη ημερομηνία και ώρα «{raw}».")


def _form_to_episode(form):
    """Map the posted form onto episode fields, parsing dates and times."""
    data = {field: (form.get(field) or "").strip() or None
            for field in EPISODE_FIELDS}
    data["date_of_birth"] = _parse_date(form.get("date_of_birth"))
    data["id_expiry"] = _parse_date(form.get("id_expiry"))
    for field in ("admission_at", "examination_at", "discharge_at"):
        data[field] = _parse_datetime(form.get(field))
    category = (form.get("financial_category_id") or "").strip()
    data["financial_category_id"] = int(category) if category.isdigit() else None
    return data


def _tariff_lines_from_form(ctx, form):
    """Build TariffLine objects from the posted tariff rows."""
    db = ctx["db_execute"]
    lines = []
    codes = form.getlist("tariff_code")
    quantities = form.getlist("tariff_quantity")
    hours = form.getlist("tariff_hours")
    consumables = form.getlist("tariff_consumables")
    notes = form.getlist("tariff_note")
    cpts = form.getlist("tariff_cpt")

    def at(values, i, default=""):
        return values[i] if i < len(values) else default

    for i, code in enumerate(codes):
        code = (code or "").strip()
        if not code:
            continue
        rows = db("""SELECT code, description_el, price_type, base_amount, hourly_amount
                     FROM taep_tariff WHERE code=%s AND active=1""",
                  (code,), fetch=True)
        if not rows:
            raise CostingError("UNKNOWN_TARIFF",
                               f"Ο κωδικός τιμοκαταλόγου «{code}» δεν βρέθηκε.")
        tariff = rows[0]

        cpt = (at(cpts, i) or "").strip() or None
        cpt_price = None
        if cpt:
            cpt_rows = db("""SELECT price_eur FROM taep_radiology_tariff
                             WHERE cpt_code=%s AND active=1""", (cpt,), fetch=True)
            if not cpt_rows:
                raise CostingError("UNKNOWN_CPT",
                                   f"Ο κωδικός CPT «{cpt}» δεν βρέθηκε.")
            cpt_price = money_from_db(cpt_rows[0]["price_eur"])

        quantity_raw = (at(quantities, i) or "1").strip()
        hours_raw = (at(hours, i) or "").strip()
        consumables_raw = (at(consumables, i) or "").strip()

        lines.append(TariffLine(
            tariff_code=tariff["code"],
            description=tariff["description_el"],
            price_type=tariff["price_type"],
            base_amount=money_from_db(tariff["base_amount"]) or Decimal("0.00"),
            hourly_amount=money_from_db(tariff["hourly_amount"]),
            quantity=int(quantity_raw) if quantity_raw.isdigit() else 0,
            hours=Decimal(hours_raw) if hours_raw else None,
            consumables_amount=Decimal(consumables_raw) if consumables_raw else None,
            consumables_note=at(notes, i) or None,
            radiology_cpt=cpt,
            radiology_price=cpt_price,
        ))
    return lines


def store_tariff_lines(ctx, episode_id, lines, costed, user_id):
    """Persist the tariff lines with a description snapshot and the computed total."""
    db = ctx["db_execute"]
    now = dt.datetime.now()
    db("DELETE FROM taep_episode_tariff_line WHERE episode_id=%s", (episode_id,))
    rows = []
    for line, priced in zip(lines, costed):
        tariff = db("SELECT id FROM taep_tariff WHERE code=%s", (line.tariff_code,),
                    fetch=True)
        rows.append((episode_id, tariff[0]["id"] if tariff else None,
                     line.radiology_cpt, line.description, line.quantity,
                     None if line.hours is None else str(line.hours),
                     None if line.consumables_amount is None
                     else str(line.consumables_amount),
                     line.consumables_note, str(priced.line_total),
                     1 if priced.suppressed else 0, user_id, now))
    _insert_many(db, "taep_episode_tariff_line",
                 ["episode_id", "tariff_id", "radiology_cpt", "description_snapshot",
                  "quantity", "hours", "consumables_amount", "consumables_note",
                  "line_total", "suppressed", "added_by", "added_at"], rows)


def price_episode(ctx, episode_id, tariff_lines=()):
    """Calculate an episode from what is stored plus any tariff lines supplied.

    One place builds a CostingResult for an episode, so the costing screen, the
    finalisation check and the PDF can never disagree about the number.
    """
    episode = get_episode(ctx, episode_id)
    if episode is None:
        raise CostingError("EPISODE_NOT_FOUND", "Η καταχώρηση δεν βρέθηκε.")

    examination = episode["examination_at"]
    on_date = _as_date(examination) if examination else dt.date.today()
    category = get_category(ctx, episode["financial_category_id"])
    rates = rates_in_force(ctx, episode["financial_category_id"], on_date,
                           episode["entity_code"])
    services = get_services(ctx, get_episode_service_codes(ctx, episode_id))
    return calculate(services, rates, tariff_lines,
                     financial_category_code=category["code_new"] if category else None,
                     service_date=on_date)


def list_episodes(ctx, entity_code, filters=None, limit=200):
    """Screen 3, scoped to one hospital. A Limassol user never sees Nicosia episodes."""
    filters = filters or {}
    where = ["e.entity_code = %s"]
    params = [entity_code]

    if filters.get("date_from"):
        where.append("e.examination_at >= %s")
        params.append(filters["date_from"])
    if filters.get("date_to"):
        where.append("e.examination_at <= %s")
        params.append(filters["date_to"])
    if filters.get("category_id"):
        where.append("e.financial_category_id = %s")
        params.append(filters["category_id"])
    if filters.get("id_number"):
        where.append("e.id_number = %s")
        params.append(filters["id_number"].strip())
    if filters.get("status"):
        where.append("e.status = %s")
        params.append(filters["status"])

    return ctx["db_execute"](
        f"""SELECT e.id, e.costing_number, e.episode_number, e.examination_at,
                   e.first_name, e.last_name, e.id_type, e.id_number, e.status,
                   e.taep_unit_code, c.code_new AS category_code,
                   c.name_el AS category_name, r.weight, r.total_cost
            FROM taep_episode e
            LEFT JOIN taep_financial_category c ON e.financial_category_id = c.id
            LEFT JOIN taep_costing_result r ON r.episode_id = e.id
            WHERE {' AND '.join(where)}
            ORDER BY e.examination_at DESC, e.id DESC
            LIMIT {int(limit)}""", tuple(params), fetch=True) or []


def register(app, ctx):
    """Register the ΤΑΕΠ routes. Called by eFinance at boot."""
    from flask import (abort, flash, jsonify, redirect, render_template, request,
                       session, url_for, Response)

    db = ctx["db_execute"]
    login_required = ctx["login_required"]
    permission_required = ctx["permission_required"]

    # Money is formatted in one place, in the Greek convention, so no template can
    # invent its own and no total can print differently from the PDF.
    app.jinja_env.filters.setdefault("eur", format_eur)

    def user_id():
        return session.get("user_id")

    def active_entity():
        entity = ctx["user_entity"]()
        if not entity:
            abort(403)
        return entity

    def episode_or_404(episode_id):
        """Hospital scoping returns 404, not 403 — brief §13. A Limassol clerk must
        not learn that a Nicosia episode exists."""
        episode = get_episode(ctx, episode_id)
        if episode is None or not ctx["can_access_entity"](episode["entity_code"]):
            abort(404)
        return episode

    # -- Screen 1: Νέα Καταχώρηση ------------------------------------------
    @app.route("/taep/nea", methods=["GET", "POST"])
    @login_required
    @permission_required(PERMISSIONS["create"])
    def taep_new():
        entity = active_entity()
        units = unit_for_entity(ctx, entity)
        categories = list_ae_categories(ctx)

        if request.method == "POST":
            try:
                data = _form_to_episode(request.form)
            except CostingError as exc:
                flash(exc.message_el, "danger")
                return render_template("taep_new.html", categories=categories,
                                       units=units, form=request.form)

            errors, warnings = validate_episode(data)
            unit_code = (request.form.get("taep_unit_code") or "").strip()
            if not unit_code:
                errors.append("Επιλέξτε μονάδα ΤΑΕΠ.")
            elif unit_code not in {u["unit_code"] for u in units}:
                errors.append("Η μονάδα ΤΑΕΠ δεν ανήκει στο ενεργό νοσηλευτήριο.")

            if errors:
                for message in errors:
                    flash(message, "danger")
                return render_template("taep_new.html", categories=categories,
                                       units=units, form=request.form)

            try:
                episode_id = save_episode(ctx, data, entity, unit_code, user_id())
            except CostingError as exc:
                flash(exc.message_el, "danger")
                return render_template("taep_new.html", categories=categories,
                                       units=units, form=request.form)

            for message in warnings:
                flash(message, "warning")
            return redirect(url_for("taep_costing", episode_id=episode_id))

        return render_template("taep_new.html", categories=categories, units=units,
                               form={})

    # -- Prior-episode lookup (called on blur of the identification number) -
    @app.route("/taep/api/prior")
    @login_required
    @permission_required(PERMISSIONS["create"])
    def taep_prior():
        prior = find_prior_episodes(ctx, request.args.get("id_type", ""),
                                    request.args.get("id_number", ""))
        unpaid = unpaid_self_pay_episodes(prior)
        latest = prior[0] if prior else None
        return jsonify({
            "count": len(prior),
            "unpaid": [{"costing_number": u["costing_number"],
                        "entity_code": u["entity_code"],
                        "examination_at": str(u["examination_at"] or ""),
                        "total_cost": str(u["total_cost"] or "")} for u in unpaid],
            "prefill": None if latest is None else {
                field: str(latest[field] or "") for field in
                ("first_name", "last_name", "date_of_birth", "gender", "phone",
                 "address", "id_country", "id_expiry", "next_of_kin_type",
                 "next_of_kin_details")},
        })

    # -- Service search ----------------------------------------------------
    @app.route("/taep/api/services")
    @login_required
    @permission_required(PERMISSIONS["create"])
    def taep_service_search():
        hits = search_services(ctx, request.args.get("q", ""))
        return jsonify([{"code": h["code"], "service_type": h["service_type"],
                         "category": int(h["category"]),
                         "description_el": h["description_el"]} for h in hits])

    # -- Screen 2: Κοστολόγηση --------------------------------------------
    @app.route("/taep/<int:episode_id>")
    @login_required
    @permission_required(PERMISSIONS["create"])
    def taep_costing(episode_id):
        episode = episode_or_404(episode_id)
        category = get_category(ctx, episode["financial_category_id"])
        selected = get_services(ctx, get_episode_service_codes(ctx, episode_id))
        stored = get_calculation(ctx, episode_id)
        return render_template(
            "taep_costing.html", episode=episode, category=category,
            selected=selected, result=stored,
            investigations=[s for s in selected if s.service_type == INVESTIGATION],
            treatments=[s for s in selected if s.service_type == TREATMENT],
            tariff_allowed=bool(category and _as_int(category["tariff_applies"])))

    @app.route("/taep/<int:episode_id>/services", methods=["POST"])
    @login_required
    @permission_required(PERMISSIONS["create"])
    def taep_set_services(episode_id):
        episode = episode_or_404(episode_id)
        if episode["status"] not in EDITABLE_STATUSES:
            flash("Η καταχώρηση δεν μπορεί να τροποποιηθεί.", "danger")
            return redirect(url_for("taep_costing", episode_id=episode_id))
        set_episode_services(ctx, episode_id, request.form.getlist("service_code"),
                             user_id())
        return redirect(url_for("taep_costing", episode_id=episode_id))

    @app.route("/taep/<int:episode_id>/calculate", methods=["POST"])
    @login_required
    @permission_required(PERMISSIONS["create"])
    def taep_calculate(episode_id):
        episode = episode_or_404(episode_id)
        if episode["status"] not in EDITABLE_STATUSES:
            flash("Η καταχώρηση δεν μπορεί να τροποποιηθεί.", "danger")
            return redirect(url_for("taep_costing", episode_id=episode_id))
        try:
            lines = _tariff_lines_from_form(ctx, request.form)
            result = price_episode(ctx, episode_id, lines)
            store_calculation(ctx, episode_id, result, user_id())
            store_tariff_lines(ctx, episode_id, lines, result.lines, user_id())
        except CostingError as exc:
            flash(exc.message_el, "danger")
            return redirect(url_for("taep_costing", episode_id=episode_id))

        for warning in result.warnings_el:
            flash(warning, "warning")
        for blocker in result.blocking_issues_el:
            flash(blocker, "warning")
        return redirect(url_for("taep_costing", episode_id=episode_id))

    @app.route("/taep/<int:episode_id>/finalise", methods=["POST"])
    @login_required
    @permission_required(PERMISSIONS["finalise"])
    def taep_finalise(episode_id):
        episode_or_404(episode_id)
        try:
            lines = _tariff_lines_from_form(ctx, request.form)
            result = price_episode(ctx, episode_id, lines)
            number, _ = finalise_episode(ctx, episode_id, result, user_id())
        except CostingError as exc:
            flash(exc.message_el, "danger")
            return redirect(url_for("taep_costing", episode_id=episode_id))
        flash(f"Η κοστολόγηση οριστικοποιήθηκε με αριθμό {number}.", "success")
        return redirect(url_for("taep_print", episode_id=episode_id))

    # -- Print -------------------------------------------------------------
    @app.route("/taep/<int:episode_id>/print")
    @login_required
    @permission_required(PERMISSIONS["create"])
    def taep_print(episode_id):
        episode = episode_or_404(episode_id)
        if episode["status"] != "FINALISED":
            flash("Μόνο οριστικοποιημένες κοστολογήσεις εκτυπώνονται.", "warning")
            return redirect(url_for("taep_costing", episode_id=episode_id))
        pdf = render_costing_pdf(ctx, episode_id)
        filename = f"{episode['costing_number'].replace('/', '-')}.pdf"
        return Response(pdf, mimetype="application/pdf", headers={
            "Content-Disposition": f'inline; filename="{filename}"'})

    # -- Screen 3: Λίστα Καταχωρήσεων -------------------------------------
    @app.route("/taep/list")
    @login_required
    @permission_required(PERMISSIONS["create"])
    def taep_list():
        entity = active_entity()
        filters = {
            "date_from": request.args.get("date_from") or None,
            "date_to": request.args.get("date_to") or None,
            "category_id": request.args.get("category_id") or None,
            "id_number": request.args.get("id_number") or None,
            "status": request.args.get("status") or None,
        }
        return render_template(
            "taep_list.html", episodes=list_episodes(ctx, entity, filters),
            categories=list_ae_categories(ctx), filters=filters,
            # Only the filters actually set, so the export link carries no "None".
            export_args={key: value for key, value in filters.items() if value})

    # -- Screen 4: Διαχείριση Τιμών ---------------------------------------
    @app.route("/taep/rates")
    @login_required
    @permission_required(PERMISSIONS["rates"])
    def taep_rates():
        on_date = _parse_date(request.args.get("on_date")) or dt.date.today()
        only_unset = request.args.get("only_unset") == "1"
        overview = rate_overview(ctx, on_date)
        if only_unset:
            overview = [r for r in overview if r["fee_state"] == RATE_STATE_UNCONFIRMED]
        return render_template(
            "taep_rates.html", overview=overview, on_date=on_date,
            scale=weight_scale_overview(ctx, on_date), only_unset=only_unset,
            problems=verify_rate_periods(ctx),
            states={"SET": RATE_STATE_SET, "EXEMPT": RATE_STATE_EXEMPT,
                    "UNCONFIRMED": RATE_STATE_UNCONFIRMED})

    @app.route("/taep/rates/change", methods=["POST"])
    @login_required
    @permission_required(PERMISSIONS["rates"])
    def taep_rate_change():
        try:
            category = (request.form.get("financial_category_id") or "").strip()
            weight = (request.form.get("weight") or "").strip()
            change_rate(
                ctx,
                rate_type=request.form.get("rate_type", ""),
                amount=request.form.get("amount", ""),
                effective_from=_parse_date(request.form.get("effective_from")),
                user_id=user_id(),
                financial_category_id=int(category) if category.isdigit() else None,
                weight=int(weight) if weight.isdigit() else None,
                source_document=request.form.get("source_document", ""))
        except CostingError as exc:
            flash(exc.message_el, "danger")
            return redirect(url_for("taep_rates"))
        flash("Η νέα τιμή καταχωρήθηκε. Η προηγούμενη περίοδος έκλεισε.", "success")
        return redirect(url_for("taep_rates"))

    @app.route("/taep/rates/history")
    @login_required
    @permission_required(PERMISSIONS["rates"])
    def taep_rate_history():
        category = (request.args.get("financial_category_id") or "").strip()
        weight = (request.args.get("weight") or "").strip()
        rate_type = request.args.get("rate_type", "REGISTRATION_FEE")
        periods = rate_series(
            ctx, rate_type,
            financial_category_id=int(category) if category.isdigit() else None,
            weight=int(weight) if weight.isdigit() else None)
        return render_template("taep_rate_history.html", periods=periods,
                               rate_type=rate_type)

    # -- Tariff administration --------------------------------------------
    @app.route("/taep/tariff")
    @login_required
    @permission_required(PERMISSIONS["rates"])
    def taep_tariff():
        rows = db("""SELECT code, description_el, group_el, tier_label_el, price_type,
                            base_amount, hourly_amount, active, load_status
                     FROM taep_tariff ORDER BY code""", fetch=True) or []
        return render_template("taep_tariff.html", tariffs=rows)

    @app.route("/taep/tariff/download")
    @login_required
    @permission_required(PERMISSIONS["rates"])
    def taep_tariff_download():
        return Response(
            export_tariff_workbook(ctx),
            mimetype="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            headers={"Content-Disposition":
                     f'attachment; filename="timokatalogos_taep_'
                     f'{dt.date.today():%Y%m%d}.xlsx"'})

    @app.route("/taep/tariff/upload", methods=["POST"])
    @login_required
    @permission_required(PERMISSIONS["rates"])
    def taep_tariff_upload():
        """Parse and diff. Nothing is written here — the diff is confirmed separately."""
        upload = request.files.get("workbook")
        if upload is None or not upload.filename:
            flash("Επιλέξτε αρχείο Excel.", "warning")
            return redirect(url_for("taep_tariff"))

        data = upload.read()
        rows, errors = read_tariff_workbook(data)
        if errors:
            return render_template("taep_tariff_diff.html", errors=errors,
                                   difference=None, payload=None)

        session["taep_tariff_upload"] = [
            {k: (str(v) if isinstance(v, Decimal) else v) for k, v in row.items()}
            for row in rows]
        return render_template("taep_tariff_diff.html", errors=[],
                               difference=diff_tariff(ctx, rows), payload=True)

    @app.route("/taep/tariff/apply", methods=["POST"])
    @login_required
    @permission_required(PERMISSIONS["rates"])
    def taep_tariff_apply():
        staged = session.pop("taep_tariff_upload", None)
        if not staged:
            flash("Δεν υπάρχει αρχείο προς εφαρμογή. Ανεβάστε το ξανά.", "warning")
            return redirect(url_for("taep_tariff"))
        rows = [{**row,
                 "base_amount": None if row["base_amount"] is None
                 else money(Decimal(row["base_amount"])),
                 "hourly_amount": None if row["hourly_amount"] is None
                 else money(Decimal(row["hourly_amount"]))}
                for row in staged]
        try:
            applied = apply_tariff(ctx, rows, user_id())
        except CostingError as exc:
            flash(exc.message_el, "danger")
            return redirect(url_for("taep_tariff"))
        flash(f"Εφαρμόστηκε: {applied['added']} νέες, {applied['changed']} αλλαγές, "
              f"{applied['deactivated']} απενεργοποιήσεις.", "success")
        return redirect(url_for("taep_tariff"))

    # -- Excel export of the list -----------------------------------------
    @app.route("/taep/list/export")
    @login_required
    @permission_required(PERMISSIONS["create"])
    def taep_list_export():
        entity = active_entity()
        filters = {key: request.args.get(key) or None
                   for key in ("date_from", "date_to", "category_id", "id_number",
                               "status")}
        return Response(
            export_episodes_workbook(ctx, entity, filters),
            mimetype="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            headers={"Content-Disposition":
                     f'attachment; filename="katachoriseis_taep_'
                     f'{dt.date.today():%Y%m%d}.xlsx"'})

    # -- Go-live readiness ------------------------------------------------
    @app.route("/taep/readiness")
    @login_required
    @permission_required(PERMISSIONS["admin"])
    def taep_readiness():
        findings = readiness_report(ctx)
        return render_template("taep_readiness.html", findings=findings,
                               summary=readiness_summary(findings),
                               blockers=[f for f in findings if f["level"] == "blocker"],
                               warnings=[f for f in findings if f["level"] == "warning"])

    # -- Cancellation (admin) ---------------------------------------------
    @app.route("/taep/<int:episode_id>/cancel", methods=["POST"])
    @login_required
    @permission_required(PERMISSIONS["cancel"])
    def taep_cancel(episode_id):
        episode_or_404(episode_id)
        try:
            cancel_episode(ctx, episode_id, request.form.get("reason", ""), user_id())
        except CostingError as exc:
            flash(exc.message_el, "danger")
            return redirect(url_for("taep_costing", episode_id=episode_id))
        flash("Η κοστολόγηση ακυρώθηκε. Ο αριθμός διατηρείται.", "success")
        return redirect(url_for("taep_list"))
