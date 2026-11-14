"""Active Directory sign-in next to local accounts, with a fake directory (no network)."""
import logging

import pytest

from ehr.auth import ad
from ehr.extensions import db
from ehr.models import AuditLog, LoginAttempt, MailOutbox, User
from tests.conftest import login

SECRET = "Zq9-never-in-a-log-Pass"


def ad_login(client, name="ann.ad", password="Ad-Pass-1234", lang="en"):
    return client.post("/login?lang=" + lang, data={"username": name, "password": password})


def make_ad_user(name="ann.ad", active=True, **kw):
    user = User(username=name, full_name=kw.pop("full_name", "Old Name"), email=kw.pop("email", "old@example.invalid"),
                auth_source="ad", password_hash=None, is_active=active, language="el")
    db.session.add(user)
    db.session.commit()
    return user


# ------------------------------------------------------------------------------------------ order

def test_a_local_account_signs_in_without_asking_the_directory(seeded, client, directory):
    assert login(client, "nic.requester").status_code == 302
    assert directory.calls == []
    row = AuditLog.query.filter_by(event="login").one()
    assert '"method": "local"' in row.detail_json


def test_a_wrong_password_for_a_local_account_is_not_retried_against_the_directory(seeded, client, directory):
    directory.users["nic.requester"] = ("wrong-password", "Someone In AD", None)  # same name in the directory
    assert login(client, "nic.requester", password="wrong-password").status_code == 200
    assert directory.calls == []  # the directory must never open a local account (an admin's, say)
    assert client.get("/requests").status_code == 302


def test_local_accounts_still_work_when_the_directory_is_down(seeded, client, directory):
    directory.down = True
    assert login(client, "nic.requester").status_code == 302


def test_directory_off_means_no_directory_call(seeded, client, directory, app):
    app.config["EHR_AD_ENABLED"] = False
    assert ad_login(client).status_code == 200
    assert directory.calls == [] and User.query.filter_by(username="ann.ad").count() == 0


# ------------------------------------------------------------------------------------------ first sign-in

def test_first_ad_sign_in_makes_an_inactive_user_and_shows_the_pending_message(seeded, client, directory):
    resp = ad_login(client)
    html = resp.get_data(as_text=True)
    assert resp.status_code == 200 and "once an administrator activates it" in html
    user = User.query.filter_by(username="ann.ad").one()
    assert (user.auth_source, user.is_active, user.password_hash, user.must_change_password) == ("ad", False, None, False)
    assert user.full_name == "Ann Directory" and user.email == "ann@example.invalid" and user.language == "el"
    assert user.roles() == set()
    created = AuditLog.query.filter_by(event="ad_user_created").all()
    assert len(created) == 1 and created[0].user_id == user.id
    assert AuditLog.query.filter_by(event="login").count() == 0
    assert MailOutbox.query.count() == 0  # nobody is emailed
    assert client.get("/requests").status_code == 302  # and no session started


def test_a_second_attempt_by_the_pending_user_gets_the_generic_failure(seeded, client, directory):
    ad_login(client)
    html = ad_login(client).get_data(as_text=True)
    assert "wrong. Try again" in html
    assert User.query.filter_by(username="ann.ad").count() == 1


def test_username_case_is_normalised(seeded, client, directory):
    ad_login(client, name="  Ann.AD ")
    assert User.query.filter_by(username="ann.ad").count() == 1 and directory.calls[0][0] == "ann.ad"


# ------------------------------------------------------------------------------------------ later sign-ins

def test_an_activated_ad_user_signs_in_and_name_and_email_are_refreshed(seeded, client, directory):
    make_ad_user()
    resp = ad_login(client)
    assert resp.status_code == 302 and resp.headers["Location"] == "/"
    user = User.query.filter_by(username="ann.ad").one()
    assert (user.full_name, user.email) == ("Ann Directory", "ann@example.invalid")
    assert '"method": "ad"' in AuditLog.query.filter_by(event="login").one().detail_json
    assert client.get("/requests").status_code != 302  # signed in: no redirect to the sign-in page


def test_refresh_keeps_values_when_no_lookup_ran(seeded, client, directory):
    directory.looked_up = False
    make_ad_user()
    ad_login(client)
    user = User.query.filter_by(username="ann.ad").one()
    assert (user.full_name, user.email) == ("Old Name", "old@example.invalid")


def test_wrong_ad_password_is_the_generic_failure_and_creates_nothing(seeded, client, directory):
    html = ad_login(client, password="nope").get_data(as_text=True)
    assert "wrong. Try again" in html
    assert User.query.filter_by(username="ann.ad").count() == 0
    row = AuditLog.query.filter_by(event="login_failed").one()
    assert "username_hash" in row.detail_json and "ann.ad" not in row.detail_json


def test_a_deactivated_ad_user_gets_the_same_message_as_a_wrong_password(seeded, client, directory):
    make_ad_user(active=False)
    right = ad_login(client)
    assert right.status_code == 200 and "wrong. Try again" in right.get_data(as_text=True)
    wrong = ad_login(client, password="nope")
    page = lambda r: r.get_data(as_text=True).split('role="alert"')[1].split("</div>")[0]  # noqa: E731
    assert page(right) == page(wrong)
    assert client.get("/requests").status_code == 302


# ------------------------------------------------------------------------------------------ never reaches the directory

def test_an_empty_password_never_reaches_the_directory(seeded, client, directory):
    assert ad_login(client, password="").status_code == 200
    assert directory.calls == []
    assert ad.authenticate("ann.ad", "", directory=directory).failure == ad.REFUSED
    assert directory.calls == []


@pytest.mark.parametrize("typed", ["ann.ad@example.invalid", "EXAMPLE\\ann.ad", "ann ad", "ann'", "*", "a" * 70,
                                   "ann.ad)(uid=*", "ännï", "", "../x"])
def test_usernames_that_are_not_a_bare_account_name_are_refused(seeded, client, directory, typed):
    assert ad_login(client, name=typed).status_code == 200
    assert directory.calls == []
    assert User.query.filter(User.auth_source == "ad").count() == 0


# ------------------------------------------------------------------------------------------ lockout

def test_ad_failures_count_and_a_locked_name_is_not_sent_to_the_directory(seeded, client, directory):
    for _ in range(4):
        assert ad_login(client, password="nope").status_code == 200
    assert ad_login(client, password="nope").status_code == 429  # the fifth failure locks the name
    assert len(directory.calls) == 5
    right = ad_login(client)  # the right password while locked
    assert right.status_code == 429 and len(directory.calls) == 5
    assert LoginAttempt.query.filter_by(username="ann.ad").count() == 5


def test_a_successful_ad_sign_in_clears_earlier_failures(seeded, client, directory):
    make_ad_user()
    for _ in range(3):
        ad_login(client, password="nope")
    assert ad_login(client).status_code == 302
    assert LoginAttempt.query.filter_by(username="ann.ad").count() == 0


# ------------------------------------------------------------------------------------------ no local password

def test_an_ad_user_cannot_use_the_password_page(seeded, client, directory):
    make_ad_user()
    assert ad_login(client).status_code == 302
    assert client.get("/password").status_code == 404
    assert client.post("/password", data={"password": "new-password-1", "repeat": "new-password-1"}).status_code == 404
    assert User.query.filter_by(username="ann.ad").one().password_hash is None


def test_an_admin_cannot_make_a_local_account_over_an_ad_user(seeded, client, directory):
    make_ad_user()
    login(client, "demo.admin")
    client.post("/settings/users/add", data={"username": "ann.ad", "full_name": "X", "temp_password": "temp-pass-1"})
    user = User.query.filter_by(username="ann.ad").one()
    assert user.auth_source == "ad" and user.password_hash is None


def test_users_page_shows_the_method_and_the_waiting_marker(seeded, client, directory):
    ad_login(client)  # creates the pending user
    make_ad_user("bob.ad", active=False)  # also waiting: no one has handled it
    login(client, "demo.admin")
    html = client.get("/settings/users?lang=en").get_data(as_text=True)
    assert "Active Directory" in html and "Local account" in html
    assert html.count("Waiting for activation") == 2
    # activating clears the marker
    ann = User.query.filter_by(username="ann.ad").one()
    client.post("/settings/users/%d/toggle" % ann.id)
    assert client.get("/settings/users?lang=en").get_data(as_text=True).count("Waiting for activation") == 1


# ------------------------------------------------------------------------------------------ secrets

def test_nothing_secret_reaches_the_logs_or_the_audit_rows(seeded, client, directory, caplog):
    directory.users["ann.ad"] = (SECRET, "Ann Directory", "ann@example.invalid")
    make_ad_user()
    with caplog.at_level(logging.DEBUG):
        ad_login(client, password=SECRET)
        client.post("/logout")
        ad_login(client, password=SECRET + "x")
        ad_login(client, name="new.person", password=SECRET)
    assert SECRET not in caplog.text and "ann.ad@" not in caplog.text
    for row in AuditLog.query.all():
        assert SECRET not in (row.detail_json or "")
    assert not any(SECRET in str(c) for c in [User.query.all()])
    assert all(SECRET not in (u.password_hash or "") for u in User.query.all())


def test_a_directory_that_raises_becomes_the_generic_failure(seeded, client, directory):
    class Boom:
        def lookup(self, *a):
            raise RuntimeError("boom")

    client.application.extensions["ehr_ad"] = Boom()
    assert "wrong. Try again" in ad_login(client).get_data(as_text=True)


# ------------------------------------------------------------------------------------------ ad-test command

def run_cli(app, *args, input=None):
    return app.test_cli_runner().invoke(args=list(args), input=input)


def test_ad_test_prints_name_and_email(app, directory):
    res = run_cli(app, "ad-test", "Ann.AD", input="Ad-Pass-1234\n")
    assert res.exit_code == 0, res.output
    assert "Ann Directory" in res.output and "ann@example.invalid" in res.output
    assert "Ad-Pass-1234" not in res.output


def test_ad_test_prints_the_failure_class(app, directory):
    res = run_cli(app, "ad-test", "ann.ad", input="wrong\n")
    assert res.exit_code == 1 and "wrong_credentials" in res.output
    directory.down = True
    res = run_cli(app, "ad-test", "ann.ad", input="Ad-Pass-1234\n")
    assert res.exit_code == 1 and "cannot_connect" in res.output
    res = run_cli(app, "ad-test", "ann.ad", input="\n")  # an empty password is refused locally
    assert res.exit_code == 1 and "refused before any network call" in res.output
    assert all(pw != "" for _, pw in directory.calls)


def test_ad_test_takes_no_password_argument(app, directory):
    res = run_cli(app, "ad-test", "ann.ad", "extra-password-arg")
    assert res.exit_code != 0
