"""Migration 0006: position.code and number_counter, on a database at version 5."""
from datetime import datetime, timezone

import pytest
from sqlalchemy import create_engine, inspect, text

from ehire import migrations
from ehire.extensions import db


@pytest.fixture
def engine():
    return create_engine("sqlite://")


def at_version_five(engine):
    from ehire import models  # noqa: F401

    db.metadata.create_all(engine)
    migrations.metadata.create_all(engine)
    with engine.begin() as c:
        c.exec_driver_sql("DROP TABLE number_counter")
        c.exec_driver_sql("ALTER TABLE position DROP COLUMN code")  # the previous release did not have them
        for v in range(1, 6):
            c.execute(migrations.schema_version.insert().values(version=v, name="m%d" % v,
                                                                applied_at=datetime.now(timezone.utc)))
        c.execute(text("INSERT INTO position (id, category, title_el, title_en, is_active) VALUES (1, 'nursing', 'Ν', 'Nurse', 1)"))


def test_upgrade_adds_the_column_and_the_table_and_keeps_rows(engine):
    at_version_five(engine)
    insp = inspect(engine)
    assert "code" not in {c["name"] for c in insp.get_columns("position")} and not insp.has_table("number_counter")
    assert migrations.upgrade(engine) == [6]
    insp = inspect(engine)
    assert "code" in {c["name"] for c in insp.get_columns("position")}
    assert {c["name"] for c in insp.get_columns("number_counter")} == {"stem", "last_value"}
    with engine.connect() as c:
        row = c.execute(text("SELECT title_en, code FROM position")).one()
        assert tuple(row) == ("Nurse", None)  # the old row is untouched, no code yet
    assert migrations.upgrade(engine) == []


def test_body_is_safe_to_run_twice(engine):
    at_version_five(engine)
    migrations.upgrade(engine)
    with engine.begin() as c:
        migrations.discover()[5].module.upgrade(c)
    assert [c["name"] for c in inspect(engine).get_columns("position")].count("code") == 1


def test_counter_table_works_after_the_upgrade(engine):
    at_version_five(engine)
    migrations.upgrade(engine)
    with engine.begin() as c:
        c.execute(text("INSERT INTO number_counter (stem, last_value) VALUES ('EHIRE-NGH-NUR-20261120', 1)"))
        with pytest.raises(Exception):
            c.execute(text("INSERT INTO number_counter (stem, last_value) VALUES ('EHIRE-NGH-NUR-20261120', 2)"))
