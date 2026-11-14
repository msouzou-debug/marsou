"""0003: central roles may create requests; record the retention period assumption.

Adds `request.create` to the five central roles on a database that already has role permissions, and adds the
setting `retention_years` = 10 when it is missing. Safe to run twice. A role with no permission rows at all is left
alone: that is a database whose permissions were never seeded, and `flask create-admin` or the seed will add them all.
This only records the value. No job deletes anything (docs/operations.md).
"""
from sqlalchemy import column, func, insert, select, table

from ehr.migrations.helpers import has_table

CENTRAL_ROLES = ("fin_mgmt_head", "central_hr_officer", "medical_director", "nursing_director", "ceo")
PERMISSION = "request.create"

role_permission = table("role_permission", column("role"), column("permission_key"))
setting = table("setting", column("key"), column("value"))


def upgrade(connection):
    if has_table(connection, "role_permission"):
        for role in CENTRAL_ROLES:
            rows = select(func.count()).select_from(role_permission).where(role_permission.c.role == role)
            has_any = connection.execute(rows).scalar()
            has_key = connection.execute(rows.where(role_permission.c.permission_key == PERMISSION)).scalar()
            if has_any and not has_key:
                connection.execute(insert(role_permission).values(role=role, permission_key=PERMISSION))
    if has_table(connection, "setting"):
        found = connection.execute(
            select(func.count()).select_from(setting).where(setting.c.key == "retention_years")).scalar()
        if not found:
            connection.execute(insert(setting).values(key="retention_years", value="10"))
