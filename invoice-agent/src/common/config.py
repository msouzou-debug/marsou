"""Config loading + validation (Phase 0). Invalid config refuses to run —
in particular any approval setup that could break four-eyes (§6, Phase 4 demo).
"""

import math
import os

import yaml


class ConfigError(Exception):
    pass


def _read_yaml(path, required=True):
    if not os.path.exists(path):
        if required:
            raise ConfigError(f"missing config file: {path}")
        return {}
    with open(path, encoding="utf-8") as f:
        return yaml.safe_load(f) or {}


def load_settings(base_dir=None):
    base = base_dir or os.getcwd()
    s = _read_yaml(os.path.join(base, "config", "settings.yaml"))
    s["vendors_overrides"] = _read_yaml(os.path.join(base, "config", "vendors.yaml"), required=False) or {}
    s["gl_rules"] = _read_yaml(os.path.join(base, "config", "gl_rules.yaml"), required=False).get("rules", [])
    s["base_dir"] = base
    validate_settings(s)

    # resolve relative paths against the app root
    for section, key in (("folders", "watch"), ("folders", "archive_root"), ("folders", "output_root"),
                         ("vendor_master", "vendors_csv"), ("vendor_master", "mapping_csv")):
        p = s.get(section, {}).get(key)
        if p and not os.path.isabs(p):
            s[section][key] = os.path.normpath(os.path.join(base, p))
    s["db_path"] = os.path.join(base, "db", "invoice_agent.db")
    return s


def validate_settings(s):
    errors = []

    ap = s.get("approval") or {}
    four_eyes = ap.get("four_eyes_minimum", 0)
    if not isinstance(four_eyes, int) or four_eyes < 2:
        errors.append("approval.four_eyes_minimum must be an integer >= 2")
    if ap.get("self_approval") != "forbidden":
        errors.append("approval.self_approval must be 'forbidden'")

    chain = ap.get("chain") or []
    if not chain:
        errors.append("approval.chain is empty")
    users = ap.get("users") or {}
    prev_limit = None
    approver_emails = set()
    for step in chain:
        role, limit = step.get("role"), step.get("approve_up_to")
        if not role:
            errors.append("approval.chain step missing 'role'")
            continue
        if limit is None:
            errors.append(f"approval.chain role {role} missing approve_up_to")
            continue
        limit = float(limit)
        if prev_limit is not None and limit < prev_limit:
            errors.append(f"approval.chain limits must be non-decreasing (at {role})")
        prev_limit = limit
        members = users.get(role) or []
        if not members:
            errors.append(f"approval.users has nobody for role '{role}'")
        if limit > 0:
            approver_emails.update(m.strip().lower() for m in members)
    if chain and not math.isinf(float(chain[-1].get("approve_up_to") or 0)):
        errors.append("last approval.chain step must have approve_up_to: .inf")
    # a config that cannot ever produce four_eyes distinct people is invalid
    preparers = {m.strip().lower() for m in (users.get(chain[0]["role"]) or [])} if chain else set()
    if len(approver_emails | preparers) < four_eyes:
        errors.append(
            f"approval config can never satisfy four_eyes_minimum={four_eyes}: "
            f"only {len(approver_emails | preparers)} distinct people across the chain"
        )

    rates = (s.get("validation") or {}).get("vat_rates")
    if not rates:
        errors.append("validation.vat_rates is empty")

    if not (s.get("entities") or []):
        errors.append("entities list is empty")

    ret = (s.get("audit") or {}).get("retention_years", 0)
    if ret < 6:
        errors.append("audit.retention_years must be >= 6 (Cyprus tax records)")

    if errors:
        raise ConfigError("invalid settings.yaml:\n  - " + "\n  - ".join(errors))


def role_of(settings, email):
    email = (email or "").strip().lower()
    return [
        role
        for role, members in (settings.get("approval", {}).get("users") or {}).items()
        if email in [m.strip().lower() for m in (members or [])]
    ]


def graph_client_secret():
    """Secrets live in the environment / OS keystore — never in the repo (§10)."""
    return os.environ.get("GRAPH_CLIENT_SECRET", "")
