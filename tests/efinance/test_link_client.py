"""Contract 07: the address rule, the strict reading of both answers and the house rules of the client."""

import pytest

from ehire.services import efinance_link
from ehire.services.activity_efinance import Unavailable
from ehire.services.budget_efinance import current_year
from tests.efinance.conftest import LINES


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
    fake.cost_centres = [{"code": "1000000200", "name_el": "Γραφείο", "name_en": None, "entity_code": "HQ",
                          "active": True}]
    kind, etag, answer = efinance_link.fetch_cost_centres()
    assert kind == "list" and etag is None and answer["rows"][0]["code"] == "1000000200"
    assert answer["as_of"].isoformat() == "2026-11-23T06:30:00+00:00"
    assert fake.calls[-1]["auth"] == "Bearer " + fake.token


@pytest.mark.parametrize("row", [
    {"code": "", "name_el": "x", "name_en": None, "entity_code": "HQ", "active": True},
    {"code": "1 2", "name_el": "x", "name_en": None, "entity_code": "HQ", "active": True},
    {"code": "1", "name_el": "", "name_en": None, "entity_code": "HQ", "active": True},
    {"code": "1", "name_el": "x", "name_en": None, "entity_code": "HQ", "active": "yes"},
    {"code": "1", "name_el": "x", "name_en": 5, "entity_code": "HQ", "active": True},
    {"code": 1, "name_el": "x", "name_en": None, "entity_code": "HQ", "active": True},
    {"code": "1", "name_el": "x", "name_en": None, "entity_code": "H Q", "active": True},
])
def test_one_bad_cost_centre_row_spoils_the_whole_answer(wired, fake, row):
    fake.cost_centres = [row]
    with pytest.raises(Unavailable):
        efinance_link.fetch_cost_centres()


def test_duplicate_codes_are_refused(wired, fake):
    row = {"code": "1", "name_el": "x", "name_en": None, "entity_code": "HQ", "active": True}
    fake.cost_centres = [row, dict(row)]
    with pytest.raises(Unavailable):
        efinance_link.fetch_cost_centres()


def test_budget_answer_is_read_with_decimals(wired, fake):
    fake.budgets[("1001", 2026)] = LINES
    kind, body = efinance_link.fetch_budget("1001", 2026)
    assert kind == "lines" and [l["article"] for l in body["lines"]] == ["02101", "02102", "02110"]
    assert str(body["lines"][0]["available"]) == "49659.88"
    assert fake.calls[-1]["query"] == {"cost_centre": "1001", "year": "2026"}


def test_budget_with_article_asks_for_that_line(wired, fake):
    fake.budgets[("1001", 2026)] = LINES
    kind, body = efinance_link.fetch_budget("1001", 2026, "02110")
    assert [l["article"] for l in body["lines"]] == ["02110"] and fake.calls[-1]["query"]["article"] == "02110"


def test_budget_404_means_unknown_cost_centre(wired, fake):
    assert efinance_link.fetch_budget("9999", 2026) == ("unknown_cost_centre", None)


@pytest.mark.parametrize("amount", [12.5, "12,50", "1e5", "", None, True, "12.505"])
def test_amounts_must_be_decimal_strings(wired, fake, amount):
    bad = dict(LINES[0], budget=amount)
    fake.budgets[("1001", 2026)] = [bad]
    with pytest.raises(Unavailable):
        efinance_link.fetch_budget("1001", 2026)


def test_negative_available_is_accepted(wired, fake):
    fake.budgets[("1001", 2026)] = [dict(LINES[0], available="-150.00")]
    assert str(efinance_link.fetch_budget("1001", 2026)[1]["lines"][0]["available"]) == "-150.00"


def test_an_answer_about_another_cost_centre_is_refused(app):
    with pytest.raises(Unavailable):
        efinance_link.validate_budget({"cost_centre": "X", "year": 2026, "as_of": "2026-11-23T06:30:00Z",
                                       "lines": []}, "1001", 2026)
    with pytest.raises(Unavailable):
        efinance_link.validate_budget({"cost_centre": "1001", "year": 2025, "as_of": "2026-11-23T06:30:00Z",
                                       "lines": []}, "1001", 2026)
    with pytest.raises(Unavailable):
        efinance_link.validate_budget({"cost_centre": "1001", "year": 2026, "as_of": "2026-11-23T06:30:00Z",
                                       "currency": "USD", "lines": []}, "1001", 2026)


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
