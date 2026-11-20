"""Migration 0004 on a database as the previous release left it."""
from datetime import datetime, timezone

import pytest
from sqlalchemy import create_engine, inspect

from ehire import migrations
from ehire.extensions import db


@pytest.fixture
def engine():
    return create_engine("sqlite://")


def at_version_three(engine):
    from ehire import models  # noqa: F401

    db.metadata.create_all(engine)
    migrations.metadata.create_all(engine)
    with engine.begin() as c:
        c.exec_driver_sql("DROP TABLE archive_deposit")  # the previous release did not have it
        for v, name in ((1, "0001_initial"), (2, "0002_number_search_theta"), (3, "0003_central_roles_create")):
            c.execute(migrations.schema_version.insert().values(version=v, name=name,
                                                                applied_at=datetime.now(timezone.utc)))


def test_0004_creates_the_table_with_its_key_and_index(engine):
    at_version_three(engine)
    assert not inspect(engine).has_table("archive_deposit")
    assert migrations.upgrade(engine) == [4, 5, 6]
    insp = inspect(engine)
    cols = {c["name"] for c in insp.get_columns("archive_deposit")}
    assert cols == {"id", "request_id", "kind", "round", "state", "attempts", "last_error", "pdf_storage_ref",
                    "pdf_sha256", "manifest_json", "archive_ref", "request_outcome", "created_at", "sent_at",
                    "meta_json", "protocol_id", "protocol_number", "url", "error_code", "next_attempt_at",
                    "legal_hold", "disposed_at"}
    assert {tuple(u["column_names"]) for u in insp.get_unique_constraints("archive_deposit")} == {("request_id", "kind")}
    assert "ix_archive_deposit_state" in {i["name"] for i in insp.get_indexes("archive_deposit")}
    assert migrations.upgrade(engine) == []


def test_0004_is_safe_to_run_twice_and_the_table_works_with_the_model(engine):
    at_version_three(engine)
    migrations.upgrade(engine)
    with engine.begin() as c:
        migrations.discover()[3].module.upgrade(c)  # the body again: nothing changes, nothing fails
    cols = [c["name"] for c in inspect(engine).get_columns("archive_deposit")]
    assert cols.count("kind") == 1


def test_a_new_database_is_current_and_has_the_table(app):
    assert inspect(db.engine).has_table("archive_deposit")
    assert migrations.latest_version() == 6
