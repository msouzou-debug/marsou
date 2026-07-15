"""Watched network folder (Stage 1): scanned paper invoices land here from
the copiers. New = extension we handle + hash not yet registered."""

import os
import zipfile

from ..audit import log as audit
from . import dedupe

HANDLED = (".pdf", ".xml", ".p7m", ".zip")


def scan(conn, settings, actor="system"):
    """Register new files from the watch folder. Returns list of file ids."""
    watch = settings["folders"]["watch"]
    os.makedirs(watch, exist_ok=True)
    new_ids, skipped = [], 0
    for name in sorted(os.listdir(watch)):
        path = os.path.join(watch, name)
        if not os.path.isfile(path) or not name.lower().endswith(HANDLED):
            continue
        if name.lower().endswith(".zip"):
            new, sk = _ingest_zip(conn, path, name)
            new_ids.extend(new)
            skipped += sk
            continue
        digest = dedupe.sha256_file(path)
        if dedupe.is_known(conn, digest):
            skipped += 1
            continue
        new_ids.append(dedupe.register_file(conn, digest, name, path, "folder"))
    audit.log(conn, actor, "ingest_folder", f"new={len(new_ids)} skipped={skipped}")
    return new_ids


def _ingest_zip(conn, path, zip_name):
    new_ids, skipped = [], 0
    extract_dir = path + ".extracted"
    with zipfile.ZipFile(path) as zf:
        for info in zf.infolist():
            if info.is_dir() or not info.filename.lower().endswith((".pdf", ".xml", ".p7m")):
                continue
            data = zf.read(info)
            digest = dedupe.sha256_bytes(data)
            if dedupe.is_known(conn, digest):
                skipped += 1
                continue
            os.makedirs(extract_dir, exist_ok=True)
            out = os.path.join(extract_dir, os.path.basename(info.filename))
            with open(out, "wb") as f:
                f.write(data)
            new_ids.append(dedupe.register_file(
                conn, digest, f"{zip_name}:{info.filename}", out, "folder"))
    return new_ids, skipped
