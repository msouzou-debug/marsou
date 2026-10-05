"""
Episode lifecycle: validation, saving, calculating, finalising, cancelling.
Run against a real SQLite database with the module's own schema.
"""
import datetime as dt
from decimal import Decimal

import pytest

import taep
from taep import CostingError


YESTERDAY = dt.datetime.now() - dt.timedelta(days=1)


def category_id(ctx, code):
    return ctx["db_execute"](
        "SELECT id FROM taep_financial_category WHERE code_new=%s",
        (code,), fetch=True)[0]["id"]


def episode_data(ctx, code="624", **overrides):
    data = {
        "episode_number": "E-1001",
        "first_name": "Ανδρέας", "last_name": "Παπαδόπουλος",
        "date_of_birth": dt.date(1985, 4, 12), "gender": "Άνδρας",
        "phone": "99123456", "address": "Λεωφ. Μακαρίου 10, Λευκωσία",
        "id_type": "Ταυτότητα", "id_number": "1234567", "id_country": "Κύπρος",
        "id_expiry": dt.date(2030, 1, 1),
        "next_of_kin_type": "Σύζυγος", "next_of_kin_details": "Μαρία 99654321",
        "comments": "",
        "admission_at": YESTERDAY, "examination_at": YESTERDAY + dt.timedelta(minutes=30),
        "discharge_at": YESTERDAY + dt.timedelta(hours=2),
        "financial_category_id": category_id(ctx, code),
    }
    data.update(overrides)
    return data


def make_episode(ctx, code="624", unit="NIC-ADULT", **overrides):
    return taep.save_episode(ctx, episode_data(ctx, code, **overrides),
                             entity_code="NGH", unit_code=unit, user_id=1)


def price(ctx, episode_id, codes=("AED008", "AET008")):
    """Select services, calculate with the rates in force, and store the result."""
    taep.set_episode_services(ctx, episode_id, list(codes), user_id=1)
    episode = taep.get_episode(ctx, episode_id)
    on_date = taep._as_date(episode["examination_at"])
    rates = taep.rates_in_force(ctx, episode["financial_category_id"], on_date, "NGH")
    result = taep.calculate(
        taep.get_services(ctx, taep.get_episode_service_codes(ctx, episode_id)),
        rates, financial_category_code=str(episode["financial_category_id"]),
        service_date=on_date)
    taep.store_calculation(ctx, episode_id, result, user_id=1)
    return result


# ---------------------------------------------------------------------------
# Validation
# ---------------------------------------------------------------------------

def test_a_clean_episode_validates(seeded):
    errors, warnings = taep.validate_episode(episode_data(seeded))
    assert errors == [] and warnings == []


def test_examination_before_admission_is_rejected(seeded):
    data = episode_data(seeded, examination_at=YESTERDAY - dt.timedelta(hours=1))
    errors, _ = taep.validate_episode(data)
    assert any("εξέτασης" in e and "εισαγωγής" in e for e in errors)


def test_discharge_before_examination_is_rejected(seeded):
    data = episode_data(seeded, discharge_at=YESTERDAY)
    errors, _ = taep.validate_episode(data)
    assert any("εξιτηρίου" in e for e in errors)


def test_future_times_are_rejected(seeded):
    data = episode_data(seeded, discharge_at=dt.datetime.now() + dt.timedelta(days=1))
    errors, _ = taep.validate_episode(data)
    assert any("μέλλον" in e for e in errors)


def test_missing_identification_number_is_rejected(seeded):
    errors, _ = taep.validate_episode(episode_data(seeded, id_number="  "))
    assert any("ταυτοποίησης" in e for e in errors)


def test_missing_category_is_rejected(seeded):
    errors, _ = taep.validate_episode(episode_data(seeded, financial_category_id=None))
    assert any("οικονομική κατηγορία" in e.lower() for e in errors)


def test_an_age_over_110_warns_but_does_not_block(seeded):
    data = episode_data(seeded, date_of_birth=dt.date(1900, 1, 1))
    errors, warnings = taep.validate_episode(data)
    assert errors == []
    assert any("ηλικία" in w for w in warnings)


def test_an_expired_document_warns_but_does_not_block(seeded):
    """Expired documents are common in this population, so this must not block."""
    data = episode_data(seeded, id_expiry=dt.date(2020, 1, 1))
    errors, warnings = taep.validate_episode(data)
    assert errors == []
    assert any("λήξει" in w for w in warnings)


def test_a_future_date_of_birth_is_rejected(seeded):
    data = episode_data(seeded, date_of_birth=dt.date.today() + dt.timedelta(days=1))
    errors, _ = taep.validate_episode(data)
    assert any("γέννησης" in e for e in errors)


# ---------------------------------------------------------------------------
# Saving
# ---------------------------------------------------------------------------

def test_saving_creates_a_draft(seeded):
    episode_id = make_episode(seeded)
    episode = taep.get_episode(seeded, episode_id)
    assert episode["status"] == "DRAFT"
    assert episode["costing_number"] is None
    assert episode["entity_code"] == "NGH"
    assert episode["taep_unit_code"] == "NIC-ADULT"
    assert episode["last_name"] == "Παπαδόπουλος"


def test_the_server_rejects_a_category_that_is_not_valid_at_ae(seeded):
    """Brief §4.4: a UI filter is not a control. 633 is a dental category."""
    with pytest.raises(CostingError) as excinfo:
        make_episode(seeded, code="633")
    assert excinfo.value.code == "CATEGORY_NOT_VALID_AT_AE"
    assert "633" in excinfo.value.message_el


def test_saving_again_updates_rather_than_duplicating(seeded):
    episode_id = make_episode(seeded)
    data = episode_data(seeded, first_name="Γιώργος")
    assert taep.save_episode(seeded, data, "NGH", "NIC-ADULT", 1,
                             episode_id=episode_id) == episode_id
    assert taep.get_episode(seeded, episode_id)["first_name"] == "Γιώργος"
    assert seeded["db_execute"]("SELECT COUNT(*) n FROM taep_episode",
                               fetch=True)[0]["n"] == 1


def test_a_finalised_episode_cannot_be_edited(seeded):
    """Brief §10: it is cancelled and re-entered, never edited."""
    episode_id = make_episode(seeded)
    result = price(seeded, episode_id)
    taep.finalise_episode(seeded, episode_id, result, user_id=1)

    with pytest.raises(CostingError) as excinfo:
        taep.save_episode(seeded, episode_data(seeded), "NGH", "NIC-ADULT", 1,
                          episode_id=episode_id)
    assert excinfo.value.code == "EPISODE_NOT_EDITABLE"


# ---------------------------------------------------------------------------
# Services and staleness
# ---------------------------------------------------------------------------

def test_selecting_services_stores_them_without_duplicates(seeded):
    episode_id = make_episode(seeded)
    taep.set_episode_services(seeded, episode_id, ["AET008", "AED008", "AET008"], 1)
    assert taep.get_episode_service_codes(seeded, episode_id) == ["AED008", "AET008"]


def test_changing_services_clears_the_stored_calculation(seeded):
    """Brief §4.1: adding or removing a service invalidates the result. Deleting the
    row is what makes a stale number unshowable rather than merely discouraged."""
    episode_id = make_episode(seeded)
    price(seeded, episode_id)
    assert taep.get_calculation(seeded, episode_id) is not None
    assert taep.get_episode(seeded, episode_id)["status"] == "CALCULATED"

    taep.set_episode_services(seeded, episode_id, ["AED008", "AET008", "AET074"], 1)
    assert taep.get_calculation(seeded, episode_id) is None
    assert taep.get_episode(seeded, episode_id)["status"] == "DRAFT"


# ---------------------------------------------------------------------------
# Calculating against the rates in force
# ---------------------------------------------------------------------------

def test_the_rates_in_force_reproduce_the_scale(seeded):
    rates = taep.rates_in_force(seeded, category_id(seeded, "624"),
                                dt.date(2026, 6, 1), "NGH")
    assert rates.weight_amounts == taep.WEIGHT_PRICE_SCALE
    assert rates.triage_amount == Decimal("10.00")
    assert rates.registration_fee == Decimal("0.00")
    assert rates.tariff_applies is False


def test_self_pay_category_allows_tariff_lines(seeded):
    rates = taep.rates_in_force(seeded, category_id(seeded, "600"),
                                dt.date(2026, 6, 1), "NGH")
    assert rates.tariff_applies is True
    assert rates.registration_fee == Decimal("0.00")


def test_dikaiouchos_a_carries_the_ten_euro_fee(seeded):
    rates = taep.rates_in_force(seeded, category_id(seeded, "603"),
                                dt.date(2026, 6, 1), "NGH")
    assert rates.registration_fee == Decimal("10.00")
    assert rates.tariff_applies is False


def test_a_date_before_the_rates_blocks_rather_than_defaults(seeded):
    rates = taep.rates_in_force(seeded, category_id(seeded, "624"),
                                dt.date(2020, 1, 1), "NGH")
    assert rates.weight_amounts == {}
    with pytest.raises(CostingError) as excinfo:
        taep.calculate([taep.Service("AED008", "INVESTIGATION", 2),
                        taep.Service("AET008", "TREATMENT", 3)], rates,
                       financial_category_code="624")
    assert excinfo.value.code == "NO_RATE_IN_FORCE"


def test_the_golden_case_end_to_end_through_the_database(seeded):
    """The §4.1 golden case, priced from seeded rates rather than literals."""
    episode_id = make_episode(seeded, code="624")
    codes = ["AET008", "AET057", "AET005", "AET043",
             "AED001", "AED008", "AED002", "AED006",
             "AED009", "AED012", "AED016", "AED005"]
    result = price(seeded, episode_id, codes)

    assert result.max_investigation_category == 2
    assert result.max_treatment_category == 3
    assert result.weight == 8
    assert result.weight_cost == Decimal("120.00")
    assert result.total_cost == Decimal("120.00")

    stored = taep.get_calculation(seeded, episode_id)
    assert taep.money_from_db(stored["total_cost"]) == Decimal("120.00")
    assert stored["band_label_el"] == "Συνδυασμός διάγνωσης και θεραπείας μέσου κόστους"
    assert stored["weight_rate_id"] is not None, "the rate row must be snapshotted"


def test_a_triage_only_episode_prices_at_ten(seeded):
    episode_id = make_episode(seeded)
    result = price(seeded, episode_id, codes=[])
    assert result.is_triage_only is True
    assert result.total_cost == Decimal("10.00")


# ---------------------------------------------------------------------------
# Finalisation
# ---------------------------------------------------------------------------

def test_finalising_allocates_a_number_and_locks_the_episode(seeded):
    episode_id = make_episode(seeded)
    result = price(seeded, episode_id)
    number, sequence = taep.finalise_episode(seeded, episode_id, result, user_id=1)

    assert number == "OKY1054/0001" and sequence == 1
    episode = taep.get_episode(seeded, episode_id)
    assert episode["status"] == "FINALISED"
    assert episode["costing_number"] == number


def test_finalising_without_calculating_is_refused(seeded):
    episode_id = make_episode(seeded)
    taep.set_episode_services(seeded, episode_id, ["AED008", "AET008"], 1)
    rates = taep.rates_in_force(seeded, category_id(seeded, "624"),
                                dt.date(2026, 6, 1), "NGH")
    result = taep.calculate(taep.get_services(seeded, ["AED008", "AET008"]), rates)
    with pytest.raises(CostingError) as excinfo:
        taep.finalise_episode(seeded, episode_id, result, user_id=1)
    assert excinfo.value.code == "NOT_CALCULATED"


def test_finalising_a_stale_calculation_is_refused(seeded):
    """The clerk must have pressed Υπολογισμός on exactly what is being finalised."""
    episode_id = make_episode(seeded)
    stale = price(seeded, episode_id)
    # The selection changes behind the result the clerk is looking at.
    taep.set_episode_services(seeded, episode_id, ["AED008", "AET008", "AET074"], 1)
    fresh = price(seeded, episode_id, ["AED008", "AET008", "AET074"])

    assert stale.input_hash != fresh.input_hash
    with pytest.raises(CostingError) as excinfo:
        taep.finalise_episode(seeded, episode_id, stale, user_id=1)
    assert excinfo.value.code == "STALE_CALCULATION"
    # The fresh one goes through.
    assert taep.finalise_episode(seeded, episode_id, fresh, user_id=1)[1] == 1


def test_finalising_twice_is_refused(seeded):
    episode_id = make_episode(seeded)
    result = price(seeded, episode_id)
    taep.finalise_episode(seeded, episode_id, result, user_id=1)
    with pytest.raises(CostingError) as excinfo:
        taep.finalise_episode(seeded, episode_id, result, user_id=1)
    assert excinfo.value.code == "ALREADY_FINALISED"


def test_two_units_at_one_hospital_get_numbers_from_their_own_series(seeded):
    adult = make_episode(seeded, unit="NIC-ADULT", episode_number="E-1")
    paediatric = make_episode(seeded, unit="NIC-PAED", episode_number="E-2")
    adult_number, _ = taep.finalise_episode(seeded, adult, price(seeded, adult), 1)
    paed_number, _ = taep.finalise_episode(seeded, paediatric,
                                           price(seeded, paediatric), 1)
    assert adult_number == "OKY1054/0001"
    assert paed_number == "OKY1106/0001"


# ---------------------------------------------------------------------------
# Cancellation
# ---------------------------------------------------------------------------

def test_cancelling_keeps_the_number(seeded):
    episode_id = make_episode(seeded)
    result = price(seeded, episode_id)
    number, _ = taep.finalise_episode(seeded, episode_id, result, user_id=1)

    taep.cancel_episode(seeded, episode_id, "Λάθος οικονομική κατηγορία", user_id=2)
    episode = taep.get_episode(seeded, episode_id)
    assert episode["status"] == "CANCELLED"
    assert episode["costing_number"] == number
    assert episode["cancellation_reason"] == "Λάθος οικονομική κατηγορία"


def test_a_cancelled_number_is_not_reissued(seeded):
    first = make_episode(seeded, episode_number="E-1")
    number, _ = taep.finalise_episode(seeded, first, price(seeded, first), 1)
    taep.cancel_episode(seeded, first, "ακύρωση", 2)

    second = make_episode(seeded, episode_number="E-2")
    next_number, _ = taep.finalise_episode(seeded, second, price(seeded, second), 1)
    assert next_number != number
    assert next_number == "OKY1054/0002"


def test_cancellation_requires_a_reason(seeded):
    episode_id = make_episode(seeded)
    with pytest.raises(CostingError) as excinfo:
        taep.cancel_episode(seeded, episode_id, "   ", user_id=2)
    assert excinfo.value.code == "NO_CANCELLATION_REASON"


# ---------------------------------------------------------------------------
# Prior episodes (screen 1)
# ---------------------------------------------------------------------------

def test_prior_episodes_are_found_by_identification(seeded):
    first = make_episode(seeded, episode_number="E-1")
    taep.finalise_episode(seeded, first, price(seeded, first), 1)

    prior = taep.find_prior_episodes(seeded, "Ταυτότητα", "1234567")
    assert len(prior) == 1
    assert prior[0]["last_name"] == "Παπαδόπουλος"
    assert prior[0]["category_code"] == "624"


def test_prior_episodes_cross_hospitals(seeded):
    """A patient seen in Limassol last month is the same patient in Nicosia today."""
    nicosia = make_episode(seeded, episode_number="E-1")
    taep.finalise_episode(seeded, nicosia, price(seeded, nicosia), 1)
    limassol = taep.save_episode(seeded, episode_data(seeded, episode_number="E-2"),
                                 entity_code="LGH", unit_code="LIM", user_id=1)
    taep.finalise_episode(seeded, limassol, price(seeded, limassol), 1)

    prior = taep.find_prior_episodes(seeded, "Ταυτότητα", "1234567")
    assert {p["entity_code"] for p in prior} == {"NGH", "LGH"}


def test_cancelled_episodes_are_not_offered_as_prior_records(seeded):
    episode_id = make_episode(seeded)
    taep.finalise_episode(seeded, episode_id, price(seeded, episode_id), 1)
    taep.cancel_episode(seeded, episode_id, "ακύρωση", 2)
    assert taep.find_prior_episodes(seeded, "Ταυτότητα", "1234567") == []


def test_no_identification_finds_nothing(seeded):
    assert taep.find_prior_episodes(seeded, "Ταυτότητα", "") == []


def test_unpaid_self_pay_episodes_are_singled_out(seeded):
    self_pay = make_episode(seeded, code="600", episode_number="E-1")
    taep.finalise_episode(seeded, self_pay, price(seeded, self_pay), 1)
    asylum = taep.save_episode(seeded, episode_data(seeded, "624", episode_number="E-2"),
                               "NGH", "NIC-ADULT", 1)
    taep.finalise_episode(seeded, asylum, price(seeded, asylum), 1)

    prior = taep.find_prior_episodes(seeded, "Ταυτότητα", "1234567")
    unpaid = taep.unpaid_self_pay_episodes(prior)
    assert len(unpaid) == 1
    assert unpaid[0]["category_code"] == "600"


def test_a_draft_is_not_reported_as_unpaid(seeded):
    """Only finalised self-pay episodes count; a draft was never billed."""
    make_episode(seeded, code="600")
    prior = taep.find_prior_episodes(seeded, "Ταυτότητα", "1234567")
    assert taep.unpaid_self_pay_episodes(prior) == []


# ---------------------------------------------------------------------------
# Units
# ---------------------------------------------------------------------------

def test_nicosia_general_offers_both_units(seeded):
    units = taep.unit_for_entity(seeded, "NGH", dt.date(2026, 6, 1))
    assert {u["unit_code"] for u in units} == {"NIC-ADULT", "NIC-PAED"}


def test_makarios_offers_no_unit_today(seeded):
    assert taep.unit_for_entity(seeded, "ARC", dt.date(2026, 6, 1)) == []


def test_moving_the_paediatric_unit_is_a_data_change(seeded):
    """Close the NGH row, open an ARC one. No code changes, and 1106 is kept."""
    db = seeded["db_execute"]
    db("UPDATE taep_unit SET host_valid_to='2026-12-31' WHERE unit_code='NIC-PAED'")
    db("""INSERT INTO taep_unit (unit_code, name_el, taep_number, host_entity_code,
          host_valid_from, active) VALUES
          ('NIC-PAED','ΤΑΕΠ Παίδων Λευκωσίας','1106','ARC','2027-01-01',1)""")

    before = taep.unit_for_entity(seeded, "NGH", dt.date(2026, 6, 1))
    after_ngh = taep.unit_for_entity(seeded, "NGH", dt.date(2027, 6, 1))
    after_arc = taep.unit_for_entity(seeded, "ARC", dt.date(2027, 6, 1))

    assert "NIC-PAED" in {u["unit_code"] for u in before}
    assert "NIC-PAED" not in {u["unit_code"] for u in after_ngh}
    assert [u["taep_number"] for u in after_arc] == ["1106"]
