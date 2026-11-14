"""deploy/ehr.env.example lists every environment variable the code reads, and nothing the code does not read."""
import ast
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]


def variables_read():
    found = set()
    files = list((ROOT / "ehr").rglob("*.py")) + [ROOT / "deploy" / "gunicorn.conf.py", ROOT / "wsgi.py"]
    for path in files:
        for node in ast.walk(ast.parse(path.read_text(encoding="utf-8"))):
            if isinstance(node, ast.Call) and node.args and isinstance(node.args[0], ast.Constant) \
                    and isinstance(node.args[0].value, str) and node.args[0].value.startswith("EHR_"):
                f = node.func
                owner = ast.unparse(f.value) if isinstance(f, ast.Attribute) else ""
                name = f.attr if isinstance(f, ast.Attribute) else getattr(f, "id", "")
                if (name in ("get", "getenv") and owner.split(".")[-1] in ("environ", "env", "os")) or name == "_flag":
                    if name == "_flag" or owner.split(".")[-1] in ("environ", "env", "os"):
                        found.add(node.args[0].value)
    return found


def documented():
    text = (ROOT / "deploy" / "ehr.env.example").read_text(encoding="utf-8")
    return set(re.findall(r"^([A-Z][A-Z0-9_]+)=", text, re.M))


def test_every_variable_the_code_reads_is_in_the_example():
    missing = variables_read() - documented()
    assert not missing, "add to deploy/ehr.env.example: %s" % sorted(missing)


def test_the_example_lists_no_unused_variable():
    extra = documented() - variables_read()
    assert not extra, "not read by the code: %s" % sorted(extra)


def test_the_example_holds_no_real_values_and_each_variable_has_a_comment():
    text = (ROOT / "deploy" / "ehr.env.example").read_text(encoding="utf-8")
    lines = text.splitlines()
    for i, line in enumerate(lines):
        if re.match(r"^[A-Z][A-Z0-9_]+=", line):
            assert lines[i - 1].startswith("#"), "no meaning line above %s" % line
    for name in ("EHR_SECRET_KEY", "EHR_DATABASE_URI", "EHR_SMTP_PASSWORD", "EHR_GRAPH_CLIENT_SECRET", "EHR_EFINANCE_TOKEN"):
        assert re.search(r"^%s=$" % name, text, re.M), name + " must be empty in the example"


def test_the_gunicorn_variable_is_found(tmp_path):
    assert "EHR_BIND" in variables_read() and "EHR_SMTP_PORT" in variables_read() and "EHR_ENV" in variables_read()
