"""`flask run-timers`: called by cron. Reminders, escalations, returned-request warnings and automatic withdrawal."""
from datetime import datetime, timezone

import click
from flask.cli import with_appcontext

from ..services.request_timers import run_timers
from .requests import bp


@click.command("run-timers")
@click.option("--at", "at", default=None, help="Run as if it were this time (ISO 8601). For testing.")
@with_appcontext
def run_timers_command(at):
    """Send due reminders and escalations, warn and withdraw returned requests that were not resubmitted."""
    now = datetime.fromisoformat(at) if at else datetime.now(timezone.utc)
    if now.tzinfo is None:
        now = now.replace(tzinfo=timezone.utc)
    counts = run_timers(now)
    click.echo("reminders=%(reminders)d escalations=%(escalations)d warnings=%(warnings)d withdrawn=%(withdrawn)d" % counts)


bp.record_once(lambda state: state.app.cli.add_command(run_timers_command))
