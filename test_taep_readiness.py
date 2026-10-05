"""
The go-live readiness check. Each test breaks one thing and confirms it is caught —
a check that only ever passes is worth nothing.
"""
import datetime as dt

import pytest

import taep


def levels(findings, level):
    return [f for f in findings if f["level"] == level]


def test_a_complete_install_is_ready(seeded):
    findings = taep.readiness_report(seeded, dt.date(2026, 6, 1))
    assert findings == [], findings
    assert "Έτοιμο" in taep.readiness_summary(findings)


def test_a_missing_table_is_a_blocker(ctx):
    ctx["db_execute"]("DROP TABLE taep_service")
    findings = taep.readiness_report(ctx)
    assert any(f["check"] == "σχήμα" and "taep_service" in f["detail"]
               for f in levels(findings, "blocker"))


def test_an_unseeded_install_is_a_blocker(ctx):
    """Schema created, seed never run — the most likely rollout mistake."""
    findings = taep.readiness_report(ctx)
    blockers = levels(findings, "blocker")
    assert blockers
    assert any("seed" in f["detail"] for f in blockers)


def test_a_short_service_catalogue_warns(seeded):
    seeded["db_execute"]("DELETE FROM taep_service WHERE code='AET098'")
    findings = taep.readiness_report(seeded, dt.date(2026, 6, 1))
    assert any("taep_service" in f["detail"] and "124" in f["detail"]
               for f in levels(findings, "warning"))


def test_a_tampered_weight_matrix_is_a_blocker(seeded):
    """If the table and the algorithm disagree, every price is in question."""
    seeded["db_execute"](
        "UPDATE taep_weight_matrix SET weight=99 WHERE investigation_category=1 "
        "AND treatment_category=1")
    findings = taep.readiness_report(seeded, dt.date(2026, 6, 1))
    assert any(f["check"] == "αλγόριθμος" for f in levels(findings, "blocker"))


def test_a_missing_weight_amount_is_a_blocker(seeded):
    seeded["db_execute"]("DELETE FROM taep_rate WHERE rate_type='WEIGHT_AMOUNT' "
                         "AND weight=8")
    findings = taep.readiness_report(seeded, dt.date(2026, 6, 1))
    assert any(f["check"] == "τιμές" and "8" in f["detail"]
               for f in levels(findings, "blocker"))


def test_an_unconfirmed_registration_fee_is_a_blocker(seeded):
    """The condition the Μονάδα spent four rounds clearing. If it comes back, the
    costings for those categories block, and the rollout must know before go-live."""
    category = seeded["db_execute"](
        "SELECT id FROM taep_financial_category WHERE code_new='624'",
        fetch=True)[0]["id"]
    seeded["db_execute"]("DELETE FROM taep_rate WHERE rate_type='REGISTRATION_FEE' "
                         "AND financial_category_id=%s", (category,))
    findings = taep.readiness_report(seeded, dt.date(2026, 6, 1))
    assert any(f["check"] == "τέλη εγγραφής" and "624" in f["detail"]
               for f in levels(findings, "blocker"))


def test_overlapping_rate_periods_are_a_blocker(seeded):
    seeded["db_execute"](
        """INSERT INTO taep_rate (rate_type, weight, amount, valid_from,
           source_document, series_key)
           VALUES ('WEIGHT_AMOUNT', 4, '99.00', '2026-06-01', 'χειρ.', 'manual')""")
    findings = taep.readiness_report(seeded, dt.date(2026, 6, 1))
    assert any(f["check"] == "επικάλυψη τιμών" for f in levels(findings, "blocker"))


def test_two_units_sharing_a_number_is_a_blocker(seeded):
    seeded["db_execute"]("UPDATE taep_unit SET taep_number='1054' "
                         "WHERE unit_code='NIC-PAED'")
    findings = taep.readiness_report(seeded, dt.date(2026, 6, 1))
    assert any(f["check"] == "μονάδες ΤΑΕΠ" and "ίδιο κωδικό" in f["detail"]
               for f in levels(findings, "blocker"))


def test_a_unit_with_no_number_is_a_blocker(seeded):
    seeded["db_execute"]("UPDATE taep_unit SET taep_number='' WHERE unit_code='LIM'")
    findings = taep.readiness_report(seeded, dt.date(2026, 6, 1))
    assert any("LIM" in f["detail"] for f in levels(findings, "blocker"))


def test_a_unit_not_hosted_on_the_date_warns(seeded):
    """After the paediatric relocation, checking an early date must flag it rather
    than silently returning nothing."""
    seeded["db_execute"]("UPDATE taep_unit SET host_valid_from='2027-01-01' "
                         "WHERE unit_code='NIC-PAED'")
    findings = taep.readiness_report(seeded, dt.date(2026, 6, 1))
    assert any("NIC-PAED" in f["detail"] for f in levels(findings, "warning"))


def test_an_unresolved_tariff_row_warns(seeded):
    seeded["db_execute"]("UPDATE taep_tariff SET load_status='UNPARSED' "
                         "WHERE code='SHSO-ER11'")
    findings = taep.readiness_report(seeded, dt.date(2026, 6, 1))
    assert any(f["check"] == "τιμοκατάλογος" and "SHSO-ER11" in f["detail"]
               for f in levels(findings, "warning"))


def test_a_gap_in_a_number_sequence_is_a_blocker(seeded):
    for _ in range(3):
        taep.allocate_costing_number(seeded, "LIM")
    seeded["db_execute"]("DELETE FROM taep_costing_number WHERE unit_code='LIM' "
                         "AND sequence_number=2")
    findings = taep.readiness_report(seeded, dt.date(2026, 6, 1))
    assert any(f["check"] == "αριθμοί κοστολόγησης" and "LIM" in f["detail"]
               for f in levels(findings, "blocker"))


def test_a_finalised_episode_without_a_number_is_a_blocker(seeded):
    import test_taep_episode as episodes
    episode_id = episodes.make_episode(seeded)
    result = episodes.price(seeded, episode_id, ["AED008", "AET057"])
    taep.finalise_episode(seeded, episode_id, result, user_id=1)
    seeded["db_execute"]("UPDATE taep_episode SET costing_number=NULL WHERE id=%s",
                         (episode_id,))
    findings = taep.readiness_report(seeded, dt.date(2026, 6, 1))
    assert any(f["check"] == "ακεραιότητα" and "χωρίς αριθμό" in f["detail"]
               for f in levels(findings, "blocker"))


def test_a_draft_holding_a_number_is_a_blocker(seeded):
    import test_taep_episode as episodes
    episode_id = episodes.make_episode(seeded)
    seeded["db_execute"](
        "UPDATE taep_episode SET costing_number='OKY1054/0099' WHERE id=%s",
        (episode_id,))
    findings = taep.readiness_report(seeded, dt.date(2026, 6, 1))
    assert any("με αριθμό" in f["detail"] for f in levels(findings, "blocker"))


def test_the_summary_distinguishes_ready_from_not(seeded):
    assert taep.readiness_summary([]) == "Έτοιμο για παραγωγική λειτουργία."
    assert "Δεν είναι έτοιμο" in taep.readiness_summary(
        [{"level": "blocker", "check": "x", "detail": "y"}])
    assert "Έτοιμο με" in taep.readiness_summary(
        [{"level": "warning", "check": "x", "detail": "y"}])


# ---------------------------------------------------------------------------
# The screen
# ---------------------------------------------------------------------------

def test_the_readiness_screen_needs_the_admin_permission(app):
    app.ctx["granted_permissions"].add(taep.PERMISSIONS["create"])
    client = app.test_client()
    with client.session_transaction() as sess:
        sess["user_id"] = 1
    assert client.get("/taep/readiness").status_code == 403


def test_the_readiness_screen_reports_a_clean_install(app):
    client = app.test_client()
    with client.session_transaction() as sess:
        sess["user_id"] = 1
    page = client.get("/taep/readiness").get_data(as_text=True)
    assert "Έτοιμο για παραγωγική λειτουργία" in page
    assert "Όλοι οι έλεγχοι πέρασαν" in page


def test_the_readiness_screen_lists_blockers(app):
    app.ctx["db_execute"](
        "UPDATE taep_weight_matrix SET weight=99 WHERE investigation_category=1 "
        "AND treatment_category=1")
    client = app.test_client()
    with client.session_transaction() as sess:
        sess["user_id"] = 1
    page = client.get("/taep/readiness").get_data(as_text=True)
    assert "Δεν είναι έτοιμο" in page
    assert "Εμπόδια" in page
    assert "διαφέρει από τον αλγόριθμο" in page
