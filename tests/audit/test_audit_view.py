"""The audit log view (contract 03, section 1): read-only, filtered, paged, escaped."""
import json
import re
from datetime import datetime, timezone

import pytest

from ehr.extensions import db
from ehr.models import AuditLog, Request, User
from tests.conftest import login
from tests.requests.flowhelpers import as_user, create


def add(event="setting_changed", at=None, user=None, request_id=None, detail=None):
    row = AuditLog(event=event, user_id=user.id if user else None, request_id=request_id,
                   detail_json=None if detail is None else json.dumps(detail), at=at or datetime.now(timezone.utc))
    db.session.add(row)
    db.session.commit()
    return row


def body(html):
    """Only the table: the filter form lists every event in its select."""
    return html.split("<tbody>")[-1] if "<tbody>" in html else ""


def get(client, user, query=""):
    as_user(client, user)
    return client.get("/audit" + query)


def test_anonymous_goes_to_login_and_others_get_404(seeded, client):
    assert client.get("/audit").status_code == 302
    for name in ("nic.requester", "nic.accountant", "demo.viewer"):
        assert get(client, name).status_code == 404


def test_admin_sees_newest_first(seeded, client):
    add("old_event", at=datetime(2026, 1, 1, 9, 0, tzinfo=timezone.utc))
    add("new_event", at=datetime(2026, 2, 1, 9, 0, tzinfo=timezone.utc))
    html = get(client, "demo.admin").get_data(as_text=True)
    assert html.index("new_event") < html.index("old_event")
    assert "01/02/2026 11:00" in html  # 09:00 UTC is 11:00 in Cyprus (winter, UTC+2)


def test_pagination_is_server_side_50_per_page(seeded, client):
    for i in range(120):
        add("bulk_event", detail={"n": i})
    html = get(client, "demo.admin", "?event=bulk_event").get_data(as_text=True)
    assert html.count("bulk_event") >= 50 and html.count('<td class="text-nowrap">') >= 50
    assert len(re.findall(r"<tr>\s*<td", html)) == 50
    p3 = get(client, "demo.admin", "?event=bulk_event&page=3").get_data(as_text=True)
    assert len(re.findall(r"<tr>\s*<td", p3)) == 20
    assert "page=2" in p3 and "event=bulk_event" in p3  # filters survive the paging links
    assert len(re.findall(r"<tr>\s*<td", get(client, "demo.admin", "?event=bulk_event&page=99").get_data(as_text=True))) == 20
    assert get(client, "demo.admin", "?page=abc").status_code == 200


def test_filter_by_event_user_date(seeded, client):
    admin = User.query.filter_by(username="demo.admin").one()
    req = User.query.filter_by(username="nic.requester").one()
    add("alpha_event", user=admin, at=datetime(2026, 3, 1, 12, 0, tzinfo=timezone.utc))
    add("beta_event", user=req, at=datetime(2026, 3, 10, 12, 0, tzinfo=timezone.utc))

    def rows(q):
        html = get(client, "demo.admin", q).get_data(as_text=True)
        return ("alpha_event" in body(html), "beta_event" in body(html))

    assert rows("?event=alpha_event") == (True, False)
    assert rows("?user=nic.req") == (False, True)
    assert rows("?user=NIC.REQ") == (False, True)
    assert rows("?from=05/03/2026") == (False, True)
    assert rows("?to=05/03/2026") == (True, False)
    assert rows("?from=10/03/2026&to=10/03/2026") == (False, True)  # whole day included
    assert rows("?user=%25") == (False, False)  # LIKE wildcards are taken literally
    html = get(client, "demo.admin", "?from=31/02/2026").get_data(as_text=True)  # bad date: field flagged, page works
    assert "is-invalid" in html


def test_filter_by_request_number_is_normalised(seeded, client):
    req = create(client)
    other = create(client)
    add("probe_event", request_id=req.id)
    add("probe_event", request_id=other.id)
    number = req.number
    variants = {number, number.lower(), number.replace("-", " ")}
    # Greek look-alike letters count as the Latin ones
    variants.add(number.replace("A", "Α").replace("E", "Ε"))
    for v in variants:
        html = get(client, "demo.admin", "?request=" + v).get_data(as_text=True)
        assert number in html, v
        if other.number != number:
            assert other.number not in body(html), v
    assert "audit.empty" in get(client, "demo.admin", "?request=ZZZ-999").get_data(as_text=True) or \
        "No entries" in get(client, "demo.admin", "?request=ZZZ-999").get_data(as_text=True)


def test_request_link_only_when_viewer_may_see_it(seeded, client):
    draft = create(client)  # submitted; visible to admin (sees all)
    from ehr.models import RoleAssignment

    add("probe_event", request_id=draft.id)
    html = get(client, "demo.admin", "?event=probe_event").get_data(as_text=True)
    assert 'href="/requests/%d"' % draft.id in html
    # a user with audit.view but no right to see requests: give audit.view to a Directorate role through the table
    from ehr.models import RolePermission

    db.session.add(RolePermission(role="requester", permission_key="audit.view"))
    db.session.commit()
    stranger = User.query.filter_by(username="lim.requester").one()
    assert stranger.has_permission("audit.view")
    html = get(client, "lim.requester", "?event=probe_event").get_data(as_text=True)
    assert 'href="/requests/%d"' % draft.id not in html and draft.number in html


def test_detail_is_escaped_truncated_and_secrets_hidden(seeded, client):
    long_value = "x" * 300
    add("detail_event", detail={"note": "<script>alert(1)</script>", "long": long_value, "password": "hunter2",
                                "csrf_token": "abc", "count": 3, "nested": {"a": 1}})
    html = get(client, "demo.admin", "?event=detail_event").get_data(as_text=True)
    assert "<script>alert(1)</script>" not in html and "&lt;script&gt;alert(1)&lt;/script&gt;" in html
    assert long_value not in html.replace('title="%s"' % long_value, "")  # only inside the title attribute
    assert 'title="%s"' % long_value in html and "x" * 79 + "…" in html
    assert "hunter2" not in html and "abc" not in html
    assert "count:" in html and "3" in html


def test_system_rows_and_missing_detail(seeded, client):
    add("system_event")
    html = get(client, "demo.admin", "?event=system_event").get_data(as_text=True)
    assert "System" in html or "audit.system" in html


def test_nothing_can_change_through_the_view(seeded, client):
    as_user(client, "demo.admin")
    before = AuditLog.query.count()
    for method in ("post", "put", "patch", "delete"):
        assert getattr(client, method)("/audit").status_code == 405
    assert client.get("/audit").status_code == 200
    assert client.get("/audit?page=2&event=login").status_code == 200
    assert AuditLog.query.count() == before  # looking is not audited
    rules = [r.rule for r in client.application.url_map.iter_rules() if r.rule.startswith("/audit")]
    assert rules == ["/audit"]  # no export, no edit, no delete
    row = AuditLog.query.first()
    row.event = "tampered"
    with pytest.raises(RuntimeError):
        db.session.commit()
    db.session.rollback()


def test_nav_link_for_permitted_users_only(seeded, client):
    assert 'href="/audit"' in get(client, "demo.admin").get_data(as_text=True)
    as_user(client, "nic.requester")
    assert 'href="/audit"' not in client.get("/requests").get_data(as_text=True)
