import re

from ehr.extensions import db
from ehr.models import NumberSequence, Request, Setting
from ehr.services.numbering import next_number, next_value


def test_increasing_and_distinct(seeded):
    nums = [next_number(db.session, 2026) for _ in range(25)]
    assert len(set(nums)) == 25
    values = [int(re.findall(r"\d+", n)[-1]) for n in nums]
    assert values == list(range(1, 26))
    assert all("2026" in n for n in nums)


def test_years_are_separate(seeded):
    next_number(db.session, 2026), next_number(db.session, 2026)
    assert next_value(db.session, 2027) == 1
    assert db.session.get(NumberSequence, 2026).last_value == 2


def test_prefix_from_setting(seeded):
    db.session.get(Setting, "number_prefix").value = "TST"
    assert next_number(db.session, 2026).startswith("TST")


def test_default_prefix_is_seeded(seeded):
    assert db.session.get(Setting, "number_prefix").value


def test_number_search_filled_on_save(seeded):
    from ehr.models import User

    u = User.query.first()
    r = Request(created_by=u.id, number="ΑΕΘ-2026-00007")
    db.session.add(r)
    db.session.commit()
    assert r.number_search == "AEΘ202600007"
