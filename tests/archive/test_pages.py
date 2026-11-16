"""The deposits page, the PDF route, the retry button and the line on the request page."""
import re

import pytest

from ehr.archive import queue
from ehr.extensions import db
from ehr.models import ArchiveDeposit, AuditLog
from tests.archive.ahelpers import deposits
from tests.archive.conftest import RecordingTransport
from tests.requests.flowhelpers import as_user, create, text

RAW_KEY = re.compile(r"\b(?:archive|settings\.archive|pdf)\.[a-z_.]+\b")


def make(client, stor, conv, app, fail=0):
    app.config["ARCHIVE_TRANSPORT_OVERRIDE"] = RecordingTransport(fail=fail)
    rid = create(client).id
    queue.flush()
    return rid


def test_settings_index_links_to_the_page(seeded, client):
    as_user(client, "demo.admin")
    html = text(client.get("/settings?lang=en"))
    assert 'href="/settings/archive"' in html


@pytest.mark.parametrize("user", ["nic.requester", "central.ceo", "demo.viewer", "nic.accountant"])
def test_others_get_404_on_the_page_the_pdf_and_the_retry(seeded, client, stor, conv, app, user):
    rid = make(client, stor, conv, app)
    d = deposits(rid)[0]
    as_user(client, user)
    assert client.get("/settings/archive").status_code == 404
    assert client.get("/settings/archive/%d/pdf" % d.id).status_code == 404
    assert client.post("/settings/archive/%d/retry" % d.id).status_code == 404


def test_signed_out_is_sent_to_sign_in(seeded, client):
    assert client.get("/settings/archive").status_code == 302


@pytest.mark.parametrize("lang", ["el", "en"])
def test_the_page_renders_in_both_languages_without_raw_keys(seeded, client, stor, conv, app, lang):
    rid = make(client, stor, conv, app)
    as_user(client, "demo.admin")
    resp = client.get("/settings/archive?lang=" + lang)
    html = text(resp)
    assert resp.status_code == 200
    assert not RAW_KEY.findall(re.sub(r"<[^>]+>", " ", html)), RAW_KEY.findall(html)
    assert ("ΑΕΘ-2026-0001" in html) and ("eArchive" in html)
    assert 'name="viewport"' in html


def test_the_page_says_when_nothing_is_set_up(seeded, client, stor, conv, app):
    create(client)
    as_user(client, "demo.admin")
    en = text(client.get("/settings/archive?lang=en"))
    from ehr import i18n
    assert i18n.translate("settings.archive.off", "en") in en
    assert i18n.translate("archive.state.queued", "en") in en
    app.config["ARCHIVE_TRANSPORT_OVERRIDE"] = RecordingTransport()
    assert i18n.translate("settings.archive.off", "en") not in text(client.get("/settings/archive?lang=en"))


def test_the_page_lists_newest_first_and_shows_state_files_and_reference(seeded, client, stor, conv, app):
    rid = make(client, stor, conv, app)
    as_user(client, "demo.admin")
    html = text(client.get("/settings/archive?lang=en"))
    assert "eArchive" in html
    assert "ref-AEU-2026-0001-submitted" in html
    assert "/settings/archive/%d/pdf" % deposits(rid)[0].id in html


def test_the_pdf_route_serves_the_file_with_the_safety_headers_and_audits(seeded, client, stor, conv, app):
    rid = make(client, stor, conv, app)
    d = deposits(rid)[0]
    as_user(client, "demo.admin")
    resp = client.get("/settings/archive/%d/pdf" % d.id)
    assert resp.status_code == 200 and resp.mimetype == "application/pdf"
    assert resp.data.startswith(b"%PDF")
    h = resp.headers
    assert h["X-Content-Type-Options"] == "nosniff" and "no-store" in h["Cache-Control"]
    assert "default-src 'none'" in h["Content-Security-Policy"] and "sandbox" in h["Content-Security-Policy"]
    assert "AEU-2026-0001-submitted.pdf" in h["Content-Disposition"]
    row = AuditLog.query.filter_by(event="archive_pdf_view").one()
    assert row.request_id == rid and d.pdf_sha256 in row.detail_json
    assert client.get("/settings/archive/9999/pdf").status_code == 404


def test_the_pdf_route_is_404_while_no_pdf_exists(seeded, client):
    create(client)
    d = deposits()[0]
    as_user(client, "demo.admin")
    assert client.get("/settings/archive/%d/pdf" % d.id).status_code == 404


def test_the_page_carries_the_default_security_headers(seeded, client):
    as_user(client, "demo.admin")
    h = client.get("/settings/archive").headers
    assert h["X-Content-Type-Options"] == "nosniff" and "no-store" in h["Cache-Control"]
    assert "Content-Security-Policy" in h and h["X-Frame-Options"] == "DENY"


def test_retry_puts_a_failed_row_back_in_the_queue_with_csrf(seeded, client, stor, conv, app):
    rid = make(client, stor, conv, app, fail=1)
    d = deposits(rid)[0]
    assert d.state == "failed"
    as_user(client, "demo.admin")
    app.config["CSRF_ENABLED"] = True
    assert client.post("/settings/archive/%d/retry" % d.id).status_code == 400  # no token
    html = text(client.get("/settings/archive?lang=en"))
    token = re.search(r'name="csrf_token" value="([^"]+)"', html).group(1)
    resp = client.post("/settings/archive/%d/retry" % d.id, data={"csrf_token": token})
    assert resp.status_code == 302
    row = deposits(rid)[0]
    assert (row.state, row.attempts) == ("queued", 0)
    assert AuditLog.query.filter_by(event="archive_retry", request_id=rid).count() == 1
    assert client.post("/settings/archive/%d/retry" % d.id, data={"csrf_token": token}).status_code == 302
    assert AuditLog.query.filter_by(event="archive_retry").count() == 1  # a row that is not failed is left alone


def test_the_request_page_shows_the_state_and_the_reference_but_no_pdf_link(seeded, client, stor, conv, app):
    from ehr import i18n
    rid = create(client).id
    as_user(client, "nic.requester")
    html = text(client.get("/requests/%d?lang=en" % rid))
    assert i18n.translate("archive.state.queued", "en") in html
    queue_app = app
    queue_app.config["ARCHIVE_TRANSPORT_OVERRIDE"] = RecordingTransport()
    queue.flush()
    for user in ("nic.requester", "central.ceo", "demo.admin"):
        as_user(client, user)
        html = text(client.get("/requests/%d?lang=en" % rid))
        assert i18n.translate("archive.state.stored", "en") in html
        assert "ref-AEU-2026-0001-submitted" in html and "/pdf" not in html.replace("/documents", "")
    html = text(client.get("/requests/%d?lang=el" % rid))
    assert "Αποθηκεύτηκε στο eArchive" in html


def test_a_draft_shows_no_deposit_line(seeded, client):
    from tests.requests.helpers import full_form
    as_user(client, "nic.requester")
    data = full_form()
    data["intent"] = "draft"
    client.post("/requests", data=data)
    from ehr.models import Request
    rid = Request.query.one().id
    assert "data-archive-state" not in text(client.get("/requests/%d" % rid))


def test_the_page_lists_the_newest_deposit_first(seeded, client, stor, conv, app):
    first = create(client).id
    second = create(client, username="lim.requester", directorate_code="LIM").id
    as_user(client, "demo.admin")
    html = text(client.get("/settings/archive?lang=en"))
    assert html.index("/requests/%d\"" % second) < html.index("/requests/%d\"" % first)


def test_the_request_page_shows_the_protocol_number_as_text_and_no_link_until_it_is_switched_on(http, client, app):
    from tests.archive.ahelpers import approve_all
    rid = create(client).id
    approve_all(client, rid)
    queue.flush()
    as_user(client, "nic.requester")
    html = text(client.get("/requests/%d?lang=en" % rid))
    assert "eArchive protocol number: ΑΔ/2026/00001" in html and "eArchive protocol number: ΑΔ/2026/00002" in html
    assert "127.0.0.1:5011/protocols" not in html  # stored, not shown: the web app is not published yet
    assert html.index("Copy at submission") < html.index("Copy at the decision")
    el = text(client.get("/requests/%d?lang=el" % rid))
    assert "Αριθμός πρωτοκόλλου στο eArchive: ΑΔ/2026/00001" in el
    as_user(client, "demo.admin")
    page = text(client.get("/settings/archive?lang=en"))
    assert "ΑΔ/2026/00001" in page and "Protocol number" in page and "127.0.0.1:5011/protocols" not in page
    assert ArchiveDeposit.query.filter_by(request_id=rid, kind="submitted").one().url.endswith("/protocols/p-0001")
    runner = app.test_cli_runner()
    assert runner.invoke(args=["archive-link"]).output.strip() == "archive_show_link=off"
    assert runner.invoke(args=["archive-link", "on"]).output.strip() == "archive_show_link=on"
    as_user(client, "nic.requester")
    html = text(client.get("/requests/%d?lang=en" % rid))
    assert 'href="http://127.0.0.1:5011/protocols/p-0001"' in html
    assert re.search(r'<a href="http://127.0.0.1:5011/protocols/p-0002" target="_blank" rel="noopener">', html)
    as_user(client, "demo.admin")
    assert 'href="http://127.0.0.1:5011/protocols/p-0001"' in text(client.get("/settings/archive?lang=en"))
    assert runner.invoke(args=["archive-link", "off"]).output.strip() == "archive_show_link=off"
    assert "127.0.0.1:5011/protocols" not in text(client.get("/settings/archive?lang=en"))


def test_only_an_http_address_is_ever_linked(seeded, app):
    from ehr.models import Setting
    db.session.add(Setting(key="archive_show_link", value="on"))
    db.session.commit()
    assert queue.link_for("http://127.0.0.1:5011/protocols/p-1") == "http://127.0.0.1:5011/protocols/p-1"
    assert queue.link_for("javascript:alert(1)") is None and queue.link_for("") is None and queue.link_for(None) is None
