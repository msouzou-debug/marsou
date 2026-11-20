import json
from datetime import date
from pathlib import Path

from ehire.auth import hash_password
from ehire.extensions import db
from ehire.models import AuditLog, LoginAttempt, PublicHoliday, RoleAssignment, User
from ehire.workflow.holidays import FIXED, MOVABLE

from tests.conftest import login


def test_load_holidays_adds_the_year_and_skips_dates_already_there(app):
    db.session.add(PublicHoliday(date=date(2026, 1, 1), name_el="x", name_en="Own name"))
    db.session.commit()
    result = app.test_cli_runner().invoke(args=["load-holidays", "--year", "2026"])
    assert result.exit_code == 0, result.output
    assert "2026: added 15, already there 1" in result.output
    rows = {h.date: h for h in PublicHoliday.query.all()}
    assert len(rows) == len(FIXED) + len(MOVABLE)
    assert rows[date(2026, 1, 1)].name_en == "Own name"  # not overwritten
    assert rows[date(2026, 4, 10)].name_en == "Good Friday" and rows[date(2026, 4, 10)].name_el
    again = app.test_cli_runner().invoke(args=["load-holidays", "--year", "2026"])
    assert "added 0, already there 16" in again.output
    assert AuditLog.query.filter_by(event="setting_changed", object_type="public_holiday").count() == 15


def test_load_holidays_repeatable_and_default_years(app):
    runner = app.test_cli_runner()
    assert runner.invoke(args=["load-holidays", "--year", "2027", "--year", "2028"]).exit_code == 0
    assert PublicHoliday.query.filter(PublicHoliday.date == date(2027, 5, 3)).count() == 1  # Easter Monday 2027
    assert runner.invoke(args=["load-holidays"]).exit_code == 0
    years = {h.date.year for h in PublicHoliday.query.all()}
    assert {2027, 2028} <= years and len(years) >= 3
    assert runner.invoke(args=["load-holidays", "--year", "1800"]).exit_code != 0


def test_holiday_names_cover_every_key():
    names = json.loads((Path("ehire/workflow/holiday_names.json")).read_text(encoding="utf-8"))
    for key, *_ in FIXED + MOVABLE:
        assert names[key]["name_el"] and names[key]["name_en"]


def _local_user(username="boss", ok=True):
    user = User(username=username, full_name="B", auth_source="local", password_hash=hash_password("Old-Password-1"),
                must_change_password=False)
    db.session.add(user)
    db.session.flush()
    db.session.add(RoleAssignment(user_id=user.id, role="admin"))
    db.session.commit()
    return user


def test_reset_password_sets_the_hash_forces_a_change_clears_the_lock_and_audits(app):
    user = _local_user()
    db.session.add(LoginAttempt(username="boss", ip="1.2.3.4"))
    db.session.add(LoginAttempt(username="other", ip="1.2.3.4"))
    db.session.commit()
    result = app.test_cli_runner().invoke(args=["reset-password", "BOSS"], input="New-Password-9\nNew-Password-9\n")
    assert result.exit_code == 0, result.output
    assert "New-Password-9" not in result.output
    db.session.refresh(user)
    assert user.must_change_password is True
    assert LoginAttempt.query.filter_by(username="boss").count() == 0
    assert LoginAttempt.query.filter_by(username="other").count() == 1
    row = AuditLog.query.filter_by(event="password_changed").one()
    assert row.user_id == user.id and json.loads(row.detail_json)["by"] == "cli"
    client = app.test_client()
    assert login(client, "boss", "Old-Password-1").status_code == 200  # old password refused
    assert login(client, "boss", "New-Password-9").status_code == 302


def test_reset_password_refuses_short_unknown_and_directory_accounts(app):
    user = _local_user()
    runner = app.test_cli_runner()
    short = runner.invoke(args=["reset-password", "boss"], input="short\nshort\n")
    assert short.exit_code != 0 and "at least" in short.output
    mismatch = runner.invoke(args=["reset-password", "boss"], input="New-Password-9\nNew-Password-8\nx\nx\n")
    assert user.must_change_password is False and AuditLog.query.filter_by(event="password_changed").count() == 0
    assert runner.invoke(args=["reset-password", "nobody"]).exit_code != 0
    ad = User(username="ad.person", full_name="A", auth_source="ad", is_active=True)
    db.session.add(ad)
    db.session.commit()
    result = runner.invoke(args=["reset-password", "ad.person"], input="New-Password-9\nNew-Password-9\n")
    assert result.exit_code != 0 and "Active Directory" in result.output
    assert ad.password_hash is None
