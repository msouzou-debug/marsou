"""Migration 0007: cost_centre.directorate_id, on a database at version 6."""
from datetime import datetime, timezone

import pytest
from sqlalchemy import create_engine, inspect, text

from ehire import migrations
from ehire.extensions import db


@pytest.fixture
def engine():
    return create_engine("sqlite://")


def at_version_six(engine):
    from ehire import models  # noqa: F401

    db.metadata.create_all(engine)
    migrations.metadata.create_all(engine)
    with engine.begin() as c:
        # the previous release's table: no Directorate column (SQLite cannot drop a column that has a key)
        c.exec_driver_sql("DROP TABLE cost_centre")
        c.exec_driver_sql("CREATE TABLE cost_centre (id INTEGER NOT NULL, code VARCHAR(20) NOT NULL, "
                          "name_el VARCHAR(200) NOT NULL, name_en VARCHAR(200) NOT NULL, is_active BOOLEAN NOT NULL, "
                          "PRIMARY KEY (id), UNIQUE (code))")
        for v in range(1, 7):
            c.execute(migrations.schema_version.insert().values(version=v, name="m%d" % v,
                                                                applied_at=datetime.now(timezone.utc)))
        c.execute(text("INSERT INTO cost_centre (id, code, name_el, name_en, is_active) "
                       "VALUES (1, '1000000200', 'Α', 'A', 1)"))


def test_upgrade_adds_a_nullable_indexed_column_and_keeps_rows(engine):
    at_version_six(engine)
    assert "directorate_id" not in {c["name"] for c in inspect(engine).get_columns("cost_centre")}
    assert migrations.upgrade(engine) == [7]
    insp = inspect(engine)
    col = next(c for c in insp.get_columns("cost_centre") if c["name"] == "directorate_id")
    assert col["nullable"] is True
    assert [fk["referred_table"] for fk in insp.get_foreign_keys("cost_centre")] == ["directorate"]
    assert "ix_cost_centre_directorate_id" in {i["name"] for i in insp.get_indexes("cost_centre")}
    with engine.connect() as c:
        row = c.execute(text("SELECT code, name_el, directorate_id FROM cost_centre")).one()
        assert tuple(row) == ("1000000200", "Α", None)  # code untouched, no Directorate yet
    assert migrations.upgrade(engine) == []


def test_body_is_safe_to_run_twice(engine):
    at_version_six(engine)
    migrations.upgrade(engine)
    with engine.begin() as c:
        migrations.discover()[6].module.upgrade(c)
    insp = inspect(engine)
    assert [c["name"] for c in insp.get_columns("cost_centre")].count("directorate_id") == 1
    assert [i["name"] for i in insp.get_indexes("cost_centre")].count("ix_cost_centre_directorate_id") == 1


def test_foreign_key_is_enforced_after_the_upgrade(engine):
    at_version_six(engine)
    migrations.upgrade(engine)
    with engine.begin() as c:
        c.exec_driver_sql("PRAGMA foreign_keys=ON")
        with pytest.raises(Exception):
            c.execute(text("UPDATE cost_centre SET directorate_id = 999 WHERE id = 1"))
