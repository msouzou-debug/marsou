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
    assert r.number_search == "AEU202600007"


def test_the_two_normalisers_give_the_same_result():
    """ehr/workflow/numbering.py and the copy used by the number_search column must not drift apart."""
    from ehr.models.request import _LOOKALIKES, _fallback_normalise
    from ehr.workflow.numbering import _GREEK_TO_LATIN, normalise_number

    assert {ord(k): v for k, v in _GREEK_TO_LATIN.items()} == _LOOKALIKES
    greek = "".join(chr(c) for c in range(0x370, 0x400))
    samples = ["", None, "AEU-2026-0007", "aeu 2026 0007", "ΑΕΘ-2026-0007", "αεθ 2026 7",
               "Άέθ", "pos – 2026 — 0007", "a b\t-−c", "ΑΒΕΖΗΘΙΚΜΝΟΡΤΥΧ",
               greek, greek.lower(), "Σςσ 1"]
    for text in samples:
        assert _fallback_normalise(text) == normalise_number(text), repr(text)


def test_the_migration_copy_matches_too():
    import importlib

    from ehr.workflow.numbering import normalise_number

    mig = importlib.import_module("ehr.migrations.0002_number_search_theta")
    for text in ("ΑΕΘ-2026-0007", "aeu 2026", "αεθ-1", "Ά-1–Β", ""):
        assert mig._key(text) == normalise_number(text)


def test_search_by_latin_aeu_finds_the_request_in_the_list_and_the_audit_filter(seeded, client):
    from tests.audit.test_audit_view import add, get
    from tests.requests.flowhelpers import as_user, create

    req = create(client)
    other = create(client)
    assert req.number.startswith("\u0391\u0395\u0398-")  # the seeded prefix has a Greek theta
    assert req.number_search.startswith("AEU")
    add("probe_event", request_id=req.id)
    add("probe_event", request_id=other.id)
    digits = req.number.rsplit("-", 1)[1]
    for typed in ("AEU-2026-" + digits, "aeu-2026-" + digits, "AEU 2026 " + digits):
        as_user(client, "central.ceo")
        html = client.get("/requests?tab=all&q=" + typed).get_data(as_text=True)
        assert req.number in html and other.number not in html, typed
        audit_html = get(client, "demo.admin", "?request=" + typed).get_data(as_text=True)
        assert req.number in audit_html, typed
        assert other.number not in audit_html.split("<tbody>")[-1], typed
