"""Migrations: schema_version, ordered upgrade in transactions, status, the 503 guard, CLI."""
import types

import pytest
from sqlalchemy import create_engine, inspect, text

from ehr import create_app, migrations
from ehr.config import TestConfig
from ehr.extensions import db


def fake(*pairs):
    """Replace discover() with in-memory migrations: (version, name, upgrade_function)."""
    return [migrations.Migration(v, n, types.SimpleNamespace(upgrade=f)) for v, n, f in pairs]


@pytest.fixture
def engine():
    return create_engine("sqlite://")


def test_real_migrations_are_numbered_without_gaps():
    found = migrations.discover()
    assert [m.version for m in found] == list(range(1, len(found) + 1))
    assert found[0].name == "0001_initial" and migrations.latest_version() == len(found)


def test_fresh_database_upgrades_to_latest_and_records_it(engine):
    assert migrations.current_version(engine) == 0
    done = migrations.upgrade(engine)
    assert done == [m.version for m in migrations.discover()]
    names = inspect(engine).get_table_names()
    assert {"schema_version", "user", "audit_log", "login_attempt", "request"} <= set(names)
    assert migrations.schema_is_current(engine)
    assert migrations.upgrade(engine) == []  # second run does nothing
    with engine.connect() as c:
        assert c.execute(text("select name from schema_version where version=1")).scalar() == "0001_initial"


def test_a_database_from_before_migrations_only_gets_the_version_row(engine):
    from ehr import models  # noqa: F401

    db.metadata.create_all(engine)
    with engine.begin() as c:
        c.execute(text("insert into role_permission (role, permission_key) values ('admin','x')"))
    assert migrations.upgrade(engine) == list(range(1, migrations.latest_version() + 1))
    with engine.connect() as c:  # later migrations add no permission rows to a role that has none
        assert c.execute(text("select count(*) from role_permission")).scalar() == 1


def test_pending_migrations_run_in_order_each_recorded(engine, monkeypatch):
    order = []
    mk = lambda n: (lambda conn: order.append(n) or conn.execute(text("create table t%d (id integer)" % n)))
    monkeypatch.setattr(migrations, "discover", lambda: fake((1, "0001_a", mk(1)), (2, "0002_b", mk(2)), (3, "0003_c", mk(3))))
    migrations.upgrade(engine)
    assert order == [1, 2, 3] and migrations.current_version(engine) == 3
    monkeypatch.setattr(migrations, "discover", lambda: fake(*[(i, "000%d_x" % i, mk(i)) for i in (1, 2, 3)]) + fake((4, "0004_d", mk(4))))
    assert migrations.upgrade(engine) == [4] and order == [1, 2, 3, 4]


def test_a_failing_migration_is_rolled_back_and_stops_the_rest(engine, monkeypatch):
    def good(conn):
        conn.execute(text("create table good (id integer)"))

    def bad(conn):
        conn.execute(text("create table half (id integer)"))
        raise ValueError("boom")

    def after(conn):
        conn.execute(text("create table after (id integer)"))

    monkeypatch.setattr(migrations, "discover", lambda: fake((1, "0001_a", good), (2, "0002_b", bad), (3, "0003_c", after)))
    with pytest.raises(ValueError):
        migrations.upgrade(engine)
    assert migrations.current_version(engine) == 1
    tables = inspect(engine).get_table_names()
    assert "good" in tables and "after" not in tables
    assert "half" not in tables  # SQLite rolled the DDL back with the transaction


def test_gaps_and_repeats_are_refused(monkeypatch):
    import ehr.migrations as m

    class Info:
        def __init__(self, name):
            self.name = name

    monkeypatch.setattr(m.pkgutil, "iter_modules", lambda path: [Info("0001_a"), Info("0003_c")])
    monkeypatch.setattr(m.importlib, "import_module", lambda n: types.SimpleNamespace(upgrade=lambda c: None))
    with pytest.raises(RuntimeError, match="without gaps"):
        m.discover()


def test_helpers(engine):
    from ehr.migrations.helpers import has_column, has_index, has_table

    with engine.begin() as c:
        c.execute(text("create table t (a integer, b integer)"))
        c.execute(text("create index ix_t_a on t (a)"))
        assert has_table(c, "t") and not has_table(c, "u")
        assert has_column(c, "t", "a") and not has_column(c, "t", "z") and not has_column(c, "u", "a")
        assert has_index(c, "t", "ix_t_a") and not has_index(c, "t", "nope")


def test_template_is_not_picked_up_as_a_migration():
    assert all(m.name != "_template" for m in migrations.discover())


# ---------------------------------------------------------------- the app and the CLI

class Guarded(TestConfig):
    EHR_CHECK_SCHEMA = True


@pytest.fixture
def raw_app(tmp_path):
    class Cfg(Guarded):
        SQLALCHEMY_DATABASE_URI = "sqlite:///%s" % (tmp_path / "t.sqlite3")

    app = create_app(Cfg)
    yield app


def test_app_answers_503_while_the_database_is_behind_and_recovers(raw_app):
    client = raw_app.test_client()
    with raw_app.app_context():
        db.create_all()  # tables, but no schema_version: pre-migration database
    resp = client.get("/login")
    assert resp.status_code == 503 and resp.headers["Retry-After"]
    assert "no-store" in resp.headers["Cache-Control"] and "Traceback" not in resp.get_data(as_text=True)
    assert client.get("/healthz").status_code == 503
    assert client.get("/static/css/ehr.css").status_code == 200
    with raw_app.app_context():
        migrations.upgrade(db.engine)
    assert client.get("/login").status_code == 200  # no restart needed


def test_app_answers_503_on_an_empty_database(raw_app):
    assert raw_app.test_client().get("/login").status_code == 503


def test_cli_status_and_upgrade(raw_app):
    runner = raw_app.test_cli_runner()
    r = runner.invoke(args=["db-status"])
    assert r.exit_code == 2 and "current=0" in r.output
    r = runner.invoke(args=["upgrade-db"])
    assert r.exit_code == 0 and "applied=1" in r.output and "current=%d" % migrations.latest_version() in r.output
    r = runner.invoke(args=["db-status"])
    assert r.exit_code == 0 and "pending=0" in r.output
    assert "applied=none" in runner.invoke(args=["upgrade-db"]).output


def test_init_db_marks_a_new_database_as_current_and_leaves_an_old_one_alone(raw_app):
    runner = raw_app.test_cli_runner()
    assert runner.invoke(args=["init-db"]).exit_code == 0
    with raw_app.app_context():
        assert migrations.schema_is_current(db.engine)
        db.session.execute(text("delete from schema_version"))
        db.session.commit()
    out = runner.invoke(args=["init-db"]).output
    assert "upgrade-db" in out
    with raw_app.app_context():
        assert migrations.current_version(db.engine) == 0  # not stamped behind the operator's back


def test_gunicorn_config_refuses_to_start_when_behind(tmp_path, monkeypatch):
    import runpy

    import ehr.config as cfg

    monkeypatch.setattr(cfg.Config, "SQLALCHEMY_DATABASE_URI", "sqlite:///%s" % (tmp_path / "g.sqlite3"))
    conf = runpy.run_path("deploy/gunicorn.conf.py")
    with pytest.raises(SystemExit) as err:
        conf["on_starting"](None)
    assert "upgrade-db" in str(err.value)
    from ehr import create_app as make

    app = make()
    with app.app_context():
        migrations.upgrade(db.engine)
    conf["on_starting"](None)  # now fine


def test_gunicorn_config_prints_the_production_problem(monkeypatch):
    import runpy

    import ehr.config as cfg

    monkeypatch.setattr(cfg.Config, "EHR_ENV", "production")
    conf = runpy.run_path("deploy/gunicorn.conf.py")
    with pytest.raises(SystemExit) as err:
        conf["on_starting"](None)
    assert "production" in str(err.value)
