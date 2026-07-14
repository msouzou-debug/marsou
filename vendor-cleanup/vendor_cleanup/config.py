import os

import yaml

_DEFAULTS = {
    "roles": {"reviewer": [], "approver": []},
    "paths": {"input_dir": "input", "output_dir": "output", "database": "vendor_cleanup.db"},
    "detection": {
        "fuzzy_name_cutoff": 85,
        "weights": {
            "same_iban": 0.9,
            "same_vat": 0.95,
            "same_tin": 0.95,
            "fuzzy_name": 0.5,
            "same_phone": 0.4,
        },
    },
    "server": {"host": "127.0.0.1", "port": 8090, "secret_key": "change-me"},
}


def load_settings(base_dir=None):
    base_dir = base_dir or os.getcwd()
    path = os.path.join(base_dir, "config", "settings.yaml")
    settings = {k: (dict(v) if isinstance(v, dict) else v) for k, v in _DEFAULTS.items()}
    if os.path.exists(path):
        with open(path, encoding="utf-8") as f:
            loaded = yaml.safe_load(f) or {}
        for key, value in loaded.items():
            if isinstance(value, dict) and isinstance(settings.get(key), dict):
                settings[key].update(value)
            else:
                settings[key] = value
    settings["base_dir"] = base_dir
    for k in ("input_dir", "output_dir", "database"):
        p = settings["paths"][k]
        if not os.path.isabs(p):
            settings["paths"][k] = os.path.join(base_dir, p)
    return settings


def role_of(settings, email):
    email = (email or "").strip().lower()
    roles = []
    for role, members in settings.get("roles", {}).items():
        if email in [m.strip().lower() for m in (members or [])]:
            roles.append(role)
    return roles
