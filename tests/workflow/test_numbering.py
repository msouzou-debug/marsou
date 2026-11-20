from ehire.workflow.numbering import format_number, normalise_number


def test_format_number():
    assert format_number("ΕΘ", 2026, 7) == "ΕΘ-2026-0007"
    assert format_number("POS", 2026, 12345) == "POS-2026-12345"


def test_normalise_greek_lookalikes():
    greek = "ΑΒΕΖΗΙΚΜΝΟΡΤΥΧ"
    assert normalise_number(greek) == "ABEZHIKMNOPTYX"


def test_normalise_case_dashes_spaces():
    assert normalise_number("pos - 2026 – 0007") == "POS20260007"
    assert normalise_number("αβ-2026-0001") == "AB20260001"
    assert normalise_number("ά-1") == "A1"


def test_normalise_same_for_both_scripts():
    assert normalise_number("ΑΒ-2026-0001") == normalise_number("AB-2026-0001")


def test_theta_is_typed_as_u():
    assert normalise_number("Θ") == "U" and normalise_number("θ") == "U"  # capital and small theta
    assert normalise_number("ΑΕΘ-2026-0007") == "AEU20260007"
    assert normalise_number("aeu 2026 0007") == "AEU20260007"
    assert normalise_number("ΑΕΘ-2026-0007") == normalise_number("AEU-2026-0007")


# ---- the request number: EHIRE-<directorate>-<position>-<YYYYMMDD>-<NN>

from datetime import date, datetime, timedelta, timezone  # noqa: E402
from zoneinfo import ZoneInfo  # noqa: E402

from ehire.workflow.numbering import (CATEGORY_CODES, clean_code, directorate_part, format_request_number,  # noqa: E402
                                      number_stem, position_part, valid_position_code)


def test_clean_code_keeps_latin_letters_and_digits_only():
    assert clean_code("t-nic") == "TNIC"
    assert clean_code(" a_b.c 9 ") == "ABC9"
    assert clean_code("ΝΙΚ") == ""  # Greek letters are not Latin
    assert clean_code(None) == ""


def test_directorate_part_falls_back_to_x():
    assert directorate_part("T-NIC") == "TNIC"
    assert directorate_part("NGH") == "NGH"
    assert directorate_part("Λευκωσία") == "X"
    assert directorate_part("--") == "X" and directorate_part("") == "X" and directorate_part(None) == "X"


def test_valid_position_code():
    assert all(valid_position_code(c) for c in ("NU", "NUR", "ABC123", "12"))
    assert not any(valid_position_code(c) for c in ("", "A", "ABCDEFG", "nur", "N-R", "ΝΟΥ", None))


def test_position_part_uses_own_code_else_the_category_code():
    assert position_part("phy", "nursing") == "PHY"
    assert {c: position_part(None, c) for c in CATEGORY_CODES} == {
        "medical": "MED", "nursing": "NUR", "allied": "ALH", "admin": "ADM", "other": "OTH"}
    assert position_part("", "medical") == "MED"
    assert position_part("bad code!", "admin") == "ADM"  # a stored value that is not valid is ignored
    assert position_part(None, None) == "OTH" and position_part(None, "unknown") == "OTH"


def test_number_stem_and_counter_format():
    stem = number_stem("EHIRE", "NGH", "NUR", "nursing", date(2026, 11, 20))
    assert stem == "EHIRE-NGH-NUR-20261120"
    assert format_request_number(stem, 1) == "EHIRE-NGH-NUR-20261120-01"
    assert format_request_number(stem, 99) == "EHIRE-NGH-NUR-20261120-99"
    assert format_request_number(stem, 100) == "EHIRE-NGH-NUR-20261120-100"  # grows to three digits, never wraps
    assert format_request_number(stem, 1234).endswith("-1234")


def test_number_stem_with_dash_in_directorate_and_no_codes():
    assert number_stem("EHIRE", "T-NIC", None, "medical", date(2026, 1, 5)) == "EHIRE-TNIC-MED-20260105"
    assert number_stem("EHIRE", "", None, None, date(2026, 1, 5)) == "EHIRE-X-OTH-20260105"


def test_the_day_is_the_cyprus_day_not_the_utc_day():
    """Cyprus is UTC+2 in winter and UTC+3 in summer: 22:30 UTC on 20 Nov is already 21 Nov there."""
    from ehire.localtime import load_zone, to_local

    zone = load_zone("Europe/Nicosia")
    before = datetime(2026, 11, 20, 21, 59, tzinfo=timezone.utc)
    after = before + timedelta(minutes=1)
    assert to_local(before).date() == date(2026, 11, 20) and to_local(after).date() == date(2026, 11, 21)
    assert number_stem("E", "A", "BB", None, to_local(before).date()).endswith("20261120")
    assert number_stem("E", "A", "BB", None, to_local(after).date()).endswith("20261121")
    summer = datetime(2026, 7, 1, 20, 59, tzinfo=timezone.utc)  # UTC+3
    assert to_local(summer).date() == date(2026, 7, 1)
    assert to_local(summer + timedelta(minutes=1)).date() == date(2026, 7, 2)
    assert zone is not None and ZoneInfo("Europe/Nicosia") is not None


def test_new_numbers_search_with_or_without_dashes_and_any_case():
    key = normalise_number("EHIRE-NGH-NUR-20261120-01")
    assert key == "EHIRENGHNUR2026112001"
    for typed in ("ngh nur", "20261120", "NGH-NUR-20261120-01", "ehire ngh", "nur-2026"):
        assert normalise_number(typed) in key, typed
