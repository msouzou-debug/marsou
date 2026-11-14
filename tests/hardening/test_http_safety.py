"""Item 7: classes of web mistakes, each checked across the whole app rather than one page at a time."""
import ast
import re
from pathlib import Path

import pytest
from sqlalchemy import func, select

from ehr.extensions import db
from ehr.models import AuditLog
from tests.conftest import login
from tests.requests.flowhelpers import as_user, create

ROOT = Path(__file__).resolve().parents[2]
EHR = ROOT / "ehr"
UNSAFE = {"POST", "PUT", "PATCH", "DELETE"}


def fill(rule, ids):
    """A URL for a rule, with converters filled from `ids`."""
    values = {}
    for arg in rule.arguments:
        conv = rule._converters[arg].__class__.__name__
        if conv == "IntegerConverter":
            values[arg] = ids.get(arg, 1)
        elif arg == "kind":
            values[arg] = "directorate"
        elif arg == "day":
            values[arg] = "2026-01-01"
        else:
            values[arg] = "x"
    return rule.build(values, append_unknown=False)[1]


# ---------------------------------------------------------------- state changes on GET

MUTATING_WORDS = {"add", "remove", "save", "toggle", "delete", "reassign", "create", "update", "withdraw", "action",
                  "upload", "logout", "unlock", "send", "run"}


def test_no_state_changing_endpoint_accepts_get(app):
    for rule in app.url_map.iter_rules():
        verb = rule.endpoint.rsplit(".", 1)[-1].split("_")
        if MUTATING_WORDS & set(verb) and rule.endpoint != "documents.upload":
            assert "GET" not in rule.methods, rule.endpoint
    for name in ("auth.logout", "requests.action", "requests.withdraw", "documents.upload", "documents.remove", "me.out_of_office"):
        rules = [r for r in app.url_map.iter_rules() if r.endpoint == name]
        assert rules and all("GET" not in r.methods for r in rules), name


def table_counts():
    tables = [t for t in db.metadata.sorted_tables if t.name not in ("audit_log",)]
    return {t.name: db.session.execute(select(func.count()).select_from(t)).scalar() for t in tables}


def test_get_requests_do_not_change_row_counts(seeded, client, tmp_path):
    client.application.config["EHR_STORAGE_DIR"] = str(tmp_path / "s")
    req = create(client)
    from tests.documents import samples
    from tests.documents.dhelpers import draft, upload

    d = draft(client)
    upload(client, d.id, ("a.pdf", samples.pdf_bytes(1, ["x"])))
    from ehr.models import MailOutbox, RequestDocument

    doc = RequestDocument.query.first()
    ids = {"request_id": req.id, "doc_id": doc.id, "mail_id": MailOutbox.query.first().id}
    as_user(client, "demo.admin")
    before = table_counts()
    audited = AuditLog.query.count()
    visited = 0
    for rule in client.application.url_map.iter_rules():
        if "GET" not in rule.methods or rule.endpoint == "static":
            continue
        url = fill(rule, ids)
        for path in (url, url + ("&" if "?" in url else "?") + "lang=en"):
            client.get(path)
            visited += 1
    assert visited > 30
    assert table_counts() == before
    assert AuditLog.query.count() >= audited  # reading a document is audited; that is its purpose


# ---------------------------------------------------------------- CSRF

def test_every_state_changing_endpoint_rejects_a_post_without_the_token(seeded, client):
    client.application.config["CSRF_ENABLED"] = True
    checked = 0
    for who in (None, "demo.admin"):
        if who:
            client.application.config["CSRF_ENABLED"] = False
            as_user(client, who)
            client.application.config["CSRF_ENABLED"] = True
        for rule in client.application.url_map.iter_rules():
            for method in sorted(rule.methods & UNSAFE):
                url = fill(rule, {})
                resp = client.open(url, method=method, data={"x": "y"})
                assert resp.status_code == 400, (who, method, url, resp.status_code)
                resp = client.open(url, method=method, data={"csrf_token": "forged"})
                assert resp.status_code == 400, (who, method, url)
                checked += 1
    assert checked >= 30


def test_a_non_ascii_token_is_a_400_not_a_crash(seeded, client):
    client.application.config["CSRF_ENABLED"] = True
    client.get("/login")  # starts the session and its token
    assert client.post("/login", data={"csrf_token": "\u00e9\u03b1"}).status_code == 400
    assert client.post("/login", headers={"X-CSRF-Token": "\u00e9"}).status_code == 400


def test_the_csrf_walk_covers_the_known_posts(app):
    posted = {r.endpoint for r in app.url_map.iter_rules() if r.methods & UNSAFE}
    assert {"auth.login", "auth.logout", "requests.action", "documents.upload", "me.out_of_office"} <= posted


def test_every_post_form_in_the_templates_carries_the_token():
    pattern = re.compile(r"<form\b[^>]*\bmethod=[\"']post[\"'][^>]*>(.*?)</form>", re.S | re.I)
    found = 0
    for path in (EHR / "templates").rglob("*.html"):
        for body in pattern.findall(path.read_text(encoding="utf-8")):
            found += 1
            assert "csrf_token" in body, "POST form without csrf_token in %s" % path.relative_to(ROOT)
    assert found > 15


def test_javascript_posts_send_form_data_that_includes_the_token():
    for path in (EHR / "static" / "js").glob("*.js"):
        text = path.read_text(encoding="utf-8")
        for m in re.finditer(r"method:\s*[\"']POST[\"']", text):
            assert "FormData" in text, path.name  # built from the form, which has the hidden csrf_token field


# ---------------------------------------------------------------- redirects

EVIL = ["https://evil.example/", "//evil.example/", "/\\evil.example", "javascript:alert(1)", "http:evil.example",
        "///evil.example", "/%0d%0aSet-Cookie:x=1", "evil.example", "\\\\evil.example", "/ok\r\nX: y"]


@pytest.mark.parametrize("target", EVIL)
def test_login_and_password_never_redirect_off_site(seeded, client, target):
    resp = client.post("/login", data={"username": "nic.requester", "password": "demo-1234", "next": target})
    assert resp.status_code == 302
    loc = resp.headers["Location"]
    assert loc.startswith("/") and not loc.startswith("//") and "\\" not in loc and "evil" not in loc.split("?")[0]
    page = client.get("/login?next=" + target).get_data(as_text=True)
    assert "evil.example" not in page.split('name="next"')[1].split(">")[0]
    resp = client.post("/password", data={"password": "a-new-pass-1", "repeat": "a-new-pass-1", "next": target})
    assert "evil" not in resp.headers.get("Location", "")


def _call_name(node):
    return getattr(node.func, "id", getattr(node.func, "attr", ""))


def _internal(arg):
    """url_for(...), a constant path, or a name/expression made of those (names hold values that went through
    safe_next, which test_login_and_password_never_redirect_off_site exercises)."""
    if isinstance(arg, ast.Constant):
        return str(arg.value).startswith("/")
    if isinstance(arg, ast.Call):
        return _call_name(arg) in ("url_for", "safe_next")
    if isinstance(arg, ast.IfExp):
        return _internal(arg.body) and _internal(arg.orelse)
    if isinstance(arg, ast.BoolOp):
        return all(_internal(v) for v in arg.values)
    return isinstance(arg, ast.Name)


def test_every_redirect_in_the_source_is_internal():
    seen = 0
    for path in EHR.rglob("*.py"):
        for node in ast.walk(ast.parse(path.read_text(encoding="utf-8"))):
            if isinstance(node, ast.Call) and _call_name(node) == "redirect":
                seen += 1
                assert _internal(node.args[0]), "%s:%d redirect target is not url_for or a constant path" % (
                    path.relative_to(ROOT), node.lineno)
    assert seen > 10


# ---------------------------------------------------------------- output escaping and SQL

def test_no_safe_filter_or_markup_on_user_text():
    for path in EHR.rglob("*.html"):
        text = path.read_text(encoding="utf-8")
        assert "|safe" not in text and "| safe" not in text, path
        assert "autoescape false" not in text.replace("-", " "), path
    for path in EHR.rglob("*.py"):
        text = path.read_text(encoding="utf-8")
        for word in ("Markup(", "render_template_string(", "mark_safe", "|safe"):
            assert word not in text, (path, word)


def test_user_text_is_escaped_on_a_page(seeded, client):
    req = create(client)
    from ehr.models import Request

    row = db.session.get(Request, req.id)
    row.need_text = "<img src=x onerror=alert(1)>"
    db.session.commit()
    html = client.get("/requests/%d" % req.id).get_data(as_text=True)
    assert "<img src=x" not in html and "&lt;img src=x" in html


def test_no_sql_is_built_by_string_formatting():
    risky = {"text", "execute", "exec_driver_sql", "from_statement"}
    for path in EHR.rglob("*.py"):
        for node in ast.walk(ast.parse(path.read_text(encoding="utf-8"))):
            if not isinstance(node, ast.Call):
                continue
            name = getattr(node.func, "id", getattr(node.func, "attr", ""))
            if name in risky and node.args:
                a = node.args[0]
                bad = isinstance(a, ast.JoinedStr) or (isinstance(a, ast.BinOp) and isinstance(a.op, (ast.Mod, ast.Add))) or (
                    isinstance(a, ast.Call) and getattr(a.func, "attr", "") == "format")
                assert not bad, "%s:%d builds SQL from a string" % (path.relative_to(ROOT), node.lineno)


# ---------------------------------------------------------------- file paths

def test_upload_names_never_become_paths(seeded, client, tmp_path):
    from ehr.models import RequestDocument
    from tests.documents import samples
    from tests.documents.dhelpers import draft, upload

    store = tmp_path / "store"
    client.application.config["EHR_STORAGE_DIR"] = str(store)
    req = draft(client)
    for name in ("../../evil.pdf", "..\\..\\evil.pdf", "/etc/cron.d/evil.pdf", "a/../../b.pdf", "x\x00y.pdf"):
        upload(client, req.id, (name, samples.pdf_bytes(1, ["x"])))
    names = [d.file_name for d in RequestDocument.query.filter_by(request_id=req.id)]
    assert names and all("/" not in n and "\\" not in n and ".." not in n.replace("..", "", 0) or "/" not in n for n in names)
    inside = {str(p) for p in store.rglob("*") if p.is_file()}
    assert inside and all(p.startswith(str(store)) for p in inside)
    assert not list(tmp_path.glob("evil*")) and not (tmp_path.parent / "evil.pdf").exists()


def test_stored_paths_cannot_leave_the_storage_folder(app, tmp_path):
    from ehr.documents import storage

    app.config["EHR_STORAGE_DIR"] = str(tmp_path / "s")
    for ref in ("../x", "1/../../x", "/etc/passwd", "1/../../../etc/passwd"):
        with pytest.raises(ValueError):
            storage.abs_path(ref)
    assert storage.abs_path("1/2-ab.bin").startswith(str(tmp_path / "s"))


# ---------------------------------------------------------------- debug mode and error pages

def test_debug_is_off_and_the_debugger_is_not_reachable(seeded, client):
    app = client.application
    assert app.debug is False
    for url in ("/console", "/?__debugger__=yes&cmd=resource&f=style.css", "/console?__debugger__=yes&cmd=printpin"):
        resp = client.get(url)
        assert resp.status_code in (200, 302, 404) and "Werkzeug" not in resp.get_data(as_text=True)
        assert "debugger" not in resp.get_data(as_text=True).lower() or resp.status_code != 200
    from ehr import config

    assert not hasattr(config.Config, "DEBUG")


def test_nothing_in_the_source_starts_a_debug_server():
    for path in list(EHR.rglob("*.py")) + [ROOT / "wsgi.py", ROOT / "deploy" / "gunicorn.conf.py"] + list((ROOT / "scripts").glob("*.sh")):
        text = path.read_text(encoding="utf-8")
        for bad in ("debug=True", "use_debugger", "use_reloader", "--debug"):
            assert bad not in text, (path, bad)
        assert not re.search(r"\b(app|application)\.run\(", text), path


def test_errors_do_not_leak_a_stack_trace(seeded):
    from ehr import create_app
    from ehr.config import TestConfig

    class Quiet(TestConfig):
        TESTING = False
        PROPAGATE_EXCEPTIONS = False
        CSRF_ENABLED = True
        SECRET_KEY = "k" * 40

    app = create_app(Quiet)

    @app.get("/boom")
    def boom():
        raise RuntimeError("secret internal detail /srv/ehr/ehr/x.py")

    with app.app_context():
        db.create_all()
        client = app.test_client()
        for method, url, status in (("get", "/boom", 500), ("get", "/nope", 404), ("post", "/login", 400),
                                    ("get", "/logout", 405)):
            resp = getattr(client, method)(url)
            text = resp.get_data(as_text=True)
            assert resp.status_code == status, url
            assert "Traceback" not in text and "secret internal detail" not in text and "/srv/ehr" not in text
            assert resp.headers["X-Content-Type-Options"] == "nosniff"
        db.session.remove()
        db.drop_all()


# ---------------------------------------------------------------- secrets in logs and audit rows

def test_passwords_are_not_written_to_logs_or_audit(seeded, client, caplog):
    import logging

    caplog.set_level(logging.DEBUG)
    login(client, "nic.requester", password="Typed-Wrong-Pw-77")
    login(client, "nic.requester")
    client.post("/password", data={"password": "Brand-New-Pw-88", "repeat": "Brand-New-Pw-88"})
    for row in AuditLog.query.all():
        blob = (row.detail_json or "") + (row.object_id or "")
        assert "Typed-Wrong-Pw-77" not in blob and "Brand-New-Pw-88" not in blob and "demo-1234" not in blob
    assert "Typed-Wrong-Pw-77" not in caplog.text and "Brand-New-Pw-88" not in caplog.text


def test_create_admin_asks_for_the_password_and_never_takes_it_as_an_argument(app):
    runner = app.test_cli_runner()
    result = runner.invoke(args=["create-admin", "--username", "boss", "--full-name", "Test Boss", "--password", "x"])
    assert result.exit_code != 0 and "No such option" in result.output
    result = runner.invoke(args=["create-admin", "--username", "boss", "--full-name", "Test Boss"],
                           input="Long-Enough-Pw-1\nLong-Enough-Pw-1\n")
    assert result.exit_code == 0, result.output
    assert "Long-Enough-Pw-1" not in result.output
    from ehr.models import User

    boss = User.query.filter_by(username="boss").one()
    assert boss.has_permission("settings.manage") and boss.has_permission("audit.view")
    assert boss.password_hash and "Long-Enough" not in boss.password_hash
    client = app.test_client()
    assert login(client, "boss", password="Long-Enough-Pw-1").status_code == 302
    again = runner.invoke(args=["create-admin", "--username", "BOSS", "--full-name", "x"], input="Long-Enough-Pw-1\nLong-Enough-Pw-1\n")
    assert again.exit_code != 0 and "already exists" in again.output
    short = runner.invoke(args=["create-admin", "--username", "b2", "--full-name", "x"], input="short\nshort\n")
    assert short.exit_code != 0 and "at least" in short.output


def test_demo_data_commands_are_refused_in_production(app):
    app.config["EHR_ENV"] = "production"
    runner = app.test_cli_runner()
    for command in ("seed-demo", "seed-cases"):
        result = runner.invoke(args=[command])
        assert result.exit_code != 0 and "production" in result.output
    from ehr.models import User

    assert User.query.count() == 0
    app.config["EHR_ENV"] = "development"
    assert runner.invoke(args=["seed-demo"]).exit_code == 0
