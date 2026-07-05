"""Smoke test: the Streamlit script runs top-to-bottom without exceptions.

AppTest can't inject file uploads, so this covers the empty-state path (title,
uploader, info message, clean stop); the full pipeline is covered by the
recon/ tests.
"""
from pathlib import Path

from streamlit.testing.v1 import AppTest


def test_app_renders_empty_state():
    at = AppTest.from_file(str(Path(__file__).resolve().parent.parent / "app.py"),
                           default_timeout=30)
    at.run()
    assert not at.exception
    assert at.title[0].value == "OKYπY — Συμφωνία Πληρωμών ΟΑΥ"
    assert at.info, "expected the drop-files hint when nothing is uploaded"
    assert at.checkbox[0].label.startswith("Λειτουργία διασταύρωσης")
