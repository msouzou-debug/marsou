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


# Invented lines, version 2 of the contract. Distinct amounts, so a test can search a page, a payload, a PDF or the
# eArchive meta for them. 2121 has no budget loaded; 3003 is not a salary line and must never show.
LINES = [line("2102", "BASIC PAY", "250000.00", "180340.12", "20000.00", "49659.88"),
         line("2103", "13TH SALARY", 80000, 61200.5, "18800.00", "-0.50"),
         line("2121", "OVERTIME", None, "0.00", "0.00", None),
         line("3003", "SUBSISTENCE ALLOWANCE", "77777.77", "0.00", "0.00", "77777.77", payroll=False)]
AMOUNT_TEXTS = ("250000", "250.000", "180340", "180.340", "49659", "49.659", "80000", "80.000", "61200", "61.200",
                "18800", "18.800", "77777", "77.777")


def set_budget_mode(value):
    row = db.session.get(Setting, "efinance_budget")
    if row is None:
        row = Setting(key="efinance_budget")
        db.session.add(row)
    row.value = value
    db.session.commit()
    budget_efinance.clear_cache()
