"""
Rate administration: closing one period and opening the next, without an exclusion
constraint to lean on.
"""
import datetime as dt
import threading
from decimal import Decimal

import pytest

import taep
from taep import CostingError


DOC = "Απόφαση ΔΣ 123/2027"


def category_id(ctx, code):
    return ctx["db_execute"](
        "SELECT id FROM taep_financial_category WHERE code_new=%s", (code,),
        fetch=True)[0]["id"]


# ---------------------------------------------------------------------------
# Changing a rate
# ---------------------------------------------------------------------------

def test_changing_a_rate_closes_the_old_period_and_opens_a_new_one(seeded):
    closed, new = taep.change_rate(seeded, "WEIGHT_AMOUNT", "70.00",
                                   dt.date(2027, 1, 1), user_id=5, weight=4,
                                   source_document=DOC)
    periods = taep.rate_series(seeded, "WEIGHT_AMOUNT", weight=4)
    assert len(periods) == 2

    old = next(p for p in periods if p["id"] == closed)
    added = next(p for p in periods if p["id"] == new)
    assert taep._as_date(old["valid_to"]) == dt.date(2026, 12, 31)
    assert old["closed_by"] == 5 and old["closed_at"]
    assert taep.money_from_db(added["amount"]) == Decimal("70.00")
    assert taep._as_date(added["valid_from"]) == dt.date(2027, 1, 1)
    assert added["source_document"] == DOC
    assert added["created_by"] == 5


def test_a_rate_is_never_updated_in_place(seeded):
    before = taep.rate_series(seeded, "WEIGHT_AMOUNT", weight=8)
    original_amount = before[0]["amount"]
    taep.change_rate(seeded, "WEIGHT_AMOUNT", "150.00", dt.date(2027, 1, 1),
                     user_id=5, weight=8, source_document=DOC)
    after = taep.rate_series(seeded, "WEIGHT_AMOUNT", weight=8)
    assert after[0]["id"] == before[0]["id"]
    assert after[0]["amount"] == original_amount, "the historic amount was altered"


def test_the_old_rate_still_prices_an_old_episode(seeded):
    """The point of effective dating: a 2026 episode keeps costing the 2026 price."""
    taep.change_rate(seeded, "WEIGHT_AMOUNT", "200.00", dt.date(2027, 1, 1),
                     user_id=5, weight=8, source_document=DOC)
    before = taep.rates_in_force(seeded, category_id(seeded, "624"),
                                 dt.date(2026, 6, 1))
    after = taep.rates_in_force(seeded, category_id(seeded, "624"),
                                dt.date(2027, 6, 1))
    assert before.weight_amounts[8] == Decimal("120.00")
    assert after.weight_amounts[8] == Decimal("200.00")


def test_a_registration_fee_change_is_scoped_to_its_category(seeded):
    taep.change_rate(seeded, "REGISTRATION_FEE", "25.00", dt.date(2027, 1, 1),
                     user_id=5, financial_category_id=category_id(seeded, "603"),
                     source_document=DOC)
    changed = taep.rates_in_force(seeded, category_id(seeded, "603"),
                                  dt.date(2027, 6, 1))
    untouched = taep.rates_in_force(seeded, category_id(seeded, "605"),
                                    dt.date(2027, 6, 1))
    assert changed.registration_fee == Decimal("25.00")
    assert untouched.registration_fee == Decimal("10.00")


def test_a_source_document_is_mandatory(seeded):
    with pytest.raises(CostingError) as excinfo:
        taep.change_rate(seeded, "WEIGHT_AMOUNT", "70.00", dt.date(2027, 1, 1),
                         user_id=5, weight=4, source_document="  ")
    assert excinfo.value.code == "NO_SOURCE_DOCUMENT"


def test_the_change_is_audit_logged(seeded):
    taep.change_rate(seeded, "TRIAGE_AMOUNT", "12.00", dt.date(2027, 1, 1),
                     user_id=5, source_document=DOC)
    entries = [e for e in seeded["activity_log"] if e[2] == "RATE_CHANGED"]
    assert len(entries) == 1
    assert DOC in entries[0][3] and "12.00" in entries[0][3]


@pytest.mark.parametrize("rate_type,weight,code", [
    ("WEIGHT_AMOUNT", None, "WEIGHT_REQUIRED"),
    ("TRIAGE_AMOUNT", 4, "WEIGHT_NOT_ALLOWED"),
    ("NONSENSE", None, "UNKNOWN_RATE_TYPE"),
])
def test_rate_type_and_weight_must_agree(seeded, rate_type, weight, code):
    with pytest.raises(CostingError) as excinfo:
        taep.change_rate(seeded, rate_type, "10.00", dt.date(2027, 1, 1), user_id=5,
                         weight=weight, source_document=DOC)
    assert excinfo.value.code == code


@pytest.mark.parametrize("amount", ["-1.00", "abc", ""])
def test_a_bad_amount_is_refused(seeded, amount):
    with pytest.raises(CostingError) as excinfo:
        taep.change_rate(seeded, "TRIAGE_AMOUNT", amount, dt.date(2027, 1, 1),
                         user_id=5, source_document=DOC)
    assert excinfo.value.code == "BAD_AMOUNT"


# ---------------------------------------------------------------------------
# The rules that stop a wrong price being readable
# ---------------------------------------------------------------------------

def test_a_new_period_cannot_start_on_or_before_the_current_one(seeded):
    with pytest.raises(CostingError) as excinfo:
        taep.change_rate(seeded, "WEIGHT_AMOUNT", "70.00", dt.date(2026, 1, 1),
                         user_id=5, weight=4, source_document=DOC)
    assert excinfo.value.code == "EFFECTIVE_DATE_NOT_AFTER_CURRENT"


def test_backdating_into_a_closed_period_is_refused(seeded):
    """Backdating silently rewrites what a past costing reproduces."""
    taep.change_rate(seeded, "WEIGHT_AMOUNT", "70.00", dt.date(2027, 1, 1),
                     user_id=5, weight=4, source_document=DOC)
    with pytest.raises(CostingError) as excinfo:
        taep.change_rate(seeded, "WEIGHT_AMOUNT", "80.00", dt.date(2026, 6, 1),
                         user_id=5, weight=4, source_document=DOC)
    assert excinfo.value.code == "BACKDATED_INTO_CLOSED_PERIOD"


def test_two_changes_in_sequence_build_a_clean_history(seeded):
    taep.change_rate(seeded, "WEIGHT_AMOUNT", "70.00", dt.date(2027, 1, 1),
                     user_id=5, weight=4, source_document="Α")
    taep.change_rate(seeded, "WEIGHT_AMOUNT", "80.00", dt.date(2028, 1, 1),
                     user_id=5, weight=4, source_document="Β")
    periods = taep.rate_series(seeded, "WEIGHT_AMOUNT", weight=4)
    assert [taep.money_from_db(p["amount"]) for p in periods] == [
        Decimal("60.00"), Decimal("70.00"), Decimal("80.00")]
    assert [str(taep._as_date(p["valid_to"]) or "") for p in periods] == [
        "2026-12-31", "2027-12-31", ""]
    assert taep.verify_rate_periods(seeded) == []


def test_the_periods_are_contiguous_with_no_day_uncovered(seeded):
    taep.change_rate(seeded, "WEIGHT_AMOUNT", "70.00", dt.date(2027, 1, 1),
                     user_id=5, weight=4, source_document=DOC)
    for day, expected in ((dt.date(2026, 12, 31), Decimal("60.00")),
                          (dt.date(2027, 1, 1), Decimal("70.00"))):
        rates = taep.rates_in_force(seeded, category_id(seeded, "624"), day)
        assert rates.weight_amounts[4] == expected


def test_the_seeded_data_has_no_overlapping_periods(seeded):
    assert taep.verify_rate_periods(seeded) == []


def test_verify_detects_an_overlap_someone_inserted_by_hand(seeded):
    """The check an exclusion constraint would have done. Someone editing the table
    directly is exactly the case MySQL cannot stop us from hitting."""
    seeded["db_execute"](
        """INSERT INTO taep_rate (rate_type, weight, amount, valid_from,
           source_document) VALUES ('WEIGHT_AMOUNT', 4, '99.00', '2026-06-01', 'χειρ.')""")
    problems = taep.verify_rate_periods(seeded)
    assert problems
    assert any("επικαλύπτεται" in p["detail"] for p in problems)


def test_an_overlap_makes_the_engine_refuse_rather_than_guess(seeded):
    seeded["db_execute"](
        """INSERT INTO taep_rate (rate_type, weight, amount, valid_from,
           source_document) VALUES ('WEIGHT_AMOUNT', 4, '99.00', '2026-01-01', 'χειρ.')""")
    with pytest.raises(CostingError) as excinfo:
        taep.rates_in_force(seeded, category_id(seeded, "624"), dt.date(2026, 6, 1))
    assert excinfo.value.code == "OVERLAPPING_RATES"


def test_two_admins_changing_the_same_rate_at_once_do_not_both_win(seeded):
    """series_key's UNIQUE constraint is the only thing standing in for a transaction,
    because db_execute commits per call. The first version relied on a UNIQUE over
    nullable columns and six threads all inserted, because SQL treats NULLs as
    distinct and the national weight rows have NULL category and entity."""
    results, errors = [], []
    lock = threading.Lock()

    def change():
        try:
            outcome = taep.change_rate(seeded, "WEIGHT_AMOUNT", "70.00",
                                       dt.date(2027, 1, 1), user_id=5, weight=12,
                                       source_document=DOC)
            with lock:
                results.append(outcome)
        except CostingError as exc:
            with lock:
                errors.append(exc.code)

    threads = [threading.Thread(target=change) for _ in range(6)]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join()

    assert len(results) == 1, f"more than one change succeeded: {results}"
    assert set(errors) <= {"RATE_ALREADY_STARTS_THEN",
                           "EFFECTIVE_DATE_NOT_AFTER_CURRENT",
                           "BACKDATED_INTO_CLOSED_PERIOD"}, (
        "a loser left the series dirty instead of being refused")
    assert taep.verify_rate_periods(seeded) == []
    assert len(taep.rate_series(seeded, "WEIGHT_AMOUNT", weight=12)) == 2


# ---------------------------------------------------------------------------
# The rate screen
# ---------------------------------------------------------------------------

def test_the_overview_covers_the_twenty_three_valid_categories(seeded):
    overview = taep.rate_overview(seeded, dt.date(2026, 6, 1))
    assert len(overview) == 23


def test_the_three_fee_states_are_distinguished(seeded):
    """A set value, a documented exemption and an unconfirmed value must not look the
    same — conflating them is how a wrong bill gets issued."""
    overview = {row["code"]: row for row in taep.rate_overview(seeded, dt.date(2026, 6, 1))}

    # 603 pays €10.00 by the 29/09 ruling.
    assert overview["603"]["fee_state"] == taep.RATE_STATE_SET
    assert overview["603"]["registration_fee"] == Decimal("10.00")

    # 604 is a documented exemption: zero, with the note that justifies it.
    assert overview["604"]["fee_state"] == taep.RATE_STATE_EXEMPT
    assert overview["604"]["registration_fee"] == Decimal("0.00")
    assert overview["604"]["note_el"]


def test_a_category_with_no_rate_row_reads_as_unconfirmed(seeded):
    seeded["db_execute"](
        "DELETE FROM taep_rate WHERE rate_type='REGISTRATION_FEE' "
        "AND financial_category_id=%s", (category_id(seeded, "620"),))
    overview = {row["code"]: row for row in taep.rate_overview(seeded, dt.date(2026, 6, 1))}
    assert overview["620"]["fee_state"] == taep.RATE_STATE_UNCONFIRMED
    assert overview["620"]["registration_fee"] is None


def test_the_overview_shows_the_deposit_separately_from_the_fee(seeded):
    overview = {row["code"]: row for row in taep.rate_overview(seeded, dt.date(2026, 6, 1))}
    assert overview["600"]["registration_fee"] == Decimal("0.00")
    assert overview["600"]["deposit"] == Decimal("100.00")
    assert overview["624"]["deposit"] is None


def test_the_overview_carries_the_payer_and_the_tariff_flag(seeded):
    overview = {row["code"]: row for row in taep.rate_overview(seeded, dt.date(2026, 6, 1))}
    assert overview["628"]["payer_el"] == "Υπηρεσία Ασύλου"
    assert overview["600"]["tariff_applies"] is True
    assert overview["624"]["tariff_applies"] is False


def test_the_weight_scale_overview_shows_the_scale_and_triage(seeded):
    scale = {row["weight"]: row for row in taep.weight_scale_overview(seeded,
                                                                     dt.date(2026, 6, 1))}
    assert scale[4]["amount"] == Decimal("60.00")
    assert scale[8]["amount"] == Decimal("120.00")
    assert scale[12]["amount"] == Decimal("180.00")
    assert scale[1]["amount"] == Decimal("10.00")
    assert scale[1]["band_label_el"] == "Διαλογή"
    assert all(row["source_document"] for row in scale.values())


def test_the_overview_follows_the_date_it_is_asked_about(seeded):
    taep.change_rate(seeded, "REGISTRATION_FEE", "30.00", dt.date(2027, 1, 1),
                     user_id=5, financial_category_id=category_id(seeded, "603"),
                     source_document=DOC)
    before = {r["code"]: r for r in taep.rate_overview(seeded, dt.date(2026, 6, 1))}
    after = {r["code"]: r for r in taep.rate_overview(seeded, dt.date(2027, 6, 1))}
    assert before["603"]["registration_fee"] == Decimal("10.00")
    assert after["603"]["registration_fee"] == Decimal("30.00")


def test_the_series_key_is_null_free(seeded):
    """The NULL-distinct trap: a UNIQUE over nullable columns does not constrain the
    national rows at all, which is why series_key exists."""
    assert taep.rate_series_key("WEIGHT_AMOUNT", weight=8) == "WEIGHT_AMOUNT|*|*|8"
    assert taep.rate_series_key("REGISTRATION_FEE", 7) == "REGISTRATION_FEE|7|*|*"
    rows = seeded["db_execute"]("SELECT series_key FROM taep_rate", fetch=True)
    assert rows and all(r["series_key"] for r in rows)
    assert all("None" not in r["series_key"] for r in rows)


def test_the_database_itself_refuses_a_second_row_starting_the_same_day(seeded):
    """The guard the nullable UNIQUE key failed to provide, tested at the database so
    it holds even for something writing outside change_rate()."""
    taep.change_rate(seeded, "WEIGHT_AMOUNT", "70.00", dt.date(2027, 1, 1),
                     user_id=5, weight=4, source_document=DOC)
    with pytest.raises(Exception) as excinfo:
        seeded["db_execute"](
            """INSERT INTO taep_rate (rate_type, weight, amount, valid_from,
               source_document, series_key)
               VALUES ('WEIGHT_AMOUNT', 4, '99.00', '2027-01-01', 'x', %s)""",
            (taep.rate_series_key("WEIGHT_AMOUNT", weight=4),))
    assert taep._is_duplicate_key(excinfo.value)
    assert len(taep.rate_series(seeded, "WEIGHT_AMOUNT", weight=4)) == 2


def test_concurrent_changes_to_different_series_all_succeed(seeded):
    """Contention must only serialise within a series, not across them."""
    outcomes, errors = [], []
    lock = threading.Lock()

    def change(weight):
        try:
            taep.change_rate(seeded, "WEIGHT_AMOUNT", "99.00", dt.date(2027, 1, 1),
                             user_id=5, weight=weight, source_document=DOC)
            with lock:
                outcomes.append(weight)
        except CostingError as exc:
            with lock:
                errors.append((weight, exc.code))

    threads = [threading.Thread(target=change, args=(w,)) for w in (4, 8, 12)]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join()

    assert not errors, errors
    assert sorted(outcomes) == [4, 8, 12]
    assert taep.verify_rate_periods(seeded) == []
