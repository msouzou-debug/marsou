from ehr.workflow.numbering import format_number, normalise_number


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
