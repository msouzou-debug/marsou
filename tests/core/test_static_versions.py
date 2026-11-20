import re

from tests.conftest import login


def test_static_urls_carry_a_version_that_changes_with_the_file(app, client, seeded, tmp_path, monkeypatch):
    page = client.get("/login").text
    links = re.findall(r'(?:href|src)="(/static/[^"]+)"', page)
    assert links and all(re.search(r"[?&]v=[0-9a-f]{10}$", u) for u in links), links
    css = [u for u in links if "ehire-frame.css" in u][0]
    assert client.get(css).status_code == 200

    from ehire import staticver

    f = tmp_path / "a.css"
    f.write_text("a{}")
    first = staticver._digest(str(f))
    f.write_text("a{color:red}")
    assert staticver._digest(str(f)) != first
    assert staticver._digest(str(tmp_path / "missing.css")) is None


def test_the_language_switch_is_in_the_menu_and_in_the_phone_bar(client, seeded):
    login(client, "nic.requester")
    page = client.get("/requests").text
    assert page.count('lang="el"') >= 2 and page.count('lang="en"') >= 2
    assert "ehire-mobilebar__lang" in page and "ehire-userinfo__lang" in page
