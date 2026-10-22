# -*- coding: utf-8 -*-
"""
The standalone host, exercised the way a hospital would: a real login, a real costing,
and the hospital boundary.

These tests exist because the detachment claim is easy to make and hard to keep. The
module is shared source with eFinance, so what can quietly break is not the costing —
it is the seven things the host supplies. Each test below pins one of them.
"""
import datetime as dt
import importlib
import re
import sys
from pathlib import Path

import pytest
from werkzeug.security import generate_password_hash

sys.path.insert(0, str(Path(__file__).resolve().parent / "standalone"))

import taep                                     # noqa: E402

host = importlib.import_module("host")          # noqa: E402

YESTERDAY = dt.datetime.now() - dt.timedelta(days=1)
PASSWORD = "sygkentrotiko-2026"


@pytest.fixture
def server(tmp_path):
    """A freshly initialised standalone host with one user per role."""
    host.use_database(tmp_path / "taep.db")
    app = host.create_app()
    app.config["TESTING"] = True
    for username, role, hospital in (
            ("maria", "clerk", "NGH"),
            ("andreas", "clerk", "LGH"),
            ("elena", "cashier", "NGH"),
            ("kostas", "rates_admin", "NGH"),
            ("admin", "admin", "HQ")):
        host.db_execute(
            """INSERT INTO host_user
               (username, password_hash, full_name, role, hospital_code, active)
               VALUES (%s,%s,%s,%s,%s,1)""",
            (username, generate_password_hash(PASSWORD), username.title(),
             role, hospital))
    return app


def sign_in(app, username, password=PASSWORD):
    client = app.test_client()
    response = client.post("/login", data={"username": username,
                                           "password": password})
    return client, response


def form_fields(**overrides):
    category = host.db_execute(
        "SELECT id FROM taep_financial_category WHERE code_new='624'",
        fetch=True)[0]["id"]
    fields = {
        "id_type": "Ταυτότητα", "id_number": "1234567", "id_country": "Κύπρος",
        "id_expiry": "2030-01-01",
        "last_name": "Παπαδόπουλος", "first_name": "Ανδρέας",
        "date_of_birth": "1985-04-12", "gender": "Άνδρας", "phone": "99123456",
        "address": "Λεωφ. Μακαρίου 10", "next_of_kin_type": "Σύζυγος",
        "next_of_kin_details": "Μαρία 99654321",
        "taep_unit_code": "NGH-ADULT", "episode_number": "E-9001",
        "admission_at": YESTERDAY.strftime("%Y-%m-%dT%H:%M"),
        "examination_at": (YESTERDAY + dt.timedelta(minutes=30)
                           ).strftime("%Y-%m-%dT%H:%M"),
        "discharge_at": (YESTERDAY + dt.timedelta(hours=2)
                         ).strftime("%Y-%m-%dT%H:%M"),
        "financial_category_id": str(category), "comments": "",
    }
    fields.update(overrides)
    return fields


# ---------------------------------------------------------------------------
# It stands up at all
# ---------------------------------------------------------------------------

def test_the_host_registers_every_screen(server):
    paths = {str(rule) for rule in server.url_map.iter_rules()}
    assert "/taep/nea" in paths and "/taep/list" in paths
    assert "/login" in paths and "/logout" in paths
    assert len([p for p in paths if p.startswith("/taep")]) == 25


def test_the_master_data_is_seeded(server):
    counts = {table: host.db_execute("SELECT COUNT(*) AS c FROM %s" % table,
                                     fetch=True)[0]["c"]
              for table in ("taep_service", "taep_unit", "taep_country",
                            "taep_financial_category", "host_entity")}
    assert counts["taep_service"] == 125
    assert counts["taep_financial_category"] == 38
    assert counts["taep_country"] > 200
    assert counts["host_entity"] == 9
    # Every unit's hospital exists as an entity, or a clerk could log in nowhere.
    orphans = host.db_execute(
        """SELECT u.unit_code FROM taep_unit u
           LEFT JOIN host_entity e ON e.code = u.host_entity_code
           WHERE e.code IS NULL""", fetch=True)
    assert orphans == []


# ---------------------------------------------------------------------------
# login_required, has_permission
# ---------------------------------------------------------------------------

def test_without_a_session_every_screen_sends_you_to_the_login(server):
    anonymous = server.test_client()
    for path in ("/taep/nea", "/taep/list", "/taep/1", "/taep/rates"):
        response = anonymous.get(path)
        assert response.status_code == 302
        assert "/login" in response.headers["Location"], path


def test_a_wrong_password_says_the_same_thing_as_a_wrong_username(server):
    _, wrong_password = sign_in(server, "maria", "not-the-password")
    _, no_such_user = sign_in(server, "oudeis")
    assert wrong_password.status_code == no_such_user.status_code == 200
    assert "Λάθος όνομα χρήστη ή κωδικός" in wrong_password.get_data(as_text=True)
    assert (wrong_password.get_data(as_text=True)
            == no_such_user.get_data(as_text=True))


def test_a_disabled_account_cannot_sign_in(server):
    host.db_execute("UPDATE host_user SET active=0 WHERE username='maria'")
    _, response = sign_in(server, "maria")
    assert response.status_code == 200


def test_a_cashier_may_look_but_not_enter(server):
    client, response = sign_in(server, "elena")
    assert response.status_code == 302
    assert client.get("/taep/list").status_code == 200
    # permission_required redirects with a flash, as eFinance's does, and the host's
    # home sends a cashier on to the list rather than back to the entry screen.
    refused = client.get("/taep/nea")
    assert refused.status_code == 302
    assert refused.headers["Location"] == "/"
    assert client.get("/", follow_redirects=True).request.path == "/taep/list"


def test_only_the_rates_admin_reaches_the_tariff(server):
    clerk, _ = sign_in(server, "maria")
    assert clerk.get("/taep/rates").status_code == 302
    rates_admin, _ = sign_in(server, "kostas")
    assert rates_admin.get("/taep/rates").status_code == 200


def test_logging_out_closes_the_session(server):
    client, _ = sign_in(server, "maria")
    assert client.get("/taep/list").status_code == 200
    client.get("/logout")
    assert "/login" in client.get("/taep/list").headers["Location"]


# ---------------------------------------------------------------------------
# user_entity, can_access_entity — the boundary
# ---------------------------------------------------------------------------

def test_a_limassol_clerk_cannot_open_a_nicosia_episode(server):
    nicosia, _ = sign_in(server, "maria")
    episode_id = int(re.search(
        r"/taep/(\d+)",
        nicosia.post("/taep/nea", data=form_fields()).headers["Location"]).group(1))

    limassol, _ = sign_in(server, "andreas")
    assert limassol.get("/taep/%d" % episode_id).status_code == 404
    assert "E-9001" not in limassol.get("/taep/list").get_data(as_text=True)


def test_the_central_role_reaches_any_episode_but_the_list_stays_local(server):
    """The asymmetry eFinance already has, kept rather than quietly fixed.

    `can_access_entity` is unconditionally true for a central role, so HQ can open any
    hospital's costing by id or by number. `/taep/list` still filters on the one code in
    `user_entity()`, so HQ's own list is empty. Documented in
    docs/note-to-efinance-agent-entity-scoping.md §2; if it changes it must change in
    eFinance first, not here.
    """
    nicosia, _ = sign_in(server, "maria")
    episode_id = int(re.search(
        r"/taep/(\d+)",
        nicosia.post("/taep/nea", data=form_fields()).headers["Location"]).group(1))

    central, _ = sign_in(server, "admin")
    assert central.get("/taep/%d" % episode_id).status_code == 200
    assert "E-9001" not in central.get("/taep/list").get_data(as_text=True)


# ---------------------------------------------------------------------------
# db_execute, log_activity — a whole costing
# ---------------------------------------------------------------------------

def test_a_costing_runs_end_to_end_and_prints(server):
    client, _ = sign_in(server, "maria")
    location = client.post("/taep/nea", data=form_fields()).headers["Location"]
    episode_id = int(re.search(r"/taep/(\d+)", location).group(1))

    # One investigation and one treatment: the algorithm refuses a treatment on its own.
    codes = [host.db_execute(
        "SELECT code FROM taep_service WHERE service_type=%s AND active=1"
        " ORDER BY code LIMIT 1", (kind,), fetch=True)[0]["code"]
        for kind in ("INVESTIGATION", "TREATMENT")]
    assert client.post("/taep/%d/services" % episode_id,
                       data={"service_code": codes}).status_code == 302
    assert client.post("/taep/%d/calculate" % episode_id).status_code == 302

    result = host.db_execute(
        "SELECT * FROM taep_costing_result WHERE episode_id=%s",
        (episode_id,), fetch=True)[0]
    assert result["total_cost"] > 0

    assert client.post("/taep/%d/finalise" % episode_id).status_code == 302
    episode = host.db_execute("SELECT * FROM taep_episode WHERE id=%s",
                              (episode_id,), fetch=True)[0]
    assert episode["status"] == "FINALISED"
    assert episode["costing_number"]

    printed = client.get("/taep/%d/print" % episode_id)
    assert printed.status_code == 200
    assert printed.data[:4] == b"%PDF"

    # log_activity is the host's, and the audit trail is the only record of who
    # finalised a price.
    actions = {row["action"] for row in host.db_execute(
        "SELECT action FROM host_activity", fetch=True)}
    assert {"LOGIN"} <= actions
    assert len(actions) > 1


def test_the_costing_number_is_unique_across_hospitals(server):
    numbers = []
    for user, unit, number in (("maria", "NGH-ADULT", "E-1"),
                               ("andreas", "LGH", "E-2")):
        client, _ = sign_in(server, user)
        location = client.post("/taep/nea", data=form_fields(
            taep_unit_code=unit, episode_number=number)).headers["Location"]
        episode_id = int(re.search(r"/taep/(\d+)", location).group(1))
        client.post("/taep/%d/calculate" % episode_id)
        client.post("/taep/%d/finalise" % episode_id)
        numbers.append(host.db_execute(
            "SELECT costing_number FROM taep_episode WHERE id=%s",
            (episode_id,), fetch=True)[0]["costing_number"])

    assert all(numbers) and len(set(numbers)) == 2
    # Each number carries its own unit's ΟΑΥ ΤΑΕΠ code, so the two sequences are
    # genuinely separate rather than merely happening to differ.
    assert "1054" in numbers[0] and "1047" in numbers[1]


# ---------------------------------------------------------------------------
# The two hosts must not drift
# ---------------------------------------------------------------------------

def test_the_host_supplies_every_key_the_module_asks_for(server):
    missing = [key for key in taep.REQUIRED_CTX_KEYS if key not in host.ctx]
    assert missing == []


def test_the_admin_role_carries_every_permission(server):
    assert set(host.ROLE_PERMISSIONS["admin"]) == set(taep.PERMISSIONS.values())
