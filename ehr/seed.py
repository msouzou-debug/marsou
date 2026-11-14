"""Demo data and CLI commands. All invented. Data lives in seed_data.json (UTF-8)."""
import json
from datetime import date
from pathlib import Path

import click

from .auth import hash_password
from .extensions import db
from .models import (CostCentre, Directorate, Facility, OaySpecialty, Position, PublicHoliday, RoleAssignment,
                     RolePermission, Setting, User, UserDirectorate)

DATA_FILE = Path(__file__).parent / "seed_data.json"


def load_data():
    with open(DATA_FILE, encoding="utf-8") as fh:
        return json.load(fh)


def seed_demo(data=None):
    """Insert demo data. Safe to run twice: rows found by their natural key are left alone."""
    data = data or load_data()

    for key, value in data["settings"].items():
        if db.session.get(Setting, key) is None:
            db.session.add(Setting(key=key, value=value))

    dirs = {}
    for d in data["directorates"]:
        row = Directorate.query.filter_by(code=d["code"]).first()
        if row is None:
            row = Directorate(**d)
            db.session.add(row)
        dirs[d["code"]] = row
    db.session.flush()

    for f in data["facilities"]:
        d = dirs[f["directorate"]]
        if not Facility.query.filter_by(directorate_id=d.id, code=f["code"]).first():
            db.session.add(Facility(directorate_id=d.id, code=f["code"], name_el=f["name_el"], name_en=f["name_en"]))
    for p in data["positions"]:
        if not Position.query.filter_by(category=p["category"], title_en=p["title_en"]).first():
            db.session.add(Position(**p))
    for c in data["cost_centres"]:
        if not CostCentre.query.filter_by(code=c["code"]).first():
            db.session.add(CostCentre(**c))
    for name in data["oay_specialties"]:
        if not OaySpecialty.query.filter_by(name=name).first():
            db.session.add(OaySpecialty(name=name))
    for h in data["public_holidays"]:
        day = date.fromisoformat(h["date"])
        if db.session.get(PublicHoliday, day) is None:
            db.session.add(PublicHoliday(date=day, name_el=h["name_el"], name_en=h["name_en"]))
    for role, keys in data["role_permissions"].items():
        for key in keys:
            if db.session.get(RolePermission, (role, key)) is None:
                db.session.add(RolePermission(role=role, permission_key=key))

    pw_hash = hash_password(data["demo_password"])
    users = {}
    for u in data["users"]:
        row = User.query.filter_by(username=u["username"]).first()
        if row is None:
            row = User(password_hash=pw_hash, auth_source="local", must_change_password=False, **u)
            db.session.add(row)
        users[u["username"]] = row
    db.session.flush()

    for username, manager in data["line_managers"].items():
        if users[username].line_manager_user_id is None:
            users[username].line_manager_user_id = users[manager].id
    for a in data["role_assignments"]:
        dir_id = dirs[a["directorate"]].id if a["directorate"] else None
        user = users[a["user"]]
        if not RoleAssignment.query.filter_by(user_id=user.id, role=a["role"], directorate_id=dir_id).first():
            sub = users[a["substitute"]].id if a["substitute"] else None
            db.session.add(RoleAssignment(user_id=user.id, role=a["role"], directorate_id=dir_id, substitute_user_id=sub))
    for username, code in data["user_directorates"]:
        key = (users[username].id, dirs[code].id)
        if db.session.get(UserDirectorate, key) is None:
            db.session.add(UserDirectorate(user_id=key[0], directorate_id=key[1]))
    db.session.commit()


def _refuse_in_production(app):
    """Demo data has a known password and invented people. It must never reach a production database."""
    if app.config.get("EHR_ENV") == "production":
        raise click.ClickException("Demo data is not loaded in production (EHR_ENV=production).")


def register_cli(app):
    @app.cli.command("init-db")
    def init_db():
        """Create all tables and mark the schema as current (see ehr/migrations/README.md)."""
        from sqlalchemy import inspect

        from .migrations import stamp_latest

        existed = inspect(db.engine).has_table("user")
        db.create_all()
        if existed:
            click.echo("Tables checked. This database already existed: run `flask upgrade-db` to bring it up to date.")
            return
        stamp_latest(db.engine)
        click.echo("Tables created.")

    @app.cli.command("seed-demo")
    def seed_demo_cmd():
        """Load invented demo data (idempotent). Refused in production."""
        _refuse_in_production(app)
        db.create_all()
        seed_demo()
        click.echo("Demo data loaded. Demo password for every user: %s" % load_data()["demo_password"])

    @app.cli.command("seed-cases")
    def seed_cases_cmd():
        """Create invented sample requests through the engine (idempotent). Run seed-demo first. Refused in production."""
        _refuse_in_production(app)
        from datetime import datetime, timezone

        from .services.request_seed_cases import seed_cases

        created = seed_cases(datetime.now(timezone.utc))
        click.echo("Sample requests created: %s" % (", ".join(created) if created else "none (already there)"))
