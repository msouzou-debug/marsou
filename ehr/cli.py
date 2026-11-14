"""Operator commands: upgrade-db, db-status, backup-db, create-admin, unlock-user, ad-test.
Nothing here takes a password as an argument."""
import hashlib
import os
import sqlite3

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

    @app.cli.command("backup-db")
    @click.argument("target", type=click.Path(dir_okay=False))
    def backup_db(target):
        """Copy the SQLite database to TARGET with SQLite's online backup. Safe while the app runs (never copy the
        file by hand in WAL mode). Refuses to overwrite. Prints the sha256 of the new file."""
        from sqlalchemy.engine import make_url

        url = make_url(str(app.config["SQLALCHEMY_DATABASE_URI"]))
        if url.get_backend_name() != "sqlite" or not url.database or url.database == ":memory:":
            raise click.ClickException("backup-db works on a SQLite file database only. Use the engine's own tool.")
        source = os.path.abspath(url.database)
        if not os.path.isfile(source):
            raise click.ClickException("The database file %s does not exist." % source)
        target = os.path.abspath(target)
        if os.path.exists(target):
            raise click.ClickException("%s already exists. Choose a new name; nothing was overwritten." % target)
        folder = os.path.dirname(target)
        if not os.path.isdir(folder) or not os.access(folder, os.W_OK):
            raise click.ClickException("The folder %s does not exist or is not writable." % folder)
        temp = os.path.join(folder, ".%s.tmp-%d" % (os.path.basename(target), os.getpid()))
        try:
            src = sqlite3.connect(source, timeout=app.config["EHR_SQLITE_BUSY_TIMEOUT_MS"] / 1000.0)
            dst = sqlite3.connect(temp)
            try:
                src.backup(dst)
                dst.execute("PRAGMA journal_mode=DELETE")  # one self-contained file, no -wal or -shm to carry along
                if dst.execute("PRAGMA integrity_check").fetchone()[0] != "ok":
                    raise click.ClickException("The copy failed its integrity check. Nothing was kept.")
            finally:
                dst.close()
                src.close()
            os.chmod(temp, 0o600)
            fd = os.open(temp, os.O_RDONLY)
            try:
                os.fsync(fd)
            finally:
                os.close(fd)
            digest = hashlib.sha256()
            with open(temp, "rb") as fh:
                for block in iter(lambda: fh.read(1 << 20), b""):
                    digest.update(block)
            os.link(temp, target)  # fails if the name appeared meanwhile: never replaces a file
        except FileExistsError:
            raise click.ClickException("%s appeared while the backup ran. Nothing was overwritten." % target)
        except sqlite3.Error as err:
            raise click.ClickException("The backup failed: %s" % err)
        finally:
            if os.path.exists(temp):
                os.unlink(temp)
        click.echo("backup written: %s" % target)
        click.echo("sha256 %s" % digest.hexdigest())

    @app.cli.command("ad-test")
    @click.argument("username")
    def ad_test(username):
        """Try an Active Directory sign-in without the web app. Asks for the password (not echoed, not logged)
        and prints the name and email it read, or the kind of failure."""
        from .auth import ad

        password = click.prompt("Password", hide_input=True, default="", show_default=False)
        result = ad.authenticate(username, password)
        if not result.ok:
            click.echo("FAILED: %s (%s)" % (result.failure, ad.FAILURE_TEXT.get(result.failure, "")))
            raise SystemExit(1)
        if not result.looked_up:
            click.echo("ok: the directory accepted the credentials. EHR_AD_BASE_DN is empty, so no name or email was read.")
            return
        click.echo("ok: sign-in accepted")
        click.echo("name:  %s" % (result.full_name or "(none)"))
        click.echo("email: %s" % (result.email or "(none)"))
