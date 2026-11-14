"""SQLite as the production engine: placement rules, connection settings, one writer, backup."""
import hashlib
import importlib.util
import sqlite3
import threading
from pathlib import Path
from types import SimpleNamespace

import pytest
from flask import Flask

from ehr import create_app
from ehr.config import TestConfig
from ehr.dbsetup import init_sqlite, sqlite_settings
from ehr.extensions import db
from ehr.models import NumberSequence, Request, RequestAction
from ehr.security import ConfigError, check_production_config
from tests.conftest import login
from tests.requests.flowhelpers import fin_fields, open_task
from tests.requests.helpers import full_form

ROOT = Path(__file__).resolve().parents[2]


def prod(uri):
    app = Flask("t")
    app.config.update({"EHR_ENV": "production", "SECRET_KEY": "x" * 40, "CSRF_ENABLED": True, "TESTING": False,
                       "SQLALCHEMY_DATABASE_URI": uri})
    return app


@pytest.fixture
def file_app(tmp_path):
    class FileConfig(TestConfig):
        SQLALCHEMY_DATABASE_URI = "sqlite:///%s" % (tmp_path / "ehr.sqlite3")

    app = create_app(FileConfig)
    with app.app_context():
        db.create_all()
        from ehr.seed import seed_demo

        seed_demo()
        yield app
        db.session.remove()
        db.engine.dispose()


# ---------------------------------------------------------------------------------------- production placement

def test_an_absolute_sqlite_file_outside_the_code_folder_is_accepted(tmp_path):
    check_production_config(prod("sqlite:///%s" % (tmp_path / "ehr.sqlite3")))


@pytest.mark.parametrize("uri,words", [
    ("sqlite:///ehr.sqlite3", "relative"),
    ("sqlite://", "in-memory"),
    ("sqlite:///:memory:", "in-memory"),
])
def test_relative_or_memory_sqlite_is_refused(uri, words):
    with pytest.raises(ConfigError, match=words):
        check_production_config(prod(uri))


def test_a_sqlite_file_inside_the_code_folder_is_refused():
    with pytest.raises(ConfigError, match="inside the code folder"):
        check_production_config(prod("sqlite:///%s" % (ROOT / "instance" / "ehr.sqlite3")))


def test_a_missing_or_read_only_folder_is_refused(tmp_path):
    with pytest.raises(ConfigError, match="not writable"):
        check_production_config(prod("sqlite:///%s" % (tmp_path / "no-such-folder" / "ehr.sqlite3")))
    ro = tmp_path / "ro"
    ro.mkdir()
    ro.chmod(0o500)
    try:
        import os

        if os.access(ro, os.W_OK):  # running as root: permissions do not apply
            pytest.skip("folder permissions are not enforced for this user")
        with pytest.raises(ConfigError, match="not writable"):
            check_production_config(prod("sqlite:///%s" % (ro / "ehr.sqlite3")))
    finally:
        ro.chmod(0o700)


# ---------------------------------------------------------------------------------------- connection settings

def test_a_new_connection_reports_the_settings(file_app):
    for _ in range(2):  # a second, fresh connection too
        with db.engine.connect() as conn:
            raw = conn.connection.dbapi_connection
            got = sqlite_settings(raw)
        assert got == {"journal_mode": "wal", "busy_timeout": 5000, "foreign_keys": 1, "synchronous": 1}
        db.engine.dispose()


def test_busy_timeout_comes_from_config(tmp_path):
    class Cfg(TestConfig):
        SQLALCHEMY_DATABASE_URI = "sqlite:///%s" % (tmp_path / "x.sqlite3")
        EHR_SQLITE_BUSY_TIMEOUT_MS = 1234

    app = create_app(Cfg)
    with app.app_context(), db.engine.connect() as conn:
        assert sqlite_settings(conn.connection.dbapi_connection)["busy_timeout"] == 1234
    with app.app_context():
        db.engine.dispose()


def test_foreign_keys_are_enforced(file_app):
    from sqlalchemy.exc import IntegrityError

    db.session.add(RequestAction(request_id=99999, action="x"))
    with pytest.raises(IntegrityError):
        db.session.flush()
    db.session.rollback()


def test_other_engines_are_left_alone():
    fake = SimpleNamespace(dialect=SimpleNamespace(name="postgresql"))
    init_sqlite(SimpleNamespace(config={}), fake)  # would raise on listening to a fake engine if it did anything


def test_write_transactions_start_with_begin_immediate(file_app):
    statements = []
    from sqlalchemy import event

    @event.listens_for(db.engine, "before_cursor_execute")
    def _spy(conn, cursor, statement, params, context, executemany):
        statements.append(statement)

    db.session.add(NumberSequence(year=2099, last_value=0))
    db.session.commit()
    event.remove(db.engine, "before_cursor_execute", _spy)
    assert statements[0] == "BEGIN IMMEDIATE"


# ---------------------------------------------------------------------------------------- one writer: gunicorn

def _gunicorn_conf():
    spec = importlib.util.spec_from_file_location("ehr_gunicorn_conf", ROOT / "deploy" / "gunicorn.conf.py")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def test_gunicorn_defaults_to_one_worker():
    assert _gunicorn_conf().workers == 1


def test_gunicorn_refuses_more_than_one_worker_on_sqlite(tmp_path, monkeypatch):
    from ehr.config import Config

    monkeypatch.setattr(Config, "SQLALCHEMY_DATABASE_URI", "sqlite:///%s" % (tmp_path / "w.sqlite3"))
    conf = _gunicorn_conf()
    with pytest.raises(SystemExit) as err:
        conf.on_starting(SimpleNamespace(cfg=SimpleNamespace(workers=2)))
    assert "one worker" in str(err.value) and "SQLite" in str(err.value)
    with pytest.raises(SystemExit) as err:  # one worker passes this check and meets the next one (schema version)
        conf.on_starting(SimpleNamespace(cfg=SimpleNamespace(workers=1)))
    assert "schema version" in str(err.value)


# ---------------------------------------------------------------------------------------- concurrency

def _clients(app, username, n):
    """n signed-in clients, signed in one after the other: password hashing is slow, and this test is about the
    writes that follow, not about how many logins fit into the busy timeout."""
    out = []
    for _ in range(n):
        client = app.test_client()
        assert login(client, username).status_code == 302
        out.append(client)
    return out


def _run_threads(n, target):
    barrier = threading.Barrier(n)
    results, errors = [None] * n, []

    def runner(i):
        try:
            results[i] = target(i, barrier)
        except Exception as err:  # noqa: BLE001 collected and shown by the test
            errors.append(repr(err))
            try:
                barrier.abort()
            except Exception:  # noqa: BLE001
                pass

    db.session.rollback()  # the test's own session must not hold the write lock while the threads run
    threads = [threading.Thread(target=runner, args=(i,)) for i in range(n)]
    for t in threads:
        t.start()
    for t in threads:
        t.join(120)
    assert not errors, errors
    return results


def test_numbers_are_distinct_and_consecutive_under_concurrent_submits(file_app):
    n = 10
    form = full_form()
    clients = _clients(file_app, "nic.requester", n)

    def submit(i, barrier):
        barrier.wait()
        resp = clients[i].post("/requests", data=form)
        return resp.status_code, resp.get_data(as_text=True)

    results = _run_threads(n, submit)
    assert all(code == 302 for code, _ in results), [(c, b[:200]) for c, b in results if c != 302]
    assert not any("locked" in body.lower() for _, body in results)
    db.session.expire_all()
    numbers = [r.number for r in Request.query.all()]
    assert len(numbers) == n and len(set(numbers)) == n
    values = sorted(int(x.rsplit("-", 1)[1]) for x in numbers)
    assert values == list(range(1, n + 1))
    assert db.session.get(NumberSequence, Request.query.first().created_at.year).last_value == n


def test_exactly_one_action_per_task_under_concurrent_double_submit(file_app):
    client = file_app.test_client()
    assert login(client, "nic.requester").status_code == 302
    assert client.post("/requests", data=full_form()).status_code == 302
    rid = Request.query.one().id
    task = open_task(rid, "nic.accountant")
    data = {"action": "check", "role": task.role, "task_id": str(task.id), "position": "yes", "funds": "yes"}
    data.update(fin_fields())
    n = 8
    clients = _clients(file_app, "nic.accountant", n)

    def act(i, barrier):
        barrier.wait()
        resp = clients[i].post("/requests/%d/action?lang=en" % rid, data=data)
        return resp.status_code, resp.get_data(as_text=True)

    results = _run_threads(n, act)
    assert all(code in (200, 302) for code, _ in results), [c for c, _ in results]
    assert not any("locked" in body.lower() for _, body in results)
    db.session.expire_all()
    checks = RequestAction.query.filter_by(request_id=rid, role="dir_accountant", action="check").all()
    assert len(checks) == 1
    assert db.session.get(Request, rid).current_step == 3


# ---------------------------------------------------------------------------------------- backup

def _invoke(app, *args, input=None):
    return app.test_cli_runner().invoke(args=list(args), input=input)


def test_backup_copies_a_live_wal_database(file_app, tmp_path):
    db.session.add(NumberSequence(year=2098, last_value=7))
    db.session.commit()
    target = tmp_path / "out" / "backup.sqlite3"
    target.parent.mkdir()
    # another connection stays open and writes, as the running app would
    other = sqlite3.connect(str(tmp_path / "ehr.sqlite3"))
    other.execute("PRAGMA journal_mode=WAL")
    res = _invoke(file_app, "backup-db", str(target))
    other.close()
    assert res.exit_code == 0, res.output
    digest = hashlib.sha256(target.read_bytes()).hexdigest()
    assert "sha256 " + digest in res.output
    assert sorted(p.name for p in target.parent.iterdir()) == ["backup.sqlite3"]  # no temp, -wal or -shm left
    copy = sqlite3.connect(str(target))
    assert copy.execute("SELECT last_value FROM number_sequence WHERE year=2098").fetchone() == (7,)
    assert copy.execute("PRAGMA journal_mode").fetchone()[0] == "delete"
    copy.close()


def test_backup_never_overwrites(file_app, tmp_path):
    target = tmp_path / "keep.sqlite3"
    target.write_bytes(b"precious")
    res = _invoke(file_app, "backup-db", str(target))
    assert res.exit_code != 0 and "already exists" in res.output
    assert target.read_bytes() == b"precious"


def test_backup_refuses_a_missing_folder_and_a_memory_database(file_app, tmp_path, app):
    res = _invoke(file_app, "backup-db", str(tmp_path / "nope" / "b.sqlite3"))
    assert res.exit_code != 0 and "not exist" in res.output
    res = _invoke(app, "backup-db", str(tmp_path / "b.sqlite3"))  # the in-memory test database
    assert res.exit_code != 0 and "SQLite file database only" in res.output
