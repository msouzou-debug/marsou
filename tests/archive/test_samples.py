"""`flask archive-samples`: six sample deposits from the invented demo cases, for eArchive's own test."""
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


FOLDERS = ["1-submitted", "2-approved-with-attachments-submitted", "3-approved-with-attachments-decided",
           "4-rejected-submitted", "5-rejected-decided", "6-many-attachments-zip"]


def load(out, name):
    return json.loads((out / name / "meta.json").read_text(encoding="utf-8"))


def test_six_folders_with_complete_chains_meta_files_and_a_curl_example(seeded, conv, tmp_path, app):
    app.config["EHR_ARCHIVE_TOKEN"] = TOKEN
    seed(app)
    out = tmp_path / "samples"
    result = app.test_cli_runner().invoke(args=["archive-samples", str(out)])
    assert result.exit_code == 0, result.output
    assert sorted(p.name for p in out.iterdir()) == FOLDERS
    fake = FakeEArchive()
    for folder in out.iterdir():
        meta = json.loads((folder / "meta.json").read_text(encoding="utf-8"))
        fake._schema(meta)  # the strict check of the note's schema
        names = {p.name for p in folder.iterdir()}
        assert {"meta.json", "curl-example.txt"} <= names
        assert names == {"meta.json", "curl-example.txt"} | {f["filename"] for f in meta["files"]}
        for f in meta["files"]:
            assert set(f) == {"kind", "part_name", "filename", "mime", "size", "sha256"}
            data = (folder / f["filename"]).read_bytes()
            assert len(data) == f["size"] and hashlib.sha256(data).hexdigest() == f["sha256"]
        curl = (folder / "curl-example.txt").read_text(encoding="utf-8")
        assert "type=application/pdf" in curl or "type=application/zip" in curl
        assert "<EHR_INGEST_TOKEN>" in curl and "api/v1/ingest/documents" in curl and "meta=<meta.json" in curl
        assert "Idempotency-Key: ehr:%d" % meta["outbox_id"] in curl
        for part in meta["files"]:
            assert "-F '%s=@%s" % (part["part_name"], part["filename"]) in curl
        blob = b"".join(p.read_bytes() for p in folder.iterdir())
        assert TOKEN.encode() not in blob
    metas = {name: load(out, name) for name in FOLDERS}
    assert len({m["outbox_id"] for m in metas.values()}) == 6 and len({m["source_ref"] for m in metas.values()}) == 6
    # complete chains: each decided sample names the submitted sample before it, and that one is in the set
    for decided, submitted in (("3-approved-with-attachments-decided", "2-approved-with-attachments-submitted"),
                               ("5-rejected-decided", "4-rejected-submitted")):
        assert metas[decided]["related"] == [{"source_ref": metas[submitted]["source_ref"], "relation": "SUPERSEDES"}]
        assert "related" not in metas[submitted] and metas[submitted]["source_ref"].endswith(":submitted")
        assert metas[decided]["sender_ref"] == metas[submitted]["sender_ref"]
    assert [f["filename"] for f in metas["2-approved-with-attachments-submitted"]["files"][1:]] == \
        [f["filename"] for f in metas["3-approved-with-attachments-decided"]["files"][1:]] == ["job-description.pdf", "rota-2026.pdf"]
    assert len(metas["4-rejected-submitted"]["files"]) == 1 and len(metas["5-rejected-decided"]["files"]) == 1
    assert len({metas[n]["sender_ref"] for n in ("1-submitted", "2-approved-with-attachments-submitted",
                                                 "4-rejected-submitted", "6-many-attachments-zip")}) == 4
    approved = metas["3-approved-with-attachments-decided"]
    assert [f["kind"] for f in approved["files"]] == ["MAIN", "ATTACHMENT", "ATTACHMENT"]
    assert [f["mime"] for f in approved["files"]] == ["application/pdf"] * 3
    assert approved["files"][0]["filename"].endswith(" — απόφαση.pdf")
    many = metas["6-many-attachments-zip"]
    assert [(f["kind"], f["filename"], f["mime"]) for f in many["files"][1:]] == [
        ("ATTACHMENT", "Συνημμένα.zip", "application/zip")]
    import zipfile
    with zipfile.ZipFile(out / "6-many-attachments-zip" / "Συνημμένα.zip") as zf:
        assert len(zf.namelist()) == 25 and zf.namelist()[0] == "attachment-01.pdf"
    assert approved["doc_type"].endswith("εγκρίθηκε") and metas["5-rejected-decided"]["doc_type"].endswith("απορρίφθηκε")
    for name in ("1-submitted", "2-approved-with-attachments-submitted", "4-rejected-submitted", "6-many-attachments-zip"):
        assert metas[name]["doc_type"].endswith("υποβλήθηκε")
    assert result.output.count("source_ref") == 6


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
