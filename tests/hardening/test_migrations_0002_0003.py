"""Migration 0002 (number_search with Theta as U) and 0003 (central roles create, retention_years)."""
from datetime import datetime, timezone

import pytest
from sqlalchemy import create_engine, text

from ehr import migrations
from ehr.extensions import db

THETA = "Θ"
CENTRAL = ("fin_mgmt_head", "central_hr_officer", "medical_director", "nursing_director", "ceo")


@pytest.fixture
def engine():
    return create_engine("sqlite://")


def at_version_one(engine):
    """A database as the previous release left it: every table, schema_version at 1."""
    from ehr import models  # noqa: F401

    db.metadata.create_all(engine)
    migrations.metadata.create_all(engine)
    with engine.begin() as c:
        c.execute(migrations.schema_version.insert().values(version=1, name="0001_initial",
                                                            applied_at=datetime.now(timezone.utc)))


def add_request(conn, number, search):
    conn.execute(text("INSERT INTO request (number, number_search, status, round, created_by, created_at, "
                      "withdrawal_warned) VALUES (:n, :s, 'in_progress', 1, 1, :t, 0)"),
                 {"n": number, "s": search, "t": datetime.now(timezone.utc)})


def keys(engine):
    with engine.connect() as c:
        return dict(c.execute(text("SELECT number, number_search FROM request")).fetchall())


def test_0002_recomputes_number_search_for_every_numbered_request(engine):
    at_version_one(engine)
    old_prefix = "ΑΕ" + THETA  # the old key kept the Theta
    with engine.begin() as c:
        add_request(c, old_prefix + "-2026-0007", "AE" + THETA + "20260007")
        add_request(c, "ΑΕΘ-2026-0008", "stale")
        add_request(c, "POS-2026-0009", "POS20260009")  # already right: untouched
        c.execute(text("INSERT INTO request (number, number_search, status, round, created_by, created_at, "
                       "withdrawal_warned) VALUES (NULL, NULL, 'draft', 1, 1, :t, 0)"),
                  {"t": datetime.now(timezone.utc)})  # a draft has no number
    assert migrations.upgrade(engine)[:1] == [2]
    found = keys(engine)
    assert found[old_prefix + "-2026-0007"] == "AEU20260007"
    assert found["ΑΕΘ-2026-0008"] == "AEU20260008"
    assert found["POS-2026-0009"] == "POS20260009"
    assert found[None] is None
    assert migrations.upgrade(engine) == []  # second run does nothing


def test_0002_is_safe_when_the_columns_are_missing(engine):
    from ehr.migrations import helpers

    mod = migrations.discover()[1].module
    with engine.begin() as c:
        c.exec_driver_sql("CREATE TABLE request (id integer primary key)")
        mod.upgrade(c)
        assert not helpers.has_column(c, "request", "number_search")


def test_0002_then_search_finds_the_old_row(seeded):
    """After the migration a row saved with the old key is found by the Latin spelling."""
    from ehr.models import Request, User

    user = User.query.first()
    row = Request(created_by=user.id, number="ΑΕΘ-2026-0042")
    db.session.add(row)
    db.session.commit()
    db.session.execute(text("UPDATE request SET number_search = :k WHERE id = :i"),
                       {"k": "AE" + THETA + "20260042", "i": row.id})
    db.session.commit()
    assert Request.query.filter(Request.number_search.like("%AEU20260042%")).count() == 0
    migrations.discover()[1].module.upgrade(db.session.connection())
    db.session.commit()
    assert Request.query.filter(Request.number_search.like("%AEU20260042%")).count() == 1


def role_keys(engine):
    with engine.connect() as c:
        return {(r, k) for r, k in c.execute(text("SELECT role, permission_key FROM role_permission"))}


def test_0003_adds_request_create_to_the_central_roles_and_is_idempotent(engine):
    at_version_one(engine)
    with engine.begin() as c:
        for role in CENTRAL + ("viewer", "admin"):
            c.execute(text("INSERT INTO role_permission (role, permission_key) VALUES (:r, 'request.view_own')"),
                      {"r": role})
        c.execute(text("INSERT INTO role_permission (role, permission_key) VALUES ('ceo', 'request.create')"))  # there already
    before = role_keys(engine)
    done = migrations.upgrade(engine)
    assert done == list(range(2, migrations.latest_version() + 1))
    after = role_keys(engine)
    assert after - before == {(r, "request.create") for r in CENTRAL if r != "ceo"}
    assert ("viewer", "request.create") not in after and ("admin", "request.create") not in after
    with engine.connect() as c:  # no duplicate for the CEO, whose row was already there
        assert c.execute(text("SELECT count(*) FROM role_permission WHERE role='ceo' AND "
                              "permission_key='request.create'")).scalar() == 1
    with engine.begin() as c:  # running the body again changes nothing
        migrations.discover()[2].module.upgrade(c)
    assert role_keys(engine) == after


def test_0003_leaves_an_unseeded_database_alone_and_records_retention_years(engine):
    at_version_one(engine)
    migrations.upgrade(engine)
    assert role_keys(engine) == set()  # no permission rows at all: create-admin or the seed adds every row
    with engine.connect() as c:
        assert c.execute(text("SELECT value FROM setting WHERE key='retention_years'")).scalar() == "10"


def test_0003_keeps_a_retention_value_that_is_already_set(engine):
    at_version_one(engine)
    with engine.begin() as c:
        c.execute(text("INSERT INTO setting (key, value) VALUES ('retention_years', '7')"))
    migrations.upgrade(engine)
    with engine.connect() as c:
        assert c.execute(text("SELECT value FROM setting WHERE key='retention_years'")).scalar() == "7"


def test_a_new_database_built_by_0001_meets_0002_and_0003(engine):
    assert migrations.upgrade(engine) == list(range(1, migrations.latest_version() + 1))
    assert migrations.schema_is_current(engine)


def test_create_admin_records_retention_years(app):
    from ehr.cli import _ensure_recorded_settings
    from ehr.models import Setting

    _ensure_recorded_settings()
    db.session.commit()
    assert db.session.get(Setting, "retention_years").value == "10"
    db.session.get(Setting, "retention_years").value = "12"
    _ensure_recorded_settings()  # does not overwrite a value an owner set
    db.session.commit()
    assert db.session.get(Setting, "retention_years").value == "12"


def test_the_demo_seed_records_retention_years(seeded):
    from ehr.models import get_setting

    assert get_setting("retention_years") == "10"
