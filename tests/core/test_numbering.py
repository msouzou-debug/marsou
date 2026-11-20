import re
from datetime import datetime, timezone

from ehire.extensions import db
from ehire.models import Directorate, NumberCounter, Position, Request, Setting, User
from ehire.services.numbering import next_number, next_value, stem_for

NOON = datetime(2026, 11, 20, 12, 0, tzinfo=timezone.utc)


def make_request(directorate="NIC", category="nursing", position=None):
    d = Directorate.query.filter_by(code=directorate).one()
    if position is None:
        position = Position.query.filter_by(category=category).first()
    user = User.query.first()
    r = Request(created_by=user.id, directorate_id=d.id, position_id=position.id if position else None, category=category)
    db.session.add(r)
    db.session.flush()
    return r


def test_shape_and_counter(seeded):
    r = make_request()
    nums = [next_number(db.session, r, NOON) for _ in range(3)]
    assert nums == ["EHIRE-NIC-NUR-20261120-0%d" % i for i in (1, 2, 3)]
    assert db.session.get(NumberCounter, "EHIRE-NIC-NUR-20261120").last_value == 3


def test_counter_restarts_for_another_position_directorate_or_day(seeded):
    nurse = make_request()
    midwife = make_request(position=Position.query.filter_by(title_en="Midwife").one())
    assert Position.query.filter_by(title_en="Midwife").one().code == "MID"
    lim = make_request(directorate="LIM")
    assert next_number(db.session, nurse, NOON).endswith("NIC-NUR-20261120-01")
    assert next_number(db.session, nurse, NOON).endswith("NIC-NUR-20261120-02")
    assert next_number(db.session, midwife, NOON).endswith("NIC-MID-20261120-01")
    assert next_number(db.session, lim, NOON).endswith("LIM-NUR-20261120-01")
    assert next_number(db.session, nurse, datetime(2026, 11, 21, 12, 0, tzinfo=timezone.utc)).endswith("NIC-NUR-20261121-01")


def test_two_positions_may_share_a_code(seeded):
    other = Position(category="nursing", title_el="Άλλη", title_en="Other post", code="NUR")
    db.session.add(other)
    db.session.flush()
    a, b = make_request(), make_request(position=other)
    assert next_number(db.session, a, NOON).endswith("-01")
    assert next_number(db.session, b, NOON).endswith("-02")  # same stem, so one counter


def test_position_without_code_uses_the_category_code(seeded):
    p = Position(category="allied", title_el="Χωρίς", title_en="No code", code=None)
    db.session.add(p)
    db.session.flush()
    assert next_number(db.session, make_request(position=p, category="allied"), NOON) == "EHIRE-NIC-ALH-20261120-01"


def test_day_is_the_cyprus_day(seeded):
    r = make_request()
    late = datetime(2026, 11, 20, 22, 30, tzinfo=timezone.utc)  # 00:30 on 21 Nov in Cyprus
    assert "-20261121-" in next_number(db.session, r, late)
    early = datetime(2026, 11, 20, 21, 59, tzinfo=timezone.utc)
    assert "-20261120-" in next_number(db.session, r, early)


def test_counter_rolls_from_99_to_100(seeded):
    r = make_request()
    stem = stem_for(db.session, r, NOON)
    db.session.add(NumberCounter(stem=stem, last_value=98))
    db.session.flush()
    assert next_number(db.session, r, NOON).endswith("-99")
    assert next_number(db.session, r, NOON).endswith("-100")
    assert next_number(db.session, r, NOON).endswith("-101")


def test_directorate_code_with_dash_or_nothing_left(seeded):
    d = Directorate(code="T-NIC", name_el="Δοκιμή", name_en="Test")
    db.session.add(d)
    db.session.flush()
    r = Request(created_by=User.query.first().id, directorate_id=d.id, category="medical")
    db.session.add(r)
    db.session.flush()
    assert next_number(db.session, r, NOON) == "EHIRE-TNIC-MED-20261120-01"
    d.code = "--"
    assert next_number(db.session, r, NOON) == "EHIRE-X-MED-20261120-01"


def test_prefix_from_setting(seeded):
    row = db.session.get(Setting, "number_prefix")
    row.value = "TST"
    assert next_number(db.session, make_request(), NOON).startswith("TST-NIC-")


def test_default_prefix_is_ehire(seeded):
    assert db.session.get(Setting, "number_prefix").value == "EHIRE"
    db.session.delete(db.session.get(Setting, "number_prefix"))
    db.session.flush()
    assert next_number(db.session, make_request(), NOON).startswith("EHIRE-NIC-")


def test_next_value_counts_per_stem(seeded):
    assert [next_value(db.session, "A-B-C-20260101") for _ in range(3)] == [1, 2, 3]
    assert next_value(db.session, "A-B-C-20260102") == 1


def test_number_search_filled_on_save(seeded):
    u = User.query.first()
    old = Request(created_by=u.id, number="ΑΕΘ-2026-00007")
    new = Request(created_by=u.id, number="EHIRE-NGH-NUR-20261120-01")
    db.session.add_all([old, new])
    db.session.commit()
    assert old.number_search == "AEU202600007"
    assert new.number_search == "EHIRENGHNUR2026112001"


def test_the_two_normalisers_give_the_same_result():
    """ehire/workflow/numbering.py and the copy used by the number_search column must not drift apart."""
    from ehire.models.request import _LOOKALIKES, _fallback_normalise
    from ehire.workflow.numbering import _GREEK_TO_LATIN, normalise_number

    assert {ord(k): v for k, v in _GREEK_TO_LATIN.items()} == _LOOKALIKES
    greek = "".join(chr(c) for c in range(0x370, 0x400))
    samples = ["", None, "AEU-2026-0007", "aeu 2026 0007", "ΑΕΘ-2026-0007", "αεθ 2026 7",
               "Άέθ", "pos – 2026 — 0007", "a b\t-−c", "ΑΒΕΖΗΘΙΚΜΝΟΡΤΥΧ",
               greek, greek.lower(), "Σςσ 1", "EHIRE-NGH-NUR-20261120-01"]
    for text in samples:
        assert _fallback_normalise(text) == normalise_number(text), repr(text)


def test_the_migration_copy_matches_too():
    import importlib

    from ehire.workflow.numbering import normalise_number

    mig = importlib.import_module("ehire.migrations.0002_number_search_theta")
    for text in ("ΑΕΘ-2026-0007", "aeu 2026", "αεθ-1", "Ά-1–Β", ""):
        assert mig._key(text) == normalise_number(text)


def test_two_submissions_same_day_get_01_and_02_and_others_restart(seeded, client):
    from tests.requests.flowhelpers import create

    first = create(client)
    second = create(client)
    other_position = create(client, category="nursing")
    lim = create(client, "lim.requester", directorate_code="LIM")
    for r in (first, second, other_position, lim):
        assert re.fullmatch(r"EHIRE-[A-Z]+-[A-Z0-9]{2,6}-\d{8}-\d{2}", r.number), r.number
    assert first.number.endswith("-01") and second.number.endswith("-02")
    assert first.number.rsplit("-", 1)[0] == second.number.rsplit("-", 1)[0]
    assert "-NIC-" in first.number and "-NIC-NUR-" in other_position.number and other_position.number.endswith("-01")
    assert "-LIM-" in lim.number and lim.number.endswith("-01")
    assert first.number_search == re.sub("-", "", first.number)


def test_resubmission_keeps_the_number(seeded, client):
    from tests.requests.flowhelpers import act, create, reload
    from tests.requests.test_return_replace_withdraw import resubmit

    req = create(client)
    number = req.number
    assert act(client, "nic.accountant", req.id, "return", comment="Add detail.").status_code == 302
    assert resubmit(client, req.id, need_text="A corrected need.").status_code == 302
    assert reload(req.id).round == 2 and reload(req.id).number == number


def test_old_numbers_still_open_search_and_export(seeded, client):
    from tests.requests.flowhelpers import as_user, create

    old_style = create(client)
    old_style.number = "ΑΕΘ-2026-0007"
    other = create(client)
    legacy = create(client)
    legacy.number = "EHIRE-2026-0003"
    db.session.commit()
    as_user(client, "central.ceo")
    page = client.get("/requests/%d" % old_style.id)
    assert page.status_code == 200 and "ΑΕΘ-2026-0007" in page.get_data(as_text=True)
    def found(typed):
        return client.get("/requests", query_string={"tab": "all", "q": typed}).get_data(as_text=True)

    for typed, expect, absent in (("AEU-2026-0007", old_style, other), ("aeu 2026 0007", old_style, other),
                                  ("EHIRE-2026-0003", legacy, other), ("ehire 2026", legacy, old_style)):
        html = found(typed)
        assert expect.number in html and absent.number not in html, typed
    # the new shape, in pieces, any case, with or without dashes
    assert other.number.startswith("EHIRE-NIC-PHY-")
    day = other.number.split("-")[3]
    for typed in ("nic phy", day, other.number.lower(), other.number.replace("-", ""), "NIC-PHY-" + day + "-02"):
        assert other.number in found(typed), typed
    assert old_style.number not in found("nic phy")
    # the audit page's request filter takes the same input
    from tests.audit.test_audit_view import add, get

    add("probe_event", request_id=other.id)
    assert other.number in get(client, "demo.admin", "?request=nic+phy+" + day).get_data(as_text=True)
    as_user(client, "central.ceo")
    export = client.get("/requests/export.xlsx")
    assert export.status_code == 200 and export.data[:2] == b"PK"


def test_clear_test_data_lowers_the_new_counters(seeded):
    from ehire.testdata import _release_numbers

    r = make_request()
    r.number = next_number(db.session, r, NOON)
    r2 = make_request()
    r2.number = next_number(db.session, r2, NOON)
    db.session.flush()
    stem = r.number.rsplit("-", 1)[0]
    r2.number = None
    _release_numbers([r.number.replace("-01", "-02")])
    assert db.session.get(NumberCounter, stem).last_value == 1
    r.number = None
    _release_numbers([stem + "-01"])
    assert db.session.get(NumberCounter, stem).last_value == 0
