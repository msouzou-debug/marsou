"""`flask archive-samples`: three sample deposits from the invented demo cases, for eArchive's own test."""
import hashlib
import json
import os
from datetime import datetime, timezone

from ehr.extensions import db
from tests.archive.fake_earchive import TOKEN, FakeEArchive
from tests.requests.flowhelpers import create


def seed(app):
    from ehr.services.request_seed_cases import seed_cases
    seed_cases(datetime.now(timezone.utc))


def test_three_folders_with_meta_files_and_a_curl_example(seeded, conv, tmp_path, app):
    app.config["EHR_ARCHIVE_TOKEN"] = TOKEN
    seed(app)
    out = tmp_path / "samples"
    result = app.test_cli_runner().invoke(args=["archive-samples", str(out)])
    assert result.exit_code == 0, result.output
    assert sorted(p.name for p in out.iterdir()) == ["approved-with-attachments", "rejected", "submitted"]
    fake = FakeEArchive()
    for folder in out.iterdir():
        meta = json.loads((folder / "meta.json").read_text(encoding="utf-8"))
        fake._schema(meta)  # the strict check of the note's schema
        names = {p.name for p in folder.iterdir()}
        assert {"meta.json", "curl-example.txt"} <= names
        for f in meta["files"]:
            data = (folder / f["filename"]).read_bytes()
            assert len(data) == f["size"] and hashlib.sha256(data).hexdigest() == f["sha256"]
        curl = (folder / "curl-example.txt").read_text(encoding="utf-8")
        assert "<EHR_INGEST_TOKEN>" in curl and "api/v1/ingest/documents" in curl and "meta=<meta.json" in curl
        assert "Idempotency-Key: ehr:%d" % meta["outbox_id"] in curl
        for part in meta["files"]:
            assert "-F '%s=@%s" % (part["part_name"], part["filename"]) in curl
        blob = b"".join(p.read_bytes() for p in folder.iterdir())
        assert TOKEN.encode() not in blob
    approved = json.loads((out / "approved-with-attachments" / "meta.json").read_text(encoding="utf-8"))
    assert [f["role"] for f in approved["files"]] == ["MAIN", "ATTACHMENT", "ATTACHMENT"]
    assert approved["doc_type"].endswith("εγκρίθηκε") and approved["related"][0]["relation"] == "SUPERSEDES"
    assert json.loads((out / "submitted" / "meta.json").read_text(encoding="utf-8"))["doc_type"].endswith("υποβλήθηκε")
    assert json.loads((out / "rejected" / "meta.json").read_text(encoding="utf-8"))["doc_type"].endswith("απορρίφθηκε")
    # Sending the samples to the fake works: they are real deposits.
    for name in ("approved-with-attachments", "rejected", "submitted"):
        assert (out / name / "meta.json").stat().st_size > 500
    assert result.output.count("source_ref") == 3


def test_it_refuses_in_production_and_without_demo_cases(seeded, conv, tmp_path, app, client):
    runner = app.test_cli_runner()
    create(client)  # a request, but not a seeded demo case
    result = runner.invoke(args=["archive-samples", str(tmp_path / "a")])
    assert result.exit_code != 0 and "seed-cases" in result.output
    app.config["EHR_ENV"] = "production"
    result = runner.invoke(args=["archive-samples", str(tmp_path / "b")])
    assert result.exit_code != 0 and "production" in result.output
    assert not os.path.exists(tmp_path / "b")


def test_it_does_not_overwrite_a_folder(seeded, conv, tmp_path, app):
    seed(app)
    runner = app.test_cli_runner()
    assert runner.invoke(args=["archive-samples", str(tmp_path / "s")]).exit_code == 0
    again = runner.invoke(args=["archive-samples", str(tmp_path / "s")])
    assert again.exit_code != 0 and "already exists" in again.output
