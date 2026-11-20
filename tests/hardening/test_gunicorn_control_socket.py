"""gunicorn's control socket stays off: its default folder under the service user's home is not writable (see deploy/gunicorn.conf.py)."""
import importlib.util
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]


def test_the_control_socket_is_disabled_in_the_config_file():
    spec = importlib.util.spec_from_file_location("ehire_gunicorn_conf_cs", ROOT / "deploy" / "gunicorn.conf.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    assert module.control_socket_disable is True


def test_the_setting_name_exists_in_the_installed_gunicorn():
    from gunicorn.config import Config

    assert "control_socket_disable" in Config().settings
