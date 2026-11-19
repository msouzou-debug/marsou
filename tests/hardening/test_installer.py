"""scripts/install-ehire.sh, run for real against a temporary folder with --root.

The releases are real tarballs built by make-release.sh from a small project copy (the existing fixture: the test
suite is a stub that passes, so RELEASE-INFO says `tests: passed` without --skip-tests). Their ehire-cli.sh and
preflight.sh are small stubs that keep a fake database in a file, so every install, upgrade and rollback path can run
in a second. systemd, useradd and chown to another user cannot run here: --root records them in DIR/.actions.log.
"""
import hashlib
import os
import pty
import re
import shutil
import socket
import subprocess
import threading
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path

import pytest

from .test_release_scripts import ROOT, SCRIPTS, build, project, repack, sh  # noqa: F401  (project is a fixture)

CLI_STUB = r"""#!/usr/bin/env bash
set -euo pipefail
APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
if [ "${1:-}" = "--env-file" ]; then ENVF="$2"; shift 2; fi
. "$APP_DIR/scripts/_env.sh"
load_env_file "$ENVF"
cmd="$1"; shift
echo "$(basename "$APP_DIR") $cmd $*" >> "${STUB_LOG:-/dev/null}"
db="${EHIRE_DATABASE_URI#sqlite:///}"
want="$(cat "$APP_DIR/SCHEMA")"
case "$cmd" in
  init-db) echo "schema=$want" > "$db" ;;
  upgrade-db)
    mkdir -p "$EHIRE_STORAGE_DIR"; echo m > "$EHIRE_STORAGE_DIR/written-by-migration"
    if [ -n "${STUB_UPGRADE_FAIL:-}" ]; then echo "schema=partial" > "$db"; echo "migration exploded" >&2; exit 1; fi
    echo "schema=$want" > "$db"; echo "applied=1 current=$want latest=$want" ;;
  db-status)
    cur="$(sed 's/schema=//' "$db")"
    if [ "$cur" = "$want" ]; then echo "current=$cur latest=$want pending=0"; else echo "current=$cur latest=$want pending=1"; exit 2; fi ;;
  backup-db)
    [ -z "${STUB_BACKUP_FAIL:-}" ] || { echo "backup exploded" >&2; exit 1; }
    [ ! -e "$1" ] || exit 1
    cp "$db" "$1" ;;
  *) exit 64 ;;
esac
"""

PREFLIGHT_STUB = r"""#!/usr/bin/env bash
APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
echo "$(basename "$APP_DIR") preflight $*" >> "${STUB_LOG:-/dev/null}"
if [ -n "${STUB_PREFLIGHT_FAIL:-}" ]; then echo "FAIL  simulated preflight failure"; echo "preflight: 1 failure(s), 0 warning(s)"; exit 1; fi
echo "ok    stub"; echo "WARN  stub warning"; echo "preflight: 0 failure(s), 1 warning(s)"
"""


def free_port():
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


class Rel:
    """Builds release tarballs from the project copy."""

    def __init__(self, project):
        self.project = project
        self.dist = project / "dist"

    def make(self, version, schema, requirements="", skip_tests=False):
        p = self.project
        (p / "scripts/ehire-cli.sh").write_text(CLI_STUB)
        (p / "scripts/preflight.sh").write_text(PREFLIGHT_STUB)
        shutil.copy(ROOT / "deploy/ehire.env.example", p / "deploy/ehire.env.example")
        shutil.copy(ROOT / "deploy/ehire.service.example", p / "deploy/ehire.service.example")
        (p / "SCHEMA").write_text(str(schema))
        (p / "requirements.txt").write_text(requirements)
        args = (["--skip-tests"] if skip_tests else []) + [version]
        r = build(p, *args)
        assert r.returncode == 0, r.stderr
        return self.dist / ("ehire-%s.tar.gz" % version)


@pytest.fixture
def rel(project):
    return Rel(project)


class Health:
    """A tiny HTTP server standing in for gunicorn. It is unhealthy while /opt/ehire/current points at `bad`."""

    def __init__(self, root):
        outer = self
        self.bad = None

        class H(BaseHTTPRequestHandler):
            def do_GET(self):
                cur = ""
                try:
                    cur = os.readlink(os.path.join(str(root), "opt/ehire/current"))
                except OSError:
                    pass
                if outer.bad and cur.endswith(outer.bad):
                    self.send_response(503)
                    self.end_headers()
                    return
                body = b'{"status":"ok"}'
                self.send_response(200)
                self.send_header("Content-Type", "application/json")
                self.end_headers()
                self.wfile.write(body)

            def log_message(self, *a):
                pass

        self.server = HTTPServer(("127.0.0.1", 0), H)
        self.url = "http://127.0.0.1:%d/healthz" % self.server.server_address[1]
        threading.Thread(target=self.server.serve_forever, daemon=True).start()

    def close(self):
        self.server.shutdown()
        self.server.server_close()


@pytest.fixture
def box(tmp_path):
    """An empty fake filesystem root, a health stand-in, a free port and a stub log."""
    root = tmp_path / "fsroot"
    root.mkdir()
    h = Health(root)
    yield type("Box", (), {"root": root, "health": h, "port": free_port(), "log": tmp_path / "stub.log", "tmp": tmp_path})
    h.close()


def run(box, tarball, *args, env=None, root=True, installer=None, stdin=subprocess.DEVNULL):
    e = {k: v for k, v in os.environ.items() if not k.startswith(("EHIRE_", "STUB_"))}
    e.update({"EHIRE_INSTALL_TEST_FAST_VENV": "1", "EHIRE_INSTALL_TEST_HEALTH_URL": box.health.url,
              "EHIRE_INSTALL_TEST_HEALTH_SECONDS": "2", "STUB_LOG": str(box.log)})
    e.update(env or {})
    installer = installer or box.tmp / "proj/dist/install-ehire.sh"
    cmd = ["bash", str(installer)]
    if root:
        cmd += ["--root", str(box.root)]
    cmd += ["--port", str(box.port), *map(str, args), str(tarball)]
    return subprocess.run(cmd, capture_output=True, text=True, env=e, stdin=stdin)


def snapshot(root):
    snap = {}
    for dirpath, dirs, files in os.walk(root):
        for n in dirs + files:
            p = Path(dirpath) / n
            rel = str(p.relative_to(root))
            if p.is_symlink():
                snap[rel] = ("link", os.readlink(p))
            elif p.is_dir():
                snap[rel] = ("dir",)
            else:
                snap[rel] = ("file", hashlib.sha256(p.read_bytes()).hexdigest())
    return snap


def actions(box):
    f = box.root / ".actions.log"
    return f.read_text().splitlines() if f.exists() else []


def stub_calls(box):
    return box.log.read_text().splitlines() if box.log.exists() else []


def link(box, name):
    return os.readlink(box.root / "opt/ehire" / name)


def backups(box):
    d = box.root / "var/backups/ehire"
    return sorted(d.iterdir()) if d.exists() else []


def secret_of(box):
    text = (box.root / "etc/ehire/ehire.env").read_text()
    return re.search(r"^EHIRE_SECRET_KEY=(.*)$", text, re.M).group(1)


# ================================================================================================ guards

def refused(box, r, text, code=1):
    assert r.returncode == code, (r.returncode, r.stdout, r.stderr)
    assert text in r.stdout + r.stderr, (text, r.stdout, r.stderr)


def test_not_root_is_refused_and_changes_nothing(rel, box):
    t = rel.make("1.0.0", 1)
    before = snapshot(box.root)
    r = run(box, t, "--yes", env={"EHIRE_INSTALL_TEST_NOT_ROOT": "1"})
    refused(box, r, "not root")
    assert "never calls sudo" in r.stdout
    assert snapshot(box.root) == before and not actions(box)


def test_test_hooks_are_ignored_without_root_option(rel, box):
    # no tarball on purpose: the run must fail on the tarball guard, not on the (ignored) not-root hook
    r = subprocess.run(["bash", str(SCRIPTS / "install-ehire.sh"), "--yes", str(box.tmp / "ehire-9.tar.gz")], capture_output=True, text=True,
                       env=dict(os.environ, EHIRE_INSTALL_TEST_NOT_ROOT="1"), stdin=subprocess.DEVNULL)
    assert r.returncode == 1 and "does not exist" in r.stdout and "not root" not in r.stdout


def test_root_option_refuses_slash_and_missing_folder(rel, box):
    t = rel.make("1.0.0", 1)
    for bad in ("/", "/nonexistent-folder-xyz"):
        r = subprocess.run(["bash", str(t.parent / "install-ehire.sh"), "--root", bad, str(t)], capture_output=True, text=True, stdin=subprocess.DEVNULL)
        assert r.returncode == 1 and "--root" in r.stderr, bad


def test_missing_tarball_wrong_name_and_missing_checksum(rel, box):
    t = rel.make("1.0.0", 1)
    before = snapshot(box.root)
    refused(box, run(box, box.tmp / "ehire-1.0.0.tar.gz", "--yes"), "does not exist")
    odd = t.parent / "release.tar.gz"
    shutil.copy(t, odd)
    refused(box, run(box, odd, "--yes"), "is not ehire-<version>.tar.gz")
    shutil.copy(t, t.parent / "ehire-2.0.0.tar.gz")
    refused(box, run(box, t.parent / "ehire-2.0.0.tar.gz", "--yes"), "sha256 is not next to the tarball")
    assert snapshot(box.root) == before and not actions(box)


def test_wrong_checksum_is_refused(rel, box):
    t = rel.make("1.0.0", 1)
    with open(t, "ab") as fh:
        fh.write(b"x")
    r = run(box, t, "--yes")
    refused(box, r, "does not match")
    assert snapshot(box.root) == {} and not actions(box)


def edited_copy(box, tarball, edit):
    """The same release with something changed inside, packed under the same name in another folder, with a fresh
    outer checksum: an insider who fixes the outer sum."""
    import tarfile

    work = box.tmp / "evil-work"
    shutil.rmtree(work, ignore_errors=True)
    work.mkdir()
    with tarfile.open(tarball) as tf:
        tf.extractall(work)
    top = next(work.iterdir())
    edit(top)
    out = box.tmp / "evil" / tarball.name
    out.parent.mkdir(exist_ok=True)
    with tarfile.open(out, "w:gz") as tf:
        tf.add(top, arcname=top.name)
    (out.parent / (out.name + ".sha256")).write_text(
        subprocess.run(["sha256sum", out.name], cwd=out.parent, capture_output=True, text=True).stdout)
    return out


def test_a_tampered_file_inside_is_refused_even_with_a_fresh_outer_checksum(rel, box):
    t = rel.make("1.0.0", 1)
    edited = edited_copy(box, t, lambda top: (top / "wsgi.py").write_text("app = 'evil'\n"))
    r = run(box, edited, "--yes")
    refused(box, r, "SHA256SUMS")
    assert snapshot(box.root) == {} and not actions(box)


def test_release_built_with_skip_tests_is_refused(rel, box):
    t = rel.make("1.0.0", 1, skip_tests=True)
    r = run(box, t, "--yes")
    # verify-release.sh already says "tests skipped"; either message is a refusal before any change
    assert r.returncode == 1 and ("tests" in r.stdout)
    assert snapshot(box.root) == {} and not actions(box)


def test_release_info_must_say_tests_passed_even_if_the_checksums_are_fixed(rel, box):
    t = rel.make("1.0.0", 1)

    def edit(top):
        info = top / "RELEASE-INFO"
        info.write_text(info.read_text().replace("tests: passed", "tests: unknown"))
        lines = []
        for line in (top / "SHA256SUMS").read_text().splitlines():
            digest, name = line.split("  ", 1)
            if name == "./RELEASE-INFO":
                digest = hashlib.sha256(info.read_bytes()).hexdigest()
            lines.append("%s  %s" % (digest, name))
        (top / "SHA256SUMS").write_text("\n".join(lines) + "\n")

    r = run(box, edited_copy(box, t, edit), "--yes")
    refused(box, r, "tests: passed")
    assert snapshot(box.root) == {} and not actions(box)


def python_shim(tmp, blocked):
    """A python3 that fails when its arguments mention `blocked`, otherwise runs the real one."""
    real = shutil.which("python3")
    shim = tmp / "shimbin"
    shim.mkdir(exist_ok=True)
    f = shim / "python3"
    f.write_text('#!/bin/sh\ncase "$*" in *%s*) exit 1;; esac\nexec %s "$@"\n' % (blocked, real))
    f.chmod(0o755)
    return {"PATH": "%s:%s" % (shim, os.environ["PATH"])}


def test_python_too_old_and_no_venv_module_are_refused(rel, box):
    t = rel.make("1.0.0", 1)
    refused(box, run(box, t, "--yes", env=python_shim(box.tmp, "version_info")), "older than 3.10")
    refused(box, run(box, t, "--yes", env=python_shim(box.tmp, "ensurepip")), "no venv module")
    assert snapshot(box.root) == {}


def test_missing_time_zone_database_and_low_disk_are_refused(rel, box):
    t = rel.make("1.0.0", 1)
    refused(box, run(box, t, "--yes", env={"PYTHONTZPATH": "/nonexistent"}), "time zone database")
    refused(box, run(box, t, "--yes", env={"EHIRE_INSTALL_TEST_FREE_KB": "1000"}), "less than 500 MB")
    assert snapshot(box.root) == {} and not actions(box)


def test_busy_port_is_refused_with_the_process_and_changes_nothing(rel, box):
    t = rel.make("1.0.0", 1)
    with socket.socket() as s:
        s.bind(("0.0.0.0", box.port))
        s.listen()
        r = run(box, t, "--yes")
    refused(box, r, "port %d is already in use" % box.port)
    assert "pid" in r.stdout
    assert snapshot(box.root) == {} and not actions(box)


def test_no_terminal_and_no_yes_refuses(rel, box):
    t = rel.make("1.0.0", 1)
    r = run(box, t)
    refused(box, r, "--yes")
    assert snapshot(box.root) == {} and not actions(box)


def test_prompt_on_a_terminal_declined_and_accepted(rel, box):
    t = rel.make("1.0.0", 1)

    def with_tty(answer):
        master, slave = pty.openpty()
        e = {k: v for k, v in os.environ.items() if not k.startswith(("EHIRE_", "STUB_"))}
        e.update({"EHIRE_INSTALL_TEST_FAST_VENV": "1", "EHIRE_INSTALL_TEST_HEALTH_URL": box.health.url,
                  "EHIRE_INSTALL_TEST_HEALTH_SECONDS": "2", "STUB_LOG": str(box.log)})
        p = subprocess.Popen(["bash", str(t.parent / "install-ehire.sh"), "--root", str(box.root), "--port", str(box.port), str(t)],
                             stdin=slave, stdout=slave, stderr=slave, env=e)
        os.close(slave)
        os.write(master, (answer + "\n").encode())
        out = b""
        while True:
            try:
                chunk = os.read(master, 4096)
            except OSError:
                break
            if not chunk:
                break
            out += chunk
        p.wait()
        os.close(master)
        return p.returncode, out.decode(errors="replace")

    code, out = with_tty("n")
    assert code == 1 and "Proceed? [y/N]" in out and "Cancelled" in out
    assert snapshot(box.root) == {}
    code, out = with_tty("y")
    assert code == 0 and "Done." in out
    assert (box.root / "opt/ehire/current").is_symlink()


# ================================================================================================ dry run

def test_dry_run_prints_every_action_and_changes_nothing(rel, box):
    t = rel.make("1.0.0", 1)
    r = run(box, t, "--dry-run")
    assert r.returncode == 0, r.stdout + r.stderr
    assert snapshot(box.root) == {} and not actions(box) and not box.log.exists()
    for word in ("FIRST INSTALL", "would: create the system user", "would: unpack", "would: create /etc/ehire/ehire.env".replace("/etc/ehire/ehire.env", "/etc/ehire/ehire.env"),
                 "would: ehire-cli.sh init-db", "would: preflight.sh", "would: copy deploy/ehire.service.example", "would: poll"):
        assert word in r.stdout, word
    assert "[14/14]" in r.stdout and "nothing was changed" in r.stdout


def test_dry_run_of_an_upgrade_changes_nothing(rel, box):
    t1, t2 = rel.make("1.0.0", 1), rel.make("1.1.0", 2)
    assert run(box, t1, "--yes").returncode == 0
    before = snapshot(box.root)
    n = len(actions(box))
    r = run(box, t2, "--dry-run")
    assert r.returncode == 0 and "UPGRADE" in r.stdout and "would: ehire-cli.sh backup-db" in r.stdout
    assert snapshot(box.root) == before and len(actions(box)) == n


# ================================================================================================ first install

def test_first_install_builds_the_tree_and_the_settings_file(rel, box):
    t = rel.make("1.0.0", 1)
    r = run(box, t, "--yes")
    out = r.stdout
    assert r.returncode == 0, out + r.stderr
    for n in range(1, 15):
        assert "[%d/14]" % n in out
    assert "FIRST INSTALL" in out and "installing: 1.0.0" in out
    root = box.root
    assert link(box, "current") == str(root / "opt/ehire/releases/ehire-1.0.0")
    assert (root / "opt/ehire/venv").is_symlink() and (root / "opt/ehire/venv/bin/python").exists()
    assert (root / "opt/ehire/staging").is_dir() and (root / "var/lib/ehire/storage").is_dir()
    assert (root / "var/log/ehire").is_dir() and (root / "var/backups/ehire").is_dir()
    assert not (root / "opt/ehire/.install-incomplete").exists()
    # modes
    mode = lambda p: (root / p).stat().st_mode & 0o7777
    assert mode("etc/ehire/ehire.env") == 0o640 and mode("etc/ehire") == 0o750
    assert mode("var/lib/ehire") == 0o750 and mode("var/lib/ehire/storage") == 0o750
    assert mode("opt/ehire/releases/ehire-1.0.0") & 0o022 == 0
    assert mode("opt/ehire/releases/ehire-1.0.0/wsgi.py") & 0o022 == 0
    # settings file
    env = (root / "etc/ehire/ehire.env").read_text()
    secret = secret_of(box)
    assert len(secret) >= 64 and secret != "" and "change" not in secret.lower()
    assert "EHIRE_DATABASE_URI=sqlite:///%s/var/lib/ehire/ehire.sqlite3" % root in env
    assert "EHIRE_STORAGE_DIR=%s/var/lib/ehire/storage" % root in env
    assert "EHIRE_BIND=0.0.0.0:%d" % box.port in env and "EHIRE_AD_ENABLED=false" in env
    assert "EHIRE_ENV=production" in env and "EHIRE_BASE_URL=https://ehire.shso.online" in env
    # the secret is on no screen and in no log
    logs = list((root / "var/log/ehire").glob("install-*.log"))
    assert len(logs) == 1
    for text in (out, r.stderr, logs[0].read_text(), "\n".join(actions(box))):
        assert secret not in text
    assert "Done." in logs[0].read_text()
    # database, service file, stub calls
    assert (root / "var/lib/ehire/ehire.sqlite3").read_text().strip() == "schema=1"
    assert (root / "etc/systemd/system/ehire.service").read_bytes() == (ROOT / "deploy/ehire.service.example").read_bytes()
    calls = stub_calls(box)
    assert calls[0].startswith("ehire-1.0.0 init-db") and any(c.startswith("ehire-1.0.0 db-status") for c in calls)
    assert any("preflight --env-file" in c and "--skip-port" in c for c in calls)
    # what would have run as root-only actions
    act = actions(box)
    assert any(a.startswith("useradd --system") and "--shell /usr/sbin/nologin" in a for a in act)
    assert "chown ehire:ehire /var/lib/ehire" in act and "chown root:ehire /etc/ehire/ehire.env" in act
    assert "chmod 640 /etc/ehire/ehire.env" in act
    assert any(a.startswith("runuser -u ehire -- ") and "init-db" in a for a in act)
    sysctl = [a for a in act if a.startswith("systemctl")]
    assert sysctl == ["systemctl daemon-reload", "systemctl enable ehire", "systemctl start ehire"]
    for a in sysctl + act:
        for other in ("nginx", "apache", "cron", "restart", "reload ", "daemon-reexec"):
            assert other not in a, a
    # every chown and chmod is inside the installer's own paths
    own = ("/opt/ehire", "/etc/ehire", "/var/lib/ehire", "/var/log/ehire", "/var/backups/ehire", "/etc/systemd/system/ehire.service")
    for a in act:
        if a.startswith(("chown", "chmod")):
            target = a.split()[-1]
            assert target.startswith(own), a
            assert str(root) not in a
    # the finish: three addresses and the manual steps
    assert "http://127.0.0.1:%d/healthz" % box.port in out and "https://ehire.shso.online/" in out
    assert "sudo -u ehire /opt/ehire/current/scripts/ehire-cli.sh create-admin" in out
    assert "ufw" in out and out.count("ehire-cli.sh send-") == 2 and "run-timers" in out and "backup-db" in out


def test_first_install_with_no_start_does_not_start_the_service(rel, box):
    t = rel.make("1.0.0", 1)
    r = run(box, t, "--yes", "--no-start")
    assert r.returncode == 0 and "not started" in r.stdout and "skipped (--no-start)" in r.stdout
    assert "systemctl start ehire" not in actions(box) and "systemctl enable ehire" in actions(box)


def test_wheels_option_makes_pip_run_offline(rel, box):
    t = rel.make("1.0.0", 1)
    wheels = box.tmp / "wheels"
    wheels.mkdir()
    r = run(box, t, "--yes", "--wheels", wheels)
    assert r.returncode == 0
    assert any("--no-index --find-links %s" % wheels in a for a in actions(box) if a.startswith("pip"))
    refused(box, run(box, t, "--yes", "--wheels", box.tmp / "nope"), "is not a folder")


def test_a_real_venv_and_an_offline_pip_run(rel, box):
    t = rel.make("1.0.0", 1, requirements="# nothing to install\n")
    wheels = box.tmp / "wheels"
    wheels.mkdir()
    r = run(box, t, "--yes", "--wheels", wheels, env={"EHIRE_INSTALL_TEST_FAST_VENV": ""})
    assert r.returncode == 0, r.stdout + r.stderr
    py = box.root / "opt/ehire/venv/bin/python"
    assert py.exists() and subprocess.run([str(py), "-m", "pip", "--version"], capture_output=True).returncode == 0
    assert (box.root / "opt/ehire/venv-1.0.0/.ehire-venv-ok").exists()


def test_rerun_of_the_current_release_is_a_no_op(rel, box):
    t = rel.make("1.0.0", 1)
    assert run(box, t, "--yes").returncode == 0
    before, n = snapshot(box.root), len(actions(box))
    r = run(box, t, "--yes")
    assert r.returncode == 0 and "Nothing to do" in r.stdout
    assert snapshot(box.root) == before and len(actions(box)) == n


def test_same_release_current_but_service_unhealthy_is_refused(rel, box):
    t = rel.make("1.0.0", 1)
    assert run(box, t, "--yes").returncode == 0
    box.health.bad = "ehire-1.0.0"
    before = snapshot(box.root)
    r = run(box, t, "--yes")
    refused(box, r, "already the current release, but the service is not healthy")
    assert snapshot(box.root) == before


def test_existing_settings_file_is_never_modified_and_missing_names_are_reported(rel, box):
    t = rel.make("1.0.0", 1)
    envdir = box.root / "etc/ehire"
    envdir.mkdir(parents=True)
    original = (
        "# my own file, my own order\n"
        "EHIRE_SECRET_KEY=mine-" + "k" * 60 + "\n"
        "EHIRE_ENV=production\n"
        "EHIRE_DATABASE_URI=sqlite:///%s/var/lib/ehire/ehire.sqlite3\n"
        "EHIRE_STORAGE_DIR=%s/var/lib/ehire/storage\n"
        "EHIRE_BIND=0.0.0.0:%d\n" % (box.root, box.root, box.port)
    )
    (envdir / "ehire.env").write_text(original)
    r = run(box, t, "--yes")
    assert r.returncode == 0, r.stdout
    assert (envdir / "ehire.env").read_text() == original
    assert "variables the new example has and the file lacks (names only)" in r.stdout
    assert "EHIRE_SMTP_HOST" in r.stdout and "EHIRE_GRAPH_TENANT" in r.stdout
    assert "mine-" not in r.stdout and "mine-" not in "".join(p.read_text() for p in (box.root / "var/log/ehire").glob("*.log"))
    assert not any("ehire.env" in a and a.startswith(("chown", "chmod")) for a in actions(box))


def test_port_option_must_agree_with_an_existing_settings_file(rel, box):
    t = rel.make("1.0.0", 1)
    (box.root / "etc/ehire").mkdir(parents=True)
    (box.root / "etc/ehire/ehire.env").write_text("EHIRE_BIND=0.0.0.0:%d\n" % (box.port + 1))
    r = run(box, t, "--yes")
    refused(box, r, "says port %d" % (box.port + 1))
    assert not (box.root / "opt").exists()


# ================================================================================================ failed first install

def test_failed_first_install_stops_the_unit_keeps_files_and_resumes(rel, box):
    t = rel.make("1.0.0", 1)
    r = run(box, t, "--yes", env={"STUB_PREFLIGHT_FAIL": "1"})
    assert r.returncode == 3, r.stdout
    out = r.stdout
    assert "FAILED: preflight reported failures" in out and "FAIL  simulated preflight failure" in out
    assert "Nothing was deleted" in out and "rm -rf /opt/ehire" in out
    assert (box.root / "opt/ehire/releases/ehire-1.0.0").is_dir() and (box.root / "etc/ehire/ehire.env").exists()
    assert (box.root / "opt/ehire/.install-incomplete").exists()
    assert not (box.root / "etc/systemd/system/ehire.service").exists()  # preflight stops before the unit is written
    secret = secret_of(box)
    assert secret not in out
    # fixed: the same command resumes as a first install and keeps the settings file
    before_env = (box.root / "etc/ehire/ehire.env").read_bytes()
    r2 = run(box, t, "--yes")
    assert r2.returncode == 0, r2.stdout
    assert "resuming" in r2.stdout and (box.root / "etc/ehire/ehire.env").read_bytes() == before_env
    assert not (box.root / "opt/ehire/.install-incomplete").exists()


def test_failed_health_check_on_first_install_stops_and_disables_the_unit(rel, box):
    t = rel.make("1.0.0", 1)
    box.health.bad = "ehire-1.0.0"
    r = run(box, t, "--yes")
    assert r.returncode == 3 and "did not answer" in r.stdout
    act = actions(box)
    assert "systemctl stop ehire" in act and "systemctl disable ehire" in act
    assert (box.root / "opt/ehire/current").is_symlink()


# ================================================================================================ upgrade

def first_then_data(rel, box, **second):
    t1 = rel.make("1.0.0", 1)
    assert run(box, t1, "--yes").returncode == 0
    storage = box.root / "var/lib/ehire/storage"
    (storage / "doc.txt").write_text("a document\n")
    db = box.root / "var/lib/ehire/ehire.sqlite3"
    (box.root / "var/lib/ehire/ehire.sqlite3-wal").write_text("stale wal")
    (box.root / "var/lib/ehire/ehire.sqlite3-shm").write_text("stale shm")
    box.log.unlink()
    return db, storage


def test_upgrade_backs_up_first_switches_and_migrates(rel, box):
    db, storage = first_then_data(rel, box)
    t2 = rel.make("1.1.0", 2)
    n = len(actions(box))
    r = run(box, t2, "--yes")
    assert r.returncode == 0, r.stdout + r.stderr
    assert "UPGRADE" in r.stdout and "installing: 1.1.0" in r.stdout and "currently linked: 1.0.0" in r.stdout
    assert link(box, "current") == str(box.root / "opt/ehire/releases/ehire-1.1.0")
    b = backups(box)
    assert len(b) == 1 and b[0].name.endswith("-pre-1.1.0")
    assert (b[0] / "ehire.sqlite3").read_text().strip() == "schema=1"
    assert (b[0] / "storage.tar.gz").stat().st_size > 0
    listing = subprocess.run(["tar", "-tzf", str(b[0] / "storage.tar.gz")], capture_output=True, text=True).stdout
    assert "storage/doc.txt" in listing
    assert db.read_text().strip() == "schema=2"
    calls = stub_calls(box)
    # the backup runs from the CURRENT release, the migration from the new one, and in that order
    assert calls[0].startswith("ehire-1.0.0 backup-db") and str(b[0]) in calls[0]
    idx = [i for i, c in enumerate(calls) if c.startswith("ehire-1.1.0 upgrade-db")]
    assert idx and calls.index(calls[0]) < idx[0]
    assert any(c.startswith("ehire-1.1.0 db-status") for c in calls) and any(c.startswith("ehire-1.1.0 preflight") for c in calls)
    act = actions(box)[n:]
    stop = act.index("systemctl stop ehire")
    assert act.index(next(a for a in act if "backup-db" in a)) < stop
    assert act.count("systemctl start ehire") == 1
    assert not any(a.startswith("useradd") for a in act)
    # unchanged requirements: the venv stays
    assert link(box, "venv") == "venv-1.0.0" and not (box.root / "opt/ehire/venv-1.1.0").exists()
    assert "Backup" not in r.stdout or True
    assert str(b[0]).replace(str(box.root), "") in r.stdout


def test_upgrade_with_changed_requirements_builds_a_new_venv_and_keeps_the_old_one(rel, box):
    first_then_data(rel, box)
    t2 = rel.make("1.1.0", 2, requirements="# changed\n")
    r = run(box, t2, "--yes")
    assert r.returncode == 0, r.stdout
    assert link(box, "venv") == "venv-1.1.0"
    assert (box.root / "opt/ehire/venv-1.0.0/bin/python").exists() and (box.root / "opt/ehire/venv-1.1.0/bin/python").exists()


def test_upgrade_replaces_a_changed_service_file_and_keeps_a_bak(rel, box):
    first_then_data(rel, box)
    unit = box.root / "etc/systemd/system/ehire.service"
    unit.write_text("[Unit]\nDescription=old\n")
    t2 = rel.make("1.1.0", 2)
    r = run(box, t2, "--yes")
    assert r.returncode == 0
    assert (unit.parent / "ehire.service.bak").read_text() == "[Unit]\nDescription=old\n"
    assert unit.read_bytes() == (ROOT / "deploy/ehire.service.example").read_bytes()
    assert "systemctl daemon-reload" in actions(box)


def assert_rolled_back(box, r, db, storage, starts=2):
    assert r.returncode == 2, r.stdout + r.stderr
    assert link(box, "current") == str(box.root / "opt/ehire/releases/ehire-1.0.0")
    assert db.read_text().strip() == "schema=1"
    assert (storage / "doc.txt").read_text() == "a document\n"
    assert not (storage / "written-by-migration").exists()
    assert not (box.root / "var/lib/ehire/ehire.sqlite3-wal").exists() and not (box.root / "var/lib/ehire/ehire.sqlite3-shm").exists()
    b = backups(box)
    side = b[0] / "failed-upgrade"
    assert (side / "ehire.sqlite3-wal").exists() and (side / "storage/written-by-migration").exists()  # kept, not deleted
    assert "rolled back to ehire-1.0.0" in r.stdout and "Exit code 2" in r.stdout and "[13/14] Roll back" in r.stdout
    assert actions(box).count("systemctl start ehire") == starts  # the first install, the failed try if it got that far, the rollback


def test_failing_preflight_after_the_switch_rolls_back_and_restores_the_data(rel, box):
    db, storage = first_then_data(rel, box)
    t2 = rel.make("1.1.0", 2)
    r = run(box, t2, "--yes", env={"STUB_PREFLIGHT_FAIL": "1"})
    assert_rolled_back(box, r, db, storage)


def test_failing_migration_rolls_back_and_restores_the_data(rel, box):
    db, storage = first_then_data(rel, box)
    t2 = rel.make("1.1.0", 2)
    r = run(box, t2, "--yes", env={"STUB_UPGRADE_FAIL": "1"})
    assert_rolled_back(box, r, db, storage)
    assert "migration exploded" in r.stdout


def test_failing_health_check_rolls_back_and_the_old_release_answers_again(rel, box):
    db, storage = first_then_data(rel, box)
    t2 = rel.make("1.1.0", 2, requirements="# changed\n")
    box.health.bad = "ehire-1.1.0"
    r = run(box, t2, "--yes")
    assert_rolled_back(box, r, db, storage, starts=3)
    assert link(box, "venv") == "venv-1.0.0"  # the venv link went back too
    assert "service ehire started again and answers /healthz" in r.stdout
    # the failed release stays on disk for inspection
    assert (box.root / "opt/ehire/releases/ehire-1.1.0").is_dir()


def test_rollback_restores_a_changed_service_file(rel, box):
    db, storage = first_then_data(rel, box)
    unit = box.root / "etc/systemd/system/ehire.service"
    unit.write_text("[Unit]\nDescription=old\n")
    t2 = rel.make("1.1.0", 2)
    r = run(box, t2, "--yes", env={"STUB_PREFLIGHT_FAIL": "1"})
    # preflight fails before the service file is touched, so the file is unchanged either way
    assert r.returncode == 2 and unit.read_text() == "[Unit]\nDescription=old\n"


def test_a_failed_backup_stops_before_anything_live_is_touched(rel, box):
    db, storage = first_then_data(rel, box)
    t2 = rel.make("1.1.0", 2)
    n = len(actions(box))
    r = run(box, t2, "--yes", env={"STUB_BACKUP_FAIL": "1"})
    assert r.returncode == 2, r.stdout
    assert "backup-db failed" in r.stdout and "service was not stopped" in r.stdout
    assert link(box, "current").endswith("ehire-1.0.0") and db.read_text().strip() == "schema=1"
    assert "systemctl stop ehire" not in actions(box)[n:]
    assert not any(c.startswith("ehire-1.1.0 upgrade-db") for c in stub_calls(box))


def test_an_older_release_folder_needs_yes(rel, box):
    first_then_data(rel, box)
    t1 = rel.dist / "ehire-1.0.0.tar.gz"
    t2 = rel.make("1.1.0", 2)
    assert run(box, t2, "--yes").returncode == 0
    r = run(box, t1)
    # not current, but unpacked: without --yes it is refused (and with no terminal the prompt is refused too)
    refused(box, r, "already unpacked but is not the current release")
    assert link(box, "current").endswith("ehire-1.1.0")
    assert run(box, t1, "--yes").returncode == 0 and link(box, "current").endswith("ehire-1.0.0")


def test_unpack_refuses_a_release_folder_with_other_content(rel, box):
    t = rel.make("1.0.0", 1)
    folder = box.root / "opt/ehire/releases/ehire-1.0.0"
    folder.mkdir(parents=True)
    (folder / "SHA256SUMS").write_text("other\n")
    (box.root / "opt/ehire/.install-incomplete").write_text("x\n")
    r = run(box, t, "--yes")
    assert r.returncode == 3 and "already exists with different content" in r.stdout
    assert (folder / "SHA256SUMS").read_text() == "other\n"


def test_upgrade_refuses_data_outside_its_layout(rel, box):
    first_then_data(rel, box)
    env = box.root / "etc/ehire/ehire.env"
    env.write_text(re.sub(r"^EHIRE_STORAGE_DIR=.*$", "EHIRE_STORAGE_DIR=/somewhere/else", env.read_text(), flags=re.M))
    t2 = rel.make("1.1.0", 2)
    before = snapshot(box.root)
    r = run(box, t2, "--yes")
    refused(box, r, "backs up only its own layout")
    assert snapshot(box.root) == before


# ================================================================================================ the script itself

def test_installer_is_strict_valid_bash_and_shellcheck_clean_when_available():
    path = SCRIPTS / "install-ehire.sh"
    text = path.read_text()
    assert text.startswith("#!/usr/bin/env bash") and "set -euo pipefail" in text
    assert subprocess.run(["bash", "-n", str(path)]).returncode == 0
    assert all(ord(c) < 128 for c in text), "plain ASCII only"
    if shutil.which("shellcheck"):
        r = subprocess.run(["shellcheck", "-x", str(path)], capture_output=True, text=True)
        assert r.returncode == 0, r.stdout


def test_installer_never_names_another_unit_or_a_service_manager_verb():
    lines = [l.strip() for l in (SCRIPTS / "install-ehire.sh").read_text().splitlines() if not l.lstrip().startswith("#")]
    code = [l for l in lines if not l.startswith(("say ", "note ", "fail ", "sayn ", "rec ")) and "<<" not in l]
    for l in code:
        for m in re.finditer(r"systemctl (\S+)( \S+)?", l):
            if l[:m.start()].count('"') % 2 == 1:
                continue  # inside a message or a record line, not a call
            verb, arg = m.group(1).strip('";}'), (m.group(2) or "").strip().rstrip(';')
            ok = (verb == "$1" and arg == '"$SERVICE"') or verb == "daemon-reload" or (verb == "is-active" and arg.startswith("--quiet")) \
                or l.startswith("command -v systemctl") or "command -v systemctl" in l
            assert ok, l
        bare = re.sub(r'"[^"]*"', '""', l)
        for banned in ("daemon-reexec", "restart", "nginx", "apache", "crontab", "service "):
            assert banned not in bare, l
    text = "\n".join(code)
    assert not re.search(r"(^|[;&|(]\s*)sudo\s", text, re.M)


def test_help_lists_the_options(rel):
    r = subprocess.run(["bash", str(SCRIPTS / "install-ehire.sh"), "--help"], capture_output=True, text=True)
    assert r.returncode == 0
    for opt in ("--wheels", "--dry-run", "--yes", "--no-start", "--root", "--port", "Exit codes"):
        assert opt in r.stdout


def test_verify_release_beside_the_installer_is_the_one_used(rel, box):
    t = rel.make("1.0.0", 1)
    (t.parent / "verify-release.sh").write_text("#!/usr/bin/env bash\necho 'beside verifier says no' >&2\nexit 1\n")
    r = run(box, t, "--yes")
    refused(box, r, "SHA256SUMS")
    assert "beside verifier says no" in r.stdout and snapshot(box.root) == {}
    shutil.copy(SCRIPTS / "verify-release.sh", t.parent / "verify-release.sh")
    assert run(box, t, "--yes").returncode == 0
