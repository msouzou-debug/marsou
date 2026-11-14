"""Operator commands: upgrade-db, db-status, create-admin, unlock-user. Nothing here takes a password as an argument."""
import click

from .extensions import db


def _ensure_role_permissions():
    """Role -> permission rows from the seed file. A real install has no demo data, but sign-in needs these."""
    from .models import RolePermission
    from .seed import load_data

    for role, keys in load_data()["role_permissions"].items():
        for key in keys:
            if db.session.get(RolePermission, (role, key)) is None:
                db.session.add(RolePermission(role=role, permission_key=key))


def _ensure_recorded_settings():
    """Settings a real install records from the start. Others fall back to the defaults in code. Value from the seed file."""
    from .models import Setting
    from .seed import load_data

    if db.session.get(Setting, "retention_years") is None:
        db.session.add(Setting(key="retention_years", value=load_data()["settings"]["retention_years"]))


def register(app):
    from .migrations import status, upgrade

    @app.cli.command("db-status")
    def db_status():
        """Print the database schema version and the newest one in the code."""
        current, latest, pending = status(db.engine)
        click.echo("current=%d latest=%d pending=%d" % (current, latest, len(pending)))
        raise SystemExit(0 if current >= latest else 2)  # 2 = behind; 1 would also mean "crashed"

    @app.cli.command("upgrade-db")
    def upgrade_db():
        """Apply pending database migrations in order. Stop the service first (deploy/README.md)."""
        done = upgrade(db.engine, log=click.echo)
        current, latest, _ = status(db.engine)
        click.echo("applied=%s current=%d latest=%d" % (",".join(map(str, done)) or "none", current, latest))

    @app.cli.command("create-admin")
    @click.option("--username", prompt="Username")
    @click.option("--full-name", prompt="Full name")
    @click.option("--email", default="", help="Optional.")
    def create_admin(username, full_name, email):
        """Create a local user with the admin role. The password is asked for, never passed as an option."""
        from .auth import hash_password
        from .models import RoleAssignment, User

        username = username.strip()
        if not username or User.query.filter(db.func.lower(User.username) == username.lower()).first():
            raise click.ClickException("That username is empty or already exists.")
        password = click.prompt("Password", hide_input=True, confirmation_prompt=True)
        if len(password) < app.config["PASSWORD_MIN_LENGTH"]:
            raise click.ClickException("The password needs at least %d characters." % app.config["PASSWORD_MIN_LENGTH"])
        user = User(username=username, full_name=full_name.strip(), email=email.strip() or None, auth_source="local",
                    password_hash=hash_password(password), must_change_password=False, language="el")
        db.session.add(user)
        db.session.flush()
        db.session.add(RoleAssignment(user_id=user.id, role="admin", directorate_id=None))
        _ensure_role_permissions()
        _ensure_recorded_settings()
        db.session.commit()
        click.echo("Admin %s created." % username)

    @app.cli.command("unlock-user")
    @click.argument("username")
    @click.option("--ip", default=None, help="Also clear the failures recorded for this address.")
    def unlock_user(username, ip):
        """Clear the sign-in lock for a username (use when an admin is locked out)."""
        from .auth import lockout
        from .models import LoginAttempt, audit

        removed = LoginAttempt.query.filter_by(username=lockout.key(username)).delete()
        if ip:
            removed += LoginAttempt.query.filter_by(ip=ip).delete()
        audit("login_unlocked", detail={"username": lockout.key(username), "attempts_cleared": removed, "by": "cli"})
        db.session.commit()
        click.echo("Cleared %d failed attempt(s) for %s." % (removed, username))
