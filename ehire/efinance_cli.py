"""`flask efinance-test`, `flask efinance-link none|http` and `flask sync-cost-centres` (contract 07).

Nothing here prints the token: only what eFinance answered, in plain words, and the reason codes of a failure.
"""
import click
from flask import current_app
from flask.cli import with_appcontext

from .extensions import db
from .models import Setting, audit
from .models.access import utcnow
from .services import efinance_link
from .services.activity_efinance import Unavailable
from .services.budget_efinance import current_year

REASONS = {  # plain words for the reason codes of the client
    "timeout": "no answer in time (EHIRE_EFINANCE_TIMEOUT)",
    "network": "could not connect",
    "bad_json": "the answer is not JSON",
    "bad_value": "the answer has a value eHire does not accept",
    "mismatch": "the answer is about something else than what was asked",
    "too_large": "the answer is larger than eHire accepts",
    "not_configured": "the settings do not allow the call",
    "http_401": "eFinance refused the token (401)",
    "http_403": "eFinance refused the call (403)",
}


def _reason(code):
    if code in REASONS:
        return REASONS[code]
    if code.startswith("http_3"):
        return "eFinance answered with a redirect (%s), which eHire never follows" % code[5:]
    if code.startswith("http_"):
        return "eFinance answered HTTP %s" % code[5:]
    return code


def run_test(echo, cost_centre=None):
    """Call both endpoints. Returns True when both gave a usable answer. Prints plain sentences through `echo`."""
    problems = efinance_link.check_settings()
    if problems:
        for p in problems:
            echo("settings: " + p)
        return False
    echo("address: %s" % efinance_link.client().base_url)
    ok = True
    try:
        _kind, _etag, answer = efinance_link.fetch_cost_centres()
        rows = answer["rows"]
        active = sum(1 for r in rows if r["active"])
        as_of = answer["as_of"].strftime("%Y-%m-%d %H:%M UTC") if answer["as_of"] else "not given"
        echo("cost centres: ok, %d rows (%d active), figures as of %s" % (len(rows), active, as_of))
        if not rows:
            echo("cost centres: the list is empty, so a sync would stop and change nothing")
            ok = False
        if cost_centre is None:
            cost_centre = next((r["code"] for r in rows if r["active"]), None)
    except Unavailable as exc:
        echo("cost centres: failed, %s" % _reason(exc.reason))
        ok = False
    if cost_centre is None:
        echo("budget: not tried, no cost centre to ask about (give one with --cost-centre)")
        return False
    year = current_year()
    try:
        kind, body = efinance_link.fetch_budget(cost_centre, year)
        if kind == "unknown_cost_centre":
            echo("budget: ok, eFinance does not know cost centre %s (404)" % cost_centre)
        else:
            echo("budget: ok, cost centre %s, year %d: %d line(s), figures as of %s"
                 % (cost_centre, year, len(body["lines"]), body["as_of"].strftime("%Y-%m-%d %H:%M UTC")))
    except Unavailable as exc:
        echo("budget: failed, %s" % _reason(exc.reason))
        ok = False
    return ok


@click.command("efinance-test")
@click.option("--cost-centre", default=None, help="Cost-centre code to ask the budget of (default: the first active one).")
@with_appcontext
def efinance_test_command(cost_centre):
    """Call eFinance's two endpoints and say what came back. Works whatever the link setting is."""
    ok = run_test(click.echo, cost_centre)
    click.echo("efinance-test: %s" % ("passed" if ok else "failed"))
    raise SystemExit(0 if ok else 1)


@click.command("efinance-link")
@click.argument("name", required=False, type=click.Choice(efinance_link.NAMES))
@with_appcontext
def efinance_link_command(name):
    """Show the eFinance link, or set it: none (default, never calls eFinance) or http (only after a passing test)."""
    before = efinance_link.link_name()
    if name is None or name == before:
        click.echo("efinance_link=%s" % before)
        return
    if name == "http" and not run_test(click.echo):
        raise click.ClickException("efinance-test did not pass, so the link stays %s." % before)
    row = db.session.get(Setting, efinance_link.SETTING)
    if row is None:
        row = Setting(key=efinance_link.SETTING)
        db.session.add(row)
    row.value, row.updated_at = name, utcnow()
    audit("setting_changed", object_type="setting", object_id=efinance_link.SETTING,
          detail={"before": before, "after": name})
    db.session.commit()
    click.echo("efinance_link=%s" % name)


@click.command("sync-cost-centres")
@with_appcontext
def sync_cost_centres_command():
    """Bring the cost centres in line with eFinance (nightly from cron). One line of result; exit 1 on failure."""
    from .services.cost_centre_sync import sync

    result = sync()
    click.echo(result.line())
    raise SystemExit(0 if result.ok else 1)


def register(app):
    app.cli.add_command(efinance_test_command)
    app.cli.add_command(efinance_link_command)
    app.cli.add_command(sync_cost_centres_command)
