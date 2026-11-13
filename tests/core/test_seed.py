from ehr.extensions import db
from ehr.models import (CostCentre, Directorate, Facility, OaySpecialty, Position, PublicHoliday, RoleAssignment,
                        User)
from ehr.seed import seed_demo


def counts():
    return [m.query.count() for m in (Directorate, Facility, Position, CostCentre, OaySpecialty, PublicHoliday,
                                      User, RoleAssignment)]


def test_seed_is_idempotent(seeded):
    before = counts()
    seed_demo()
    assert counts() == before


def test_seed_shape(seeded):
    assert Directorate.query.count() == 6
    assert [d.code for d in Directorate.query.filter_by(has_sci_director=True)] == ["NIC", "LIM", "LAR"]
    assert {p.category for p in Position.query} == {"medical", "nursing", "allied", "admin", "other"}
    holders = RoleAssignment.query.filter(RoleAssignment.role != "requester", RoleAssignment.role != "viewer",
                                          RoleAssignment.role != "admin").all()
    assert holders and all(a.substitute_user_id for a in holders)
    assert not any(u.must_change_password for u in User.query)
    assert all(u.line_manager_user_id or u.username == "central.ceo" or u.username.startswith("demo.") for u in User.query)


def test_cli_commands(app):
    runner = app.test_cli_runner()
    assert runner.invoke(args=["init-db"]).exit_code == 0
    assert runner.invoke(args=["seed-demo"]).exit_code == 0
    assert runner.invoke(args=["seed-demo"]).exit_code == 0
    assert Directorate.query.count() == 6
