"""`flask efinance-test`, `flask efinance-link none|http`, `flask efinance-budget off|exists|figures` and
`flask sync-cost-centres` (contract 07).

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
from .services import budget_efinance
from .services.budget_efinance import current_year

INVOICES_ONLY = "efinance_invoices_only"

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
            echo("budget: ok, " + budget_summary(cost_centre, year, body))
    except Unavailable as exc:
        echo("budget: failed, %s" % _reason(exc.reason))
        ok = False
    return ok


def _covers(body):
    """The distinct `spent_covers` values of the salary lines, as text ("not given" when none says)."""
    found = sorted({l["spent_covers"] for l in body["lines"] if l["spent_covers"]})
    return ", ".join(found) if found else "not given"


def budget_summary(cost_centre, year, body):
    """One plain sentence on a budget answer: salary lines, how many have a budget, and what «spent» covers."""
    lines = body["lines"]
    loaded = sum(1 for l in lines if l["budget"] is not None)
    entity = body["entity_code"] or "not given"
    return ("cost centre %s (entity %s), year %d: %d salary line(s) came back, %d with a budget loaded; "
            "spent_covers: %s" % (cost_centre, entity, year, len(lines), loaded, _covers(body)))


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


def _first_active_cost_centre():
    from .models import CostCentre

    row = CostCentre.query.filter_by(is_active=True).order_by(CostCentre.code).first()
    return row.code if row else None


def figures_allowed(echo, cost_centre=None):
    """True when a fresh budget answer from eFinance says its «spent» includes salaries: every salary line carries a
    `spent_covers` other than efinance_invoices_only. Prints what it found."""
    if efinance_link.check_settings():
        echo("budget: not tried, the eFinance settings do not allow a call (run flask efinance-test)")
        return False
    cost_centre = cost_centre or _first_active_cost_centre()
    if cost_centre is None:
        echo("budget: not tried, no cost centre to ask about (give one with --cost-centre)")
        return False
    year = current_year()
    try:
        kind, body = efinance_link.fetch_budget(cost_centre, year)
    except Unavailable as exc:
        echo("budget: failed, %s" % _reason(exc.reason))
        return False
    if kind == "unknown_cost_centre":
        echo("budget: eFinance does not know cost centre %s (404)" % cost_centre)
        return False
    echo("budget: " + budget_summary(cost_centre, year, body))
    covers = [l["spent_covers"] for l in body["lines"]]
    if not covers:
        echo("budget: no salary line came back, so eHire cannot tell what «spent» covers")
        return False
    if any(c in (None, INVOICES_ONLY) for c in covers):
        echo("budget: eFinance's «spent» does not include salaries, so the amounts would mislead")
        return False
    return True


@click.command("efinance-budget")
@click.argument("mode", required=False, type=click.Choice(budget_efinance.MODES))
@click.option("--i-know-salaries-are-missing", "forced", is_flag=True,
              help="Switch to figures although eFinance's «spent» leaves out salaries.")
@click.option("--cost-centre", default=None, help="Cost-centre code to check with (default: the first active one).")
@with_appcontext
def efinance_budget_command(mode, forced, cost_centre):
    """Show the budget check of steps 2 and 4, or set it: off, exists (default: whether a budget is loaded, no
    amounts) or figures (amounts; refused while eFinance's spending leaves out salaries)."""
    before = budget_efinance.budget_mode()
    if mode is None or mode == before:
        click.echo("efinance_budget=%s" % before)
        return
    overridden = False
    if mode == "figures" and not figures_allowed(click.echo, cost_centre):
        overridden = True
        if not forced:
            raise click.ClickException("efinance_budget stays %s. Use --i-know-salaries-are-missing to switch "
                                       "to figures anyway." % before)
        click.echo("budget: switched to figures anyway (--i-know-salaries-are-missing)")
    row = db.session.get(Setting, budget_efinance.SETTING)
    if row is None:
        row = Setting(key=budget_efinance.SETTING)
        db.session.add(row)
    row.value, row.updated_at = mode, utcnow()
    detail = {"before": before, "after": mode}
    if overridden:
        detail["forced"] = True  # --i-know-salaries-are-missing
    audit("setting_changed", object_type="setting", object_id=budget_efinance.SETTING, detail=detail)
    db.session.commit()
    budget_efinance.clear_cache()
    click.echo("efinance_budget=%s" % mode)


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
    app.cli.add_command(efinance_budget_command)
    app.cli.add_command(sync_cost_centres_command)
