"""Invented test data that is safe on the live server: `flask load-test-data` and `flask clear-test-data`.

Why this exists: `seed-demo` and `seed-cases` hold a known password and are refused in production. For user
acceptance testing the owner wants invented data on the live server and wipes it before go-live. Everything made here
can be told apart from real data by its name:

- usernames start with `test.` and every address ends in `@test.invalid` (mail to them reaches no mailbox);
- full names, list names and titles end with a "(test)" mark; Directorate and cost-centre codes start with `T-`;
- positions and specialties end with " (test)" in English.

The data is the seed file with those marks applied, loaded through the same `seed_demo` and `seed_cases` code. The
password is asked for once and shared by all test accounts; it is never an option and never printed.

`clear` removes the test rows and what hangs off them. It refuses, changing nothing, when real people or real data
are tied to them. Audit rows are never deleted: the rows of test users keep their text, but their user id is set to
empty (a foreign key would block deleting the user, and a reused id would point the old rows at a real person); the
clear writes one `list_changed` audit row that lists the ids and usernames it released.
"""
import os
import shutil
from datetime import datetime, timezone

from sqlalchemy import or_, update
from sqlalchemy.exc import IntegrityError

from .extensions import db
from .models import (AuditLog, CostCentre, Directorate, Facility, MailOutbox, NumberCounter, NumberSequence, OaySpecialty, Position,
                     Request, RequestAction, RequestDocument, RequestFinancials, RequestLeaver, RoleAssignment, Setting,
                     Task, User, UserDirectorate, ArchiveDeposit, audit)
from .models.access import CENTRAL_ROLES
from .seed import load_data, seed_demo
from .services.request_seed_cases import Scope, seed_cases

USER_PREFIX = "test."
CODE_PREFIX = "T-"
MAIL_DOMAIN = "test.invalid"
# Greek "(test)" written as escapes, because Greek never appears literally in Python files here.
MARK_EL = " (\u03b4\u03bf\u03ba\u03b9\u03bc\u03ae)"
MARK_EN = " (test)"
SCOPE = Scope(user_prefix=USER_PREFIX, directorate_prefix=CODE_PREFIX, cost_centre_prefix=CODE_PREFIX,
              list_suffix=MARK_EN, marker="test-", only_these_timers=True)
CONFIRM_TEXT = "delete test data"


class Refused(Exception):
    """The operation cannot go ahead. `problems` lists why, one line each."""

    def __init__(self, problems):
        super().__init__("\n".join(problems))
        self.problems = list(problems)


def test_view(data):
    """The seed file with the test marks applied. Settings and public holidays are left out (a real install has its
    own), and the demo password is not used."""
    t = lambda code: CODE_PREFIX + code  # noqa: E731
    u = lambda name: USER_PREFIX + name  # noqa: E731
    return {
        "settings": {},
        "public_holidays": [],
        "role_permissions": data["role_permissions"],
        "demo_password": "",
        "directorates": [dict(d, code=t(d["code"]), name_el=d["name_el"] + MARK_EL, name_en=d["name_en"] + MARK_EN)
                         for d in data["directorates"]],
        "facilities": [dict(f, directorate=t(f["directorate"]), code=t(f["code"]), name_el=f["name_el"] + MARK_EL,
                            name_en=f["name_en"] + MARK_EN) for f in data["facilities"]],
        "positions": [dict(p, title_el=p["title_el"] + MARK_EL, title_en=p["title_en"] + MARK_EN)
                      for p in data["positions"]],
        "cost_centres": [dict(c, code=t(c["code"]), name_el=c["name_el"] + MARK_EL, name_en=c["name_en"] + MARK_EN)
                         for c in data["cost_centres"]],
        "oay_specialties": [name + MARK_EN for name in data["oay_specialties"]],
        "users": [dict(x, username=u(x["username"]), full_name=x["full_name"] + MARK_EL,
                       email="%s@%s" % (u(x["username"]), MAIL_DOMAIN)) for x in data["users"]],
        "line_managers": {u(k): u(v) for k, v in data["line_managers"].items()},
        "role_assignments": [dict(a, user=u(a["user"]), directorate=t(a["directorate"]) if a["directorate"] else None,
                                  substitute=u(a["substitute"]) if a["substitute"] else None)
                             for a in data["role_assignments"]],
        "user_directorates": [[u(name), t(code)] for name, code in data["user_directorates"]],
    }


def users_missing():
    have = {name for (name,) in db.session.query(User.username).filter(User.username.startswith(USER_PREFIX, autoescape=True))}
    return [x["username"] for x in test_view(load_data())["users"] if x["username"] not in have]


def central_holders_in_the_way():
    """Real (non-test) active holders of central roles. The engine would give the test requests' tasks to them."""
    out = []
    for a in RoleAssignment.query.filter(RoleAssignment.role.in_(CENTRAL_ROLES), RoleAssignment.directorate_id.is_(None)):
        if a.is_active_on() and not a.user.username.startswith(USER_PREFIX):
            out.append("%s is held by %s" % (a.role, a.user.username))
    return out


def load(password, now=None):
    """Load the test data (idempotent) and the sample requests. Returns a dict of counts for the message."""
    now = now or datetime.now(timezone.utc)
    problems = central_holders_in_the_way()
    if problems:
        raise Refused(["A real holder of a central role exists, so the test requests would be routed to a real person:"]
                      + ["  " + p for p in problems]
                      + ["Load the test data before real central role holders are set up, or remove them for now."])
    before = User.query.filter(User.username.startswith(USER_PREFIX, autoescape=True)).count()
    if users_missing() and not password:
        raise ValueError("a password is needed to create the test users")
    seed_demo(test_view(load_data()), password=password)
    created = seed_cases(now, SCOPE)
    after = User.query.filter(User.username.startswith(USER_PREFIX, autoescape=True)).count()
    audit("list_changed", object_type="test_data", object_id="load",
          detail={"action": "load", "by": "cli", "users_added": after - before, "requests_added": created})
    db.session.commit()
    return {"users_added": after - before, "users": after, "requests_added": created}


# ------------------------------------------------------------------ clear

def _test_user_ids():
    return [i for (i,) in db.session.query(User.id).filter(User.username.startswith(USER_PREFIX, autoescape=True))]


class Plan:
    """What a clear would remove, and what stands in its way."""

    def __init__(self):
        q = db.session.query
        self.user_ids = _test_user_ids()
        self.users = {i: n for i, n in q(User.id, User.username).filter(User.id.in_(self.user_ids))} if self.user_ids else {}
        self.dir_ids = [i for (i,) in q(Directorate.id).filter(Directorate.code.startswith(CODE_PREFIX, autoescape=True))]
        self.facility_ids = ([i for (i,) in q(Facility.id).filter(Facility.directorate_id.in_(self.dir_ids))]
                             if self.dir_ids else [])
        self.cc_ids = [i for (i,) in q(CostCentre.id).filter(CostCentre.code.startswith(CODE_PREFIX, autoescape=True))]
        self.position_ids = [i for (i,) in q(Position.id).filter(Position.title_en.endswith(MARK_EN, autoescape=True))]
        self.specialty_ids = [i for (i,) in q(OaySpecialty.id).filter(OaySpecialty.name.endswith(MARK_EN, autoescape=True))]
        cond = []
        if self.user_ids:
            cond.append(Request.created_by.in_(self.user_ids))
        if self.dir_ids:
            cond.append(Request.directorate_id.in_(self.dir_ids))
        rows = q(Request.id, Request.number, Request.created_by).filter(or_(*cond)).all() if cond else []
        self.request_ids = [r[0] for r in rows]
        self.numbers = {r[0]: r[1] or "draft #%d" % r[0] for r in rows}
        self.problems = self._problems()

    def _label(self, request_id):
        return self.numbers.get(request_id, "request %d" % request_id)

    def _problems(self):
        out = []
        q, users, reqs = db.session.query, list(self.user_ids), self.request_ids
        names = lambda ids: {i: n for i, n in q(User.id, User.username).filter(User.id.in_(ids))} if ids else {}  # noqa: E731
        if reqs:
            for r in q(Request).filter(Request.id.in_(reqs)):
                if r.created_by not in self.users:
                    out.append("%s was created by %s, who is not a test user." % (self._label(r.id), names([r.created_by])[r.created_by]))
            seen = set()
            for a in q(RequestAction).filter(RequestAction.request_id.in_(reqs)):
                for who in (a.actor_user_id, a.on_behalf_of_user_id):
                    if who is not None and who not in self.users and (a.request_id, who) not in seen:
                        seen.add((a.request_id, who))
                        out.append("%s was acted on by %s, who is not a test user." % (self._label(a.request_id), names([who])[who]))
            for d in q(RequestDocument).filter(RequestDocument.request_id.in_(reqs), RequestDocument.uploaded_by.isnot(None)):
                if d.uploaded_by not in self.users:
                    out.append("A document of %s was uploaded by %s, who is not a test user." % (self._label(d.request_id), names([d.uploaded_by])[d.uploaded_by]))
            for dep in q(ArchiveDeposit).filter(ArchiveDeposit.request_id.in_(reqs)):
                if dep.state == "stored" or dep.protocol_id:
                    out.append("The %s deposit of %s reached eArchive (state %s%s). It cannot be taken back from here." % (
                        dep.kind, self._label(dep.request_id), dep.state,
                        ", protocol %s" % dep.protocol_number if dep.protocol_number else ""))
        # Real data that points at things a clear would delete: the database would refuse the delete.
        if users:
            for u in q(User).filter(User.line_manager_user_id.in_(users), User.id.notin_(users)):
                out.append("%s has the test user %s as line manager." % (u.username, self.users[u.line_manager_user_id]))
            for a in q(RoleAssignment).filter(RoleAssignment.substitute_user_id.in_(users), RoleAssignment.user_id.notin_(users)):
                out.append("%s (%s) has the test user %s as substitute." % (a.user.username, a.role, self.users[a.substitute_user_id]))
        if self.dir_ids:
            for a in q(RoleAssignment).filter(RoleAssignment.directorate_id.in_(self.dir_ids), RoleAssignment.user_id.notin_(users or [0])):
                out.append("%s holds %s in a test Directorate." % (a.user.username, a.role))
            for ud in q(UserDirectorate).filter(UserDirectorate.directorate_id.in_(self.dir_ids), UserDirectorate.user_id.notin_(users or [0])):
                out.append("%s can see a test Directorate." % names([ud.user_id])[ud.user_id])
        keep = Request.id.notin_(reqs or [0])
        for label, column, ids in (("Directorate", Request.directorate_id, self.dir_ids),
                                   ("facility", Request.facility_id, self.facility_ids),
                                   ("cost centre", Request.cost_centre_id, self.cc_ids),
                                   ("position", Request.position_id, self.position_ids),
                                   ("specialty", Request.oay_specialty_id, self.specialty_ids)):
            if ids:
                for r in q(Request).filter(column.in_(ids), keep):
                    out.append("The real request %s uses a test %s." % (r.number or r.id, label))
        if self.specialty_ids:
            for f in q(RequestFinancials).filter(RequestFinancials.oay_specialty_id.in_(self.specialty_ids),
                                                 RequestFinancials.request_id.notin_(reqs or [0])):
                out.append("Financials of the real request %d use a test specialty." % f.request_id)
        return out

    def counts(self):
        q, reqs, users = db.session.query, self.request_ids or [0], self.user_ids or [0]
        c = lambda model, *cond: q(model).filter(*cond).count()  # noqa: E731
        docs = c(RequestDocument, RequestDocument.request_id.in_(reqs))
        return [
            ("requests", len(self.request_ids)),
            ("leavers", c(RequestLeaver, RequestLeaver.request_id.in_(reqs))),
            ("actions", c(RequestAction, RequestAction.request_id.in_(reqs))),
            ("financials", c(RequestFinancials, RequestFinancials.request_id.in_(reqs))),
            ("documents", docs),
            ("tasks", c(Task, Task.request_id.in_(reqs))),
            ("mail_outbox rows", c(MailOutbox, self._mail_cond())),
            ("archive deposits", c(ArchiveDeposit, ArchiveDeposit.request_id.in_(reqs))),
            ("role assignments", c(RoleAssignment, self._assignment_cond())),
            ("users", len(self.user_ids)),
            ("Directorates", len(self.dir_ids)),
            ("facilities", len(self.facility_ids)),
            ("cost centres", len(self.cc_ids)),
            ("positions", len(self.position_ids)),
            ("specialties", len(self.specialty_ids)),
            ("audit rows kept, user id emptied", c(AuditLog, AuditLog.user_id.in_(users))),
        ]

    def _mail_cond(self):
        return or_(MailOutbox.request_id.in_(self.request_ids or [0]), MailOutbox.to_user_id.in_(self.user_ids or [0]),
                   MailOutbox.to_email.endswith("@" + MAIL_DOMAIN))

    def _assignment_cond(self):
        return or_(RoleAssignment.user_id.in_(self.user_ids or [0]), RoleAssignment.directorate_id.in_(self.dir_ids or [0]))

    def total(self):
        return sum(n for label, n in self.counts() if not label.startswith("audit"))


def plan():
    return Plan()


def _files_of(request_ids):
    """Absolute paths of the stored files of these requests, and the folders that held them."""
    from .documents import storage

    files, folders = [], []
    for doc in RequestDocument.query.filter(RequestDocument.request_id.in_(request_ids)):
        if doc.storage_ref:
            path = storage.abs_path(doc.storage_ref)
            files += [path, storage.converted_path(path)]
    for dep in ArchiveDeposit.query.filter(ArchiveDeposit.request_id.in_(request_ids)):
        if dep.pdf_storage_ref:
            files.append(storage.abs_path(dep.pdf_storage_ref))
    for rid in request_ids:
        folders += [storage.abs_path(str(rid)), storage.abs_path("archive/%d" % rid)]
    return files, folders


def _release_numbers(removed_numbers):
    """Give back request numbers nobody holds any more. Each counter (one per directorate, position and day, and the
    old yearly ones) goes down to the highest number still used under it, or to 0 when none is. Without this the
    first real request would not be number 1."""
    stems, years = set(), set()
    for number in removed_numbers:
        parts = (number or "").split("-")
        if len(parts) == 5 and parts[3].isdigit() and len(parts[3]) == 8 and parts[4].isdigit():
            stems.add(number.rsplit("-", 1)[0])
        elif len(parts) == 3 and parts[1].isdigit() and parts[2].isdigit():
            years.add(int(parts[1]))
    remaining = [n for (n,) in db.session.query(Request.number).filter(Request.number.isnot(None))]
    for stem in stems:
        top = 0
        for number in remaining:
            head, _, tail = number.rpartition("-")
            if head == stem and tail.isdigit():
                top = max(top, int(tail))
        row = db.session.get(NumberCounter, stem)
        if row is not None and row.last_value > top:
            row.last_value = top
    for year in years:
        top = 0
        for number in remaining:
            parts = number.rsplit("-", 2)
            if len(parts) == 3 and parts[1] == str(year) and parts[2].isdigit():
                top = max(top, int(parts[2]))
        row = db.session.get(NumberSequence, year)
        if row is not None and row.last_value > top:
            row.last_value = top


def clear(the_plan=None):
    """Delete the test data. Raises Refused when something blocks it, with nothing changed."""
    p = the_plan or plan()
    if p.problems:
        raise Refused(p.problems)
    q, reqs, users = db.session.query, p.request_ids, p.user_ids
    files, folders = _files_of(reqs) if reqs else ([], [])
    summary = dict(p.counts())
    removed_users = dict(p.users)
    removed_numbers = [n for n in p.numbers.values()]
    try:
        q(MailOutbox).filter(p._mail_cond()).delete(synchronize_session=False)
        if reqs:
            q(ArchiveDeposit).filter(ArchiveDeposit.request_id.in_(reqs)).delete(synchronize_session=False)
            q(RequestDocument).filter(RequestDocument.request_id.in_(reqs)).delete(synchronize_session=False)
            q(RequestAction).filter(RequestAction.request_id.in_(reqs)).update({"supersedes_action_id": None}, synchronize_session=False)
            q(RequestAction).filter(RequestAction.request_id.in_(reqs)).delete(synchronize_session=False)
            q(RequestFinancials).filter(RequestFinancials.request_id.in_(reqs)).delete(synchronize_session=False)
            q(RequestLeaver).filter(RequestLeaver.request_id.in_(reqs)).delete(synchronize_session=False)
            q(Task).filter(Task.request_id.in_(reqs)).delete(synchronize_session=False)
            q(Request).filter(Request.id.in_(reqs)).delete(synchronize_session=False)
        q(RoleAssignment).filter(p._assignment_cond()).delete(synchronize_session=False)
        q(UserDirectorate).filter(UserDirectorate.user_id.in_(users or [0])
                                  | UserDirectorate.directorate_id.in_(p.dir_ids or [0])).delete(synchronize_session=False)
        if users:
            q(User).filter(User.id.in_(users)).update({"line_manager_user_id": None}, synchronize_session=False)
            q(Setting).filter(Setting.updated_by.in_(users)).update({"updated_by": None}, synchronize_session=False)
            # Core statement on purpose: the ORM guard stops row-by-row changes to the audit log. See the module docstring.
            db.session.execute(update(AuditLog).where(AuditLog.user_id.in_(users)).values(user_id=None))
            q(User).filter(User.id.in_(users)).delete(synchronize_session=False)
        if p.facility_ids:
            q(Facility).filter(Facility.id.in_(p.facility_ids)).delete(synchronize_session=False)
        if p.dir_ids:
            q(Directorate).filter(Directorate.id.in_(p.dir_ids)).delete(synchronize_session=False)
        if p.cc_ids:
            q(CostCentre).filter(CostCentre.id.in_(p.cc_ids)).delete(synchronize_session=False)
        if p.position_ids:
            q(Position).filter(Position.id.in_(p.position_ids)).delete(synchronize_session=False)
        if p.specialty_ids:
            q(OaySpecialty).filter(OaySpecialty.id.in_(p.specialty_ids)).delete(synchronize_session=False)
        db.session.flush()
        _release_numbers(removed_numbers)
        audit("list_changed", object_type="test_data", object_id="clear",
              detail={"action": "clear", "by": "cli", "removed": summary,
                      "users": {str(i): n for i, n in sorted(removed_users.items())},
                      "request_numbers": sorted(n for n in removed_numbers if n)})
        db.session.commit()
    except IntegrityError as err:
        db.session.rollback()
        raise Refused(["The database refused the delete, so nothing was changed: %s" % str(err.orig)])
    for path in files:
        try:
            os.remove(path)
        except OSError:
            pass
    for folder in folders:
        shutil.rmtree(folder, ignore_errors=True)
    return summary
