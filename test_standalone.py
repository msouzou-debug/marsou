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
import taep_harness                             # noqa: E402

host = importlib.import_module("host")          # noqa: E402

YESTERDAY = dt.datetime.now() - dt.timedelta(days=1)
PASSWORD = "sygkentrotiko-2026"


@pytest.fixture
def server(tmp_path):
    """A freshly initialised standalone host with one user per role."""
    host.use_database(tmp_path / "taep.db")
    app = host.create_app()
    app.config["TESTING"] = True
    if not host.db_execute("SELECT code FROM taep_diagnosis LIMIT 1", fetch=True):
        taep._insert_many(
            host.db_execute, "taep_diagnosis",
            ["code", "description_el", "description_en", "search_text", "active"],
            [(code, greek, english,
              taep.fold_greek(" ".join((code, greek, english))), 1)
             for code, greek, english in taep_harness.STAND_IN_DIAGNOSES])
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
        # Mandatory to finalise since 26/10/2026 (Μονάδα Ελέγχου Εσόδων). Asked of
        # the harness rather than named here, so the suite also runs on a clone
        # without the catalogue — see taep_harness.STAND_IN_DIAGNOSES.
        "diagnosis_code": taep_harness.sample_diagnosis(
            {"db_execute": host.db_execute}),
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
    assert len([p for p in paths if p.startswith("/taep")]) == 27


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


def test_the_standalone_base_defines_every_class_bootstrap_does_not():
    """eFinance's app.css supplies these inside eFinance; nothing supplies them here
    except base.html, and the standalone server has no second stylesheet to fall back
    on. Reported by the eFinance agent, 22/10/2026, about `.num` — which the redesign
    had already removed, but four of its neighbours were real.
    """
    import re
    root = Path(__file__).resolve().parent
    used, scripted = set(), set()
    for template in (root / "templates").glob("taep_*.html"):
        source = template.read_text(encoding="utf-8")
        for attribute in re.findall(r'class="([^"]*)"', source):
            # Drop the Jinja expressions; only literal class names are styled.
            attribute = re.sub(r"{{.*?}}|{%.*?%}", " ", attribute)
            used.update(attribute.split())
        # A class the page's own JavaScript looks up is a behaviour hook, not a style:
        # `.tariff-code` exists so a change handler can find the select, and no
        # stylesheet should have an opinion about it. Only classes nobody scripts have
        # to be defined in base.html.
        for script in re.findall(r"<script\b.*?</script>", source, re.S):
            scripted.update(re.findall(r'[.#"\']([a-z][a-z0-9-]*)', script))

    base = (root / "standalone" / "templates" / "base.html").read_text(encoding="utf-8")
    bootstrap = re.compile(
        r"^(bi|bi-|container|row|col|d-|flex-|align-|justify-|gap-|g-|gx-|gy-|"
        r"m[tbserxy]?-|p[tbserxy]?-|w-|h-|text-|fw-|fs-|lh-|fst-|small|lead|"
        r"table|thead|tbody|btn|form-|input-|select|card|alert|badge|bg-|border|"
        r"rounded|shadow|nav|navbar|dropdown|modal|list-|progress|position-|"
        r"visually-|float-|opacity-|sticky-|accordion|collapse|font-monospace|"
        r"active|disabled|is-|invalid|valid|ratio|vstack|hstack|clearfix|"
        r"user-select-|overflow-)")
    custom = {name for name in used
              if not bootstrap.match(name) and re.fullmatch(r"[a-z][a-z0-9-]*", name)}

    # Two class names are built from a Jinja expression, so stripping it leaves a stem:
    # `status-{{ episode.status|lower }}` on a row in the list, and
    # `fee-{{ row.fee_state|lower }}` on a row in the rates overview. Nothing in either
    # host styles them — the list already shows status as a coloured badge — so they are
    # row hooks with no rules, kept rather than removed because eFinance's own app.css
    # is not visible from here and may tint those rows. Listed explicitly so a third one
    # is a failure rather than a silent exemption.
    dynamic = {name for name in custom if name.endswith("-")}
    assert dynamic == {"status-", "fee-"}, sorted(dynamic)

    styled = custom - dynamic - scripted
    missing = sorted(name for name in styled if ".%s" % name not in base)
    assert missing == [], missing
    # The guard is worthless if it is matching nothing, and worthless again if the
    # script exemption has swallowed the classes it exists to check.
    assert {"number", "totals", "stat-card"} <= styled
    assert "tariff-code" in scripted


def test_every_template_string_has_english():
    """Run the translations build and require a clean exit.

    This exists because I piped its output to `tail` twice and missed the MISSING block
    both times, and «Επιστροφή στον ασθενή μετά την προκαταβολή» shipped untranslated as
    a result. A tool whose warnings depend on somebody reading them is a tool whose
    warnings get missed; the suite reads them now.
    """
    import subprocess
    import sys
    root = Path(__file__).resolve().parent
    finished = subprocess.run(
        [sys.executable, str(root / "tools" / "build_translations.py")],
        capture_output=True, text=True, cwd=str(root))
    assert finished.returncode == 0, finished.stdout + finished.stderr


def test_every_table_scrolls_inside_its_own_box():
    """An unwrapped <table> does not scroll itself — it drags the whole page sideways,
    and on a phone nothing on that screen is readable.

    eFinance's own suite catches this and caught my «Προηγούμενες εκδόσεις» table on
    23/10/2026, after the other two tables in the same file already had the wrapper.
    Their test should not be the one that finds mine.
    """
    import re
    root = Path(__file__).resolve().parent
    unwrapped = []
    for template in sorted((root / "templates").glob("taep_*.html")):
        lines = template.read_text(encoding="utf-8").splitlines()
        for index, line in enumerate(lines):
            if "<table" not in line:
                continue
            preceding = "\n".join(lines[max(0, index - 6):index])
            if "table-responsive" not in preceding:
                unwrapped.append("%s:%d" % (template.name, index + 1))
    assert unwrapped == [], unwrapped
    # Worthless if it is finding no tables at all.
    assert sum("<table" in line
               for template in (root / "templates").glob("taep_*.html")
               for line in template.read_text(encoding="utf-8").splitlines()) >= 10


def test_an_english_screen_turns_the_status_and_the_dropdowns(client, app):
    """The status and the identification and sex labels used to stay Greek in English.

    Reported by the eFinance session, 29/10/2026: seven words on ΤΑΕΠ screens had no
    English. The cause was not a missing entry in en.json but the way they are printed.
    Everything else goes through t('literal'); these go through a Jinja filter
    (episode.status | status_el) or a loop variable, which t() never saw, so
    build_translations.py could not find them either and nobody noticed.

    The templates now call t() on the result. This test renders two screens with the
    real dictionary in place of the harness identity t, and also checks the option
    *value* is untouched — the column holds the Greek word and must keep holding it.
    """
    import json
    import re as _re

    root = Path(__file__).resolve().parent
    english = json.loads((root / "docs" / "taep-translations-en.json")
                         .read_text(encoding="utf-8"))
    app.jinja_env.globals["t"] = lambda s: english.get(s, s)

    entry = client.get("/taep/nea").get_data(as_text=True)
    assert "Passport" in entry and "Alien Registration Certificate" in entry
    assert "Male" in entry and "Female" in entry
    # The stored value, not the label.
    assert 'value="Διαβατήριο"' in entry and 'value="Άρρεν"' in entry

    import test_taep_routes as routes
    episode_id = routes.create(client, app)
    costing = client.get("/taep/%d" % episode_id).get_data(as_text=True)
    assert "Draft" in costing
    assert not _re.search(r">\s*Πρόχειρο\s*<", costing)


def test_no_inline_script_reaches_for_jquery_while_the_page_is_parsing():
    """eFinance loads jQuery and Select2 at the foot of its <body>.

    Our scripts are inline in the content block, which renders above that. An
    immediately-invoked function there runs while jQuery is still undefined, so a
    `if (!window.jQuery) return;` guard does not protect anything — it just gives up
    silently, every time, in production only.

    That is what killed the ICD-10 box (reported 30/10/2026), and the same pattern had
    been quietly costing the costing screen its service search since 21/10: those
    pickers degrade to plain dropdowns, which work well enough that nobody reported
    them. Checked here because neither failure can be seen from Python — the templates
    render identically either way, and no test that renders HTML would have caught it.

    The rule: a script block that touches jQuery runs from taepReady(), never from an
    IIFE.
    """
    import re
    root = Path(__file__).resolve().parent
    offenders = []
    for path in sorted((root / "templates").glob("taep_*.html")):
        for block in re.findall(r"<script>(.*?)</script>",
                                path.read_text(encoding="utf-8"), re.S):
            if "jQuery" not in block:
                continue
            if "taepReady(" not in block:
                offenders.append("%s: touches jQuery without taepReady()" % path.name)
            if "})();" in block or "}());" in block:
                offenders.append("%s: immediately-invoked block touches jQuery"
                                 % path.name)
    assert not offenders, "\n".join(offenders)


def test_every_select2_we_build_is_detached_from_efinance_s_own_initialiser():
    """base.html runs `$('.select2').select2()` of its own on ready.

    Select2 marks the wrapper it builds with the legacy class `select2`. If eFinance's
    pass finds one of ours it treats the wrapper as a <select> to replace: it hides the
    real box with select2-hidden-accessible — 1px, clipped — and puts an empty container
    built from a <span> where it was. Clicking that does nothing.

    That is what was still wrong with the ICD-10 box after the load-order fix on
    30/10/2026, and it was only visible in a browser: the wrapper is created by Select2
    at runtime, so nothing in the rendered HTML shows it. Reproduced in Chromium against
    a copy of the live base.html — the recipe is in docs/deployment-runbook.md — and the
    rule is pinned here: every select2() call of ours is followed by taepDetach().
    """
    import re
    root = Path(__file__).resolve().parent
    for path in sorted((root / "templates").glob("taep_*.html")):
        text = path.read_text(encoding="utf-8")
        initialisations = len(re.findall(r"\.select2\(\{", text))
        detaches = text.count("taepDetach(")
        if not initialisations:
            continue
        # One definition plus one call per initialisation.
        assert detaches == initialisations + 1, (
            "%s: %d select2() calls but %d taepDetach references"
            % (path.name, initialisations, detaches))


def test_the_service_matcher_looks_inside_the_groups():
    """The service lists are grouped by ΟΑΥ category, and Select2 hands a custom matcher
    the optgroup rather than its options.

    The matcher used to read data.text only, which for a group is its label. So every
    search for a service name returned nothing and «Κατηγορία» returned all 103 —
    the exact opposite of useful. Nobody had reported it because the script had never
    run in the browser at all (see the load-order test above), so this surfaced only
    once that was fixed.

    Checked as structure rather than behaviour: a custom matcher in these templates has
    to handle data.children, and the only honest test of the rest is a browser.
    """
    import re
    root = Path(__file__).resolve().parent
    for path in sorted((root / "templates").glob("taep_*.html")):
        text = path.read_text(encoding="utf-8")
        if "matcher:" not in text:
            continue
        assert "data.children" in text, (
            "%s: a custom Select2 matcher that ignores data.children drops every "
            "grouped option" % path.name)
