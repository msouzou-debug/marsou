"""Transports and the flush: nothing sent by default, folder deposits are atomic and idempotent, failures are retried."""
import json
import os

import pytest

from ehr.archive import queue
from ehr.archive.transports import (ArchiveError, FolderTransport, HttpTransport, NullTransport, get_transport,
                                    manifest_hash)
from ehr.extensions import db
from ehr.models import ArchiveDeposit, AuditLog, Setting
from tests.archive.ahelpers import deposits, rich_request
from tests.archive.conftest import RecordingTransport
from tests.requests.flowhelpers import create


def set_transport(name):
    db.session.add(Setting(key="archive_transport", value=name))
    db.session.commit()


def test_the_default_transport_is_null_and_rows_stay_queued(seeded, client, stor, conv):
    rich_request(client)
    assert isinstance(get_transport(), NullTransport)
    counts = queue.flush()
    assert counts["stored"] == 0 and counts["rendered"] == 2
    assert {d.state for d in deposits()} == {"queued"} and {d.archive_ref for d in deposits()} == {None}


def test_the_setting_chooses_the_transport_and_a_typo_sends_nothing(seeded):
    set_transport("folder")
    assert isinstance(get_transport(), FolderTransport)
    db.session.get(Setting, "archive_transport").value = "flodler"
    assert isinstance(get_transport(), NullTransport)
    db.session.get(Setting, "archive_transport").value = "http"
    assert isinstance(get_transport(), HttpTransport) and get_transport().delivers is False


def test_the_http_transport_sends_nothing_without_a_token(seeded, app):
    app.config["EHR_ARCHIVE_TOKEN"] = ""
    assert HttpTransport().delivers is False
    app.config["EHR_ARCHIVE_TOKEN"] = "sample-token"
    assert HttpTransport().delivers is True
    app.config["EHR_ARCHIVE_URL"] = "http://archive.example.invalid:5011"
    assert HttpTransport().delivers is False  # not a loopback address


def test_the_folder_transport_writes_the_deposit_and_returns_the_folder_name(seeded, client, stor, conv, drop):
    set_transport("folder")
    rid = rich_request(client)
    counts = queue.flush()
    assert counts["stored"] == 2 and counts["failed"] == 0
    names = sorted(p.name for p in drop.iterdir())
    assert names == ["AEU-2026-0001-decided", "AEU-2026-0001-submitted"]  # no temp folders left
    folder = drop / "AEU-2026-0001-decided"
    assert sorted(p.name for p in folder.iterdir()) == [
        "01-job-description.pdf", "02-rota-2026.pdf", "AEU-2026-0001-decided.pdf", "manifest.json"]
    manifest = json.loads((folder / "manifest.json").read_text(encoding="utf-8"))
    assert manifest["files"][0]["stored_as"] == "AEU-2026-0001-decided.pdf"
    for f in manifest["files"]:
        import hashlib
        assert hashlib.sha256((folder / f["stored_as"]).read_bytes()).hexdigest() == f["sha256"]
    row = [d for d in deposits() if d.kind == "decided"][0]
    assert (row.state, row.archive_ref, row.attempts, row.last_error) == ("stored", "AEU-2026-0001-decided", 1, None)
    assert row.sent_at is not None
    assert AuditLog.query.filter_by(event="archive_stored", request_id=rid).count() == 2


def test_the_folder_transport_is_idempotent_and_refuses_a_conflict(tmp_path, app):
    from ehr.archive.transports import DepositFile
    src = tmp_path / "a.pdf"
    src.write_bytes(b"%PDF-1.4 one")
    drop = tmp_path / "drop"
    drop.mkdir()
    manifest = {"folder": "X-1-decided", "key": "X-1:decided", "files": [{"stored_as": "a.pdf"}]}
    files = [DepositFile("a.pdf", "a.pdf", "application/pdf", 12, "0" * 64, str(src))]
    t = FolderTransport(str(drop))
    assert t.deposit(manifest, files) == "X-1-decided"
    stamp = os.stat(drop / "X-1-decided" / "manifest.json").st_mtime_ns
    assert t.deposit(manifest, files) == "X-1-decided"  # the same deposit again: success, nothing rewritten
    assert os.stat(drop / "X-1-decided" / "manifest.json").st_mtime_ns == stamp
    other = dict(manifest, files=[{"stored_as": "b.pdf"}])
    assert manifest_hash(other) != manifest_hash(manifest)
    with pytest.raises(ArchiveError, match="not overwritten"):
        t.deposit(other, files)
    assert sorted(p.name for p in drop.iterdir()) == ["X-1-decided"]


def test_a_crash_while_writing_leaves_no_half_deposit(tmp_path, app):
    from ehr.archive.transports import DepositFile
    drop = tmp_path / "drop"
    drop.mkdir()
    files = [DepositFile("a.pdf", "a.pdf", "application/pdf", 1, "0" * 64, str(tmp_path / "missing.pdf"))]
    with pytest.raises(OSError):
        FolderTransport(str(drop)).deposit({"folder": "Y-1-submitted", "files": []}, files)
    assert list(drop.iterdir()) == []


def test_the_folder_transport_needs_an_existing_drop_folder(tmp_path, app):
    with pytest.raises(ArchiveError, match="not set"):
        FolderTransport("").deposit({"folder": "Z-1-decided"}, [])
    with pytest.raises(ArchiveError, match="does not exist"):
        FolderTransport(str(tmp_path / "nope")).deposit({"folder": "Z-1-decided"}, [])


def test_a_failing_transport_marks_failed_and_a_later_run_succeeds(seeded, client, stor, conv, app):
    t = RecordingTransport(fail=1)
    app.config["ARCHIVE_TRANSPORT_OVERRIDE"] = t
    rid = create(client).id
    counts = queue.flush()
    assert counts == {"rendered": 1, "stored": 0, "failed": 1, "waiting": 0}
    row = deposits(rid)[0]
    assert row.state == "failed" and row.attempts == 1 and "eArchive is down" in row.last_error
    assert AuditLog.query.filter_by(event="archive_failed", request_id=rid).count() == 1
    counts = queue.flush()  # the cron run is the backoff
    assert counts["stored"] == 1 and counts["rendered"] == 0
    row = deposits(rid)[0]
    assert (row.state, row.attempts, row.last_error, row.archive_ref) == ("stored", 2, None, "ref-AEU-2026-0001-submitted")
    assert queue.flush() == {"rendered": 0, "stored": 0, "failed": 0, "waiting": 0}
    assert len(t.calls) == 2  # the PDF was made once and re-sent byte for byte
    assert t.calls[0][0] == t.calls[1][0]


def test_ten_failed_attempts_stop_the_retries_until_an_admin_retries(seeded, client, stor, conv, app):
    t = RecordingTransport(fail=99)
    app.config["ARCHIVE_TRANSPORT_OVERRIDE"] = t
    rid = create(client).id
    for _ in range(12):
        queue.flush()
    row = deposits(rid)[0]
    assert row.state == "failed" and row.attempts == 10 and len(t.calls) == 10


def test_a_changed_file_is_refused_before_it_is_sent(seeded, client, stor, conv, transport):
    from ehr.documents import storage
    rid = create(client).id
    queue.flush()
    transport.calls.clear()
    row = deposits(rid)[0]
    row.state = "queued"
    db.session.commit()
    with open(storage.abs_path(row.pdf_storage_ref), "ab") as fh:
        fh.write(b"tampered")
    queue.flush()
    row = deposits(rid)[0]
    assert row.state == "failed" and "sha256" in row.last_error and transport.calls == []


# ------------------------------------------------------------------ the user's action is never touched

def test_the_after_request_flush_never_breaks_the_action(seeded, client, stor, app, monkeypatch):
    from ehr.archive import pdf
    from tests.requests.flowhelpers import reload
    app.config["ARCHIVE_AUTO_FLUSH"] = True
    app.config["ARCHIVE_RENDER_AFTER_REQUEST"] = True
    app.config["ARCHIVE_TRANSPORT_OVERRIDE"] = RecordingTransport(fail=99)

    def broken(*a, **k):
        raise RuntimeError("the renderer exploded")
    monkeypatch.setattr(pdf, "render_html", broken)
    rid = create(client).id  # the submit answered 302 inside create()
    assert reload(rid).status == "in_progress"
    row = deposits(rid)[0]
    assert row.state == "queued" and "exploded" in row.last_error


def test_a_failing_transport_after_the_request_does_not_change_the_answer(seeded, client, stor, conv, app):
    app.config["ARCHIVE_AUTO_FLUSH"] = True
    app.config["ARCHIVE_RENDER_AFTER_REQUEST"] = True
    t = RecordingTransport(fail=99)
    app.config["ARCHIVE_TRANSPORT_OVERRIDE"] = t
    rid = create(client).id
    row = deposits(rid)[0]
    assert row.state == "failed" and len(t.calls) == 1


def test_by_default_the_request_does_not_render(seeded, client, stor, conv, app):
    app.config["ARCHIVE_AUTO_FLUSH"] = True
    app.config["ARCHIVE_TRANSPORT_OVERRIDE"] = RecordingTransport()
    rid = create(client).id
    assert conv.calls == 0 and deposits(rid)[0].pdf_storage_ref is None
    assert queue.flush()["stored"] == 1  # the cron command does the work


def test_flush_swallows_errors_from_the_queue_itself(seeded, monkeypatch):
    monkeypatch.setattr(queue, "pending_query", lambda *a, **k: (_ for _ in ()).throw(RuntimeError("db gone")))
    assert queue.flush() == {"rendered": 0, "stored": 0, "failed": 0, "waiting": 0}
    assert queue.flush_quietly() == {"rendered": 0, "stored": 0, "failed": 0, "waiting": 0}


def test_the_cli_prints_counts_and_sets_the_transport(seeded, client, stor, conv, app, transport):
    create(client)
    runner = app.test_cli_runner()
    out = runner.invoke(args=["send-archive"]).output
    assert out.strip() == "rendered=1 stored=1 failed=0 waiting=0"
    assert runner.invoke(args=["archive-transport"]).output.strip() == "archive_transport=none"
    assert runner.invoke(args=["archive-transport", "folder"]).output.strip() == "archive_transport=folder"
    assert AuditLog.query.filter_by(event="setting_changed", object_id="archive_transport").count() == 1
    assert runner.invoke(args=["archive-transport", "ftp"]).exit_code != 0
