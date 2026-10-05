"""
Database-level tests: the seed loader, rate resolution and costing-number allocation,
run against a real SQLite database with the module's own schema.
"""
import datetime as dt
import sqlite3
import threading
from decimal import Decimal

import pytest

import taep
from taep import CostingError


# ---------------------------------------------------------------------------
# Schema
# ---------------------------------------------------------------------------

def test_every_schema_statement_runs_on_sqlite(ctx):
    """The fixture already ran them; this asserts the tables are really there."""
    tables = {r["name"] for r in ctx["db_execute"](
        "SELECT name FROM sqlite_master WHERE type='table'", fetch=True)}
    expected = {"taep_financial_category", "taep_service", "taep_weight_matrix",
                "taep_rate", "taep_tariff", "taep_radiology_tariff", "taep_unit",
                "taep_costing_number", "taep_episode", "taep_episode_service",
                "taep_episode_tariff_line", "taep_costing_result", "taep_settlement"}
    assert expected <= tables


def test_schema_renders_for_mysql_too():
    rendered = [taep.render_schema(s, use_mysql=True) for s in taep.SCHEMA_STATEMENTS]
    assert all("{AUTO_INCREMENT}" not in s and "{ENGINE}" not in s for s in rendered)
    assert any("ENGINE=InnoDB" in s for s in rendered)
    assert all("AUTOINCREMENT" not in s for s in rendered)


# ---------------------------------------------------------------------------
# Seed loader
# ---------------------------------------------------------------------------

def test_seed_loads_the_master_data(seeded):
    db = seeded["db_execute"]
    count = lambda table: db(f"SELECT COUNT(*) AS n FROM {table}", fetch=True)[0]["n"]

    assert count("taep_financial_category") == 38
    assert count("taep_service") == 125
    assert count("taep_weight_matrix") == 15
    assert count("taep_unit") == 8
    assert count("taep_tariff") == 52
    assert count("taep_radiology_tariff") == 305


def test_seed_is_idempotent(seeded):
    db = seeded["db_execute"]
    before = db("SELECT COUNT(*) AS n FROM taep_service", fetch=True)[0]["n"]
    taep.seed(seeded)
    taep.seed(seeded)
    assert db("SELECT COUNT(*) AS n FROM taep_service", fetch=True)[0]["n"] == before


def test_only_twenty_three_categories_are_valid_at_ae(seeded):
    rows = seeded["db_execute"](
        "SELECT COUNT(*) AS n FROM taep_financial_category WHERE valid_for_ae=1",
        fetch=True)
    assert rows[0]["n"] == 23


def test_tariff_applies_to_three_categories(seeded):
    rows = seeded["db_execute"](
        "SELECT code_new FROM taep_financial_category WHERE tariff_applies=1 "
        "ORDER BY code_new", fetch=True)
    assert [r["code_new"] for r in rows] == ["600", "602", "640"]


def test_the_matrix_in_the_table_matches_the_constant(seeded):
    rows = seeded["db_execute"](
        "SELECT investigation_category i, treatment_category t, weight, "
        "band_label_el FROM taep_weight_matrix", fetch=True)
    from_db = {(r["i"], r["t"]): r["weight"] for r in rows}
    assert from_db == taep.WEIGHT_MATRIX
    for row in rows:
        assert row["band_label_el"] == taep.BAND_LABELS_EL[row["weight"]]


def test_the_weight_scale_is_seeded_as_rate_rows(seeded):
    rows = seeded["db_execute"](
        "SELECT weight, amount FROM taep_rate WHERE rate_type='WEIGHT_AMOUNT' "
        "ORDER BY weight", fetch=True)
    assert {r["weight"]: taep.money_from_db(r["amount"])
            for r in rows} == taep.WEIGHT_PRICE_SCALE


def test_the_triage_amount_is_seeded(seeded):
    rows = seeded["db_execute"](
        "SELECT amount FROM taep_rate WHERE rate_type='TRIAGE_AMOUNT'", fetch=True)
    assert taep.money_from_db(rows[0]["amount"]) == Decimal("10.00")


def test_registration_fees_and_the_deposit_are_seeded(seeded):
    db = seeded["db_execute"]
    fees = db("""SELECT c.code_new, r.amount FROM taep_rate r
                 JOIN taep_financial_category c ON r.financial_category_id = c.id
                 WHERE r.rate_type='REGISTRATION_FEE' AND r.amount > 0""",
              fetch=True)
    assert {f["code_new"]: taep.money_from_db(f["amount"]) for f in fees} == {
        "603": Decimal("10.00"), "605": Decimal("10.00"), "608": Decimal("10.00")}

    deposits = db("""SELECT c.code_new, r.amount FROM taep_rate r
                     JOIN taep_financial_category c ON r.financial_category_id = c.id
                     WHERE r.rate_type='REGISTRATION_DEPOSIT'""", fetch=True)
    assert {d["code_new"]: taep.money_from_db(d["amount"]) for d in deposits} == {
        "600": Decimal("100.00")}


def test_the_payer_is_seeded(seeded):
    rows = seeded["db_execute"](
        "SELECT payer_el FROM taep_financial_category WHERE code_new='628'", fetch=True)
    assert rows[0]["payer_el"] == "Υπηρεσία Ασύλου"


# ---------------------------------------------------------------------------
# Costing numbers
# ---------------------------------------------------------------------------

def test_the_first_number_for_a_unit_is_sequence_one(seeded):
    number, sequence = taep.allocate_costing_number(seeded, "LIM")
    assert (number, sequence) == ("OKY1047/0001", 1)


def test_numbers_increment_without_gaps(seeded):
    issued = [taep.allocate_costing_number(seeded, "LIM")[0] for _ in range(5)]
    assert issued == ["OKY1047/0001", "OKY1047/0002", "OKY1047/0003",
                      "OKY1047/0004", "OKY1047/0005"]


def test_each_unit_keeps_its_own_sequence(seeded):
    """The two Nicosia units share an entity but never share a series."""
    assert taep.allocate_costing_number(seeded, "NIC-ADULT")[0] == "OKY1054/0001"
    assert taep.allocate_costing_number(seeded, "NIC-PAED")[0] == "OKY1106/0001"
    assert taep.allocate_costing_number(seeded, "NIC-ADULT")[0] == "OKY1054/0002"
    assert taep.allocate_costing_number(seeded, "NIC-PAED")[0] == "OKY1106/0002"


def test_an_unknown_unit_is_refused(seeded):
    with pytest.raises(CostingError) as excinfo:
        taep.allocate_costing_number(seeded, "NOPE")
    assert excinfo.value.code == "UNKNOWN_UNIT"


def test_concurrent_allocation_never_issues_the_same_number(seeded):
    """Brief §13: gapless and unique under concurrent finalisation from two sessions.

    This test caught a real defect. The first implementation incremented a counter and
    read it back with a second statement; because eFinance's db_execute commits per
    call, two threads read the same value and were issued the same number — forty
    allocations produced twenty-four distinct numbers. Allocation is now a single
    INSERT whose UNIQUE key rejects the loser of a race.
    """
    threads_count, per_thread = 8, 25
    issued, errors = [], []
    lock = threading.Lock()

    def allocate():
        for _ in range(per_thread):
            try:
                number, _ = taep.allocate_costing_number(seeded, "LAR")
                with lock:
                    issued.append(number)
            except Exception as exc:
                with lock:
                    errors.append(repr(exc))

    threads = [threading.Thread(target=allocate) for _ in range(threads_count)]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join()

    total = threads_count * per_thread
    assert not errors, f"errors under contention: {errors[:3]}"
    assert len(issued) == total
    assert len(set(issued)) == total, "a costing number was issued twice"
    sequences = sorted(int(n.split("/")[1]) for n in issued)
    assert sequences == list(range(1, total + 1)), "the sequence has a gap"


def test_two_units_allocate_concurrently_without_interfering(seeded):
    issued = {"NIC-ADULT": [], "NIC-PAED": []}
    lock = threading.Lock()

    def allocate(unit):
        for _ in range(20):
            number, _ = taep.allocate_costing_number(seeded, unit)
            with lock:
                issued[unit].append(number)

    threads = [threading.Thread(target=allocate, args=(u,))
               for u in issued for _ in range(2)]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join()

    for unit, prefix in (("NIC-ADULT", "OKY1054/"), ("NIC-PAED", "OKY1106/")):
        numbers = issued[unit]
        assert len(numbers) == len(set(numbers)) == 40
        assert all(n.startswith(prefix) for n in numbers)
        assert sorted(int(n.split("/")[1]) for n in numbers) == list(range(1, 41))


def test_the_ledger_records_every_number(seeded):
    for _ in range(3):
        taep.allocate_costing_number(seeded, "PAF", user_id=7)
    rows = seeded["db_execute"](
        "SELECT * FROM taep_costing_number WHERE unit_code='PAF' "
        "ORDER BY sequence_number", fetch=True)
    assert [r["costing_number"] for r in rows] == [
        "OKY1025/0001", "OKY1025/0002", "OKY1025/0003"]
    assert all(r["allocated_by"] == 7 and r["allocated_at"] for r in rows)


def test_last_allocated_sequence_reports_without_allocating(seeded):
    assert taep.last_allocated_sequence(seeded, "CHR") == 0
    taep.allocate_costing_number(seeded, "CHR")
    taep.allocate_costing_number(seeded, "CHR")
    assert taep.last_allocated_sequence(seeded, "CHR") == 2
    # Reporting must not consume a number.
    assert taep.last_allocated_sequence(seeded, "CHR") == 2
    assert taep.allocate_costing_number(seeded, "CHR")[1] == 3


def test_a_number_is_never_reissued_after_cancellation(seeded):
    """A cancelled costing keeps its number; the ledger row stays and the next
    allocation moves on rather than refilling the hole."""
    first, _ = taep.allocate_costing_number(seeded, "FAM")
    second, _ = taep.allocate_costing_number(seeded, "FAM")
    # Cancelling the episode does not touch the ledger.
    third, sequence = taep.allocate_costing_number(seeded, "FAM")
    assert [first, second, third] == ["OKY1049/0001", "OKY1049/0002", "OKY1049/0003"]
    assert sequence == 3


def test_duplicate_key_detection_covers_both_engines():
    assert taep._is_duplicate_key(Exception("UNIQUE constraint failed: t.c"))
    assert taep._is_duplicate_key(Exception("Duplicate entry '1' for key 'x'"))
    assert not taep._is_duplicate_key(Exception("no such table: t"))


def test_money_survives_the_round_trip_in_both_modes():
    """SQLite stores a DECIMAL column with NUMERIC affinity, so "10.00" comes back as
    the float 10.0. money_from_db is what stops a float reaching the arithmetic."""
    assert taep.money_from_db("10.00") == Decimal("10.00")
    assert taep.money_from_db(10.0) == Decimal("10.00")
    assert taep.money_from_db(10) == Decimal("10.00")
    assert taep.money_from_db(Decimal("10.005")) == Decimal("10.01")
    assert taep.money_from_db(None) is None
    # The case that matters: a tenth is not representable in binary floating point.
    assert taep.money_from_db(0.1) == Decimal("0.10")
    assert taep.money_from_db(120.0) + taep.money_from_db(10.0) == Decimal("130.00")


def test_allocation_survives_heavier_contention(seeded):
    """Sixteen threads. The first retry strategy exhausted its budget here, because
    every loser re-read the same MAX and collided on the same number again."""
    issued, errors = [], []
    lock = threading.Lock()

    def allocate():
        for _ in range(20):
            try:
                number, _ = taep.allocate_costing_number(seeded, "TRD")
                with lock:
                    issued.append(number)
            except Exception as exc:
                with lock:
                    errors.append(repr(exc))

    threads = [threading.Thread(target=allocate) for _ in range(16)]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join()

    assert not errors, f"errors under contention: {errors[:2]}"
    assert len(set(issued)) == 320
    assert sorted(int(n.split("/")[1]) for n in issued) == list(range(1, 321))
