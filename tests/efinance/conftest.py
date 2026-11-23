"""Fixtures for the eFinance link tests (contract 07): a stand-in eFinance on 127.0.0.1 and the app pointed at it."""
import pytest

from ehire.extensions import db
from ehire.models import Setting
from ehire.services import budget_efinance
from tests.efinance.fake_efinance import FakeEFinance, cc, line


@pytest.fixture
def fake():
    server = FakeEFinance().start()
    yield server
    server.stop()


@pytest.fixture
def wired(seeded, fake):
    """Seeded app whose eFinance settings point at the stand-in. The link setting is still `none`."""
    seeded.config.update(EHIRE_EFINANCE_URL=fake.url, EHIRE_EFINANCE_TOKEN=fake.token, EHIRE_EFINANCE_TIMEOUT=0.5)
    budget_efinance.clear_cache()
    yield seeded
    budget_efinance.clear_cache()


def set_link(value):
    row = db.session.get(Setting, "efinance_link")
    if row is None:
        row = Setting(key="efinance_link")
        db.session.add(row)
    row.value = value
    db.session.commit()
    budget_efinance.clear_cache()


@pytest.fixture
def linked(wired):
    set_link("http")
    return wired


def demo_list(fake, extra=()):
    """eFinance's list matching the seeded demo cost centres (codes 1001 to 1010), plus `extra` rows."""
    entity = {"1001": "NIC", "1002": "NIC", "1003": "NIC", "1004": "LIM", "1005": "LAR", "1006": "PHC",
              "1007": "MH", "1008": "AMB", "1009": None, "1010": None}
    from ehire.models import CostCentre

    rows = [cc(c.code, c.name_el, entity.get(c.code), True, c.name_en) for c in CostCentre.query.order_by(CostCentre.code)]
    fake.cost_centres = rows + list(extra)
    return fake.cost_centres


LINES = [line("02101", "Sample salaries", "250000.00", "180340.12", "20000.00", "49659.88"),
         line("02102", "Sample temporary salaries", "80000.00", "61200.00", "18800.00", "0.00"),
         line("02110", "Sample overtime", "30000.00", "12000.00", "0.00", "18000.00")]
