"""make-release.sh, verify-release.sh and preflight.sh, run for real in temporary folders."""
import os
import re
import shutil
import socket
import subprocess
import tarfile
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]
SCRIPTS = ROOT / "scripts"


def sh(*args, cwd=None, env=None, check=False):
    return subprocess.run(list(map(str, args)), cwd=cwd, env=env, capture_output=True, text=True, check=check)


@pytest.fixture
def project(tmp_path):
    """A small copy of the project: the real scripts, a stub .venv python that stands for the test suite."""
    proj = tmp_path / "proj"
    for d in ("ehr/templates", "deploy", "docs", "tests", "claude", ".claude", "instance", ".venv/bin", "scripts"):
        (proj / d).mkdir(parents=True)
    for name in ("make-release.sh", "verify-release.sh", "preflight.sh", "ehr-cli.sh", "_env.sh"):
        shutil.copy(SCRIPTS / name, proj / "scripts" / name)
    (proj / "ehr/__init__.py").write_text("x = 1\n")
    (proj / "ehr/templates/a.html").write_text("<p>hi</p>\n")
    (proj / "ehr/__pycache__").mkdir()
    (proj / "ehr/__pycache__/x.cpython-311.pyc").write_bytes(b"junk")
    (proj / "deploy/README.md").write_text("deploy\n")
    (proj / "wsgi.py").write_text("app = None\n")
    (proj / "requirements.txt").write_text("Flask\n")
    (proj / "requirements-dev.txt").write_text("pytest\n")
    (proj / "docs/operations.md").write_text("operations\n")
    (proj / "docs/draft.md").write_text("a draft\n")
    (proj / "tests/test_x.py").write_text("def test_x(): pass\n")
    (proj / "claude/brief.md").write_text("brief\n")
    (proj / "CLAUDE.md").write_text("c\n")
    (proj / "memory.md").write_text("m\n")
    (proj / "instance/ehr.sqlite3").write_bytes(b"db")
    (proj / "local.sqlite3").write_bytes(b"db")
    stub = proj / ".venv/bin/python"
    stub.write_text("#!/bin/sh\nexit ${STUB_EXIT:-0}\n")
    stub.chmod(0o755)
    return proj


def build(project, *args, **env):
    e = dict(os.environ, **env)
    return sh(project / "scripts/make-release.sh", *args, cwd=project, env=e)


def names(tarball):
    with tarfile.open(tarball) as tf:
        return sorted(m.name for m in tf.getmembers() if m.isfile())


def test_release_holds_source_only_and_checksums_every_file(project):
    r = build(project, "v1")
    assert r.returncode == 0, r.stderr
    tarball = project / "dist/ehr-v1.tar.gz"
    assert tarball.exists() and (project / "dist/ehr-v1.tar.gz.sha256").exists()
    got = names(tarball)
    top = "ehr-v1/"
    rel = {n[len(top):] for n in got}
    assert {"ehr/__init__.py", "ehr/templates/a.html", "deploy/README.md", "wsgi.py", "requirements.txt",
            "docs/operations.md", "scripts/preflight.sh", "SHA256SUMS", "RELEASE-INFO"} <= rel
    for bad in ("tests/test_x.py", "docs/draft.md", "claude/brief.md", "CLAUDE.md", "memory.md", "requirements-dev.txt",
                "instance/ehr.sqlite3", "local.sqlite3", ".venv/bin/python", "ehr/__pycache__/x.cpython-311.pyc"):
        assert bad not in rel, bad
    with tarfile.open(tarball) as tf:
        sums = tf.extractfile(top + "SHA256SUMS").read().decode().splitlines()
        info = tf.extractfile(top + "RELEASE-INFO").read().decode()
    listed = {line.split("  ", 1)[1][2:] for line in sums}
    assert listed == rel - {"SHA256SUMS"}  # every file, and the list is not in itself
    assert "tests: passed" in info and "version: v1" in info
    assert (project / "dist/ehr-v1.tar.gz.sha256").read_text().split()[1] == "ehr-v1.tar.gz"


def test_a_failing_test_suite_builds_no_release(project):
    r = build(project, "v2", STUB_EXIT="1")
    assert r.returncode != 0 and "test suite failed" in r.stderr
    assert not list((project / "dist").glob("*")) if (project / "dist").exists() else True


def test_skip_tests_is_recorded_and_the_release_is_refused(project):
    assert build(project, "--skip-tests", "v3").returncode == 0
    r = sh(project / "scripts/verify-release.sh", project / "dist/ehr-v3.tar.gz")
    assert r.returncode != 0 and "tests skipped" in r.stderr


def test_bad_version_names_are_refused(project):
    assert build(project, "../evil").returncode != 0


def test_verify_accepts_a_good_release_and_prints_its_info(project):
    build(project, "v4")
    r = sh(project / "scripts/verify-release.sh", project / "dist/ehr-v4.tar.gz")
    assert r.returncode == 0, r.stderr
    assert "tarball checksum matches" in r.stdout and "tests: passed" in r.stdout


def test_verify_rejects_a_changed_tarball_and_a_missing_checksum(project):
    build(project, "v5")
    tarball = project / "dist/ehr-v5.tar.gz"
    with open(tarball, "ab") as fh:
        fh.write(b"x")
    assert sh(project / "scripts/verify-release.sh", tarball).returncode != 0
    build(project, "v6")
    (project / "dist/ehr-v6.tar.gz.sha256").unlink()
    r = sh(project / "scripts/verify-release.sh", project / "dist/ehr-v6.tar.gz")
    assert r.returncode != 0 and "sha256" in r.stderr
    assert sh(project / "scripts/verify-release.sh", project / "dist/missing.tar.gz").returncode != 0


def repack(project, tarball, edit):
    """Unpack, change something, pack again, and write a fresh outer checksum: an insider who fixes the outer sum."""
    work = project / "repack"
    shutil.rmtree(work, ignore_errors=True)
    work.mkdir()
    with tarfile.open(tarball) as tf:
        tf.extractall(work)
    top = next(work.iterdir())
    edit(top)
    out = project / "dist" / "ehr-edited.tar.gz"
    with tarfile.open(out, "w:gz") as tf:
        tf.add(top, arcname=top.name)
    (project / "dist/ehr-edited.tar.gz.sha256").write_text(
        subprocess.run(["sha256sum", out.name], cwd=out.parent, capture_output=True, text=True).stdout)
    return out


def test_verify_rejects_a_file_changed_inside_even_with_a_fresh_outer_checksum(project):
    build(project, "v7")
    out = repack(project, project / "dist/ehr-v7.tar.gz", lambda top: (top / "wsgi.py").write_text("app = 'evil'\n"))
    r = sh(project / "scripts/verify-release.sh", out)
    assert r.returncode != 0 and "missing or changed" in r.stderr


def test_verify_rejects_an_unlisted_extra_file_and_a_removed_file(project):
    build(project, "v8")
    out = repack(project, project / "dist/ehr-v8.tar.gz", lambda top: (top / "ehr/backdoor.py").write_text("x\n"))
    r = sh(project / "scripts/verify-release.sh", out)
    assert r.returncode != 0 and "backdoor.py" in r.stderr
    out = repack(project, project / "dist/ehr-v8.tar.gz", lambda top: (top / "wsgi.py").unlink())
    assert sh(project / "scripts/verify-release.sh", out).returncode != 0


def test_verify_dir_mode_checks_installed_files_and_ignores_extras(project, tmp_path):
    build(project, "v9")
    inst = tmp_path / "inst"
    inst.mkdir()
    with tarfile.open(project / "dist/ehr-v9.tar.gz") as tf:
        tf.extractall(inst)
    folder = inst / "ehr-v9"
    assert sh(project / "scripts/verify-release.sh", "--dir", folder).returncode == 0
    (folder / ".venv").mkdir()
    (folder / ".venv/x").write_text("extra")
    assert sh(project / "scripts/verify-release.sh", "--dir", folder).returncode == 0
    (folder / "wsgi.py").write_text("changed\n")
    assert sh(project / "scripts/verify-release.sh", "--dir", folder).returncode != 0


def test_two_builds_of_the_same_tree_have_the_same_file_list(project):
    build(project, "a1")
    build(project, "a2")
    strip = lambda p: [n.split("/", 1)[1] for n in names(p)]
    assert strip(project / "dist/ehr-a1.tar.gz") == strip(project / "dist/ehr-a2.tar.gz")


def test_scripts_use_strict_mode_and_no_sudo_or_network_tools():
    for path in SCRIPTS.glob("*.sh"):
        text = path.read_text()
        if path.name in ("_env.sh", "test.sh"):
            continue
        assert "set -euo pipefail" in text, path.name
        body = "\n".join(l for l in text.splitlines() if not l.lstrip().startswith("#"))
        command = re.compile(r"(^|[;&|(]\s*|\$\(\s*)(sudo|su|systemctl|service|curl|wget|ssh|scp|nc|pip3?)\s", re.M)
        assert not command.search(body), (path.name, command.search(body).group(0))


# ---------------------------------------------------------------- preflight

def env_file(tmp_path, **values):
    base = {"EHR_ENV": "production", "EHR_SECRET_KEY": "s" * 48, "EHR_DATABASE_URI": "postgresql://u@h/d",
            "EHR_BASE_URL": "https://ehr.example.invalid", "EHR_HTTPS": "true",
            "EHR_STORAGE_DIR": str(tmp_path / "storage"), "EHR_BIND": "127.0.0.1:%d" % free_port()}
    base.update(values)
    f = tmp_path / "ehr.env"
    f.write_text("# test\n" + "\n".join("%s=%s" % kv for kv in base.items() if kv[1] is not None) + "\n")
    f.chmod(0o640)
    (tmp_path / "storage").mkdir(exist_ok=True)
    return f


def free_port():
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def preflight(env, *extra):
    e = {k: v for k, v in os.environ.items() if not k.startswith("EHR_")}
    return sh(SCRIPTS / "preflight.sh", "--env-file", env, *extra, env=e)


def test_preflight_flags_a_default_or_missing_secret(tmp_path):
    for secret in ("dev-only-change-me", "", "short"):
        r = preflight(env_file(tmp_path, EHR_SECRET_KEY=secret), "--skip-port")
        assert r.returncode != 0 and "FAIL  EHR_SECRET_KEY" in r.stdout, secret


def test_preflight_flags_sqlite_and_non_production(tmp_path):
    r = preflight(env_file(tmp_path, EHR_DATABASE_URI="sqlite:///x.db", EHR_ENV="development"), "--skip-port")
    assert r.returncode != 0
    assert "FAIL  EHR_DATABASE_URI is SQLite" in r.stdout and "FAIL  EHR_ENV is not production" in r.stdout


def test_preflight_checks_the_time_zone(tmp_path):
    ok = preflight(env_file(tmp_path), "--skip-port")
    assert "ok    time zone Europe/Nicosia is known" in ok.stdout
    bad = preflight(env_file(tmp_path, EHR_TIMEZONE="Nowhere/Land"), "--skip-port")
    assert bad.returncode != 0 and "FAIL  time zone Nowhere/Land cannot be loaded" in bad.stdout


def test_preflight_flags_missing_storage_and_missing_env_file(tmp_path):
    f = env_file(tmp_path, EHR_STORAGE_DIR=str(tmp_path / "nowhere"))
    r = preflight(f, "--skip-port")
    assert "FAIL  storage folder" in r.stdout and r.returncode != 0
    r = preflight(tmp_path / "missing.env")
    assert r.returncode != 0 and "environment file" in r.stdout


@pytest.mark.skipif(os.geteuid() == 0, reason="root can write anywhere")
def test_preflight_flags_an_unwritable_storage_folder(tmp_path):
    f = env_file(tmp_path)
    (tmp_path / "storage").chmod(0o500)
    assert "FAIL  storage folder" in preflight(f, "--skip-port").stdout


def test_preflight_port_check(tmp_path):
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        s.listen()
        port = s.getsockname()[1]
        f = env_file(tmp_path, EHR_BIND="127.0.0.1:%d" % port)
        busy = preflight(f)
        assert "FAIL  port %d" % port in busy.stdout
        assert "port check skipped" in preflight(f, "--skip-port").stdout
    assert "ok    port %d is free" % port in preflight(f).stdout


def test_preflight_database_and_schema(tmp_path):
    db = tmp_path / "pf.sqlite3"
    f = env_file(tmp_path, EHR_DATABASE_URI="sqlite:///%s" % db, EHR_ENV="development")
    behind = preflight(f, "--skip-port")
    assert "FAIL  database is behind the code" in behind.stdout or "FAIL  the database is not reachable" in behind.stdout
    e = {k: v for k, v in os.environ.items() if not k.startswith("EHR_")}
    e.update(EHR_DATABASE_URI="sqlite:///%s" % db, EHR_ENV="development")
    assert sh(SCRIPTS / "ehr-cli.sh", "--env-file", f, "upgrade-db", env=e).returncode == 0
    done = preflight(f, "--skip-port")
    assert "ok    database reachable and up to date" in done.stdout
    # the only failures left are the two that are about production mode
    fails = [l for l in done.stdout.splitlines() if l.startswith("FAIL")]
    assert len(fails) == 2 and done.returncode != 0
    assert any("LibreOffice" in l for l in done.stdout.splitlines())  # ok or WARN, but always reported


def test_preflight_reports_python_and_packages(tmp_path):
    out = preflight(env_file(tmp_path), "--skip-port").stdout
    assert "ok    Python 3." in out and "required packages import" in out


def test_ehr_cli_runs_a_command_with_the_env_file(tmp_path):
    f = env_file(tmp_path, EHR_DATABASE_URI="sqlite:///%s" % (tmp_path / "c.sqlite3"), EHR_ENV="development")
    e = {k: v for k, v in os.environ.items() if not k.startswith("EHR_")}
    r = sh(SCRIPTS / "ehr-cli.sh", "--env-file", f, "db-status", env=e)
    assert r.returncode == 2 and "current=0" in r.stdout
    assert sh(SCRIPTS / "ehr-cli.sh", "--env-file", tmp_path / "none", "db-status", env=e).returncode != 0
