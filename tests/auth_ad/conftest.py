import pytest

from ehr.auth import ad


class FakeDirectory:
    """Stands in for the directory. users: {sAMAccountName: (password, full_name, email)}."""

    def __init__(self, users=None, looked_up=True):
        self.users = dict(users or {})
        self.calls = []  # (username, password) of every lookup that reached the "network"
        self.down = False
        self.looked_up = looked_up

    def lookup(self, username, password):
        self.calls.append((username, password))
        if self.down:
            return ad.AdResult(False, ad.CONNECT)
        found = self.users.get(username)
        if found is None or found[0] != password:
            return ad.AdResult(False, ad.CREDENTIALS)
        return ad.AdResult(True, full_name=found[1], email=found[2], looked_up=self.looked_up)


@pytest.fixture
def directory(app):
    fake = FakeDirectory({"ann.ad": ("Ad-Pass-1234", "Ann Directory", "ann@example.invalid")})
    app.extensions["ehr_ad"] = fake
    app.config["EHR_AD_ENABLED"] = True
    return fake
