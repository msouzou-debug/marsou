"""EHR_ENV=production refuses unsafe settings with a clear message."""
import pytest
from flask import Flask

from ehr import create_app
from ehr.config import TestConfig
from ehr.security import ConfigError, check_production_config


def make(**cfg):
    app = Flask("t")
    base = {"EHR_ENV": "production", "SECRET_KEY": "x" * 40, "CSRF_ENABLED": True, "TESTING": False,
            "SQLALCHEMY_DATABASE_URI": "postgresql://u:p@db.example.invalid/ehr"}
    app.config.update(base)
    app.config.update(cfg)
    return app


def test_a_sound_production_config_passes():
    check_production_config(make())


def test_development_is_not_checked():
    check_production_config(make(EHR_ENV="development", SECRET_KEY="dev-only-change-me", CSRF_ENABLED=False,
                                 SQLALCHEMY_DATABASE_URI="sqlite:///x.db"))


@pytest.mark.parametrize("cfg,words", [
    ({"SECRET_KEY": "dev-only-change-me"}, "EHR_SECRET_KEY"),
    ({"SECRET_KEY": ""}, "EHR_SECRET_KEY"),
    ({"SECRET_KEY": "short"}, "EHR_SECRET_KEY"),
    ({"CSRF_ENABLED": False}, "CSRF"),
    ({"TESTING": True}, "TESTING"),
    ({"DEBUG": True}, "Debug"),
    ({"SQLALCHEMY_DATABASE_URI": "sqlite:///ehr.sqlite3"}, "SQLite"),
    ({"SQLALCHEMY_DATABASE_URI": "SQLite://"}, "SQLite"),
])
def test_unsafe_settings_are_refused_with_a_message(cfg, words):
    with pytest.raises(ConfigError) as err:
        check_production_config(make(**cfg))
    assert words in str(err.value) and "production" in str(err.value)


def test_all_problems_are_listed_together():
    with pytest.raises(ConfigError) as err:
        check_production_config(make(SECRET_KEY="dev-only-change-me", CSRF_ENABLED=False, SQLALCHEMY_DATABASE_URI="sqlite://"))
    assert str(err.value).count("\n- ") == 3


def test_create_app_refuses_to_start_in_production_with_defaults():
    class Prod(TestConfig):
        EHR_ENV = "production"
        TESTING = False
        CSRF_ENABLED = True

    with pytest.raises(RuntimeError, match="will not start in production"):
        create_app(Prod)  # default secret and SQLite


def test_error_is_a_runtime_error_so_gunicorn_config_can_exit_with_it():
    assert issubclass(ConfigError, RuntimeError)
