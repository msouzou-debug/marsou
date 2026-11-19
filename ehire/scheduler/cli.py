"""`flask run-timers` and `flask send-mail`, for cron (see deploy/README.md)."""
from datetime import datetime, timezone

import click
from flask.cli import with_appcontext

from ..mail.outbox import flush
from .timers import run_timers


@click.command("run-timers")
@click.option("--at", "at", default=None, help="Run as if it were this time (ISO 8601). For testing.")
@with_appcontext
def run_timers_command(at):
    """Queue due reminders, escalations and warnings; withdraw returned requests that were not resubmitted."""
    now = datetime.fromisoformat(at) if at else datetime.now(timezone.utc)
    if now.tzinfo is None:
        now = now.replace(tzinfo=timezone.utc)
    counts = run_timers(now)
    click.echo("reminders=%(reminders)d escalations=%(escalations)d warnings=%(warnings)d withdrawn=%(withdrawn)d" % counts)


@click.command("send-mail")
@click.option("--limit", default=100, show_default=True, help="Most messages to try in one run.")
@with_appcontext
def send_mail_command(limit):
    """Send queued emails through the configured backend; retry failed ones up to 5 attempts."""
    counts = flush(limit=limit)
    click.echo("sent=%(sent)d failed=%(failed)d expired=%(expired)d" % counts)


def register(app):
    app.cli.add_command(run_timers_command)
    app.cli.add_command(send_mail_command)
