"""More than 19 attachments go to eArchive as zips (eArchive opens each and files every member).

eArchive's limits (answers of 16/11/2026): every part, a zip included, at most 50 MB; inside a zip each file at most
50 MB, all together at most 200 MB, at most 200 files; the whole request at most 200 MB; at most 19 attachment parts.
So the attachments are split, in the order of the request's documents, over as many zips as it takes for each zip FILE
to stay within the part limit (the size is that of the built zip, not the sum of its inputs).

Each zip is built with the standard library and is deterministic: members in the order of the request's documents,
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
from .transports import BlockedError, DepositFile

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


# Bytes a stored (not compressed) member adds to a zip: local header 30 + name, the data, central entry 46 + name; the
# end record is 22. Names are UTF-8 and nothing has an extra field. `build_zips` measures every built zip against the
# part limit, so a change in the zipfile module cannot slip a zip over it unseen.
MEMBER_OVERHEAD, END_RECORD = 76, 22


def _name_len(name):
    return len(name.encode("utf-8"))


def plan(names, sizes):
    """Split members, in order, over zips. Returns [[index, ...], ...]. Raises BlockedError when one member cannot be in
    a zip on its own within the part limit."""
    groups, cur, cur_bytes, cur_data = [], [], END_RECORD, 0
    for i, (name, size) in enumerate(zip(names, sizes)):
        add = MEMBER_OVERHEAD + 2 * _name_len(name) + size
        alone = END_RECORD + add
        if alone > meta_mod.MAX_PART_BYTES or size > meta_mod.MAX_FILE_BYTES:
            raise meta_mod.file_too_big(name, meta_mod.MAX_PART_BYTES)
        if cur and (cur_bytes + add > meta_mod.MAX_PART_BYTES or len(cur) >= meta_mod.MAX_ZIP_FILES
                    or cur_data + size > meta_mod.MAX_DEPOSIT_BYTES):
            groups.append(cur)
            cur, cur_bytes, cur_data = [], END_RECORD, 0
        cur.append(i)
        cur_bytes += add
        cur_data += size
    if cur:
        groups.append(cur)
    return groups


def _write_one(members, stem, folder):
    """Write one zip into `folder` as `<stem>-<first 16 of sha256>.zip` (kept if it is already there). Returns
    (path, size, sha256)."""
    tmp = os.path.join(folder, ".%s.%s.part" % (stem, secrets.token_hex(4)))
    try:
        write_zip(members, tmp)
        sha, size = _sha(tmp), os.path.getsize(tmp)
        final = os.path.join(folder, "%s-%s.zip" % (stem, sha[:16]))
        if os.path.isfile(final) and _sha(final) == sha:
            os.remove(tmp)
        else:
            os.replace(tmp, final)
    finally:
        if os.path.exists(tmp):
            os.remove(tmp)
    return final, size, sha


def build_zips(pairs, folder, stem):
    """pairs: [(manifest entry, DepositFile)] of the attachments. Returns [(manifest entry, DepositFile)], one per zip,
    named from archive.zip_name, with " (2)", " (3)" before the extension, in the meta part.

    Raises BlockedError when the files do not fit eArchive's limits: more than 200 files, a file over its limit, a type
    eArchive refuses, more than the whole request may hold, or more zips than attachment parts."""
    entries = [e for e, _ in pairs]
    if len(entries) > meta_mod.MAX_ZIP_FILES:
        raise meta_mod.count_error(len(entries))
    meta_mod.check_entries(entries, limit=meta_mod.MAX_FILE_BYTES)
    names = meta_mod.unique_names([meta_mod.clean_filename(e["name"]) for e in entries])
    groups = plan(names, [int(e.get("size") or 0) for e in entries])
    if len(groups) > meta_mod.MAX_ATTACHMENTS:
        raise meta_mod.deposit_too_big()
    os.makedirs(folder, exist_ok=True)
    zip_name = meta_mod._t("archive.zip_name")
    out = []
    for group in groups:
        final, size, sha = _write_one([(names[i], pairs[i][1].path) for i in group], stem, folder)
        if size > meta_mod.MAX_PART_BYTES:
            raise meta_mod.file_too_big(zip_name, meta_mod.MAX_PART_BYTES)
        entry = {"role": "bundle", "stored_as": os.path.basename(final), "name": zip_name, "mime": ZIP_MIME,
                 "size": size, "sha256": sha, "members": len(group)}
        out.append((entry, DepositFile(entry["stored_as"], zip_name, ZIP_MIME, size, sha, final)))
    return out


def pack(row, manifest, files):
    """The manifest and files of a deposit as they are sent: unchanged up to 19 attachments, otherwise the PDF and
    the zips. `files` follow `manifest["files"]`."""
    if not needs_zip(manifest):
        return manifest, files
    pairs = list(zip(manifest["files"], files))
    docs = [(e, f) for e, f in pairs if e["role"] == "document"]
    meta_mod.check_entries([e for e, _ in docs], limit=meta_mod.MAX_FILE_BYTES)  # before anything is written
    folder = os.path.dirname(storage.abs_path("archive/%d/x" % row.request_id))
    zips = build_zips(docs, folder, "%s-attachments" % row.kind)
    packed = dict(manifest)
    packed["files"] = [e for e, _ in pairs if e["role"] != "document"] + [e for e, _ in zips]
    return packed, [f for e, f in pairs if e["role"] != "document"] + [f for _, f in zips]
