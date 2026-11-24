"""Contract 07: the address rule, the strict reading of both answers and the house rules of the client."""

import pytest

from ehire.services import efinance_link
from ehire.services.activity_efinance import Unavailable
from ehire.services.budget_efinance import current_year
from tests.efinance.conftest import LINES
from tests.efinance.fake_efinance import cc


def _problems(app, url, token="t"):
    return efinance_link.check_settings({"EHIRE_EFINANCE_URL": url, "EHIRE_EFINANCE_TOKEN": token})


@pytest.mark.parametrize("url", ["http://127.0.0.1:5004", "http://localhost:5004", "https://efinance.example.org"])
def test_allowed_addresses(app, url):
    assert _problems(app, url) == []


@pytest.mark.parametrize("url", ["http://efinance.example.org", "http://10.227.56.22:5004", "ftp://127.0.0.1",
                                 "https://user:pw@efinance.example.org", "https://efinance.example.org/?a=1", "nonsense"])
def test_refused_addresses(app, url):
    assert _problems(app, url)


def test_empty_url_and_token_are_reported_without_the_token(app):
    found = efinance_link.check_settings({"EHIRE_EFINANCE_URL": "", "EHIRE_EFINANCE_TOKEN": ""})
    assert len(found) == 2 and any("EHIRE_EFINANCE_TOKEN" in p for p in found)


def test_link_is_off_by_default(app):
    assert efinance_link.link_name() == "none" and not efinance_link.is_on()


def test_cost_centres_answer_is_read(wired, fake):
    fake.cost_centres = [cc("1000000200", "Γραφείο", "HQ")]
    kind, etag, answer = efinance_link.fetch_cost_centres()
    assert kind == "list" and etag is None and answer["rows"][0]["code"] == "1000000200"
    assert answer["rows"][0]["name_el"] == "Γραφείο" and answer["rows"][0]["name_en"] is None
    assert answer["as_of"].isoformat() == "2026-11-23T06:30:00+00:00"
    assert fake.calls[-1]["auth"] == "Bearer " + fake.token and fake.calls[-1]["path"] == "/api/ehire/cost-centres"


def test_cost_centres_other_spelling_and_extra_fields(app):
    body = {"as_of": None, "cost_centres": [{"code": "1", "name_el": "Α", "entity_code": "HQ", "active": True,
                                             "sap_status": "X"}], "source": "SAP"}
    row = efinance_link.validate_cost_centres(body)["rows"][0]
    assert row == {"code": "1", "name_el": "Α", "name_en": None, "entity_code": "HQ", "active": True}


@pytest.mark.parametrize("row", [
    {"code": "", "name": "x", "entity_code": "HQ", "active": True},
    {"code": "1 2", "name": "x", "entity_code": "HQ", "active": True},
    {"code": "1", "name": "", "entity_code": "HQ", "active": True},
    {"code": "1", "entity_code": "HQ", "active": True},
    {"code": "1", "name": "x", "entity_code": "HQ", "active": "yes"},
    {"code": "1", "name": "x", "name_en": 5, "entity_code": "HQ", "active": True},
    {"code": 1, "name": "x", "entity_code": "HQ", "active": True},
    {"code": "1", "name": "x", "entity_code": "H Q", "active": True},
])
def test_one_bad_cost_centre_row_spoils_the_whole_answer(wired, fake, row):
    fake.cost_centres = [row]
    with pytest.raises(Unavailable):
        efinance_link.fetch_cost_centres()


def test_duplicate_codes_are_refused(wired, fake):
    row = cc("1", "x", "HQ")
    fake.cost_centres = [row, dict(row)]
    with pytest.raises(Unavailable):
        efinance_link.fetch_cost_centres()


def test_budget_answer_keeps_salary_lines_only(wired, fake):
    fake.cost_centres = [cc("1001", "x", "NIC")]
    fake.budgets[("1001", 2026)] = LINES
    kind, body = efinance_link.fetch_budget("1001", 2026)
    assert kind == "lines" and [l["budget_code"] for l in body["lines"]] == ["2102", "2103", "2121"]
    assert body["entity_code"] == "NIC" and body["level"] == "entity"
    first, second, third = body["lines"]
    assert str(first["available"]) == "49659.88" and str(first["open_requisitions"]) == "20000.00"
    assert str(second["budget"]) == "80000.00" and str(second["spent"]) == "61200.50"  # a number and a float
    assert third["budget"] is None and third["available"] is None and third["budget_updated_at"] is None
    assert first["spent_covers"] == "efinance_invoices_only" and first["description"] == "BASIC PAY"
    assert first["budget_updated_at"].isoformat() == "2026-11-20T08:00:00+00:00"
    assert fake.calls[-1]["path"] == "/api/ehire/budget"
    assert fake.calls[-1]["query"] == {"cost_centre": "1001", "year": "2026", "payroll": "1"}


def test_budget_payroll_parameter_honoured_or_not_gives_the_same_lines(wired, fake):
    fake.budgets[("1001", 2026)] = LINES
    fake.honour_payroll = True
    assert [l["budget_code"] for l in efinance_link.fetch_budget("1001", 2026)[1]["lines"]] == ["2102", "2103", "2121"]


def test_budget_404_means_unknown_cost_centre(wired, fake):
    assert efinance_link.fetch_budget("9999", 2026) == ("unknown_cost_centre", None)


def test_budget_empty_lines_is_a_usable_answer(wired, fake):
    fake.budgets[("1001", 2026)] = []
    assert efinance_link.fetch_budget("1001", 2026)[1]["lines"] == []


@pytest.mark.parametrize("amount,expected", [(12.5, "12.50"), ("12.50", "12.50"), (12, "12.00"), ("-3", "-3.00"),
                                             (" 7.1 ", "7.10"), (None, None), (4250000.0, "4250000.00"),
                                             ("12.500", "12.50")])
def test_amounts_may_be_numbers_decimal_strings_or_null(app, amount, expected):
    found = efinance_link.money(amount)
    assert (str(found) if found is not None else None) == expected


@pytest.mark.parametrize("amount", ["12,50", "1e5", "", True, "12.505", 12.505, "abc", float("nan"), float("inf"),
                                    "1.234.567", [1], {"v": 1}, 1e12])
def test_bad_amounts_spoil_the_answer(wired, fake, amount):
    fake.budgets[("1001", 2026)] = [dict(LINES[0], spent=amount)]
    with pytest.raises(Unavailable):
        efinance_link.fetch_budget("1001", 2026)


def _budget_body(**changes):
    body = {"cost_centre": "1001", "entity_code": "NIC", "year": 2026, "level": "entity", "lines": [dict(LINES[0])]}
    body.update(changes)
    return body


def test_unknown_extra_fields_are_ignored(app):
    line = dict(LINES[0], currency="EUR", gl_accounts=["511010"])
    body = _budget_body(lines=[line], generated_by="eFinance 3.2", as_of="not a date")
    assert efinance_link.validate_budget(body, "1001", 2026)["lines"][0]["budget_code"] == "2102"


def test_year_may_be_a_digit_string(app):
    assert efinance_link.validate_budget(_budget_body(year="2026"), "1001", 2026)["year"] == 2026


@pytest.mark.parametrize("line", [
    {k: v for k, v in LINES[0].items() if k != "budget_code"},
    {k: v for k, v in LINES[3].items() if k != "budget_code"},  # even on a line eHire would ignore
    dict(LINES[0], budget_code=""), dict(LINES[0], budget_code=2102), dict(LINES[0], payroll="true"),
    dict(LINES[0], spent_covers=5), dict(LINES[0], budget_updated_at="yesterday"), dict(LINES[0], description=7),
])
def test_a_bad_line_makes_the_answer_unusable(app, line):
    with pytest.raises(Unavailable):
        efinance_link.validate_budget(_budget_body(lines=[line]), "1001", 2026)


def test_a_line_without_payroll_is_not_a_salary_line(app):
    line = {k: v for k, v in LINES[0].items() if k != "payroll"}
    assert efinance_link.validate_budget(_budget_body(lines=[line]), "1001", 2026)["lines"] == []


def test_duplicate_budget_codes_are_refused(app):
    with pytest.raises(Unavailable):
        efinance_link.validate_budget(_budget_body(lines=[dict(LINES[0]), dict(LINES[0])]), "1001", 2026)


def test_an_answer_about_another_cost_centre_or_year_is_refused(app):
    for body in (_budget_body(cost_centre="X"), _budget_body(year=2025), _budget_body(year=True),
                 _budget_body(year=None)):
        with pytest.raises(Unavailable):
            efinance_link.validate_budget(body, "1001", 2026)


def test_missing_lines_list_is_refused(app):
    with pytest.raises(Unavailable):
        efinance_link.validate_budget({"cost_centre": "1001", "year": 2026}, "1001", 2026)


@pytest.mark.parametrize("mode,reason", [(401, "http_401"), (500, "http_500"), ("timeout", "timeout"),
                                         ("redirect", "http_302"), ("bad_json", "bad_json"), ("huge", "too_large")])
def test_every_failure_is_unavailable_with_a_reason(wired, fake, mode, reason, caplog):
    fake.mode = mode
    with pytest.raises(Unavailable) as exc:
        efinance_link.fetch_cost_centres()
    assert exc.value.reason == reason
    with pytest.raises(Unavailable):
        efinance_link.fetch_budget("1001", 2026)
    assert fake.token not in caplog.text


def test_a_redirect_is_never_followed(wired, fake):
    fake.mode = "redirect"
    with pytest.raises(Unavailable):
        efinance_link.fetch_cost_centres()
    assert len(fake.calls) == 1


def test_a_wrong_token_is_401(wired, fake):
    wired.config["EHIRE_EFINANCE_TOKEN"] = "wrong"
    with pytest.raises(Unavailable) as exc:
        efinance_link.fetch_cost_centres()
    assert exc.value.reason == "http_401"


def test_system_proxy_settings_are_ignored(wired, fake, monkeypatch):
    fake.cost_centres = []
    for name in ("http_proxy", "HTTP_PROXY", "https_proxy", "HTTPS_PROXY", "all_proxy", "ALL_PROXY"):
        monkeypatch.setenv(name, "http://127.0.0.1:9")  # nothing listens there
    for name in ("no_proxy", "NO_PROXY"):
        monkeypatch.delenv(name, raising=False)
    efinance_link.fetch_cost_centres()
    assert fake.calls and not fake.calls[-1]["forwarded"]


def test_plain_http_to_another_host_is_never_called(wired, fake):
    wired.config["EHIRE_EFINANCE_URL"] = "http://efinance.example.org:%d" % fake.port
    with pytest.raises(Unavailable) as exc:
        efinance_link.fetch_cost_centres()
    assert exc.value.reason == "not_configured" and not fake.calls


def test_the_activity_client_still_reads_its_answers(wired, fake):
    """The shared client gained a generic GET; contract 05's call keeps working (404 means no data)."""
    from ehire.services.activity_efinance import EFinanceClient, NoData

    client = EFinanceClient(fake.url, fake.token, 0.5)
    with pytest.raises(NoData):
        client.fetch_one("NGH", "Cardiology")


def test_current_year_is_cyprus_time(app):
    assert 2026 <= current_year() <= 2100
