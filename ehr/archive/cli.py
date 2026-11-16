"""`flask send-archive` (cron) and `flask archive-transport`."""
import click
from flask.cli import with_appcontext

from ..extensions import db
from ..models import Setting, audit
from ..models.access import utcnow
from .queue import flush
from .transports import NAMES, transport_name


@click.command("send-archive")
@click.option("--limit", default=50, show_default=True, help="Most deposits to try in one run.")
@with_appcontext
def send_archive_command(limit):
    """Make the PDFs of queued deposits and hand them to the archive transport (retries failed ones, 10 attempts)."""
    counts = flush(limit=limit)
    click.echo("rendered=%(rendered)d stored=%(stored)d failed=%(failed)d waiting=%(waiting)d" % counts)


@click.command("archive-transport")
@click.argument("name", required=False, type=click.Choice(NAMES))
@with_appcontext
def archive_transport_command(name):
    """Show the archive transport, or set it: none (default, sends nothing), folder or http."""
    before = transport_name()
    if name is None or name == before:
        click.echo("archive_transport=%s" % before)
        return
    row = db.session.get(Setting, "archive_transport")
    if row is None:
        row = Setting(key="archive_transport")
        db.session.add(row)
    row.value, row.updated_at = name, utcnow()
    audit("setting_changed", object_type="setting", object_id="archive_transport",
          detail={"before": before, "after": name})
    db.session.commit()
    click.echo("archive_transport=%s" % name)


def register(app):
    app.cli.add_command(send_archive_command)
    app.cli.add_command(archive_transport_command)
