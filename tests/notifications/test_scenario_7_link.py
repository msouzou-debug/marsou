"""Scenario 7: the email only informs. Its one link is the request page; opening it changes nothing."""
from urllib.parse import urlparse

from ehr import i18n
from ehr.models import Request, User
from tests.conftest import login
from tests.notifications.nhelpers import HREF, counts, create, mails


def test_the_link_opens_sign_in_then_the_request_with_the_card_and_changes_nothing(seeded, client):
    r = create(client)
    mail = mails("task_opened", "nic.accountant", r.id)[0]
    links = HREF.findall(mail.html)
    assert len(set(links)) == 1  # the VML button repeats the same href
    url = urlparse(sorted(set(links))[0])
    assert (url.scheme, url.netloc, url.path, url.query) == ("http", "127.0.0.1:5008", "/requests/%d" % r.id, "do=review")
    assert "token" not in sorted(set(links))[0] and "approve" not in links[0] and "reject" not in links[0]
    path = "%s?%s" % (url.path, url.query)

    before = counts()
    client.post("/logout")  # one client: the test app context keeps `g`, so a second client would share the user
    anon = client
    resp = anon.get(path)
    assert resp.status_code == 302
    assert resp.headers["Location"].startswith("/login?next=") and "do%3Dreview" in resp.headers["Location"]
    assert counts() == before
    assert anon.get(path).status_code == 302 and counts() == before  # asking twice still changes nothing

    # Signing in lands on the request, with the action card for the person it was sent to.
    nxt = resp.headers["Location"]
    form = anon.get(nxt)
    assert form.status_code == 200 and "do=review" in form.get_data(as_text=True)
    landed = login(anon, "nic.accountant", follow=False)
    assert landed.status_code == 302
    login_post = anon.post("/login", data={"username": "nic.accountant", "password": "demo-1234",
                                           "next": path}, follow_redirects=False)
    assert login_post.headers["Location"] == path
    page = anon.get(path)
    html = page.get_data(as_text=True)
    assert page.status_code == 200 and "data-ehr-card" in html and i18n.translate("action.title", "el") in html
    assert counts()[1:3] == before[1:3]


def test_the_link_does_not_work_for_someone_who_may_not_see_the_request(seeded, client):
    r = create(client)
    client.post("/logout")
    login(client, "lim.accountant")
    assert client.get("/requests/%d?do=review" % r.id).status_code == 404


def test_the_button_is_the_only_call_to_action(seeded, client):
    r = create(client)
    for m in mails(request_id=r.id):
        assert m.html.count("<a ") == 1 and m.text.count("http") == 1
        assert i18n.translate("action.view_request", m.language) in m.html
