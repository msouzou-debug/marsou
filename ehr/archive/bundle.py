"""More than 19 attachments go to eArchive as ONE attachment: a zip (eArchive opens it and files each member).

The zip is built with the standard library and is deterministic: members in the order of the request's documents,
a fixed timestamp, no compression, fixed attributes. The same documents give the same bytes and the same sha256 on
every rebuild, which a retry needs (eArchive compares the hashes under the same Idempotency-Key). The built zip is
kept in the archive storage area next to the PDF, named with its hash. Nothing is deleted.
"""
import hashlib
import os
import secrets
import zipfile

from ..documents import storage
from . import meta as meta_mod
from .transports import DepositFile

FIXED_TIME = (1980, 1, 1, 0, 0, 0)  # the earliest time a zip can hold
ZIP_MIME = "application/zip"


def needs_zip(manifest):
    return sum(1 for f in manifest.get("files") or [] if f.get("role") == "document") > meta_mod.MAX_ATTACHMENTS


def write_zip(members, path):
    """members: [(name inside the zip, source path)] -> the zip at `path`. Deterministic."""
    with zipfile.ZipFile(path, "w", compression=zipfile.ZIP_STORED, allowZip64=True) as zf:
        for name, source in members:
            info = zipfile.ZipInfo(name, date_time=FIXED_TIME)
            info.compress_type = zipfile.ZIP_STORED
            info.create_system = 3
            info.external_attr = 0o600 << 16
            info.file_size = os.path.getsize(source)
            with open(source, "rb") as src, zf.open(info, "w", force_zip64=info.file_size > (1 << 30)) as dst:
                for block in iter(lambda: src.read(1 << 16), b""):
                    dst.write(block)


def _sha(path):
    digest = hashlib.sha256()
    with open(path, "rb") as fh:
        for block in iter(lambda: fh.read(1 << 16), b""):
            digest.update(block)
    return digest.hexdigest()


def build(pairs, folder, stem):
    """pairs: [(manifest entry, DepositFile)] of the attachments. Writes the zip into `folder` as
    `<stem>-<first 16 of sha256>.zip` (kept if it is already there) and returns (manifest entry, DepositFile).

    Raises BlockedError when the files do not fit eArchive's limits for a zip: at most 200 files inside, 50 MB each,
    200 MB in all, every file an accepted type."""
    entries = [e for e, _ in pairs]
    if len(entries) > meta_mod.MAX_ZIP_FILES:
        raise meta_mod.count_error(len(entries))
    meta_mod.check_entries(entries)
    names = meta_mod.unique_names([meta_mod.clean_filename(e["name"]) for e in entries])
    os.makedirs(folder, exist_ok=True)
    tmp = os.path.join(folder, ".%s.%s.part" % (stem, secrets.token_hex(4)))
    try:
        write_zip([(n, f.path) for n, (_, f) in zip(names, pairs)], tmp)
        sha, size = _sha(tmp), os.path.getsize(tmp)
        final = os.path.join(folder, "%s-%s.zip" % (stem, sha[:16]))
        if os.path.isfile(final) and _sha(final) == sha:
            os.remove(tmp)
        else:
            os.replace(tmp, final)
    finally:
        if os.path.exists(tmp):
            os.remove(tmp)
    zip_name = meta_mod._t("archive.zip_name")
    entry = {"role": "bundle", "stored_as": os.path.basename(final), "name": zip_name, "mime": ZIP_MIME, "size": size,
             "sha256": sha, "members": len(entries)}
    return entry, DepositFile(entry["stored_as"], zip_name, ZIP_MIME, size, sha, final)


def pack(row, manifest, files):
    """The manifest and files of a deposit as they are sent: unchanged up to 19 attachments, otherwise the PDF and
    one zip. `files` follow `manifest["files"]`."""
    if not needs_zip(manifest):
        return manifest, files
    pairs = list(zip(manifest["files"], files))
    docs = [(e, f) for e, f in pairs if e["role"] == "document"]
    meta_mod.check_entries([e for e, _ in docs])  # before anything is written
    folder = os.path.dirname(storage.abs_path("archive/%d/x" % row.request_id))
    entry, dep = build(docs, folder, "%s-attachments" % row.kind)
    packed = dict(manifest)
    packed["files"] = [e for e, _ in pairs if e["role"] != "document"] + [entry]
    return packed, [f for e, f in pairs if e["role"] != "document"] + [dep]
