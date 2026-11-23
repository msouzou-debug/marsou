"""Contract 07, section 1: every row of the cost-centre table, the T- exception, the safety stop, ETag / 304,
unknown entity codes, one transaction and one audit row."""
import json

import pytest

from ehire.extensions import db
from ehire.models import AuditLog, CostCentre, Directorate, Setting
from ehire.services import cost_centre_sync
from tests.efinance.conftest import demo_list, set_link
from tests.efinance.fake_efinance import cc


def _cc(code):
    db.session.expire_all()
    return CostCentre.query.filter_by(code=code).first()


def _sync_rows():
    return AuditLog.query.filter_by(event="list_changed", object_id="efinance_sync").all()


def test_link_none_calls_nothing(wired, fake):
    fake.fail_if_called = True
    result = cost_centre_sync.sync()
    assert result.ok and result.outcome == "off" and result.line() == "skipped: efinance_link=none"
    assert not fake.calls and not fake.forbidden


def test_identical_list_changes_nothing_and_writes_no_audit_row(linked, fake):
    demo_list(fake)
    result = cost_centre_sync.sync()
    assert result.ok and result.outcome == "unchanged" and not _sync_rows()
    assert cost_centre_sync.last_run()["outcome"] == "unchanged"


def test_new_code_is_added_and_tied_to_the_directorate_of_its_entity(linked, fake):
    demo_list(fake, [cc("1000000200", "Νέο", "LIM", True, "New")])
    result = cost_centre_sync.sync()
    row = _cc("1000000200")
    assert row.is_active and row.directorate_id == Directorate.query.filter_by(code="LIM").one().id
    assert row.name_en == "New" and result.counts["added"] == 1


def test_new_code_with_unknown_entity_is_added_without_directorate_and_reported(linked, fake):
    demo_list(fake, [cc("1000000300", "Άγνωστο", "ZZZ")])
    result = cost_centre_sync.sync()
    row = _cc("1000000300")
    assert row.directorate_id is None and row.name_en == "Άγνωστο"  # no English name: the Greek one is repeated
    assert result.unknown_entities == ["ZZZ"] and "unknown_entities=ZZZ" in result.line()
    detail = json.loads(_sync_rows()[0].detail_json)
    assert detail["unknown_entities"] == ["ZZZ"] and detail["source"] == "efinance_sync"


def test_name_entity_and_active_changes_are_applied(linked, fake):
    rows = demo_list(fake)
    rows[0]["name_el"] = "Νέο όνομα"
    rows[1]["entity_code"] = "LIM"
    rows[2]["active"] = False
    result = cost_centre_sync.sync()
    assert _cc("1001").name_el == "Νέο όνομα"
    assert _cc("1002").directorate_id == Directorate.query.filter_by(code="LIM").one().id
    assert not _cc("1003").is_active
    assert result.counts == {"added": 0, "updated": 2, "deactivated": 1, "reactivated": 0}
    assert sorted(result.codes["updated"]) == ["1001", "1002"] and result.codes["deactivated"] == ["1003"]


def test_missing_from_the_list_is_switched_off_never_deleted(linked, fake):
    demo_list(fake)
    fake.cost_centres = [r for r in fake.cost_centres if r["code"] != "1010"]
    cost_centre_sync.sync()
    assert _cc("1010") is not None and not _cc("1010").is_active


def test_switched_off_by_hand_but_active_in_efinance_comes_back(linked, fake):
    _cc("1005").is_active = False
    db.session.commit()
    demo_list(fake)
    result = cost_centre_sync.sync()
    assert _cc("1005").is_active and result.codes["reactivated"] == ["1005"]


def test_codes_typed_in_ehire_are_switched_off_unless_they_start_with_T(linked, fake):
    demo_list(fake)  # eFinance's list: the demo codes only
    db.session.add_all([CostCentre(code="T-01", name_el="Δοκιμή", name_en="Test"),
                        CostCentre(code="TEST-02", name_el="Δοκιμή", name_en="Test")])
    db.session.commit()
    cost_centre_sync.sync()
    assert _cc("T-01").is_active and not _cc("TEST-02").is_active


@pytest.mark.parametrize("keep", [0, 4])
def test_safety_stop_changes_nothing(linked, fake, keep):
    """10 active here: an answer with none, or with 4 active (fewer than half), is refused."""
    rows = demo_list(fake)
    fake.cost_centres = rows[:keep]
    before = {c.code: c.is_active for c in CostCentre.query}
    result = cost_centre_sync.sync()
    assert not result.ok and result.reason == ("empty" if keep == 0 else "safety_stop")
    assert result.line().startswith("failed:")
    db.session.expire_all()
    assert {c.code: c.is_active for c in CostCentre.query} == before and not _sync_rows()
    last = cost_centre_sync.last_run()
    assert last["ok"] is False and last["reason"] == result.reason


def test_exactly_half_is_accepted(linked, fake):
    rows = demo_list(fake)
    fake.cost_centres = rows[:5]
    result = cost_centre_sync.sync()
    assert result.ok and result.counts["deactivated"] == 5


def test_inactive_rows_do_not_count_towards_the_half(linked, fake):
    rows = demo_list(fake)
    for r in rows[1:]:
        r["active"] = False
    assert cost_centre_sync.sync().reason == "safety_stop"


def test_one_audit_row_with_counts_and_capped_codes(linked, fake):
    demo_list(fake, [cc("2%09d" % i, "Νέο %d" % i, "NIC") for i in range(60)])
    result = cost_centre_sync.sync(user_id=None)
    rows = _sync_rows()
    assert len(rows) == 1
    detail = json.loads(rows[0].detail_json)
    assert detail["counts"]["added"] == 60 and len(detail["codes"]["added"]) == cost_centre_sync.CODES_CAP
    assert detail["codes_not_listed"] == {"added": 60 - cost_centre_sync.CODES_CAP}
    assert rows[0].object_type == "cost_centre" and result.total == 70


def test_etag_is_sent_and_304_means_nothing_changed(linked, fake):
    demo_list(fake, [cc("1000000400", "Νέο", "NIC")])
    fake.etag = '"v1"'
    cost_centre_sync.sync()
    assert db.session.get(Setting, "efinance_cc_etag").value == '"v1"'
    fake.cost_centres = []  # would trip the safety stop if it were read
    result = cost_centre_sync.sync()
    assert fake.calls[-1]["if_none_match"] == '"v1"'
    assert result.ok and result.outcome == "unchanged" and result.line().startswith("unchanged:")


def test_a_hand_edit_in_settings_forgets_the_etag(linked, fake, client):
    demo_list(fake)
    fake.etag = '"v1"'
    cost_centre_sync.sync()
    from tests.conftest import login

    login(client, "demo.admin")
    row = _cc("1001")
    client.post("/settings/cost_centre/%d/edit" % row.id, data={"name_el": "Αλλαγή", "name_en": "Changed"})
    db.session.expire_all()
    assert not db.session.get(Setting, "efinance_cc_etag").value
    cost_centre_sync.sync()  # reads the whole list again and sets the name back
    assert fake.calls[-1]["if_none_match"] is None and _cc("1001").name_el != "Αλλαγή"


@pytest.mark.parametrize("mode", [401, 500, "timeout", "redirect", "bad_json", "huge"])
def test_efinance_failures_change_nothing(linked, fake, mode):
    demo_list(fake)
    fake.mode = mode
    result = cost_centre_sync.sync()
    assert not result.ok and result.reason and not _sync_rows()
    assert fake.token not in result.line()


def test_one_transaction_a_failed_store_leaves_nothing(linked, fake, monkeypatch):
    demo_list(fake, [cc("1000000500", "Νέο", "NIC")])
    calls = {"n": 0}
    real = db.session.commit

    def boom():
        calls["n"] += 1
        if calls["n"] == 1:
            raise RuntimeError("disk full")
        return real()

    monkeypatch.setattr(db.session, "commit", boom)
    result = cost_centre_sync.sync()
    monkeypatch.setattr(db.session, "commit", real)
    assert not result.ok and result.reason == "store_failed"
    assert _cc("1000000500") is None and not _sync_rows()


def test_link_switched_back_to_none_stops_syncing(linked, fake):
    set_link("none")
    fake.fail_if_called = True
    assert cost_centre_sync.sync().outcome == "off" and not fake.calls
