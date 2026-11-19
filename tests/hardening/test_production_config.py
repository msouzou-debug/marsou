"""EHIRE_ENV=production refuses unsafe settings with a clear message."""
import pytest
from flask import Flask

from ehire import create_app
from ehire.config import TestConfig
from ehire.security import ConfigError, check_production_config


def make(**cfg):
    app = Flask("t")
    base = {"EHIRE_ENV": "production", "SECRET_KEY": "x" * 40, "CSRF_ENABLED": True, "TESTING": False,
            "SQLALCHEMY_DATABASE_URI": "postgresql://u:p@db.example.invalid/ehire"}
    app.config.update(base)
    app.config.update(cfg)
    return app


def test_a_sound_production_config_passes():
    check_production_config(make())


def test_development_is_not_checked():
    check_production_config(make(EHIRE_ENV="development", SECRET_KEY="dev-only-change-me", CSRF_ENABLED=False,
                                 SQLALCHEMY_DATABASE_URI="sqlite:///x.db"))


@pytest.mark.parametrize("cfg,words", [
    ({"SECRET_KEY": "dev-only-change-me"}, "EHIRE_SECRET_KEY"),
    ({"SECRET_KEY": ""}, "EHIRE_SECRET_KEY"),
    ({"SECRET_KEY": "short"}, "EHIRE_SECRET_KEY"),
    ({"CSRF_ENABLED": False}, "CSRF"),
    ({"TESTING": True}, "TESTING"),
    ({"DEBUG": True}, "Debug"),
])
def test_unsafe_settings_are_refused_with_a_message(cfg, words):
    with pytest.raises(ConfigError) as err:
        check_production_config(make(**cfg))
    assert words in str(err.value) and "production" in str(err.value)


def test_all_problems_are_listed_together():
    with pytest.raises(ConfigError) as err:
        check_production_config(make(SECRET_KEY="dev-only-change-me", CSRF_ENABLED=False, SQLALCHEMY_DATABASE_URI="sqlite://"))
    assert str(err.value).count("\n- ") == 3  # secret, CSRF, in-memory SQLite


def test_create_app_refuses_to_start_in_production_with_defaults():
    class Prod(TestConfig):
        EHIRE_ENV = "production"
        TESTING = False
        CSRF_ENABLED = True

    with pytest.raises(RuntimeError, match="will not start in production"):
        create_app(Prod)  # default secret and SQLite


def test_error_is_a_runtime_error_so_gunicorn_config_can_exit_with_it():
    assert issubclass(ConfigError, RuntimeError)


# ---------------------------------------------------------------------------------------- Active Directory

def ad_cfg(tmp_path, **over):
    ca = tmp_path / "ca.pem"
    ca.write_text("-----BEGIN CERTIFICATE-----\n-----END CERTIFICATE-----\n")
    cfg = {"EHIRE_AD_ENABLED": True, "EHIRE_AD_SERVER": "dc1.example.invalid", "EHIRE_AD_DOMAIN": "example.invalid",
           "EHIRE_AD_USE_SSL": True, "EHIRE_AD_CA_FILE": str(ca), "EHIRE_AD_UID_ATTRIBUTE": "sAMAccountName"}
    cfg.update(over)
    return cfg


def test_ad_off_needs_nothing(tmp_path):
    check_production_config(make(EHIRE_AD_ENABLED=False, EHIRE_AD_USE_SSL=False))


def test_a_sound_ad_config_passes(tmp_path):
    check_production_config(make(**ad_cfg(tmp_path)))


@pytest.mark.parametrize("over,words", [
    ({"EHIRE_AD_USE_SSL": False}, "EHIRE_AD_USE_SSL"),
    ({"EHIRE_AD_CA_FILE": ""}, "EHIRE_AD_CA_FILE"),
    ({"EHIRE_AD_CA_FILE": "/no/such/ca.pem"}, "EHIRE_AD_CA_FILE"),
    ({"EHIRE_AD_SERVER": ""}, "EHIRE_AD_SERVER"),
    ({"EHIRE_AD_DOMAIN": ""}, "EHIRE_AD_DOMAIN"),
    ({"EHIRE_AD_UID_ATTRIBUTE": "a)(b"}, "EHIRE_AD_UID_ATTRIBUTE"),
])
def test_unsafe_ad_settings_are_refused_in_production(tmp_path, over, words):
    with pytest.raises(ConfigError, match=words):
        check_production_config(make(**ad_cfg(tmp_path, **over)))
