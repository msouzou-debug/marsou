from tests.conftest import login


def test_manuals_need_sign_in(client, seeded):
    assert client.get("/manuals").status_code in (302, 404)
    assert client.get("/manuals/user_guide").status_code in (302, 404)


def test_everyone_signed_in_reads_the_user_guide_but_not_the_admin_files(client, seeded):
    login(client, "nic.requester")
    page = client.get("/manuals")
    assert page.status_code == 200
    assert "/manuals/user_guide" in page.text
    assert "/manuals/admin_guide" not in page.text
    got = client.get("/manuals/user_guide")
    assert got.status_code == 200 and got.mimetype == "application/pdf"
    assert got.headers["Cache-Control"] == "private, no-store"
    for key in ("admin_guide", "uat_plan", "uat_scripts", "nothing"):
        assert client.get("/manuals/" + key).status_code == 404


def test_an_administrator_gets_every_manual_in_the_page_language(client, seeded):
    login(client, "demo.admin")
    page = client.get("/manuals")
    for key in ("user_guide", "admin_guide", "uat_plan", "uat_scripts"):
        assert "/manuals/" + key in page.text
    assert "eHire-admin-guide-" in client.get("/manuals/admin_guide").headers["Content-Disposition"]
    sheet = client.get("/manuals/uat_scripts")
    assert sheet.status_code == 200 and "attachment" in sheet.headers["Content-Disposition"]
