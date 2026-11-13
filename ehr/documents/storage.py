"""Files on disk and their rows. Layout: <storage>/<request_id>/<document_id>-<random>.bin, converted PDF next to it
as <document_id>-<random>.pdf. The client's file name is kept as text in the database, never used as a path."""
import hashlib
import os
import re
import secrets
import shutil
import tempfile
from datetime import datetime, timezone

from flask import current_app

from ..extensions import db
from ..models import RequestDocument, User, get_setting
from . import sniff
from .convert import get_converter

CHUNK = 1 << 16
NAME_MAX = 200


class UploadError(Exception):
    """A refused file. `key` is a string key, `params` fill it."""

    def __init__(self, key, **params):
        super().__init__(key)
        self.key = key
        self.params = params


def storage_root():
    configured = current_app.config.get("EHR_STORAGE_DIR")
    root = configured or os.path.join(current_app.instance_path, "storage")
    return os.path.abspath(root)


def max_megabytes():
    try:
        value = int(get_setting("max_file_mb", 20))
    except (TypeError, ValueError):
        value = 20
    return value if value > 0 else 20


def display_name(raw):
    """A name safe to show and to put in a header. Greek letters stay; paths, control characters and quotes go."""
    name = (raw or "").replace("\\", "/").rsplit("/", 1)[-1]
    name = "".join(ch for ch in name if ch.isprintable() and ch not in '"<>|:*?\x7f')
    name = re.sub(r"\s+", " ", name).strip(" .")
    if len(name) > NAME_MAX:
        stem, dot, ext = name.rpartition(".")
        name = (stem[: NAME_MAX - len(ext) - 1] + "." + ext) if dot else name[:NAME_MAX]
    return name or "file"


def abs_path(ref):
    """Absolute path of a stored file. Refuses anything that would leave the storage folder."""
    root = storage_root()
    path = os.path.abspath(os.path.join(root, ref))
    if os.path.commonpath([root, path]) != root:
        raise ValueError("path outside storage")
    return path


def doc_round(req):
    """The round a document added now belongs to: the next one while the request is returned."""
    return req.round + 1 if req.status == "returned" else req.round


def is_removable(req, doc):
    """Only documents of the current unsubmitted round. After a submission nothing is deleted."""
    if req.status == "draft":
        return True
    return req.status == "returned" and doc.round > req.round


def store_upload(req, file, user):
    """Save one uploaded file. Returns the RequestDocument (flushed, not committed) or raises UploadError."""
    name = display_name(file.filename)
    ext = sniff.extension(name)
    if ext not in sniff.MIME:
        raise UploadError("docs.error.type", name=name)
    limit_mb = max_megabytes()
    limit = limit_mb * 1024 * 1024
    folder = os.path.join(storage_root(), str(req.id))
    os.makedirs(folder, exist_ok=True)
    fd, tmp = tempfile.mkstemp(prefix=".upload-", dir=folder)
    final = None
    try:
        digest, size = hashlib.sha256(), 0
        with os.fdopen(fd, "wb") as out:
            while True:
                block = file.stream.read(CHUNK)
                if not block:
                    break
                size += len(block)
                if size > limit:
                    raise UploadError("docs.error.too_large", name=name, n=limit_mb)
                digest.update(block)
                out.write(block)
        if size == 0:
            raise UploadError("docs.error.empty", name=name)
        if not sniff.matches(tmp, ext):
            raise UploadError("docs.error.type", name=name)
        doc = RequestDocument(
            request_id=req.id, round=doc_round(req), file_name=name, mime=sniff.MIME[ext], size=size,
            sha256=digest.hexdigest(), uploaded_by=user.id, uploaded_at=datetime.now(timezone.utc))
        db.session.add(doc)
        db.session.flush()
        ref = "%d/%d-%s.bin" % (req.id, doc.id, secrets.token_hex(8))
        final = abs_path(ref)
        os.replace(tmp, final)
        doc.storage_ref = ref
        return doc
    except BaseException:
        for leftover in (tmp, final):
            if leftover and os.path.exists(leftover):
                os.remove(leftover)
        raise


def remove_files(doc):
    """Delete the stored file and its converted copy. Used only for unsubmitted documents."""
    path = abs_path(doc.storage_ref)
    for p in (path, converted_path(path)):
        if os.path.exists(p):
            os.remove(p)


def converted_path(path):
    return os.path.splitext(path)[0] + ".pdf"


def ensure_pdf(doc):
    """Path of the PDF version of an Office document, converting once and caching next to the original.
    None when no converter is installed or the conversion fails."""
    src = abs_path(doc.storage_ref)
    dst = converted_path(src)
    if os.path.isfile(dst) and os.path.getsize(dst) > 0:
        return dst
    converter = get_converter(current_app)
    if not os.path.isfile(src) or not converter.available():
        return None
    ext = sniff.extension(doc.file_name)
    with tempfile.TemporaryDirectory(prefix="ehr-conv-", dir=os.path.dirname(src)) as work:
        work_src = os.path.join(work, "document." + ext)
        shutil.copyfile(src, work_src)
        work_dst = os.path.join(work, "result.pdf")
        try:
            ok = converter.to_pdf(work_src, work_dst)
        except Exception:  # a converter must never break the page
            current_app.logger.exception("document conversion failed")
            ok = False
        if not ok or not os.path.isfile(work_dst) or os.path.getsize(work_dst) == 0:
            return None
        os.replace(work_dst, dst)
    return dst


def kind_of(doc):
    ext = sniff.extension(doc.file_name)
    if ext == "pdf":
        return "pdf"
    if ext in sniff.IMAGES:
        return "image"
    return "office"


def size_text(n, lang="en"):
    n = n or 0
    if n < 1024:
        text = "%d B" % n
    elif n < 1024 * 1024:
        text = "%.0f KB" % (n / 1024.0)
    else:
        text = "%.1f MB" % (n / 1024.0 / 1024.0)
    return text.replace(".", ",") if lang == "el" else text


def documents_of(req, user=None, lang="en"):
    """Template data: {"count": n, "groups": [{"round": r, "docs": [row, ...]}]}, oldest round first."""
    if req is None or req.id is None:
        return {"count": 0, "groups": []}
    docs = (RequestDocument.query.filter_by(request_id=req.id)
            .order_by(RequestDocument.round, RequestDocument.uploaded_at, RequestDocument.id).all())
    names = {}
    ids = {d.uploaded_by for d in docs if d.uploaded_by}
    if ids:
        names = {u.id: u.full_name for u in User.query.filter(User.id.in_(ids))}
    owner = user is not None and req.created_by == user.id
    groups = {}
    for d in docs:
        groups.setdefault(d.round, []).append({
            "id": d.id, "name": d.file_name, "size": size_text(d.size, lang), "who": names.get(d.uploaded_by, ""),
            "when": d.uploaded_at, "kind": kind_of(d), "removable": owner and is_removable(req, d)})
    return {"count": len(docs), "groups": [{"round": r, "docs": groups[r]} for r in sorted(groups)]}
