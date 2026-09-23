"""
Acceptance tests for the ΤΑΕΠ costing engine.

Pricing model per the rulings of Μονάδα Ελέγχου Εσόδων, 22/09/2026:
  * weight maps straight to an amount — 4→€60, 8→€120, 12→€180, national
  * no per-category unit price
  * registration fee €0.00 everywhere; the €100 on 600 is a deposit, not a charge
  * tariff lines only for self-paying categories (600, 602, 640)

Run:  python3 -m pytest test_taep.py -q
"""

import datetime as dt
from decimal import Decimal

import pytest

import taep
from taep import (
    Service, Rates, TariffLine, CostingError, SeedError,
    INVESTIGATION, TREATMENT, calculate, pick_rate, assert_finalisable,
)

SCALE = {4: Decimal("60.00"), 8: Decimal("120.00"), 12: Decimal("180.00")}


def inv(category, code=None):
    return Service(code or f"AED{category:03d}", INVESTIGATION, category)


def tre(category, code=None):
    return Service(code or f"AET{category:03d}", TREATMENT, category)


def rates(triage=None, registration="0.00", tariff=False, amounts=None):
    return Rates(
        weight_amounts=dict(SCALE) if amounts is None else amounts,
        triage_amount=Decimal(triage) if triage is not None else None,
        registration_fee=Decimal(registration) if registration is not None else None,
        tariff_applies=tariff,
    )


# ---------------------------------------------------------------------------
# The golden case — brief §4.1, verified against the source PDF
# ---------------------------------------------------------------------------

GOLDEN_TREATMENTS = {"AET008": 3, "AET057": 2, "AET005": 1, "AET043": 2}
GOLDEN_INVESTIGATIONS = {"AED001": 1, "AED008": 2, "AED002": 1, "AED006": 1,
                         "AED009": 2, "AED012": 1, "AED016": 1, "AED005": 2}


def test_golden_case_returns_exactly_120_euro():
    """Still €120.00 under the 60/120/180 scale. The €15 unit price we derived from
    this document was arithmetic, and the scale reproduces it — which is the check."""
    services = (
        [Service(c, TREATMENT, k) for c, k in GOLDEN_TREATMENTS.items()]
        + [Service(c, INVESTIGATION, k) for c, k in GOLDEN_INVESTIGATIONS.items()]
    )
    result = calculate(services, rates(), financial_category_code="624",
                       service_date=dt.date(2026, 1, 15))

    assert result.max_investigation_category == 2
    assert result.max_treatment_category == 3
    assert result.weight == 8
    assert result.band_label_en == "Standard cost combination of investigation and treatment"
    assert result.band_label_el == "Συνδυασμός διάγνωσης και θεραπείας μέσου κόστους"
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
def test_every_matrix_cell_returns_documented_weight_band_and_amount(cell, expected_weight):
    investigation, treatment = cell
    result = calculate([inv(investigation), tre(treatment)], rates())
    assert result.weight == expected_weight
    assert result.band_label_en == taep.BAND_LABELS_EN[expected_weight]
    assert result.band_label_el == taep.BAND_LABELS_EL[expected_weight]
    assert result.weight_cost == SCALE[expected_weight]


def test_matrix_has_exactly_fifteen_cells():
    assert len(taep.WEIGHT_MATRIX) == 15


def test_the_scale_is_sixty_one_twenty_one_eighty():
    assert taep.WEIGHT_PRICE_SCALE == SCALE


def test_band_labels_are_the_catalogue_wording_in_both_languages():
    """Greek comes from the Care Levels sheet, not from a translation we made."""
    import csv
    rows = {r["level_code"]: r for r in
            csv.DictReader(open("seed/care_levels.csv", encoding="utf-8"))}
    assert taep.BAND_LABELS_EL[4] == rows["AELEVEL1"]["label_el"]
    assert taep.BAND_LABELS_EL[8] == rows["AELEVEL2"]["label_el"]
    assert taep.BAND_LABELS_EL[12] == rows["AELEVEL3"]["label_el"]
    assert taep.BAND_LABELS_EL[1] == rows["TRIAGE"]["label_el"] == "Διαλογή"


# ---------------------------------------------------------------------------
# Triage — still unconfirmed, so still blocked
# ---------------------------------------------------------------------------

def test_triage_only_uses_its_own_amount_not_the_weight_four_amount():
    result = calculate([], rates(triage="15.00"))
    assert result.is_triage_only is True
    assert result.weight == 1
    assert result.band_label_el == "Διαλογή"
    assert result.weight_cost == Decimal("15.00")
    assert result.weight_cost != SCALE[4]


def test_triage_blocks_when_no_amount_is_in_force():
    """Triage was confirmed at €10.00 on 23/09, but the refusal path must still work:
    if no amount is in force on the examination date, block rather than guess."""
    with pytest.raises(CostingError) as excinfo:
        calculate([], rates(), financial_category_code="601")
    assert excinfo.value.code == "NO_RATE_IN_FORCE"
    assert "διαλογή" in excinfo.value.message_el.lower()


# ---------------------------------------------------------------------------
# Maximum category wins
# ---------------------------------------------------------------------------

def test_maximum_category_wins_on_each_side():
    result = calculate(
        [inv(1, "AED001"), inv(3, "AED019"), inv(2, "AED008"),
         tre(1, "AET001"), tre(4, "AET074"), tre(2, "AET022")], rates())
    assert (result.max_investigation_category, result.max_treatment_category) == (3, 4)
    assert result.weight == 12


def test_many_low_category_services_do_not_accumulate():
    many = [inv(1, f"AED{n:03d}") for n in range(1, 11)] + [tre(1, "AET001")]
    assert calculate(many, rates()).weight == 4


def test_kamia_codes_participate_normally():
    result = calculate([Service("AED004", INVESTIGATION, 1),
                        Service("AET021", TREATMENT, 1)], rates())
    assert result.weight == 4


def test_investigations_only_is_a_validation_error_not_a_price():
    with pytest.raises(CostingError) as excinfo:
        calculate([inv(2)], rates())
    assert excinfo.value.code == "MISSING_TREATMENT"


def test_treatments_only_is_a_validation_error_not_a_price():
    with pytest.raises(CostingError) as excinfo:
        calculate([tre(3)], rates())
    assert excinfo.value.code == "MISSING_INVESTIGATION"


def test_error_messages_are_greek():
    for services in ([inv(2)], [tre(3)]):
        with pytest.raises(CostingError) as excinfo:
            calculate(services, rates())
        assert any("Ͱ" <= ch <= "Ͽ" for ch in excinfo.value.message_el)


def test_missing_amount_for_a_weight_blocks_and_does_not_default():
    with pytest.raises(CostingError) as excinfo:
        calculate([inv(1), tre(1)], rates(amounts={8: Decimal("120.00")}),
                  financial_category_code="620")
    assert excinfo.value.code == "NO_RATE_IN_FORCE"


# ---------------------------------------------------------------------------
# Registration fee — €0.00 everywhere by ruling
# ---------------------------------------------------------------------------

def test_registration_fee_is_zero_for_every_category():
    """Ruling 3: only 600 pays, and that €100 is a deposit against the bill, not a
    charge added to it. Adding it would overcharge every self-pay patient by €100."""
    import csv
    rows = list(csv.DictReader(open("seed/financial_categories.csv", encoding="utf-8")))
    assert rows, "financial_categories.csv is empty"
    assert all(r["registration_fee_eur"] == "0.00" for r in rows)
    assert all(r["fee_status"] == "SET" for r in rows)

    deposits = {r["code_new"]: r["registration_deposit_eur"] for r in rows
                if r["registration_deposit_eur"]}
    assert deposits == {"600": "100.00"}


def test_zero_registration_fee_leaves_the_total_as_the_weight_amount():
    result = calculate([inv(1), tre(3)], rates(), financial_category_code="600")
    assert result.registration_fee_applied == Decimal("0.00")
    assert result.total_cost == result.weight_cost == Decimal("120.00")


def test_an_unset_registration_fee_still_blocks_finalisation_not_calculation():
    result = calculate([inv(1), tre(1)], rates(registration=None),
                       financial_category_code="624")
    assert result.weight_cost == Decimal("60.00")
    assert result.total_cost is None
    assert result.can_finalise is False
    with pytest.raises(CostingError) as excinfo:
        assert_finalisable(result)
    assert excinfo.value.code == "NOT_FINALISABLE"


def test_a_confirmed_costing_is_finalisable():
    result = calculate([inv(1), tre(1)], rates(), financial_category_code="624")
    assert result.can_finalise is True
    assert assert_finalisable(result) is True


# ---------------------------------------------------------------------------
# Tariff lines — self-paying categories only
# ---------------------------------------------------------------------------

def test_only_self_paying_categories_carry_tariff_charges():
    """Ruling 2. The seed flag drives this, not a branch on the category code."""
    import csv
    rows = list(csv.DictReader(open("seed/financial_categories.csv", encoding="utf-8")))
    allowed = {r["code_new"] for r in rows if r["tariff_applies"] == "TRUE"}
    assert allowed == {"600", "602", "640"}


def test_tariff_line_on_a_non_self_paying_category_is_refused():
    """Refused, not silently zeroed: the clerk should never have been offered it."""
    line = TariffLine("SHSO-ER11", "Καρδιογράφημα", "fixed", base_amount=Decimal("20.00"))
    with pytest.raises(CostingError) as excinfo:
        calculate([inv(1), tre(1)], rates(tariff=False), [line],
                  financial_category_code="624")
    assert excinfo.value.code == "TARIFF_NOT_ALLOWED"
    assert "624" in excinfo.value.message_el


def test_tariff_adds_on_top_of_the_weight_for_a_self_paying_patient():
    """Ruling 2 says these are «επιπλέον χρέωση» even where the act already feeds
    the weight. Overlap is intended here; the Μονάδα ruled with the figures in hand."""
    line = TariffLine("SHSO-ER12", "Καρδιοπνευμονική αναζωογόνηση", "fixed",
                      base_amount=Decimal("320.00"))
    result = calculate([inv(1), Service("AET085", TREATMENT, 5)],
                       rates(tariff=True), [line], financial_category_code="600")
    assert result.weight == 12
    assert result.weight_cost == Decimal("180.00")
    assert result.tariff_total == Decimal("320.00")
    assert result.total_cost == Decimal("500.00")


def test_fixed_tariff_line_multiplies_by_quantity():
    line = TariffLine("SHSO-ER11", "Καρδιογράφημα", "fixed",
                      base_amount=Decimal("20.00"), quantity=3)
    result = calculate([inv(1), tre(1)], rates(tariff=True), [line],
                       financial_category_code="600")
    assert result.tariff_total == Decimal("60.00")
    assert result.total_cost == Decimal("120.00")   # 60 weight + 60 tariff


def test_fixed_plus_hourly_charges_base_plus_hours():
    line = TariffLine("SHSO-ER39", "Έγχυση υγρών", "fixed_plus_hourly",
                      base_amount=Decimal("20.00"), hourly_amount=Decimal("5.00"),
                      hours=Decimal("3"))
    result = calculate([inv(1), tre(1)], rates(tariff=True), [line],
                       financial_category_code="600")
    assert result.tariff_total == Decimal("35.00")


def test_fixed_plus_hourly_without_hours_is_rejected():
    line = TariffLine("SHSO-ER39", "Έγχυση υγρών", "fixed_plus_hourly",
                      base_amount=Decimal("20.00"), hourly_amount=Decimal("5.00"))
    with pytest.raises(CostingError) as excinfo:
        calculate([inv(1), tre(1)], rates(tariff=True), [line],
                  financial_category_code="600")
    assert excinfo.value.code == "MISSING_HOURS"


def test_consumables_amount_without_a_note_is_rejected():
    line = TariffLine("SHSO-ER13", "Εξωτερική βηματοδότηση", "fixed_plus_consumables",
                      base_amount=Decimal("250.00"),
                      consumables_amount=Decimal("40.00"), consumables_note="  ")
    with pytest.raises(CostingError) as excinfo:
        calculate([inv(1), tre(1)], rates(tariff=True), [line],
                  financial_category_code="600")
    assert excinfo.value.code == "MISSING_CONSUMABLES_NOTE"


def test_consumables_with_a_note_is_accepted():
    line = TariffLine("SHSO-ER13", "Εξωτερική βηματοδότηση", "fixed_plus_consumables",
                      base_amount=Decimal("250.00"), consumables_amount=Decimal("40.00"),
                      consumables_note="Ηλεκτρόδια βηματοδότησης")
    result = calculate([inv(1), tre(1)], rates(tariff=True), [line],
                       financial_category_code="600")
    assert result.tariff_total == Decimal("290.00")


def test_tariff_lookup_without_a_selected_cpt_is_rejected():
    line = TariffLine("SHSO-ER3", "Ακτινογραφία", "tariff_lookup")
    with pytest.raises(CostingError) as excinfo:
        calculate([inv(1), tre(1)], rates(tariff=True), [line],
                  financial_category_code="600")
    assert excinfo.value.code == "MISSING_CPT"


def test_tariff_lookup_prices_from_the_selected_cpt_row():
    line = TariffLine("SHSO-ER3", "Ακτινογραφία", "tariff_lookup",
                      radiology_cpt="10006", radiology_price=Decimal("29.50"), quantity=2)
    result = calculate([inv(1), tre(1)], rates(tariff=True), [line],
                       financial_category_code="600")
    assert result.tariff_total == Decimal("59.00")


def test_quantity_below_one_is_rejected():
    line = TariffLine("SHSO-ER11", "x", "fixed", base_amount=Decimal("20.00"), quantity=0)
    with pytest.raises(CostingError) as excinfo:
        calculate([inv(1), tre(1)], rates(tariff=True), [line],
                  financial_category_code="600")
    assert excinfo.value.code == "BAD_QUANTITY"


# ---------------------------------------------------------------------------
# Effective dating
# ---------------------------------------------------------------------------

RATE_HISTORY = [
    {"id": 1, "amount": Decimal("100.00"), "valid_from": dt.date(2024, 1, 1),
     "valid_to": dt.date(2025, 12, 31), "entity_code": None},
    {"id": 2, "amount": Decimal("120.00"), "valid_from": dt.date(2026, 1, 1),
     "valid_to": None, "entity_code": None},
]


def test_examination_date_inside_an_old_period_uses_the_old_rate():
    assert pick_rate(RATE_HISTORY, dt.date(2025, 6, 30))["amount"] == Decimal("100.00")
    assert pick_rate(RATE_HISTORY, dt.date(2026, 6, 30))["amount"] == Decimal("120.00")


def test_date_before_every_rate_period_returns_nothing():
    assert pick_rate(RATE_HISTORY, dt.date(2023, 1, 1)) is None


def test_hospital_specific_rate_overrides_the_national_one():
    """Ruling 14 is that the tariff is national, so this should stay unused — but the
    structure supports it, and an unused path still has to be correct."""
    history = RATE_HISTORY + [
        {"id": 3, "amount": Decimal("140.00"), "valid_from": dt.date(2026, 1, 1),
         "valid_to": None, "entity_code": "LIM"},
    ]
    assert pick_rate(history, dt.date(2026, 6, 1), "LIM")["amount"] == Decimal("140.00")
    assert pick_rate(history, dt.date(2026, 6, 1), "NIC")["amount"] == Decimal("120.00")


def test_overlapping_rate_periods_are_refused_not_silently_picked():
    """MySQL has no EXCLUDE constraint (ADR-001), so the engine must catch this."""
    overlapping = [
        {"id": 1, "amount": Decimal("120.00"), "valid_from": dt.date(2026, 1, 1),
         "valid_to": None, "entity_code": None},
        {"id": 2, "amount": Decimal("150.00"), "valid_from": dt.date(2026, 1, 1),
         "valid_to": None, "entity_code": None},
    ]
    with pytest.raises(CostingError) as excinfo:
        pick_rate(overlapping, dt.date(2026, 6, 1))
    assert excinfo.value.code == "OVERLAPPING_RATES"


# ---------------------------------------------------------------------------
# Rounding and hashing
# ---------------------------------------------------------------------------

def test_rounding_is_half_up_not_bankers():
    assert taep.money(Decimal("0.125")) == Decimal("0.13")
    assert taep.money(Decimal("2.345")) == Decimal("2.35")


def test_each_component_is_rounded_once_and_the_total_is_consistent():
    line = TariffLine("SHSO-ER11", "x", "fixed", base_amount=Decimal("10.005"), quantity=3)
    result = calculate([inv(1), tre(1)], rates(registration="1.005", tariff=True),
                       [line], financial_category_code="600")
    assert result.registration_fee_applied == Decimal("1.01")
    assert result.tariff_total == Decimal("30.02")     # 3 × 10.005 = 30.015 → 30.02
    assert result.total_cost == (result.weight_cost + result.registration_fee_applied
                                 + result.tariff_total)


def test_selection_order_does_not_change_the_input_hash():
    a = calculate([inv(2, "AED008"), tre(3, "AET008")], rates(),
                  financial_category_code="624", service_date=dt.date(2026, 1, 1))
    b = calculate([tre(3, "AET008"), inv(2, "AED008")], rates(),
                  financial_category_code="624", service_date=dt.date(2026, 1, 1))
    assert a.input_hash == b.input_hash


def test_changing_a_service_or_the_date_changes_the_input_hash():
    base = calculate([inv(2, "AED008"), tre(3, "AET008")], rates(),
                     financial_category_code="624", service_date=dt.date(2026, 1, 1))
    more = calculate([inv(2, "AED008"), tre(3, "AET008"), tre(1, "AET001")], rates(),
                     financial_category_code="624", service_date=dt.date(2026, 1, 1))
    later = calculate([inv(2, "AED008"), tre(3, "AET008")], rates(),
                      financial_category_code="624", service_date=dt.date(2026, 2, 1))
    assert base.input_hash != more.input_hash
    assert base.input_hash != later.input_hash


# ---------------------------------------------------------------------------
# Seed data — now generated from the source catalogue
# ---------------------------------------------------------------------------

def test_the_catalogue_loads_clean_with_no_duplicate_codes():
    """Phase 1 reported AET092 as a duplicate. It was not: the CSV we had was a
    corrupted extract. The source catalogue carries 125 distinct codes."""
    services = taep.load_services(taep._read_seed("services.csv"))
    assert len(services) == 125
    assert len({s.code for s in services}) == 125


def test_the_catalogue_has_twenty_seven_investigations_and_ninety_eight_treatments():
    services = taep.load_services(taep._read_seed("services.csv"))
    assert sum(1 for s in services if s.service_type == INVESTIGATION) == 27
    assert sum(1 for s in services if s.service_type == TREATMENT) == 98


def test_aet091_is_not_a_duplicate_of_aet085():
    """The corrupted CSV made both «Αναζωογόνηση». AET091 is Αναρρόφηση εκκρίσεων."""
    by_code = {s.code: s for s in taep.load_services(taep._read_seed("services.csv"))}
    assert by_code["AET091"].description_el == "Αναρρόφηση εκκρίσεων"
    assert by_code["AET091"].category == 1
    assert by_code["AET085"].category == 5
    assert by_code["AET091"].description_el != by_code["AET085"].description_el


def test_aet092_is_only_the_nasogastric_tube():
    by_code = {s.code: s for s in taep.load_services(taep._read_seed("services.csv"))}
    assert by_code["AET092"].description_el == "Τοποθέτηση Ρινογαστρικού Σωλήνα"
    assert by_code["AET092"].category == 2
    assert by_code["AET086"].category == 5


def test_treatment_codes_have_no_gaps():
    """Phase 1 reported five missing treatments. They were lost by the extract."""
    services = taep.load_services(taep._read_seed("services.csv"))
    numbers = sorted(int(s.code[3:]) for s in services if s.service_type == TREATMENT)
    assert numbers == list(range(1, 99))


def test_the_only_genuine_code_gap_is_aed018():
    services = taep.load_services(taep._read_seed("services.csv"))
    numbers = sorted(int(s.code[3:]) for s in services if s.service_type == INVESTIGATION)
    missing = [n for n in range(1, max(numbers) + 1) if n not in numbers]
    assert missing == [18]


def test_seed_loader_still_refuses_a_duplicate_code():
    rows = [
        {"code": "AET001", "service_type": "TREATMENT", "category": "1",
         "category_code": "AECAT1", "description_el": "α", "description_en": "a"},
        {"code": "AET001", "service_type": "TREATMENT", "category": "5",
         "category_code": "AECAT5", "description_el": "β", "description_en": "b"},
    ]
    with pytest.raises(SeedError) as excinfo:
        taep.load_services(rows)
    assert "AET001" in str(excinfo.value)


def test_seed_loader_rejects_an_out_of_range_category():
    rows = [{"code": "AED999", "service_type": "INVESTIGATION", "category": "4",
             "category_code": "AECAT4", "description_el": "x", "description_en": "x"}]
    with pytest.raises(SeedError) as excinfo:
        taep.load_services(rows)
    assert "out of range" in str(excinfo.value)


def test_weight_matrix_csv_agrees_with_the_constant():
    assert taep.verify_weight_matrix(taep._read_seed("weight_matrix.csv")) is True


def test_the_load_report_runs_clean():
    report = taep.build_load_report()
    assert report["services_loaded"] == 125
    assert report["categories_with_tariff"] == ["600", "602", "640"]


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


# ---------------------------------------------------------------------------
# Greek folding — brief §11
# ---------------------------------------------------------------------------

def test_accent_and_case_insensitive_matching():
    folded = taep.fold_greek("Ακτινογραφία")
    assert taep.fold_greek("ΑΚΤΙΝΟΓΡΑΦΙΑ") == folded
    assert taep.fold_greek("ακτινογραφια") == folded


def test_final_sigma_folds_to_medial_sigma():
    assert taep.fold_greek("Τέτανος") == taep.fold_greek("ΤΕΤΑΝΟΣ")
    assert taep.fold_greek("Τέτανος").endswith("σ")


def test_diaeresis_and_accent_combinations_fold():
    assert taep.fold_greek("ενδομυϊκά") == taep.fold_greek("ΕΝΔΟΜΥΙΚΑ")


def test_fold_handles_empty_and_none():
    assert taep.fold_greek(None) == ""
    assert taep.fold_greek("") == ""


# ---------------------------------------------------------------------------
# Rulings of 23/09/2026
# ---------------------------------------------------------------------------

def test_triage_is_ten_euro():
    """Ruling 1: «10 ευρώ». Triage is its own amount, not on the 60/120/180 scale."""
    assert taep.TRIAGE_PRICE == Decimal("10.00")
    result = calculate([], Rates(), financial_category_code="624")
    assert result.is_triage_only is True
    assert result.weight == 1
    assert result.band_label_el == "Διαλογή"
    assert result.weight_cost == Decimal("10.00")
    assert result.total_cost == Decimal("10.00")


def test_triage_is_not_the_weight_four_amount():
    assert taep.TRIAGE_PRICE != taep.WEIGHT_PRICE_SCALE[4]


def test_costing_number_reproduces_the_sample_document():
    """Ruling 4: «κωδικός ανά νοσηλευτήριο και μοναδικός αύξων αριθμός».
    The sample reads OKY1054/0035."""
    assert taep.format_costing_number(1054, 35) == "OKY1054/0035"
    assert taep.format_costing_number("1054", 1) == "OKY1054/0001"
    assert taep.format_costing_number(1054, 12345) == "OKY1054/12345"


@pytest.mark.parametrize("hospital,sequence,code", [
    ("", 1, "NO_HOSPITAL_NUMBER"),
    ("  ", 1, "NO_HOSPITAL_NUMBER"),
    (1054, 0, "BAD_SEQUENCE"),
    (1054, -3, "BAD_SEQUENCE"),
])
def test_costing_number_rejects_bad_input(hospital, sequence, code):
    with pytest.raises(CostingError) as excinfo:
        taep.format_costing_number(hospital, sequence)
    assert excinfo.value.code == code


def test_er16_tiers_carry_the_labels_the_monada_gave():
    """Ruling 5. Without labels the coder cannot tell which tier they are picking."""
    import csv
    rows = {r["code"]: r for r in csv.DictReader(open("seed/tariff.csv", encoding="utf-8"))}
    assert rows["SHSO-ER16-A"]["tier_label_el"] == "Θεραπευτικό πλύσιμο οργάνου (πλύση)"
    assert rows["SHSO-ER16-B"]["tier_label_el"] == "Πλύση οφθαλμού, 3 ώρες"
    assert rows["SHSO-ER16-C"]["tier_label_el"] == "Παρουσία οφθαλμιάτρου"
    assert [rows[f"SHSO-ER16-{s}"]["base_amount"] for s in "ABC"] == ["50.00", "120.00", "200.00"]
    assert all(rows[f"SHSO-ER16-{s}"]["price_type"] == "fixed_plus_consumables" for s in "ABC")


def test_er2_tiers_split_into_three_fixed_rows():
    import csv
    rows = {r["code"]: r for r in csv.DictReader(open("seed/tariff.csv", encoding="utf-8"))}
    assert [rows[f"SHSO-ER2-{s}"]["base_amount"] for s in "ABC"] == ["15.00", "60.00", "70.00"]
    assert all(rows[f"SHSO-ER2-{s}"]["price_type"] == "fixed" for s in "ABC")


def test_every_tariff_row_now_resolves_to_a_price():
    """Phase 1 had nine free-text prices. All are structured now."""
    import csv
    rows = list(csv.DictReader(open("seed/tariff.csv", encoding="utf-8")))
    assert len(rows) == 52
    unresolved = [r["code"] for r in rows if r["load_status"] not in ("OK", "SPLIT")]
    assert unresolved == []
    for row in rows:
        if row["price_type"] != "tariff_lookup":
            assert row["base_amount"], f"{row['code']} has no amount"


def test_the_fee_conflict_is_recorded_not_silently_resolved():
    """The Μονάδα's own table says 603/605/608 are €10,00 at ΤΑΕΠ; their written
    confirmation of the same date zeroes them. We apply the written answer and carry
    the table's value so the disagreement stays visible."""
    import csv
    rows = {r["code_new"]: r for r in
            csv.DictReader(open("seed/financial_categories.csv", encoding="utf-8"))}
    conflicted = {c for c, r in rows.items() if r["fee_conflict"] == "TRUE"}
    assert conflicted == {"603", "605", "608"}
    for code in conflicted:
        assert rows[code]["registration_fee_eur"] == "0.00"
        assert rows[code]["monada_table_taep_fee"] == "10"


def test_the_original_fee_values_survive_a_rerun():
    """apply_monada_rulings.py reads the pristine source, not its own output."""
    import csv
    rows = {r["code_new"]: r for r in
            csv.DictReader(open("seed/financial_categories.csv", encoding="utf-8"))}
    assert rows["600"]["previous_registration_fee_eur"] == "100.00"
    assert rows["603"]["previous_registration_fee_eur"] == "10.00"
