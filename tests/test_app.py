import ast
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1] / "ehr"


def test_health(client):
    assert client.get("/healthz").get_json() == {"status": "ok"}


def test_home_is_greek_by_default_and_switches_to_english(client):
    assert "Έγκριση Θέσεων" in client.get("/").get_data(as_text=True)
    assert "Position Approval" in client.get("/?lang=en").get_data(as_text=True)
    # the choice is remembered
    assert "Position Approval" in client.get("/").get_data(as_text=True)


def test_el_and_en_have_the_same_keys():
    el = json.loads((ROOT / "i18n/el.json").read_text(encoding="utf-8"))
    en = json.loads((ROOT / "i18n/en.json").read_text(encoding="utf-8"))
    assert set(el) == set(en)


def test_no_outside_urls_in_templates_or_css():
    for path in list((ROOT / "templates").rglob("*.html")) + list((ROOT / "static/css").rglob("*.css")):
        text = path.read_text(encoding="utf-8")
        assert "http://" not in text and "https://" not in text, path


def test_no_greek_literals_in_templates_or_python():
    def has_greek(s):
        return any("Ͱ" <= ch <= "Ͽ" or "ἀ" <= ch <= "῿" for ch in s)

    allowed = {"base.html"}  # the language switch shows each language's own name
    for path in (ROOT / "templates").rglob("*.html"):
        if path.name not in allowed:
            assert not has_greek(path.read_text(encoding="utf-8")), path
    for path in ROOT.rglob("*.py"):
        assert not has_greek(path.read_text(encoding="utf-8")), path


def test_workflow_package_is_pure():
    banned = {"flask", "sqlalchemy", "flask_sqlalchemy", "requests", "smtplib", "os", "socket"}
    for path in (ROOT / "workflow").rglob("*.py"):
        for node in ast.walk(ast.parse(path.read_text(encoding="utf-8"))):
            names = []
            if isinstance(node, ast.Import):
                names = [a.name for a in node.names]
            elif isinstance(node, ast.ImportFrom):
                names = [node.module or ""]
            for name in names:
                assert name.split(".")[0] not in banned, f"{path}: {name}"
                assert not name.startswith("ehr.extensions"), f"{path}: {name}"
