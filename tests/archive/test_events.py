"""Notices from eArchive: POST /api/v1/archive-events (loopback only, bearer token, no forwarding headers)."""
import json

import pytest

from ehire.archive import queue
from ehire.extensions import db
from ehire.models import ArchiveDeposit, AuditLog
from tests.archive.ahelpers import row_of
from tests.archive.fake_earchive import TOKEN
from tests.requests.flowhelpers import as_user, create, text

URL = "/api/v1/archive-events"
REF = "position_request:EHIRE-NIC-PHY-20261120-01:submitted"


def notice(client, body=None, token=TOKEN, headers=None, addr=None, raw=None):
    h = dict(headers or {})
    if token is not None:
        h["Authorization"] = "Bearer " + token
    env = {"REMOTE_ADDR": addr} if addr else None
    kwargs = {"data": raw} if raw is not None else {"data": json.dumps(body or {}, ensure_ascii=False)}
    return client.post(URL, headers=h, content_type="application/json", environ_overrides=env, **kwargs)


def body(event, ref=REF, at="2056-01-05T09:00:00+02:00"):
    return {"event": event, "protocol_id": "p-0001", "protocol_number": "ΑΔ/2026/00001", "source_ref": ref, "at": at}


@pytest.fixture
def filed(http, client):
    rid = create(client).id
    queue.flush()
    as_user(client, "demo.admin")  # a browser session exists, but the route does not use it
    return rid


def test_the_deposited_record_can_be_disposed_and_the_date_is_shown(filed, client):
    rid = filed
    resp = notice(client, body("protocol.deleted"))
    assert resp.status_code == 200
    row = row_of(rid, "submitted")
    assert row.disposed_at is not None and row.disposed_at.year == 2056 and row.state == "stored"
    assert ArchiveDeposit.query.count() == 1  # nothing of eHire's own is deleted
    assert AuditLog.query.filter_by(event="archive_event", request_id=rid).count() == 1
    page = text(client.get("/requests/%d?lang=en" % rid))
    assert "was disposed of on 05/01/2056" in page and "data-archive-disposed" in page
    assert "was disposed of on 05/01/2056" in text(client.get("/settings/archive?lang=en"))
    assert "καταστράφηκε στις 05/01/2056" in text(client.get("/requests/%d?lang=el" % rid))


def test_a_legal_hold_is_set_and_cleared(filed, client):
    rid = filed
    assert notice(client, body("legal_hold.set")).status_code == 200
    assert row_of(rid, "submitted").legal_hold is True
    page = text(client.get("/requests/%d?lang=en" % rid))
    assert "under a legal hold" in page and "data-archive-hold" in page
    assert "under a legal hold" in text(client.get("/settings/archive?lang=en"))
    assert notice(client, body("legal_hold.cleared")).status_code == 200
    assert row_of(rid, "submitted").legal_hold is False
    assert "data-archive-hold" not in text(client.get("/requests/%d?lang=en" % rid))


def test_a_repeated_notice_changes_nothing_more(filed, client):
    rid = filed
    notice(client, body("protocol.deleted", at="2056-01-05T09:00:00+02:00"))
    first = row_of(rid, "submitted").disposed_at
    assert notice(client, body("protocol.deleted", at="2057-02-02T09:00:00+02:00")).status_code == 200
    assert row_of(rid, "submitted").disposed_at == first
    notice(client, body("legal_hold.set"))
    assert notice(client, body("legal_hold.set")).status_code == 200
    assert row_of(rid, "submitted").legal_hold is True
    applied = [json.loads(a.detail_json)["applied"] for a in AuditLog.query.filter_by(event="archive_event").order_by(AuditLog.id)]
    assert applied == [True, False, True, False]


def test_the_record_is_found_by_protocol_id_when_the_source_ref_is_unknown(filed, client):
    rid = filed
    assert notice(client, body("legal_hold.set", ref="something:else")).status_code == 200
    assert row_of(rid, "submitted").legal_hold is True


def test_unknown_events_and_unknown_records_answer_200_and_are_audited(filed, client):
    rid = filed
    assert notice(client, body("protocol.moved")).status_code == 200
    resp = notice(client, {"event": "legal_hold.set", "protocol_id": "p-9999", "source_ref": "position_request:NOPE-1:decided"})
    assert resp.status_code == 200
    ignored = AuditLog.query.filter_by(event="archive_event_ignored").all()
    assert len(ignored) == 2 and TOKEN not in " ".join(a.detail_json for a in ignored)
    row = row_of(rid, "submitted")
    assert row.legal_hold is False and row.disposed_at is None


@pytest.mark.parametrize("addr", ["10.1.2.3", "192.168.0.9", "::ffff:10.0.0.1"])
def test_only_loopback_is_served(filed, client, addr):
    resp = notice(client, body("legal_hold.set"), addr=addr)
    assert resp.status_code == 403 and resp.get_json()["code"] == "LOOPBACK_ONLY"
    assert row_of(filed, "submitted").legal_hold is False


def test_ipv6_loopback_is_served(filed, client):
    assert notice(client, body("legal_hold.set"), addr="::1").status_code == 200


@pytest.mark.parametrize("header", ["X-Forwarded-For", "X-Real-IP", "Forwarded", "CF-Connecting-IP", "CF-Ray",
                                    "X-Forwarded-Proto", "X-Forwarded-Host"])
def test_a_forwarding_header_is_refused_even_with_a_valid_token(filed, client, header):
    resp = notice(client, body("legal_hold.set"), headers={header: "127.0.0.1"})
    assert resp.status_code == 403 and row_of(filed, "submitted").legal_hold is False


def test_a_forwarded_peer_behind_the_proxy_fix_is_refused(filed, client):
    # ProxyFix would turn X-Forwarded-For into remote_addr; the header itself is already refused, and the original
    # socket address is checked as well.
    resp = notice(client, body("legal_hold.set"), headers={"X-Forwarded-For": "127.0.0.1"}, addr="10.0.0.9")
    assert resp.status_code == 403


@pytest.mark.parametrize("token", [None, "", "wrong", TOKEN + "x", TOKEN[:-1]])
def test_the_token_is_required_and_exact(filed, client, token):
    resp = notice(client, body("legal_hold.set"), token=token)
    assert resp.status_code == 401 and row_of(filed, "submitted").legal_hold is False


def test_the_token_is_compared_in_constant_time():
    import inspect

    from ehire.archive import events
    assert "hmac.compare_digest" in inspect.getsource(events)


def test_without_a_configured_token_nothing_is_accepted(filed, client, app):
    app.config["EHIRE_ARCHIVE_TOKEN"] = ""
    assert notice(client, body("legal_hold.set"), token="").status_code == 503
    assert notice(client, body("legal_hold.set"), token=None).status_code == 503


@pytest.mark.parametrize("raw", ["not json", "[]", '{"x": 1}', '{"event": ""}'])
def test_a_bad_body_is_a_400(filed, client, raw):
    assert notice(client, raw=raw).status_code == 400


def test_it_needs_no_csrf_token_but_other_posts_still_do(filed, client, app):
    app.config["CSRF_ENABLED"] = True
    assert notice(client, body("legal_hold.set")).status_code == 200
    assert client.post("/settings/archive/%d/retry" % row_of(filed, "submitted").id).status_code == 400
    assert client.get(URL).status_code == 405


def test_the_notice_page_text_for_the_address_is_in_the_docs():
    from pathlib import Path
    root = Path(__file__).resolve().parents[2]
    assert "http://127.0.0.1:5008/api/v1/archive-events" in (root / "docs/contracts/06-earchive-deposit.md").read_text(encoding="utf-8")
