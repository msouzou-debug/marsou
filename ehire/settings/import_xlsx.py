"""Bulk import of the master lists and role holders from one Excel workbook.

Three steps: read the file into plain rows (`read_workbook`), check every row against the file and the database
without changing anything (`validate`), apply the checked operations in the caller's transaction (`apply`).
Import never deletes: `active = no` deactivates. Formulas are never evaluated (data_only, read-only).
"""
import re
import secrets
import zipfile

from openpyxl import Workbook, load_workbook
from openpyxl.styles import Alignment, Font, PatternFill
from openpyxl.utils import get_column_letter
from openpyxl.worksheet.datavalidation import DataValidation

from .. import i18n
from ..auth import current_user, hash_password
from ..extensions import db
from ..models import (ARCHIVE_SITE_CODES, CATEGORIES, CENTRAL_ROLES, ROLES, CostCentre, Directorate, Facility,
                      OaySpecialty, Position, RoleAssignment, User, audit)
from .roles import SINGLE_DIRECTORATE_ROLES, _active, _ended_yesterday
from .users import EMAIL, USERNAME

MAX_BYTES = 5 * 1024 * 1024
MAX_ROWS = 5000
MAX_RAW_ROWS = 20000  # empty trailing rows count against this, so a file cannot make the reader run for long
SHEETS = {
    "directorates": ("code", "name_el", "name_en", "has_sci_director", "active"),
    "facilities": ("directorate_code", "code", "name_el", "name_en", "archive_site_code", "active"),
    "positions": ("category", "title_el", "title_en", "active"),
    "cost_centres": ("code", "name_el", "name_en", "active"),
    "oay_specialties": ("name", "active"),
    "users": ("username", "full_name", "email", "auth_source", "line_manager_username", "active"),
    "role_holders": ("role", "directorate_code", "username", "substitute_username"),
}
AUTH_SOURCES = ("local", "ad")
DIRECTORATE_ROLE_SET = ("requester",) + SINGLE_DIRECTORATE_ROLES
CENTRAL_ROLE_SET = CENTRAL_ROLES + ("viewer", "admin")
MULTI_HOLDER_ROLES = ("requester", "viewer", "admin")  # many holders for the same role and directorate
YES = {"yes", "y", "true", "1"}
NO = {"no", "n", "false", "0"}


class ImportProblem(Exception):
    """The file as a whole cannot be used. `key` is a string key."""

    def __init__(self, key, **params):
        super().__init__(key)
        self.key, self.params = key, params


# ---------------------------------------------------------------- reading

def check_file(path, size):
    """Raise ImportProblem unless the file is a plausible, safe .xlsx."""
    from ..documents import ooxml

    if size > MAX_BYTES:
        raise ImportProblem("import.err.file_size", mb=MAX_BYTES // (1024 * 1024))
    with open(path, "rb") as fh:
        magic = fh.read(4)
    if magic != b"PK\x03\x04" or not zipfile.is_zipfile(path):
        raise ImportProblem("import.err.file_type")
    if not ooxml.is_safe(path, 50 * 1024 * 1024):
        raise ImportProblem("import.err.file_unsafe")


def _text(value):
    if value is None:
        return ""
    if isinstance(value, bool):
        return "yes" if value else "no"
    if isinstance(value, float) and value.is_integer():
        value = int(value)
    return re.sub(r"\s+", " ", str(value)).strip()


def read_workbook(path):
    """{sheet: [{"row": n, "cells": {column: text}}]} for the known sheets that are present, plus structural
    errors as (sheet, row, column, key, params). Fully empty rows are skipped."""
    try:
        wb = load_workbook(path, read_only=True, data_only=True)
    except Exception:  # a damaged or unsupported workbook; the reason does not help the administrator
        raise ImportProblem("import.err.file_read")
    data, errors = {}, []
    try:
        for name in SHEETS:
            if name not in wb.sheetnames:
                continue
            columns = SHEETS[name]
            rows, header = [], None
            for number, values in enumerate(wb[name].iter_rows(values_only=True), start=1):
                if number > MAX_RAW_ROWS:
                    errors.append((name, number, "", "import.err.too_many_rows", {"rows": MAX_ROWS}))
                    break
                cells = [_text(v) for v in values]
                if header is None:
                    header = {h.lower(): i for i, h in enumerate(cells) if h}
                    for col in columns:
                        if col not in header:
                            errors.append((name, 1, col, "import.err.missing_column", {"column": col}))
                    continue
                if not any(cells):
                    continue
                if len(rows) >= MAX_ROWS:
                    errors.append((name, number, "", "import.err.too_many_rows", {"rows": MAX_ROWS}))
                    break
                rows.append({"row": number, "cells": {c: (cells[header[c]] if c in header and header[c] < len(cells) else "")
                                                      for c in columns}})
            data[name] = rows
    finally:
        wb.close()
    if not data:
        raise ImportProblem("import.err.no_sheets")
    return data, errors


# ---------------------------------------------------------------- validation

class _Check:
    def __init__(self):
        self.errors = []
        self.ops = []  # (sheet, action, key, values)

    def err(self, sheet, line, column, key, **params):
        self.errors.append((sheet, line, column, key, params))


def _flag(chk, sheet, row, column, raw, default):
    """yes/no cell. Returns True, False, or `default` when blank; None after reporting a bad value."""
    low = raw.lower()
    if not low:
        return default
    if low in YES:
        return True
    if low in NO:
        return False
    chk.err(sheet, row, column, "import.err.yes_no")
    return None


def _need(chk, sheet, row, column, raw, limit=200):
    if not raw:
        chk.err(sheet, row, column, "import.err.required")
        return False
    if len(raw) > limit:
        chk.err(sheet, row, column, "import.err.too_long", n=limit)
        return False
    return True


def _choose(chk, sheet, row, column, raw, allowed):
    if raw not in allowed:
        chk.err(sheet, row, column, "import.err.choose", allowed=", ".join(allowed))
        return False
    return True


def _same(obj, values):
    return all(getattr(obj, k) == v for k, v in values.items())


def _decide(chk, sheet, key, seen, row, existing, values, to_model):
    """Record add, update or unchanged. `to_model` maps the op values to model attribute names."""
    if key in seen:
        chk.err(sheet, row, "", "import.err.duplicate_in_file", row=seen[key])
        return
    seen[key] = row
    if existing is None:
        chk.ops.append((sheet, "add", key, values))
    elif _same(existing, to_model(values)):
        chk.ops.append((sheet, "unchanged", key, values))
    else:
        chk.ops.append((sheet, "update", key, values))


def _plain(values):
    return values


def validate(data, structural):
    """Check everything. Returns (errors, ops). Nothing is written."""
    chk = _Check()
    chk.errors.extend(structural)
    _directorates(chk, data.get("directorates", []))
    dir_codes = {d.code: d for d in Directorate.query.all()}
    file_dirs = {op[2]: op[3] for op in chk.ops if op[0] == "directorates"}
    sci = {c: d.has_sci_director for c, d in dir_codes.items()}
    sci.update({c: v["has_sci_director"] for c, v in file_dirs.items() if v["has_sci_director"] is not None})
    known_dirs = set(dir_codes) | set(file_dirs)
    _facilities(chk, data.get("facilities", []), known_dirs, dir_codes)
    _positions(chk, data.get("positions", []))
    _cost_centres(chk, data.get("cost_centres", []))
    _specialties(chk, data.get("oay_specialties", []))
    users_final = _users(chk, data.get("users", []))
    _role_holders(chk, data.get("role_holders", []), known_dirs, sci, users_final)
    return chk.errors, chk.ops


def _directorates(chk, rows):
    s, seen = "directorates", {}
    by_code = {d.code: d for d in Directorate.query.all()}
    for r in rows:
        n, c = r["row"], r["cells"]
        ok = _need(chk, s, n, "code", c["code"], 20)
        ok &= _need(chk, s, n, "name_el", c["name_el"]) & _need(chk, s, n, "name_en", c["name_en"])
        sci = _flag(chk, s, n, "has_sci_director", c["has_sci_director"], None)
        act = _flag(chk, s, n, "active", c["active"], None)
        if c["has_sci_director"] and sci is None or c["active"] and act is None or not ok:
            continue
        existing = by_code.get(c["code"])
        values = {"code": c["code"], "name_el": c["name_el"], "name_en": c["name_en"],
                  "has_sci_director": sci, "is_active": act}
        _fill_defaults(values, existing, {"has_sci_director": False, "is_active": True})
        _decide(chk, s, c["code"], seen, n, existing, values, _plain)


def _fill_defaults(values, existing, defaults):
    """A blank flag keeps the stored value on an existing row and takes the default on a new one."""
    for k, default in defaults.items():
        if values[k] is None:
            values[k] = getattr(existing, k) if existing is not None else default


def _facilities(chk, rows, known_dirs, dir_codes):
    s, seen = "facilities", {}
    existing_all = {(f.directorate.code, f.code): f for f in Facility.query.all()}
    for r in rows:
        n, c = r["row"], r["cells"]
        ok = _need(chk, s, n, "code", c["code"], 20)
        ok &= _need(chk, s, n, "name_el", c["name_el"]) & _need(chk, s, n, "name_en", c["name_en"])
        if not c["directorate_code"]:
            chk.err(s, n, "directorate_code", "import.err.required")
            ok = False
        elif c["directorate_code"] not in known_dirs:
            chk.err(s, n, "directorate_code", "import.err.unknown_directorate", code=c["directorate_code"])
            ok = False
        site = c["archive_site_code"].upper()
        if site and not _choose(chk, s, n, "archive_site_code", site, ARCHIVE_SITE_CODES):
            ok = False
        act = _flag(chk, s, n, "active", c["active"], None)
        if c["active"] and act is None or not ok:
            continue
        existing = existing_all.get((c["directorate_code"], c["code"]))
        values = {"directorate_code": c["directorate_code"], "code": c["code"], "name_el": c["name_el"],
                  "name_en": c["name_en"], "archive_site_code": site or None, "is_active": act}
        _fill_defaults(values, existing, {"is_active": True})
        _decide(chk, s, (c["directorate_code"], c["code"]), seen, n, existing, values,
                lambda v: {k: x for k, x in v.items() if k != "directorate_code"})


def _positions(chk, rows):
    s, seen = "positions", {}
    existing_all = {(p.category, p.title_el): p for p in Position.query.all()}
    for r in rows:
        n, c = r["row"], r["cells"]
        ok = _choose(chk, s, n, "category", c["category"].lower(), CATEGORIES)
        ok &= _need(chk, s, n, "title_el", c["title_el"]) & _need(chk, s, n, "title_en", c["title_en"])
        act = _flag(chk, s, n, "active", c["active"], None)
        if c["active"] and act is None or not ok:
            continue
        key = (c["category"].lower(), c["title_el"])
        existing = existing_all.get(key)
        values = {"category": key[0], "title_el": c["title_el"], "title_en": c["title_en"], "is_active": act}
        _fill_defaults(values, existing, {"is_active": True})
        _decide(chk, s, key, seen, n, existing, values, _plain)


def _cost_centres(chk, rows):
    s, seen = "cost_centres", {}
    existing_all = {x.code: x for x in CostCentre.query.all()}
    for r in rows:
        n, c = r["row"], r["cells"]
        ok = _need(chk, s, n, "code", c["code"], 20)
        ok &= _need(chk, s, n, "name_el", c["name_el"]) & _need(chk, s, n, "name_en", c["name_en"])
        act = _flag(chk, s, n, "active", c["active"], None)
        if c["active"] and act is None or not ok:
            continue
        existing = existing_all.get(c["code"])
        values = {"code": c["code"], "name_el": c["name_el"], "name_en": c["name_en"], "is_active": act}
        _fill_defaults(values, existing, {"is_active": True})
        _decide(chk, s, c["code"], seen, n, existing, values, _plain)


def _specialties(chk, rows):
    s, seen = "oay_specialties", {}
    existing_all = {x.name: x for x in OaySpecialty.query.all()}
    for r in rows:
        n, c = r["row"], r["cells"]
        ok = _need(chk, s, n, "name", c["name"])
        act = _flag(chk, s, n, "active", c["active"], None)
        if c["active"] and act is None or not ok:
            continue
        existing = existing_all.get(c["name"])
        values = {"name": c["name"], "is_active": act}
        _fill_defaults(values, existing, {"is_active": True})
        _decide(chk, s, c["name"], seen, n, existing, values, _plain)


def _users(chk, rows):
    """Returns {lower username: is_active after the import} for every user known to the file or the database."""
    s, seen = "users", {}
    existing_all = {u.username.lower(): u for u in User.query.all()}
    final = {k: u.is_active for k, u in existing_all.items()}
    me = current_user()
    checked = []
    for r in rows:
        n, c = r["row"], r["cells"]
        ok = True
        if not c["username"] or not USERNAME.match(c["username"]):
            chk.err(s, n, "username", "import.err.username_invalid")
            ok = False
        ok &= _need(chk, s, n, "full_name", c["full_name"])
        if c["email"] and (len(c["email"]) > 200 or not EMAIL.match(c["email"])):
            chk.err(s, n, "email", "import.err.email_invalid")
            ok = False
        source = c["auth_source"].lower() or "local"
        if not _choose(chk, s, n, "auth_source", source, AUTH_SOURCES):
            ok = False
        act = _flag(chk, s, n, "active", c["active"], None)
        if c["active"] and act is None:
            ok = False
        if not ok:
            continue
        low = c["username"].lower()
        existing = existing_all.get(low)
        if existing is not None and existing.auth_source != source:
            chk.err(s, n, "auth_source", "import.err.auth_source_locked")
            continue
        if act is None:
            act = existing.is_active if existing is not None else True
        if existing is not None and existing.id == (me.id if me else None) and not act and existing.is_active:
            chk.err(s, n, "active", "import.err.self_deactivate")
            continue
        final[low] = act
        values = {"username": c["username"], "full_name": c["full_name"], "email": c["email"] or None,
                  "auth_source": source, "line_manager_username": c["line_manager_username"], "is_active": act}
        checked.append((n, low, values, existing))
    file_users = {low for _n, low, _v, _e in checked}
    for n, low, values, existing in checked:
        boss = values["line_manager_username"].lower()
        if boss:
            if boss == low:
                chk.err(s, n, "line_manager_username", "import.err.manager_self")
                continue
            if boss not in file_users and boss not in existing_all:
                chk.err(s, n, "line_manager_username", "import.err.unknown_user", username=values["line_manager_username"])
                continue
            if not final.get(boss, False):
                chk.err(s, n, "line_manager_username", "import.err.inactive_user", username=values["line_manager_username"])
                continue

        def to_model(v, existing=existing):
            out = {k: x for k, x in v.items() if k not in ("username", "line_manager_username")}
            out["line_manager_user_id"] = existing_all[v["line_manager_username"].lower()].id \
                if v["line_manager_username"] and v["line_manager_username"].lower() in existing_all else None
            return out

        if low in seen:
            chk.err(s, n, "", "import.err.duplicate_in_file", row=seen[low])
            continue
        seen[low] = n
        if existing is None:
            chk.ops.append((s, "add", low, values))
        elif _same(existing, to_model(values)) and (not values["line_manager_username"]
                                                    or values["line_manager_username"].lower() in existing_all):
            chk.ops.append((s, "unchanged", low, values))
        else:
            chk.ops.append((s, "update", low, values))
    return final


def _role_holders(chk, rows, known_dirs, sci, users_final):
    s = "role_holders"
    dirs = {d.code: d for d in Directorate.query.all()}
    users = {u.username.lower(): u for u in User.query.all()}
    seen_single, seen_multi = {}, {}
    for r in rows:
        n, c = r["row"], r["cells"]
        role, dcode = c["role"].lower(), c["directorate_code"]
        ok = _choose(chk, s, n, "role", role, ROLES)
        if ok:
            if role in DIRECTORATE_ROLE_SET:
                if not dcode:
                    chk.err(s, n, "directorate_code", "import.err.role_directorate_needed")
                    ok = False
                elif dcode not in known_dirs:
                    chk.err(s, n, "directorate_code", "import.err.unknown_directorate", code=dcode)
                    ok = False
                elif role == "sci_director" and not sci.get(dcode):
                    chk.err(s, n, "role", "import.err.role_no_sci")
                    ok = False
            elif dcode:
                chk.err(s, n, "directorate_code", "import.err.role_directorate_central")
                ok = False
        for column, name in (("username", c["username"]), ("substitute_username", c["substitute_username"])):
            if column == "username" and not name:
                chk.err(s, n, column, "import.err.required")
                ok = False
            elif name:
                if name.lower() not in users_final:
                    chk.err(s, n, column, "import.err.unknown_user", username=name)
                    ok = False
                elif not users_final[name.lower()]:
                    chk.err(s, n, column, "import.err.inactive_user", username=name)
                    ok = False
        if c["substitute_username"] and c["substitute_username"].lower() == c["username"].lower():
            chk.err(s, n, "substitute_username", "import.err.same_person")
            ok = False
        if not ok:
            continue
        key = (role, dcode or None)
        multi = role in MULTI_HOLDER_ROLES
        marker = key + (c["username"].lower(),) if multi else key
        book = seen_multi if multi else seen_single
        if marker in book:
            chk.err(s, n, "username" if not multi else "", "import.err.single_holder" if not multi else
                    "import.err.duplicate_in_file", row=book[marker])
            continue
        book[marker] = n
        values = {"role": role, "directorate_code": dcode or None, "username": c["username"],
                  "substitute_username": c["substitute_username"] or None}
        chk.ops.append((s, _role_action(values, dirs, users, multi), marker, values))


def _role_action(values, dirs, users, multi):
    directorate = dirs.get(values["directorate_code"]) if values["directorate_code"] else None
    if values["directorate_code"] and directorate is None:
        return "add"  # the Directorate is new in this file
    did = directorate.id if directorate else None
    holder = users.get(values["username"].lower())
    sub = users.get((values["substitute_username"] or "").lower())
    if holder is None:
        return "add"
    current = _active(values["role"], did)
    match = [a for a in current if a.user_id == holder.id]
    if multi:
        if match and match[0].substitute_user_id == (sub.id if sub else None):
            return "unchanged"
        return "update" if match else "add"
    if len(current) == 1 and match and current[0].substitute_user_id == (sub.id if sub else None):
        return "unchanged"
    return "update" if current else "add"


def summarise(ops):
    counts = {name: {"add": 0, "update": 0, "unchanged": 0} for name in SHEETS}
    for sheet, action, _k, _v in ops:
        counts[sheet][action] += 1
    return {k: v for k, v in counts.items() if any(v.values())}


# ---------------------------------------------------------------- applying

def apply(ops, admin_id):
    """Write every add and update, with audit rows. The caller commits. Sheets are applied in dependency order."""
    for sheet in SHEETS:
        if sheet == "users":
            _apply_users(ops, admin_id)
            continue
        for s, action, _key, values in ops:
            if s == sheet and action != "unchanged":
                _APPLY[sheet](action, values, admin_id)
                db.session.flush()


def _list_audit(kind, row, action, before, after, admin_id):
    audit("list_changed", user_id=admin_id, object_type=kind, object_id=row.id,
          detail={"action": "add" if action == "add" else "edit", "source": "import", "before": before, "after": after})


def _simple(kind, model, finder):
    def run(action, values, admin_id):
        row = finder(values) if action == "update" else None
        attrs = {k: v for k, v in values.items() if k != "directorate_code"}
        if "directorate_code" in values:
            attrs["directorate_id"] = Directorate.query.filter_by(code=values["directorate_code"]).one().id
        before = {k: getattr(row, k) for k in attrs} if row is not None else None
        if row is None:
            row = model(**attrs)
            db.session.add(row)
        else:
            for k, v in attrs.items():
                setattr(row, k, v)
        db.session.flush()
        _list_audit(kind, row, action, before, attrs, admin_id)
    return run


def _find_facility(v):
    d = Directorate.query.filter_by(code=v["directorate_code"]).one()
    return Facility.query.filter_by(directorate_id=d.id, code=v["code"]).one()


def _apply_users(ops, admin_id):
    """Two passes, so a line manager added in the same file exists before anyone points at them."""
    touched = []
    for sheet, action, _key, v in ops:
        if sheet != "users" or action == "unchanged":
            continue
        if action == "add":
            local = v["auth_source"] == "local"
            # A random password nobody knows: the administrator sets a real one in Users.
            user = User(username=v["username"], full_name=v["full_name"], email=v["email"], auth_source=v["auth_source"],
                        password_hash=hash_password(secrets.token_urlsafe(32)) if local else None,
                        must_change_password=local, is_active=v["is_active"], language="el")
            db.session.add(user)
            before = None
        else:
            user = User.query.filter(db.func.lower(User.username) == v["username"].lower()).one()
            before = _user_snapshot(user)
            user.full_name, user.email, user.is_active = v["full_name"], v["email"], v["is_active"]
        touched.append((user, v, before))
    db.session.flush()
    for user, v, before in touched:
        boss = None
        if v["line_manager_username"]:
            boss = User.query.filter(db.func.lower(User.username) == v["line_manager_username"].lower()).one()
        user.line_manager_user_id = boss.id if boss else None
        db.session.flush()
        detail = {"action": "add" if before is None else "edit", "source": "import", "after": _user_snapshot(user)}
        if before is not None:
            detail["before"] = before
        audit("user_changed", user_id=admin_id, object_type="user", object_id=user.id, detail=detail)


def _user_snapshot(user):
    return {"username": user.username, "full_name": user.full_name, "email": user.email, "language": user.language,
            "line_manager_user_id": user.line_manager_user_id, "is_active": user.is_active}


def _apply_role(action, v, admin_id):
    role = v["role"]
    directorate = Directorate.query.filter_by(code=v["directorate_code"]).one() if v["directorate_code"] else None
    did = directorate.id if directorate else None
    holder = User.query.filter(db.func.lower(User.username) == v["username"].lower()).one()
    sub = None
    if v["substitute_username"]:
        sub = User.query.filter(db.func.lower(User.username) == v["substitute_username"].lower()).one()
    before = [{"user_id": a.user_id, "substitute_user_id": a.substitute_user_id} for a in _active(role, did)]
    existing = RoleAssignment.query.filter_by(user_id=holder.id, role=role, directorate_id=did).first()
    if role not in MULTI_HOLDER_ROLES:  # one active holder: the others end yesterday, as in Settings > Role holders
        for a in _active(role, did):
            if existing is None or a.id != existing.id:
                a.active_to = _ended_yesterday()
    if existing is None:
        existing = RoleAssignment(user_id=holder.id, role=role, directorate_id=did)
        db.session.add(existing)
    existing.active_from = existing.active_to = None
    existing.substitute_user_id = sub.id if sub else None
    db.session.flush()
    after = [{"user_id": a.user_id, "substitute_user_id": a.substitute_user_id} for a in _active(role, did)]
    audit("role_changed", user_id=admin_id, object_type="role_assignment", object_id=role,
          detail={"role": role, "directorate_id": did, "source": "import", "before": before, "after": after})


_APPLY = {
    "directorates": _simple("directorate", Directorate, lambda v: Directorate.query.filter_by(code=v["code"]).one()),
    "facilities": _simple("facility", Facility, _find_facility),
    "positions": _simple("position", Position,
                         lambda v: Position.query.filter_by(category=v["category"], title_el=v["title_el"]).one()),
    "cost_centres": _simple("cost_centre", CostCentre, lambda v: CostCentre.query.filter_by(code=v["code"]).one()),
    "oay_specialties": _simple("oay_specialty", OaySpecialty, lambda v: OaySpecialty.query.filter_by(name=v["name"]).one()),
    "users": None,  # applied by _apply_users
    "role_holders": _apply_role,
}


# ---------------------------------------------------------------- the template (and export)

HEADER_FILL = PatternFill("solid", start_color="069FEC", end_color="069FEC")
HEADER_FONT = Font(bold=True, color="FFFFFF")


def _yn(flag):
    return "yes" if flag else "no"


def _export_rows():
    dirs = Directorate.query.order_by(Directorate.id).all()
    holders = []
    for d in [None] + dirs:
        did = d.id if d else None
        for role in (CENTRAL_ROLE_SET if d is None else DIRECTORATE_ROLE_SET):
            for a in _active(role, did):
                holders.append((role, d.code if d else "", a.user.username, a.substitute.username if a.substitute else ""))
    return {
        "directorates": [(d.code, d.name_el, d.name_en, _yn(d.has_sci_director), _yn(d.is_active)) for d in dirs],
        "facilities": [(f.directorate.code, f.code, f.name_el, f.name_en, f.archive_site_code or "", _yn(f.is_active))
                       for f in Facility.query.order_by(Facility.id)],
        "positions": [(p.category, p.title_el, p.title_en, _yn(p.is_active)) for p in Position.query.order_by(Position.id)],
        "cost_centres": [(c.code, c.name_el, c.name_en, _yn(c.is_active)) for c in CostCentre.query.order_by(CostCentre.id)],
        "oay_specialties": [(s.name, _yn(s.is_active)) for s in OaySpecialty.query.order_by(OaySpecialty.id)],
        "users": [(u.username, u.full_name, u.email or "", u.auth_source,
                   u.line_manager.username if u.line_manager else "", _yn(u.is_active))
                  for u in User.query.order_by(User.id)],
        "role_holders": holders,
    }


def build_template(lang):
    """The workbook: an Instructions sheet, then one sheet per list holding the rows the database already has."""
    def t(key, **params):
        return i18n.translate(key, lang, **params)

    wb = Workbook()
    info = wb.active
    info.title = "Instructions"
    lines = [t("import.title"), "", t("import.intro"), "", t("import.steps.title")]
    lines += [t(f"import.step.{i}") for i in (1, 2, 3, 4)]
    lines += ["", t("import.rules.title"), t("import.rule.nodelete"), t("import.rule.password"),
              t("import.rule.limits", mb=MAX_BYTES // (1024 * 1024), rows=MAX_ROWS), t("import.help.yes_no"), ""]
    lines += [f"{name}: {t('import.help.' + name)}" for name in SHEETS]
    for i, line in enumerate(lines, start=1):
        info.cell(row=i, column=1, value=line).alignment = Alignment(wrap_text=True, vertical="top")
    info["A1"].font = Font(bold=True, size=14)
    info.column_dimensions["A"].width = 110
    rows = _export_rows()
    choices = {
        ("directorates", "has_sci_director"): ("yes", "no"), ("directorates", "active"): ("yes", "no"),
        ("facilities", "archive_site_code"): ARCHIVE_SITE_CODES, ("facilities", "active"): ("yes", "no"),
        ("positions", "category"): CATEGORIES, ("positions", "active"): ("yes", "no"),
        ("cost_centres", "active"): ("yes", "no"), ("oay_specialties", "active"): ("yes", "no"),
        ("users", "auth_source"): AUTH_SOURCES, ("users", "active"): ("yes", "no"),
        ("role_holders", "role"): ROLES,
    }
    for name, columns in SHEETS.items():
        ws = wb.create_sheet(name)
        ws.append(list(columns))
        for i, col in enumerate(columns, start=1):
            cell = ws.cell(row=1, column=i)
            cell.fill, cell.font = HEADER_FILL, HEADER_FONT
            ws.column_dimensions[get_column_letter(i)].width = max(18, len(col) + 4)
        ws.freeze_panes = "A2"
        for values in rows[name]:
            ws.append(list(values))
            for cell in ws[ws.max_row]:
                if isinstance(cell.value, str) and cell.value.startswith("="):
                    cell.data_type = "s"  # text that looks like a formula stays text
        for i, col in enumerate(columns, start=1):
            if (name, col) in choices:
                dv = DataValidation(type="list", formula1='"' + ",".join(choices[(name, col)]) + '"', allow_blank=True)
                letter = get_column_letter(i)
                ws.add_data_validation(dv)
                dv.add(f"{letter}2:{letter}{MAX_ROWS + 1}")
    return wb
