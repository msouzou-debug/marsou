# -*- coding: utf-8 -*-
"""
The module starts and serves with no host but a bare Flask app and seven ctx keys.

eFinance used to carry this proof: its harness booted ΤΑΕΠ and served its screens with
eFinance never imported, and that was the argument settled by demonstration. Their
harness has been removed in favour of standalone/host.py, so the boot proof is ours
alone now. These tests are it.

The host here is deliberately *barer* than standalone/host.py: seven ctx keys, a
template folder, and nothing else. No `t`, no `has_permission` in Jinja, no filters. If
the module needs an eighth thing from its host, it fails here.
"""
import ast
import datetime as dt
import re

import pytest
from flask import Flask

import taep
import taep_harness


ALLOWED_IMPORTS = {
    # standard library
    "csv", "dataclasses", "datetime", "decimal", "functools", "hashlib", "io",
    "os", "re", "unicodedata",
    # third party, all of which eFinance already installs
    "flask", "openpyxl", "reportlab",
}

# Every GET screen that renders without an episode. The list-shaped ones are what would
# break if a template global were missing, because they are the ones with the
# permission-gated navigation in them.
GET_SCREENS = ["/taep/nea", "/taep/list", "/taep/rates", "/taep/rates/history",
               "/taep/tariff", "/taep/parallel", "/taep/readiness"]


@pytest.fixture
def bare(seeded, tmp_path):
    """A Flask app with the seven ctx keys and nothing else.

    No Jinja globals, no filters, no base.html of its own beyond an empty shell — so
    anything the templates need from the host, the module has to provide itself.
    """
    templates = tmp_path / "templates"
    templates.mkdir()
    # The one template the module expects from a host, as empty as it can be.
    (templates / "base.html").write_text(
        "<!doctype html><html><body>{% block content %}{% endblock %}</body></html>",
        encoding="utf-8")
    for source in (taep_harness.Path(__file__).parent / "templates").glob("taep_*.html"):
        (templates / source.name).write_text(source.read_text(encoding="utf-8"),
                                             encoding="utf-8")

    app = Flask("bare_host", template_folder=str(templates))
    app.secret_key = "bare"
    app.config["TESTING"] = True

    granted = set(taep.PERMISSIONS.values())

    def login_required(view):
        return view                      # a session is assumed, not checked

    def permission_required(key):
        def decorator(view):
            return view
        return decorator

    ctx = {
        "db_execute": seeded["db_execute"],
        "login_required": login_required,
        "permission_required": permission_required,
        "has_permission": lambda key: key in granted,
        "user_entity": lambda: "NGH",
        "can_access_entity": lambda code: code == "NGH",
        "log_activity": lambda *args, **kwargs: None,
    }
    assert set(ctx) == set(taep.REQUIRED_CTX_KEYS)
    taep.register(app, ctx)
    app.ctx = ctx
    return app


# ---------------------------------------------------------------------------
# It really does boot, and it really does serve
# ---------------------------------------------------------------------------

def test_the_module_registers_against_a_bare_flask_app(bare):
    paths = {str(rule) for rule in bare.url_map.iter_rules()}
    assert len([p for p in paths if p.startswith("/taep")]) == 25


@pytest.mark.parametrize("path", GET_SCREENS)
def test_every_screen_renders_with_nothing_but_the_seven_keys(bare, path):
    """The test that catches a missing template global.

    Counting `ctx[...]` in the source says seven. A page that never renders cannot
    disagree. `{% if has_permission(...) %}` lives inside a statement block, so an
    undefined name there is an UndefinedError at render time and a 500 to the clerk —
    invisible to any amount of grepping. So the screens are fetched, not counted.
    """
    response = bare.test_client().get(path)
    assert response.status_code == 200, response.data[:400]
    body = response.get_data(as_text=True)
    assert "UndefinedError" not in body
    assert "Traceback" not in body


def test_a_costing_screen_renders_and_prints(bare):
    yesterday = dt.datetime.now() - dt.timedelta(days=1)
    category = bare.ctx["db_execute"](
        "SELECT id FROM taep_financial_category WHERE code_new='624'",
        fetch=True)[0]["id"]
    episode_id = taep.save_episode(
        bare.ctx, {**{field: None for field in taep.EPISODE_FIELDS},
                   "id_number": "1234567", "last_name": "Παπαδόπουλος",
                   "examination_at": yesterday, "financial_category_id": category},
        entity_code="NGH", unit_code="NGH-ADULT", user_id=1)
    client = bare.test_client()
    assert client.get("/taep/%d" % episode_id).status_code == 200
    assert client.post("/taep/%d/calculate" % episode_id).status_code == 302
    assert client.post("/taep/%d/finalise" % episode_id).status_code == 302
    printed = client.get("/taep/%d/print" % episode_id)
    assert printed.status_code == 200 and printed.data[:4] == b"%PDF"


# ---------------------------------------------------------------------------
# What the module provides for itself, and what it leaves to its host
# ---------------------------------------------------------------------------

def test_the_module_supplies_its_own_template_globals(bare):
    """Why the count is seven and not eight.

    A host does not have to provide `t` or `has_permission` to Jinja — register() puts
    them there. That is the fix for the 500 a host would otherwise serve, and it lives
    in the module rather than in each host, because otherwise every future host has to
    rediscover it.
    """
    assert "t" in bare.jinja_env.globals
    assert "has_permission" in bare.jinja_env.globals
    assert "eur" in bare.jinja_env.filters
    # No translation table outside eFinance: the Greek is the key.
    assert bare.jinja_env.globals["t"]("Κοστολόγηση") == "Κοστολόγηση"


def test_a_hosts_own_globals_win(seeded, tmp_path):
    """setdefault, not assignment. A module must not replace its host's t()."""
    templates = tmp_path / "templates"
    templates.mkdir()
    (templates / "base.html").write_text("{% block content %}{% endblock %}",
                                         encoding="utf-8")
    app = Flask("host_with_own_t", template_folder=str(templates))
    app.secret_key = "x"
    app.jinja_env.globals["t"] = lambda text: "HOST:" + text
    app.jinja_env.globals["has_permission"] = lambda key: False
    app.jinja_env.filters["eur"] = lambda value: "HOST-EUR"

    taep.register(app, {
        "db_execute": seeded["db_execute"],
        "login_required": lambda view: view,
        "permission_required": lambda key: (lambda view: view),
        "has_permission": lambda key: True,
        "user_entity": lambda: "NGH",
        "can_access_entity": lambda code: True,
        "log_activity": lambda *a, **k: None,
    })
    assert app.jinja_env.globals["t"]("Τιμές") == "HOST:Τιμές"
    assert app.jinja_env.globals["has_permission"]("taep.view") is False
    assert app.jinja_env.filters["eur"](1) == "HOST-EUR"


# ---------------------------------------------------------------------------
# The coupling surface, measured rather than asserted
# ---------------------------------------------------------------------------

def test_the_module_imports_nothing_of_its_hosts():
    tree = ast.parse(open("taep.py", encoding="utf-8").read())
    imported = set()
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            imported.update(alias.name.split(".")[0] for alias in node.names)
        elif isinstance(node, ast.ImportFrom) and node.level == 0 and node.module:
            imported.add(node.module.split(".")[0])
    assert imported <= ALLOWED_IMPORTS, sorted(imported - ALLOWED_IMPORTS)


def test_the_module_reads_no_ctx_key_it_has_not_declared():
    """REQUIRED_CTX_KEYS is the contract, so it must match what the code actually reads.

    A key read but not declared is a host that boots and then fails; a key declared but
    never read is a host asked for something nobody wants.
    """
    source = open("taep.py", encoding="utf-8").read()
    used = set(re.findall(r'ctx(?:\.get)?[\[\(]"([a-z_]+)"', source))
    assert used == set(taep.REQUIRED_CTX_KEYS), {
        "read but not declared": sorted(used - set(taep.REQUIRED_CTX_KEYS)),
        "declared but never read": sorted(set(taep.REQUIRED_CTX_KEYS) - used)}


def test_the_module_extends_exactly_one_template():
    extended = set()
    for path in (taep_harness.Path(__file__).parent / "templates").glob("taep_*.html"):
        extended.update(re.findall(r'{%\s*extends\s+"([^"]+)"',
                                   path.read_text(encoding="utf-8")))
    assert extended == {"base.html"}


def test_the_module_queries_no_table_that_is_not_its_own(seeded):
    """Every table named in the module's SQL starts with taep_, so nothing it runs can
    touch an eFinance table — the host's data is not ours to read."""
    literals = []
    for node in ast.walk(ast.parse(open("taep.py", encoding="utf-8").read())):
        if isinstance(node, ast.Constant) and isinstance(node.value, str):
            literals.append(node.value)
    tables = set()
    for text in literals:
        tables.update(re.findall(
            r'(?:FROM|JOIN|INTO|UPDATE)\s+([a-z_][a-z0-9_]*)', text))
    tables -= {"sqlite_master"}
    assert any(t.startswith("taep_") for t in tables), "found no SQL at all"
    foreign = sorted(t for t in tables if not t.startswith("taep_"))
    assert foreign == [], foreign
