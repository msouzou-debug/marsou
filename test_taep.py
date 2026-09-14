"""
Acceptance tests for the ΤΑΕΠ costing engine.

Written before the routes, per the build brief §13. The golden case is the gate:
nothing else merges until it passes.

Run:  python3 -m pytest test_taep.py -q
"""

import datetime as dt
from decimal import Decimal

import pytest

import taep
from taep import (
    Service, Rates, TariffLine, CostingError, SeedError,
    INVESTIGATION, TREATMENT, calculate, resolve_weight, pick_rate,
    assert_finalisable,
)


def inv(category, code=None):
    return Service(code=code or f"AED{category:03d}", service_type=INVESTIGATION,
                   category=category)


def tre(category, code=None):
    return Service(code=code or f"AET{category:03d}", service_type=TREATMENT,
                   category=category)


def rates(unit="15.00", triage=None, registration="0.00"):
    return Rates(
        unit_price=Decimal(unit) if unit is not None else None,
        triage_unit_price=Decimal(triage) if triage is not None else None,
        registration_fee=Decimal(registration) if registration is not None else None,
    )


# ---------------------------------------------------------------------------
# The golden case — brief §4.1, verified against the source PDF
# Αριθμός Κοστολόγησης OKY1054/0035, financial category 624
# ---------------------------------------------------------------------------

GOLDEN_TREATMENTS = {"AET008": 3, "AET057": 2, "AET005": 1, "AET043": 2}
GOLDEN_INVESTIGATIONS = {"AED001": 1, "AED008": 2, "AED002": 1, "AED006": 1,
                         "AED009": 2, "AED012": 1, "AED016": 1, "AED005": 2}


def test_golden_case_returns_exactly_120_euro():
    """The one case we can evidence end to end. If this moves, everything is wrong."""
    services = (
        [Service(code=c, service_type=TREATMENT, category=k)
         for c, k in GOLDEN_TREATMENTS.items()]
        + [Service(code=c, service_type=INVESTIGATION, category=k)
           for c, k in GOLDEN_INVESTIGATIONS.items()]
    )

    result = calculate(services, rates(unit="15.00", registration="0.00"),
                       financial_category_code="624",
                       service_date=dt.date(2026, 1, 15))

    assert result.max_investigation_category == 2
    assert result.max_treatment_category == 3
    assert result.weight == 8
    assert result.band_label_en == "Standard cost combination of investigation and treatment"
    assert result.unit_price_applied == Decimal("15.00")
    assert result.weight_cost == Decimal("120.00")
    assert result.tariff_total == Decimal("0.00")
    assert result.total_cost == Decimal("120.00")
    assert result.is_triage_only is False


# ---------------------------------------------------------------------------
# The matrix — all 15 cells
# ---------------------------------------------------------------------------

EXPECTED_MATRIX = {
    (1, 1): 4,  (1, 2): 4,  (1, 3): 8,  (1, 4): 8,  (1, 5): 12,
    (2, 1): 4,  (2, 2): 4,  (2, 3): 8,  (2, 4): 12, (2, 5): 12,
    (3, 1): 12, (3, 2): 12, (3, 3): 12, (3, 4): 12, (3, 5): 12,
}


@pytest.mark.parametrize("cell,expected_weight", sorted(EXPECTED_MATRIX.items()))
def test_every_matrix_cell_returns_documented_weight_and_band(cell, expected_weight):
    investigation, treatment = cell
    result = calculate([inv(investigation), tre(treatment)], rates())
    assert result.weight == expected_weight
    assert result.band_label_en == taep.BAND_LABELS_EN[expected_weight]
    assert result.weight_cost == taep.money(Decimal(expected_weight) * Decimal("15.00"))


def test_matrix_has_exactly_fifteen_cells():
    assert len(taep.WEIGHT_MATRIX) == 15


# ---------------------------------------------------------------------------
# Triage
# ---------------------------------------------------------------------------

def test_triage_only_uses_the_separate_triage_price_not_unit_price_times_one():
    """Brief §4.1: triage is its own unit price, NOT the standard price × 1."""
    result = calculate([], Rates(unit_price=Decimal("15.00"),
                                 triage_unit_price=Decimal("7.50"),
                                 registration_fee=Decimal("0.00")))
    assert result.is_triage_only is True
    assert result.weight == 1
    assert result.band_label_en == "Triage"
    assert result.unit_price_applied == Decimal("7.50")
    assert result.weight_cost == Decimal("7.50")
    # The trap this test exists to catch:
    assert result.weight_cost != Decimal("15.00")


def test_triage_without_a_triage_rate_is_blocked_not_defaulted():
    with pytest.raises(CostingError) as excinfo:
        calculate([], Rates(unit_price=Decimal("15.00"), triage_unit_price=None,
                            registration_fee=Decimal("0.00")),
                  financial_category_code="601")
    assert excinfo.value.code == "NO_RATE_IN_FORCE"
    assert "601" in excinfo.value.message_el


# ---------------------------------------------------------------------------
# Maximum category wins
# ---------------------------------------------------------------------------

def test_maximum_category_wins_on_each_side():
    """«λαμβάνεται υπόψη η εκάστοτε μέγιστη κατηγορία» — not sum, not count."""
    result = calculate(
        [inv(1, "AED001"), inv(3, "AED019"), inv(2, "AED008"),
         tre(1, "AET001"), tre(4, "AET074"), tre(2, "AET022")],
        rates())
    assert result.max_investigation_category == 3
    assert result.max_treatment_category == 4
    assert result.weight == 12


def test_many_low_category_services_do_not_accumulate():
    """Ten category-1 investigations are still category 1. Weight is not a count."""
    many = [inv(1, f"AED{n:03d}") for n in range(1, 11)] + [tre(1, "AET001")]
    result = calculate(many, rates())
    assert result.weight == 4


def test_kamia_codes_participate_normally():
    """AED004 and AET021 («Καμία») sit in category 1 and are not special-cased."""
    result = calculate([Service("AED004", INVESTIGATION, 1),
                        Service("AET021", TREATMENT, 1)], rates())
    assert result.weight == 4


# ---------------------------------------------------------------------------
# One-sided selections are rejected
# ---------------------------------------------------------------------------

def test_investigations_only_is_a_validation_error_not_a_price():
    with pytest.raises(CostingError) as excinfo:
        calculate([inv(2)], rates())
    assert excinfo.value.code == "MISSING_TREATMENT"
    assert "θεραπεία" in excinfo.value.message_el


def test_treatments_only_is_a_validation_error_not_a_price():
    with pytest.raises(CostingError) as excinfo:
        calculate([tre(3)], rates())
    assert excinfo.value.code == "MISSING_INVESTIGATION"
    assert "διαγνωστική" in excinfo.value.message_el


def test_error_messages_are_greek():
    """The clerk reads these. Brief §10."""
    for services in ([inv(2)], [tre(3)]):
        with pytest.raises(CostingError) as excinfo:
            calculate(services, rates())
        assert any("Ͱ" <= ch <= "Ͽ" for ch in excinfo.value.message_el)


# ---------------------------------------------------------------------------
# Rates: blocked rather than defaulted
# ---------------------------------------------------------------------------

def test_missing_unit_price_blocks_and_names_the_category():
    with pytest.raises(CostingError) as excinfo:
        calculate([inv(1), tre(1)], rates(unit=None), financial_category_code="620")
    assert excinfo.value.code == "NO_RATE_IN_FORCE"
    assert "620" in excinfo.value.message_el


def test_unconfirmed_registration_fee_blocks_finalisation_but_not_calculation():
    """Brief §4.2 and §10: a blank cell is not a statement of exemption, and the block
    is on finalisation. 15 of 23 ΤΑΕΠ-valid categories are unconfirmed today — refusing
    to calculate would leave the clerk with no number for most of their patients."""
    result = calculate([inv(1), tre(1)], rates(registration=None),
                       financial_category_code="624")

    # Calculation succeeds and shows what is known.
    assert result.weight_cost == Decimal("60.00")
    assert result.tariff_total == Decimal("0.00")

    # The total stays open rather than silently treating the fee as zero.
    assert result.registration_fee_applied is None
    assert result.total_cost is None

    # And finalisation is refused, naming the category.
    assert result.can_finalise is False
    assert "624" in result.blocking_issues_el[0]
    with pytest.raises(CostingError) as excinfo:
        assert_finalisable(result)
    assert excinfo.value.code == "NOT_FINALISABLE"


def test_confirmed_registration_fee_is_finalisable():
    result = calculate([inv(1), tre(1)], rates(registration="10.00"),
                       financial_category_code="603")
    assert result.can_finalise is True
    assert result.total_cost == Decimal("70.00")
    assert assert_finalisable(result) is True


def test_an_exempt_category_is_a_zero_fee_not_a_missing_one():
    """Brief §4.2: model exemption as 0.00 on a rate row, never as a code branch.
    604/606/607/609 are documented exemptions and must finalise normally."""
    result = calculate([inv(1), tre(1)], rates(registration="0.00"),
                       financial_category_code="604")
    assert result.registration_fee_applied == Decimal("0.00")
    assert result.can_finalise is True


def test_registration_fee_is_added_to_every_costing_including_zero():
    result = calculate([inv(1), tre(1)], rates(registration="0.00"))
    assert result.registration_fee_applied == Decimal("0.00")
    assert result.total_cost == result.weight_cost


def test_registration_fee_of_one_hundred_is_material():
    """600 ΕΠΙ ΠΛΗΡΩΜΗ: the fee is comparable to a whole standard episode."""
    result = calculate([inv(1), tre(3)], rates(unit="15.00", registration="100.00"),
                       financial_category_code="600")
    assert result.weight_cost == Decimal("120.00")
    assert result.registration_fee_applied == Decimal("100.00")
    assert result.total_cost == Decimal("220.00")


# ---------------------------------------------------------------------------
# Effective dating
# ---------------------------------------------------------------------------

RATE_HISTORY = [
    {"id": 1, "amount": Decimal("12.00"), "valid_from": dt.date(2024, 1, 1),
     "valid_to": dt.date(2025, 12, 31), "entity_code": None},
    {"id": 2, "amount": Decimal("15.00"), "valid_from": dt.date(2026, 1, 1),
     "valid_to": None, "entity_code": None},
]


def test_examination_date_inside_an_old_period_uses_the_old_rate():
    """Brief §6. An auditor in 2031 gets the 2026 number, not today's."""
    assert pick_rate(RATE_HISTORY, dt.date(2025, 6, 30))["amount"] == Decimal("12.00")
    assert pick_rate(RATE_HISTORY, dt.date(2026, 6, 30))["amount"] == Decimal("15.00")


def test_date_before_every_rate_period_returns_nothing():
    assert pick_rate(RATE_HISTORY, dt.date(2023, 1, 1)) is None


def test_hospital_specific_rate_overrides_the_national_one():
    history = RATE_HISTORY + [
        {"id": 3, "amount": Decimal("18.00"), "valid_from": dt.date(2026, 1, 1),
         "valid_to": None, "entity_code": "LIM"},
    ]
    assert pick_rate(history, dt.date(2026, 6, 1), "LIM")["amount"] == Decimal("18.00")
    assert pick_rate(history, dt.date(2026, 6, 1), "NIC")["amount"] == Decimal("15.00")


def test_overlapping_rate_periods_are_refused_not_silently_picked():
    """MySQL has no EXCLUDE constraint (ADR-001), so the engine must catch this."""
    overlapping = [
        {"id": 1, "amount": Decimal("15.00"), "valid_from": dt.date(2026, 1, 1),
         "valid_to": None, "entity_code": None},
        {"id": 2, "amount": Decimal("19.00"), "valid_from": dt.date(2026, 1, 1),
         "valid_to": None, "entity_code": None},
    ]
    with pytest.raises(CostingError) as excinfo:
        pick_rate(overlapping, dt.date(2026, 6, 1))
    assert excinfo.value.code == "OVERLAPPING_RATES"


# ---------------------------------------------------------------------------
# Tariff lines
# ---------------------------------------------------------------------------

def test_fixed_tariff_line_multiplies_by_quantity():
    line = TariffLine("SHSO-ER11", "Καρδιογράφημα", "fixed",
                      base_amount=Decimal("20.00"), quantity=3)
    result = calculate([inv(1), tre(1)], rates(), [line])
    assert result.tariff_total == Decimal("60.00")
    assert result.total_cost == Decimal("120.00")  # 4 × 15 + 0 + 60


def test_fixed_plus_hourly_charges_base_plus_hours():
    """SHSO-ER39 Έγχυση υγρών: €20 plus €5/hour."""
    line = TariffLine("SHSO-ER39", "Έγχυση υγρών", "fixed_plus_hourly",
                      base_amount=Decimal("20.00"), hourly_amount=Decimal("5.00"),
                      quantity=1, hours=Decimal("3"))
    result = calculate([inv(1), tre(1)], rates(), [line])
    assert result.tariff_total == Decimal("35.00")


def test_fixed_plus_hourly_without_hours_is_rejected():
    line = TariffLine("SHSO-ER39", "Έγχυση υγρών", "fixed_plus_hourly",
                      base_amount=Decimal("20.00"), hourly_amount=Decimal("5.00"))
    with pytest.raises(CostingError) as excinfo:
        calculate([inv(1), tre(1)], rates(), [line])
    assert excinfo.value.code == "MISSING_HOURS"


def test_consumables_amount_without_a_note_is_rejected():
    """Brief §10: the note is mandatory wherever a consumables amount is entered."""
    line = TariffLine("SHSO-ER13", "Εξωτερική βηματοδότηση", "fixed_plus_consumables",
                      base_amount=Decimal("250.00"),
                      consumables_amount=Decimal("40.00"), consumables_note="  ")
    with pytest.raises(CostingError) as excinfo:
        calculate([inv(1), tre(1)], rates(), [line])
    assert excinfo.value.code == "MISSING_CONSUMABLES_NOTE"


def test_consumables_with_a_note_is_accepted():
    line = TariffLine("SHSO-ER13", "Εξωτερική βηματοδότηση", "fixed_plus_consumables",
                      base_amount=Decimal("250.00"),
                      consumables_amount=Decimal("40.00"),
                      consumables_note="Ηλεκτρόδια βηματοδότησης")
    result = calculate([inv(1), tre(1)], rates(), [line])
    assert result.tariff_total == Decimal("290.00")


def test_tariff_lookup_without_a_selected_cpt_is_rejected():
    line = TariffLine("SHSO-ER3", "Ακτινογραφία", "tariff_lookup")
    with pytest.raises(CostingError) as excinfo:
        calculate([inv(1), tre(1)], rates(), [line])
    assert excinfo.value.code == "MISSING_CPT"


def test_tariff_lookup_prices_from_the_selected_cpt_row():
    line = TariffLine("SHSO-ER3", "Ακτινογραφία", "tariff_lookup",
                      radiology_cpt="10006", radiology_price=Decimal("29.50"),
                      quantity=2)
    result = calculate([inv(1), tre(1)], rates(), [line])
    assert result.tariff_total == Decimal("59.00")


def test_quantity_below_one_is_rejected():
    line = TariffLine("SHSO-ER11", "Καρδιογράφημα", "fixed",
                      base_amount=Decimal("20.00"), quantity=0)
    with pytest.raises(CostingError) as excinfo:
        calculate([inv(1), tre(1)], rates(), [line])
    assert excinfo.value.code == "BAD_QUANTITY"


# ---------------------------------------------------------------------------
# The overlap suppression — 83% of the tariff duplicates a weight service
# ---------------------------------------------------------------------------

def test_overlapping_tariff_line_is_suppressed_and_warned_about():
    """Default is weight_only: the weight prices the act, the tariff line is zeroed.

    Without this a cardiac arrest is billed €180 of weight plus €320 of tariff for
    one resuscitation. See docs/phase1-data-quality-memo.md §8.
    """
    line = TariffLine("SHSO-ER12", "Καρδιοπνευμονική αναζωογόνηση", "fixed",
                      base_amount=Decimal("320.00"),
                      overlaps_service="AET085")
    result = calculate([inv(1), Service("AET085", TREATMENT, 5)], rates(), [line])

    assert result.weight == 12
    assert result.weight_cost == Decimal("180.00")
    assert result.tariff_total == Decimal("0.00")
    assert result.total_cost == Decimal("180.00")

    assert len(result.lines) == 1
    assert result.lines[0].suppressed is True
    assert "AET085" in result.lines[0].suppression_reason_el
    assert result.warnings_el and "AET085" in result.warnings_el[0]


def test_non_overlapping_tariff_line_still_charges():
    """The 8 genuine extras are unaffected."""
    line = TariffLine("SHSO-ER1", "Τεστ εγκυμοσύνης", "fixed",
                      base_amount=Decimal("12.00"))
    result = calculate([inv(1), tre(1)], rates(), [line])
    assert result.tariff_total == Decimal("12.00")


# ---------------------------------------------------------------------------
# Rounding
# ---------------------------------------------------------------------------

def test_rounding_is_half_up_not_bankers():
    """Python rounds 0.125 to 0.12 by default. The Μονάδα rounds it to 0.13."""
    assert taep.money(Decimal("0.125")) == Decimal("0.13")
    assert taep.money(Decimal("0.135")) == Decimal("0.14")
    assert taep.money(Decimal("2.345")) == Decimal("2.35")


def test_each_component_is_rounded_once_and_totals_are_consistent():
    line = TariffLine("SHSO-ER11", "x", "fixed", base_amount=Decimal("10.005"),
                      quantity=3)
    result = calculate([inv(1), tre(1)], rates(unit="7.335", registration="1.005"),
                       [line])
    assert result.weight_cost == Decimal("29.34")       # 4 × 7.335 = 29.34
    assert result.registration_fee_applied == Decimal("1.01")
    assert result.tariff_total == Decimal("30.02")      # 3 × 10.005 = 30.015 → 30.02
    assert result.total_cost == Decimal("60.37")
    assert result.total_cost == (result.weight_cost + result.registration_fee_applied
                                 + result.tariff_total)


# ---------------------------------------------------------------------------
# Input hash
# ---------------------------------------------------------------------------

def test_selection_order_does_not_change_the_input_hash():
    a = calculate([inv(2, "AED008"), tre(3, "AET008")], rates(),
                  financial_category_code="624", service_date=dt.date(2026, 1, 1))
    b = calculate([tre(3, "AET008"), inv(2, "AED008")], rates(),
                  financial_category_code="624", service_date=dt.date(2026, 1, 1))
    assert a.input_hash == b.input_hash


def test_changing_a_service_changes_the_input_hash():
    a = calculate([inv(2, "AED008"), tre(3, "AET008")], rates(),
                  financial_category_code="624", service_date=dt.date(2026, 1, 1))
    b = calculate([inv(2, "AED008"), tre(3, "AET008"), tre(1, "AET001")], rates(),
                  financial_category_code="624", service_date=dt.date(2026, 1, 1))
    assert a.input_hash != b.input_hash


def test_changing_the_service_date_changes_the_input_hash():
    a = calculate([inv(1), tre(1)], rates(), financial_category_code="624",
                  service_date=dt.date(2026, 1, 1))
    b = calculate([inv(1), tre(1)], rates(), financial_category_code="624",
                  service_date=dt.date(2026, 2, 1))
    assert a.input_hash != b.input_hash


# ---------------------------------------------------------------------------
# Seed loader
# ---------------------------------------------------------------------------

def test_seed_loader_refuses_the_duplicate_aet092():
    """Brief §9.1, go-live blocker. This test SHOULD fail once the Μονάδα fixes the
    data — at which point delete it and let build_load_report() run clean."""
    with pytest.raises(SeedError) as excinfo:
        taep.load_services(taep._read_seed("services.csv"))
    assert "AET092" in str(excinfo.value)


def test_seed_loader_rejects_an_out_of_range_category():
    rows = [{"code": "AED999", "service_type": "INVESTIGATION", "category": "4",
             "category_code": "AECAT4", "description_el": "x"}]
    with pytest.raises(SeedError) as excinfo:
        taep.load_services(rows)
    assert "out of range" in str(excinfo.value)


def test_weight_matrix_csv_agrees_with_the_constant():
    assert taep.verify_weight_matrix(taep._read_seed("weight_matrix.csv")) is True


@pytest.mark.parametrize("code,price_raw,expected_type,expected_status", [
    ("SHSO-ER11", "20", "fixed", "OK"),
    ("SHSO-ER36", "20 €", "fixed", "OK"),
    ("SHSO-ER3", "Χρέωση ανάλογα με το ανατομικό σημείο", "tariff_lookup", "OK"),
    ("SHSO-ER39", "20€   / συν 5€  ανά ωρα", "fixed_plus_hourly", "OK"),
    ("SHSO-ER13", "250€   / συν αναλώσιμο", "fixed_plus_consumables", "OK"),
    ("SHSO-ER16", "50 € / 120 €  / 200 € / συν αναλώσιμα",
     "fixed_plus_consumables", "UNPARSED_MULTI_TIER"),
    ("SHSO-ER2", "15€  / 60€   / 70€", "fixed", "UNPARSED_MULTI_TIER"),
])
def test_tariff_price_shapes_are_classified_or_flagged(code, price_raw, expected_type,
                                                       expected_status):
    price_type, base, hourly, status = taep.parse_tariff_price(code, price_raw)
    assert price_type == expected_type
    assert status == expected_status


def test_er39_parses_to_twenty_base_and_five_hourly():
    _, base, hourly, _ = taep.parse_tariff_price("SHSO-ER39", "20€ / συν 5€ ανά ωρα")
    assert base == Decimal("20.00")
    assert hourly == Decimal("5.00")


# ---------------------------------------------------------------------------
# Greek folding — brief §11
# ---------------------------------------------------------------------------

def test_accent_and_case_insensitive_matching():
    folded = taep.fold_greek("Ακτινογραφία")
    assert taep.fold_greek("ΑΚΤΙΝΟΓΡΑΦΙΑ") == folded
    assert taep.fold_greek("ακτινογραφια") == folded
    assert taep.fold_greek("  ακτινογραφία  ") == folded


def test_final_sigma_folds_to_medial_sigma():
    """«Τέτανος» and «τετανοσ» must match. Brief §11 names this case."""
    assert taep.fold_greek("Τέτανος") == taep.fold_greek("ΤΕΤΑΝΟΣ")
    assert taep.fold_greek("Τέτανος").endswith("σ")


def test_diaeresis_and_accent_combinations_fold():
    assert taep.fold_greek("Παρακολούθηση") == taep.fold_greek("ΠΑΡΑΚΟΛΟΥΘΗΣΗ")
    assert taep.fold_greek("ενδομυϊκά") == taep.fold_greek("ΕΝΔΟΜΥΙΚΑ")


def test_fold_handles_empty_and_none():
    assert taep.fold_greek(None) == ""
    assert taep.fold_greek("") == ""
