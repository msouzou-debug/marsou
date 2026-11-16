"""The request PDF: contents, language, hashes, and the manifest. Real LibreOffice when it is installed."""
import hashlib
import json
import os
import shutil
import subprocess

import pytest

from ehr.archive import pdf, queue
from ehr.documents import storage
from ehr.extensions import db
from ehr.models import ArchiveDeposit, RequestDocument
from tests.archive.ahelpers import deposits, rich_request
from tests.archive.conftest import needs_soffice

HAVE_PDFTOTEXT = shutil.which("pdftotext") is not None


def pdf_text(path):
    return subprocess.run(["pdftotext", "-layout", str(path), "-"], capture_output=True, check=True).stdout.decode()


def one(kind="decided"):
    db.session.expire_all()
    return ArchiveDeposit.query.filter_by(kind=kind).one()


def test_the_html_page_holds_every_part(seeded, client, stor, conv):
    rid = rich_request(client)
    counts = queue.flush()
    assert counts["rendered"] == 2
    row = one()
    path = storage.abs_path(row.pdf_storage_ref)
    html = open(path, "rb").read().decode("utf-8")
    assert "<!DOCTYPE html>" in html and "http://" not in html and "https://" not in html
    assert "data:image/png;base64," in html  # the logo is embedded
    for needle in ("ΑΕΘ-2026-0001", "Αίτημα για Έγκριση Θέσεων", "Maria Test Leaver", "40.000,50 €",
                   "Checked again after the rota was added.", "Αντικαταστάθηκε από μεταγενέστερη απάντηση",
                   "job-description.pdf", "rota-2026.pdf", "1.254.300,50 €", "01/03/2027", "Κύκλος 2",
                   "Συμπληρώθηκαν χειροκίνητα", "Δημιουργήθηκε από το eHR"):
        assert needle in html, needle
    order = [html.index(x) for x in ("Στοιχεία αιτήματος", "Άτομα που αποχώρησαν", "Οικονομικά στοιχεία",
                                    "Έλεγχοι και γνωμοδοτήσεις", "Ιστορικό", "Συνημμένα έγγραφα")]
    assert order == sorted(order)
    assert "Η γνωμοδότησή σας" not in html  # the card wording is not used in a record


@needs_soffice
@pytest.mark.skipif(not HAVE_PDFTOTEXT, reason="pdftotext is not installed")
def test_the_real_pdf_has_greek_text_and_the_required_content(seeded, client, stor):
    rich_request(client)
    app = client.application
    app.extensions.pop("ehr_converter", None)  # the real converter
    queue.flush()
    row = one()
    assert row.state == "queued" and row.last_error is None
    path = storage.abs_path(row.pdf_storage_ref)
    assert open(path, "rb").read(5) == b"%PDF-"
    text = pdf_text(path)
    for needle in ("Αίτημα για Έγκριση Θέσεων", "ΑΕΘ-2026-0001", "Κατάσταση στις", "Εγκρίθηκε", "Maria Test Leaver",
                   "40.000,50 €", "Checked again after the rota was added.", "Αντικαταστάθηκε από μεταγενέστερη",
                   "job-description.pdf", "rota-2026.pdf", "SHA-256", "Δημιουργήθηκε από το eHR",
                   "1.254.300,50 €", "Έσοδα ανά €1 μισθοδοσίας"):
        assert needle in text.replace("\n", " ") or needle in text, needle
    assert row.pdf_sha256 == hashlib.sha256(open(path, "rb").read()).hexdigest()
    assert "archive/" in row.pdf_storage_ref


def test_the_submitted_pdf_is_the_state_at_first_submission(seeded, client, stor, conv):
    rid = rich_request(client)
    queue.flush()
    path = storage.abs_path(one("submitted").pdf_storage_ref)
    html = open(path, "rb").read().decode("utf-8")
    assert "Κατάσταση στις" in html and "Σε εξέλιξη" in html  # in progress at that moment
    assert "Approved by the Directorate." not in html and "Checked again" not in html
    assert "Maria Test Leaver" in html and "job-description.pdf" in html
    assert "Κύκλος 2" not in html.split("Ιστορικό")[0]  # round 1 header


def test_the_manifest_matches_the_stored_files(seeded, client, stor, conv):
    rid = rich_request(client)
    queue.flush()
    row = one()
    m = json.loads(row.manifest_json)
    assert m["request_number"] == "ΑΕΘ-2026-0001" and m["kind"] == "decided" and m["round"] == 2
    assert m["key"] == "ΑΕΘ-2026-0001:decided" and m["folder"] == "AEU-2026-0001-decided"
    assert m["status"] == "approved" and m["submitted_at"].endswith("Z") and m["decided_at"].endswith("Z")
    assert m["directorate"]["name"] == "Λευκωσίας" and m["facility"]["code"] and m["cost_centre_code"] == "1001"
    assert m["staff_category"] == "medical" and m["positions_count"] == 2 and m["requester_name"]
    assert m["position_title"] and "as_of" not in m
    files = m["files"]
    assert [f["role"] for f in files] == ["request_pdf", "document", "document"]
    assert files[0]["sha256"] == row.pdf_sha256
    for f in files:
        path = storage.abs_path(row.pdf_storage_ref) if f["role"] == "request_pdf" else storage.abs_path(
            db.session.get(RequestDocument, f["document_id"]).storage_ref)
        assert hashlib.sha256(open(path, "rb").read()).hexdigest() == f["sha256"]
        assert os.path.getsize(path) == f["size"] and f["mime"]
    assert [f["name"] for f in files[1:]] == ["job-description.pdf", "rota-2026.pdf"]


def test_a_failing_conversion_keeps_the_deposit_queued_with_the_error(seeded, client, stor, app):
    from tests.archive.conftest import HtmlConverter
    rich_request(client)
    app.extensions["ehr_converter"] = HtmlConverter(ok=False)
    counts = queue.flush()
    assert counts["rendered"] == 0 and counts["waiting"] == 2
    rows = deposits()
    assert {r.state for r in rows} == {"queued"} and all(r.attempts == 1 and r.last_error for r in rows)
    app.extensions["ehr_converter"] = HtmlConverter()
    counts = queue.flush()
    assert counts["rendered"] == 2
    assert {r.last_error for r in deposits()} == {None}


def test_no_converter_leaves_the_deposit_queued_and_counts_no_attempt(seeded, client, stor, app):
    from ehr.documents.convert import NullConverter
    rich_request(client)
    app.extensions["ehr_converter"] = NullConverter()
    queue.flush()
    rows = deposits()
    assert {r.state for r in rows} == {"queued"} and all(r.attempts == 0 and "converter" in r.last_error for r in rows)


def test_repeated_failures_end_in_failed_after_ten_attempts(seeded, client, stor, app):
    from tests.archive.conftest import HtmlConverter
    rich_request(client)
    app.extensions["ehr_converter"] = HtmlConverter(ok=False)
    for _ in range(10):
        queue.flush()
    assert {r.state for r in deposits()} == {"failed"}
    assert queue.flush() == {"rendered": 0, "stored": 0, "failed": 0, "waiting": 0}  # not tried again
