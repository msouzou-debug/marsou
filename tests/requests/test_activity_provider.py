"""ΟΑΥ activity figures: manual and eFinance sources (Phase 5). The eFinance side is a fake server on localhost."""
import json
import logging
import re
import threading
import time
from decimal import Decimal
from http.server import BaseHTTPRequestHandler, HTTPServer
from urllib.parse import parse_qs, urlsplit

import pytest

from ehr.extensions import db
from ehr.models import AuditLog, OaySpecialty, Request, RequestFinancials, Setting
from ehr.services import activity
from ehr.services.activity_efinance import EFinanceClient
from tests.requests.flowhelpers import act, as_user, create, fin_fields, reload, step2, step3, step4, text

TOKEN = "tok-9f3c1d-never-show"


def good(facility, specialty, month="2026-08", visits=51000, revenue="1300000.75"):
    return {"facility_code": facility, "specialty": specialty, "data_month": month,
            "prev_year": {"year": 2025, "visits": visits, "procedures": 9900, "revenue": revenue},
            "ytd": {"year": 2026, "visits": 40100, "procedures": 7400, "revenue": 990000}}


class Fake:
    """A small eFinance. `known` maps specialty name to a body builder; `mode` overrides the answer."""

    def __init__(self):
        self.calls, self.mode, self.known, self.delay, self.body = [], None, {}, 0, None

        fake = self

        class Handler(BaseHTTPRequestHandler):
            def log_message(self, *a):
                pass

            def do_GET(self):
                parts = urlsplit(self.path)
                query = {k: v[0] for k, v in parse_qs(parts.query).items()}
                fake.calls.append({"path": parts.path, "query": query, "auth": self.headers.get("Authorization")})
                if fake.delay:
                    time.sleep(fake.delay)
                code, payload = 200, None
                if fake.mode == "redirect":
                    self.send_response(302)
                    self.send_header("Location", "http://127.0.0.1:1/x")
                    self.end_headers()
                    return
                if isinstance(fake.mode, int):
                    code, payload = fake.mode, b"{}"
                elif fake.mode == "badjson":
                    payload = b"{not json"
                elif fake.mode == "huge":
                    payload = b"x" * 200000
                elif fake.body is not None:
                    payload = json.dumps(fake.body).encode()
                else:
                    build = fake.known.get(query.get("specialty"))
                    if build is None:
                        code, payload = 404, b"{}"
                    else:
                        payload = json.dumps(build(query["facility_code"], query["specialty"])).encode()
                self.send_response(code)
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(payload)))
                self.end_headers()
                self.wfile.write(payload)

        self.server = HTTPServer(("127.0.0.1", 0), Handler)
        self.url = "http://127.0.0.1:%d" % self.server.server_address[1]
        threading.Thread(target=self.server.serve_forever, daemon=True).start()

    def stop(self):
        self.server.shutdown()
        self.server.server_close()


@pytest.fixture
def fake():
    f = Fake()
    yield f
    f.stop()


@pytest.fixture(autouse=True)
def _fresh_cache():
    activity.clear_cache()
    yield
    activity.clear_cache()


def use_efinance(app, fake=None, configured=True):
    app.config["EHR_EFINANCE_URL"] = fake.url if (fake and configured) else ""
    app.config["EHR_EFINANCE_TOKEN"] = TOKEN if configured else ""
    app.config["EHR_EFINANCE_TIMEOUT"] = 1.0
    db.session.merge(Setting(key="activity_provider", value="efinance"))
    db.session.commit()


def spec(name="Cardiology"):
    return OaySpecialty.query.filter_by(name=name).one()


def page(client, rid, user="nic.accountant"):
    as_user(client, user)
    return text(client.get("/requests/%d?lang=en" % rid))


def input_of(html, name):
    m = re.search(r'<input[^>]*name="%s"[^>]*>' % re.escape(name), html)
    assert m, name
    return m.group(0)


def value_of(html, name):
    m = re.search(r'value="([^"]*)"', input_of(html, name))
    return m.group(1) if m else ""


def refresh(client, rid, specialty, user="nic.accountant", **extra):
    as_user(client, user)
    data = {"role": "dir_accountant", "refresh": "1", "oay_specialty_id": str(specialty.id)}
    data.update(extra)
    return text(client.post("/requests/%d/action?lang=en" % rid, data=data))


def check_post(client, rid, specialty, **over):
    fields = fin_fields(specialty.id)
    fields.update(over)
    return act(client, "nic.accountant", rid, "check", position="yes", funds="yes", **fields)


def rows_of(rid):
    db.session.expire_all()
    return {r.period: r for r in RequestFinancials.query.filter_by(request_id=rid)}


# ---------------------------------------------------------------- settings

def test_default_is_manual_and_manual_card_is_unchanged(seeded, client):
    req = create(client)
    html = page(client, req.id)
    assert activity.chosen_provider_name() == "manual"
    assert "readonly" not in input_of(html, "fin.prev_year.visits")
    assert "data-ehr-refresh" not in html and "Typed by hand" in html
    step2(client, req.id)
    assert {r.source for r in rows_of(req.id).values()} == {"manual"}
    assert rows_of(req.id)["ytd"].source_snapshot_json is None


def test_settings_option_blocked_when_not_configured(seeded, client, app):
    as_user(client, "demo.admin")
    html = text(client.get("/settings/timings?lang=en"))
    assert 'id="t-provider-efinance"' in html and re.search(r'id="t-provider-efinance"[^>]*disabled', html)
    assert "not set up on the server" in html
    resp = client.post("/settings/timings", data={"reminder_days": "2", "escalation_days": "5",
                                                  "returned_timeout_days": "30", "max_file_mb": "20",
                                                  "activity_provider": "efinance", "lang": "en"})
    assert resp.status_code == 400 and activity.chosen_provider_name() == "manual"


def test_admin_saves_provider_and_it_is_audited(seeded, client, app, fake):
    app.config.update(EHR_EFINANCE_URL=fake.url, EHR_EFINANCE_TOKEN=TOKEN)
    as_user(client, "demo.admin")
    base = {"reminder_days": "2", "escalation_days": "5", "returned_timeout_days": "30", "max_file_mb": "20"}
    html = text(client.get("/settings/timings?lang=en"))
    assert not re.search(r'id="t-provider-efinance"[^>]*disabled', html)
    assert client.post("/settings/timings", data=dict(base, activity_provider="efinance")).status_code == 302
    assert activity.chosen_provider_name() == "efinance" and isinstance(activity.get_provider(), activity.EFinanceActivityProvider)
    row = AuditLog.query.filter_by(event="setting_changed", object_id="activity_provider").one()
    assert json.loads(row.detail_json) == {"before": "manual", "after": "efinance"}
    assert client.post("/settings/timings", data=dict(base, activity_provider="bogus")).status_code == 400
    assert client.post("/settings/timings", data=base).status_code == 302  # absent: unchanged
    assert activity.chosen_provider_name() == "efinance"
    assert client.post("/settings/timings", data=dict(base, activity_provider="manual")).status_code == 302
    assert isinstance(activity.get_provider(), activity.ManualEntryProvider)


def test_non_admin_cannot_reach_the_setting(seeded, client):
    as_user(client, "nic.accountant")
    assert client.post("/settings/timings", data={"activity_provider": "manual"}).status_code == 404


def test_efinance_setting_without_link_behaves_as_manual(seeded, client, app):
    use_efinance(app, configured=False)
    assert isinstance(activity.get_provider(), activity.ManualEntryProvider)
    req = create(client)
    assert "readonly" not in input_of(page(client, req.id), "fin.prev_year.visits")


# ---------------------------------------------------------------- figures path

def test_figures_show_read_only_and_tampered_post_is_ignored(seeded, client, app, fake):
    use_efinance(app, fake)
    fake.known["Cardiology"] = good
    req = create(client)
    db.session.get(Request, req.id).oay_specialty_id = spec().id
    db.session.commit()
    html = page(client, req.id)
    for line, shown in (("visits", "51.000"), ("procedures", "9.900"), ("revenue", "1.300.000,75")):
        tag = input_of(html, "fin.prev_year." + line)
        assert " readonly" in tag and 'value="%s"' % shown in tag
    assert value_of(html, "fin.ytd.revenue") == "990.000,00"
    assert value_of(html, "oay_data_month") == "08/2026" and value_of(html, "payroll_to_month") == "08/2026"
    assert " readonly" not in input_of(html, "fin.prev_year.payroll_cost")
    assert "From the ΟΑΥ data held in eFinance, to 08/2026" in html and "data-ehr-refresh" in html
    assert fake.calls[0]["query"] == {"facility_code": "NIC01" if False else fake.calls[0]["query"]["facility_code"],
                                      "specialty": "Cardiology"}
    assert fake.calls[0]["auth"] == "Bearer " + TOKEN and fake.calls[0]["path"] == "/api/oay-activity"

    count = len(fake.calls)
    resp = check_post(client, req.id, spec(), **{"fin.prev_year.visits": "1", "fin.prev_year.revenue": "5,00",
                                                 "fin.ytd.procedures": "2", "oay_data_month": "01/2020"})
    assert resp.status_code == 302
    assert len(fake.calls) == count  # the post used the figures the page showed
    rows = rows_of(req.id)
    assert rows["prev_year"].visits == 51000 and rows["prev_year"].revenue == Decimal("1300000.75")
    assert rows["ytd"].procedures == 7400 and rows["ytd"].revenue == Decimal("990000.00")
    assert rows["prev_year"].payroll_cost == Decimal("812400.00") and rows["ytd"].headcount == Decimal("14.50")
    assert rows["prev_year"].source == "provider" and rows["prev_year"].oay_data_month.isoformat() == "2026-08-01"
    snap = json.loads(rows["prev_year"].source_snapshot_json)
    assert snap["source"] == "efinance" and snap["response"]["data_month"] == "2026-08"
    assert snap["response"]["prev_year"]["revenue"] == "1300000.75" and snap["response"]["ytd"]["year"] == 2026

    # the request reads the same later, whatever eFinance holds now
    fake.known["Cardiology"] = lambda f, s: good(f, s, visits=1, revenue="1.00")
    as_user(client, "central.ceo")
    shown = text(client.get("/requests/%d?lang=en" % req.id))
    assert "51.000" in shown and "1.300.000,75" in shown and "From the ΟΑΥ data held in eFinance, to 08/2026" in shown


def test_post_without_a_prior_page_fetches_by_itself(seeded, client, app, fake):
    use_efinance(app, fake)
    fake.known["Cardiology"] = good
    req = create(client)
    assert check_post(client, req.id, spec(), **{"fin.prev_year.visits": "7"}).status_code == 302
    assert rows_of(req.id)["prev_year"].visits == 51000 and len(fake.calls) == 1


def test_specialty_change_and_refresh_reload_the_lines(seeded, client, app, fake):
    use_efinance(app, fake)
    fake.known["Cardiology"] = good
    fake.known["Paediatrics"] = lambda f, s: good(f, s, visits=12345, month="2026-07")
    req = create(client)
    page(client, req.id)
    html = text(client.post("/requests/%d/action?lang=en" % req.id, data={
        "role": "dir_accountant", "refresh": "1", "action": "check", "position": "yes", "funds": "yes",
        "oay_specialty_id": str(spec("Paediatrics").id), "payroll_to_month": "", "fin.prev_year.payroll_cost": "100,00"}))
    assert value_of(html, "fin.prev_year.visits") == "12.345" and value_of(html, "oay_data_month") == "07/2026"
    assert value_of(html, "fin.prev_year.payroll_cost") == "100,00"  # what the Accountant typed stays
    assert "to 07/2026" in html
    assert rows_of(req.id) == {}  # a refresh stores nothing
    assert check_post(client, req.id, spec("Paediatrics")).status_code == 302
    assert rows_of(req.id)["prev_year"].visits == 12345


def test_refresh_asks_again_instead_of_using_the_cache(seeded, client, app, fake):
    use_efinance(app, fake)
    fake.known["Cardiology"] = good
    req = create(client)
    page(client, req.id)
    fake.known["Cardiology"] = lambda f, s: good(f, s, visits=777)
    html = refresh(client, req.id, spec())
    assert value_of(html, "fin.prev_year.visits") == "777"


def test_alias_is_tried_when_the_first_name_has_no_data(seeded, client, app, fake):
    use_efinance(app, fake)
    s = spec()
    s.aliases_json = json.dumps(["Cardiac Services", "Heart"])
    db.session.commit()
    fake.known["Heart"] = good
    req = create(client)
    assert check_post(client, req.id, s).status_code == 302
    assert [c["query"]["specialty"] for c in fake.calls] == ["Cardiology", "Cardiac Services", "Heart"]
    snap = json.loads(rows_of(req.id)["ytd"].source_snapshot_json)
    assert snap["request"]["specialty"] == "Heart" and rows_of(req.id)["ytd"].source == "provider"


# ---------------------------------------------------------------- fallbacks

def _fallback(client, app, fake, notice, reason, mode=None, body=None, delay=0):
    use_efinance(app, fake)
    fake.mode, fake.body, fake.delay = mode, body, delay
    req = create(client)
    html = page(client, req.id)
    html = refresh(client, req.id, spec())
    assert notice in html
    assert " readonly" not in input_of(html, "fin.prev_year.visits")
    resp = check_post(client, req.id, spec())  # typed in full
    assert resp.status_code == 302
    rows = rows_of(req.id)
    assert rows["prev_year"].source == "manual" and rows["prev_year"].visits == 48200
    snap = json.loads(rows["prev_year"].source_snapshot_json)
    assert snap["reason"] == reason and snap["source"] == "manual"
    return req


def test_no_data_falls_back_to_typing(seeded, client, app, fake):
    _fallback(client, app, fake, "eFinance has no ΟΑΥ figures", "no_data")


@pytest.mark.parametrize("mode,reason", [(500, "http_500"), (401, "http_401"), (403, "http_403"),
                                         ("badjson", "bad_json"), ("huge", "too_large"), ("redirect", "http_302")])
def test_unavailable_falls_back_to_typing(seeded, client, app, fake, mode, reason):
    _fallback(client, app, fake, "could not be loaded from eFinance", reason, mode=mode)


def test_timeout_falls_back_to_typing(seeded, client, app, fake):
    app.config["EHR_EFINANCE_TIMEOUT"] = 0.3
    started = time.monotonic()
    use_efinance(app, fake)
    app.config["EHR_EFINANCE_TIMEOUT"] = 0.3
    fake.delay = 1.2
    fake.known["Cardiology"] = good
    req = create(client)
    html = refresh(client, req.id, spec())
    assert "could not be loaded from eFinance" in html and time.monotonic() - started < 3


def test_unreachable_server_falls_back(seeded, client, app, fake):
    use_efinance(app, fake)
    fake.stop()
    app.config["EHR_EFINANCE_TIMEOUT"] = 0.5
    req = create(client)
    html = refresh(client, req.id, spec())
    assert "could not be loaded from eFinance" in html
    fake.__init__()  # so the fixture can stop a live server


@pytest.mark.parametrize("patch", [
    lambda b: b["prev_year"].update(visits=-1),
    lambda b: b["ytd"].update(revenue="-5.00"),
    lambda b: b["ytd"].update(revenue=-5),
    lambda b: b["ytd"].update(procedures=1.5),
    lambda b: b["ytd"].update(visits="12"),
    lambda b: b["ytd"].update(revenue="abc"),
    lambda b: b["ytd"].update(revenue="NaN"),
    lambda b: b["ytd"].update(revenue=True),
    lambda b: b.update(data_month="2026-13"),
    lambda b: b.update(data_month="08/2026"),
    lambda b: b["ytd"].update(year=2025),
    lambda b: b["prev_year"].update(visits=10 ** 12),
    lambda b: b.update(facility_code="OTHER"),
    lambda b: b.update(specialty="Other"),
])
def test_invalid_values_are_rejected(patch):
    body = good("NIC01", "Cardiology")
    patch(body)
    from ehr.services.activity_efinance import Unavailable, validate
    with pytest.raises(Unavailable):
        validate(body, "NIC01", "Cardiology")


def test_valid_body_passes_and_nulls_mean_no_data():
    from ehr.services.activity_efinance import NoData, validate
    out = validate(good("NIC01", "Cardiology"), "NIC01", "Cardiology")
    assert out["prev_year"]["revenue"] == Decimal("1300000.75") and out["ytd"]["revenue"] == Decimal("990000.00")
    body = good("NIC01", "Cardiology")
    body["ytd"] = None
    with pytest.raises(NoData):
        validate(body, "NIC01", "Cardiology")


def test_negative_numbers_from_the_server_mean_unavailable(seeded, client, app, fake):
    use_efinance(app, fake)
    fake.body = good("x", "y")
    bad = dict(fake.body, prev_year=dict(fake.body["prev_year"], visits=-4))
    fake.known["Cardiology"] = lambda f, s: dict(bad, facility_code=f, specialty=s)
    req = create(client)
    html = refresh(client, req.id, spec())
    assert "could not be loaded from eFinance" in html


def test_client_refuses_remote_plain_http_and_missing_token():
    assert not EFinanceClient("http://efinance.example", "t").configured()
    assert not EFinanceClient("https://efinance.example", "").configured()
    assert not EFinanceClient("", "t").configured()
    assert EFinanceClient("https://efinance.example/", "t").configured()
    assert EFinanceClient("http://127.0.0.1:9", "t").configured()


# ---------------------------------------------------------------- secrets and the whole flow

def test_token_never_in_logs_audit_rows_pages_or_snapshots(seeded, client, app, fake, caplog):
    use_efinance(app, fake)
    caplog.set_level(logging.DEBUG)
    fake.mode = 500
    req = create(client)
    pages = [refresh(client, req.id, spec()), page(client, req.id)]
    check_post(client, req.id, spec())
    as_user(client, "demo.admin")
    pages.append(text(client.get("/settings/timings?lang=en")))
    assert not any(TOKEN in p for p in pages)
    assert TOKEN not in caplog.text and "Bearer" not in caplog.text
    assert "unavailable" in caplog.text
    dump = json.dumps([[r.event, r.detail_json] for r in AuditLog.query.all()], default=str)
    assert TOKEN not in dump
    assert TOKEN not in json.dumps([r.source_snapshot_json for r in RequestFinancials.query.all()])
    assert not any(TOKEN in str(v) for k, v in db.session.query(Setting.key, Setting.value).all())


def test_nothing_personal_is_sent(seeded, client, app, fake):
    use_efinance(app, fake)
    fake.known["Cardiology"] = good
    req = create(client)
    check_post(client, req.id, spec())
    assert set(fake.calls[0]["query"]) == {"facility_code", "specialty"}


@pytest.mark.parametrize("provider", ["manual", "efinance"])
def test_scenario_1_end_to_end_with_each_provider(seeded, client, app, fake, provider):
    if provider == "efinance":
        use_efinance(app, fake)
        fake.known["Internal Medicine"] = good
    req = create(client, category="medical")
    rid = req.id
    step2(client, rid, financials=True, **{})
    r = reload(rid)
    assert (r.current_step, r.step3_phase) == (3, "inputs")
    step3(client, rid)
    step4(client, rid)
    assert act(client, "central.medical", rid, "opinion", opinion="positive", comment="Fine.").status_code == 302
    assert act(client, "central.ceo", rid, "approve").status_code == 302
    assert reload(rid).status == "approved"
    rows = rows_of(rid)
    if provider == "efinance":
        assert rows["prev_year"].source == "provider" and rows["prev_year"].visits == 51000
    else:
        assert rows["prev_year"].source == "manual" and rows["prev_year"].visits == 48200
    html = page(client, rid, "central.ceo")
    assert "Revenue per" in html


def test_only_the_assignee_can_trigger_a_fetch(seeded, client, app, fake):
    use_efinance(app, fake)
    fake.known["Cardiology"] = good
    req = create(client)
    refresh(client, req.id, spec(), user="nic.requester")
    refresh(client, req.id, spec(), user="lim.accountant", )
    assert fake.calls == []
