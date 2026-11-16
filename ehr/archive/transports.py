"""How a deposit leaves eHR. One small interface (contract 06); `http` is the real eArchive link.

`deposit(manifest, files) -> reference`. It must be idempotent on the manifest's `key` (request number + kind): a
second call with the same key must not create a second record. A transport signals failure by raising; the queue
records the message and tries again at the next run.
"""
import hashlib
import json
import os
import re
import secrets
import http.client
import shutil
import urllib.error
import urllib.request
from dataclasses import dataclass
from urllib.parse import quote, urlsplit

from flask import current_app

from .. import i18n
from ..models import get_setting

NAMES = ("none", "folder", "http")


class ArchiveError(Exception):
    """A problem with a deposit that is worth showing to an administrator as it is."""


@dataclass(frozen=True)
class DepositFile:
    """One file of a deposit: `stored_as` is the name inside the deposit, `path` is where eHR holds it."""
    stored_as: str
    name: str
    mime: str
    size: int
    sha256: str
    path: str


class Transport:
    name = "none"
    delivers = False  # False: nothing is sent and rows stay queued

    def deposit(self, manifest, files):
        raise NotImplementedError


class NullTransport(Transport):
    """The default. Sends nothing. Deposits wait in the queue until a real transport is chosen."""
    name = "none"
    delivers = False

    def deposit(self, manifest, files):
        raise ArchiveError("No archive transport is set up (archive_transport = none).")


def _t(key, **params):
    """A reason an administrator reads: Greek, from the string files (never English in code)."""
    return i18n.translate(key, "el", **params)


def canonical(manifest):
    """The manifest as the bytes that are written and compared: sorted keys, UTF-8, no line noise."""
    return json.dumps(manifest, ensure_ascii=False, sort_keys=True, indent=2).encode("utf-8") + b"\n"


def manifest_hash(manifest):
    return hashlib.sha256(canonical(manifest)).hexdigest()


def safe_name(text, limit=80):
    """A file or folder name that is safe on any disk: no path parts, no control or odd characters."""
    name = re.sub(r"[^\w.\- ]", "_", (text or "").replace("\\", "/").rsplit("/", 1)[-1], flags=re.UNICODE)
    name = re.sub(r"\s+", " ", name).strip(" .") or "file"
    if len(name) > limit:
        stem, dot, ext = name.rpartition(".")
        name = (stem[: limit - len(ext) - 1] + "." + ext) if dot and len(ext) < 10 else name[:limit]
    return name


class FolderTransport(Transport):
    """Writes each deposit as a folder `<number>-<kind>/` inside EHR_ARCHIVE_DROP_DIR: manifest.json, the PDF and the
    documents. Written under a temporary name and renamed, so a reader never sees half a deposit. An existing deposit
    with the same manifest is a successful retry; one with a different manifest is refused, never overwritten."""
    name = "folder"
    delivers = True

    def __init__(self, drop_dir=None):
        self._drop_dir = drop_dir

    def drop_dir(self):
        path = self._drop_dir or current_app.config.get("EHR_ARCHIVE_DROP_DIR") or ""
        if not path:
            raise ArchiveError("EHR_ARCHIVE_DROP_DIR is not set.")
        path = os.path.abspath(path)
        if not os.path.isdir(path):
            raise ArchiveError("The archive drop folder does not exist: %s" % path)
        return path

    def deposit(self, manifest, files):
        root = self.drop_dir()
        folder = manifest.get("folder")
        if not folder or folder != safe_name(folder):
            raise ArchiveError("The manifest has no usable folder name.")
        final = os.path.join(root, folder)
        wanted = manifest_hash(manifest)
        if os.path.lexists(final):
            return self._existing(final, folder, wanted)
        tmp = os.path.join(root, ".%s.tmp-%s" % (folder, secrets.token_hex(4)))
        os.mkdir(tmp)
        try:
            for f in files:
                shutil.copyfile(f.path, os.path.join(tmp, f.stored_as))
            with open(os.path.join(tmp, "manifest.json"), "wb") as fh:
                fh.write(canonical(manifest))
                fh.flush()
                os.fsync(fh.fileno())
            try:
                os.rename(tmp, final)
            except OSError:  # somebody else made it first; fine if it is the same deposit
                if not os.path.isdir(final):
                    raise
                return self._existing(final, folder, wanted)
        finally:
            if os.path.isdir(tmp):
                shutil.rmtree(tmp, ignore_errors=True)
        return folder

    @staticmethod
    def _existing(final, folder, wanted):
        try:
            with open(os.path.join(final, "manifest.json"), "rb") as fh:
                found = hashlib.sha256(fh.read()).hexdigest()
        except OSError:
            found = None
        if found != wanted:
            raise ArchiveError("The folder %s is already in the drop folder with different contents; "
                               "it was not overwritten." % folder)
        return folder


# ---------------------------------------------------------------- the HTTP transport (eArchive's ingest route)
# Specification: docs/external/earchive-ingest-2026-11-16.md. Only the standard library is used.

DEFAULT_URL = "http://127.0.0.1:5011"
INGEST_PATH = "/api/v1/ingest/documents"
LOOPBACK_HOSTS = ("127.0.0.1", "::1", "localhost")
TIMEOUT_SECONDS = 60
KIND_MAIN, KIND_ATTACHMENT = "MAIN", "ATTACHMENT"
FILE_FIELDS = ("kind", "part_name", "filename", "mime", "size", "sha256")  # exactly these six; eArchive refuses others
RETRY_STATUSES = (408, 429)  # eArchive's own 5 minute timeout can give 408; wait and retry with the same key
SITE_UNKNOWN_WAIT_HOURS = 24
REASONS_MAX = 300
_PART_NAME = re.compile(r"^[a-z][a-z0-9_]{0,39}$")


class TransientError(ArchiveError):
    """eArchive could not be reached or is restarting. Try again later with the same key."""


class SiteUnknown(ArchiveError):
    """eArchive does not have this site code yet (400 UNKNOWN_REGISTRY). Not a block: the deposit waits and is tried
    again once a day, and is never filed under another code."""

    def __init__(self, code):
        self.site = code
        self.text = _t("archive.error.site_unknown", code=code)
        super().__init__(self.text)


class BlockedError(ArchiveError):
    """eArchive refused the deposit. Do not send it again unchanged; an administrator looks at it."""

    def __init__(self, code, message, local=False):
        """`local`: eHR's own check (the message is complete). Otherwise eArchive's: shown as 'CODE: message'."""
        self.code, self.message = code, message
        self.text = (message or code) if local else ("%s: %s" % (code, message) if message else code)
        super().__init__(self.text)


@dataclass(frozen=True)
class Receipt:
    protocol_id: str = None
    protocol_number: str = None
    url: str = None
    duplicate: bool = False
    mismatch: bool = False  # settled from a 409 IDEMPOTENCY_MISMATCH that named the record


def check_url(base):
    """The eArchive base URL, or ArchiveError. Plain http, a loopback host, no credentials, no path: the note says the
    route refuses anything else, and a token must never leave this machine."""
    text = (base or "").strip() or DEFAULT_URL
    try:
        parts = urlsplit(text)
        parts.port  # noqa: B018  raises ValueError for a bad port
    except ValueError:
        raise ArchiveError("EHR_ARCHIVE_URL is not a valid address.")
    if parts.scheme != "http":
        raise ArchiveError("EHR_ARCHIVE_URL must start with http:// (https is refused: eArchive is on this machine).")
    if (parts.hostname or "").lower() not in LOOPBACK_HOSTS:
        raise ArchiveError("EHR_ARCHIVE_URL must point to this machine (127.0.0.1, ::1 or localhost).")
    if parts.username or parts.password or parts.path not in ("", "/") or parts.query or parts.fragment:
        raise ArchiveError("EHR_ARCHIVE_URL must be only the address and port, for example %s." % DEFAULT_URL)
    return "%s://%s" % (parts.scheme, parts.netloc)


def check_web_url(text):
    """eArchive's public web address (EHR_ARCHIVE_WEB_URL): "" when not set, otherwise the address without a trailing
    slash. Only http or https, with a host, no credentials, no query, no fragment; anything else is an ArchiveError."""
    text = (text or "").strip()
    if not text:
        return ""
    try:
        parts = urlsplit(text)
        parts.port  # noqa: B018  raises ValueError for a bad port
    except ValueError:
        raise ArchiveError("EHR_ARCHIVE_WEB_URL is not a valid address.")
    if parts.scheme not in ("http", "https") or not parts.hostname or re.search(r"\s", text):
        raise ArchiveError("EHR_ARCHIVE_WEB_URL must be an http:// or https:// address.")
    if parts.username or parts.password or parts.query or parts.fragment:
        raise ArchiveError("EHR_ARCHIVE_WEB_URL must be only the address (no sign-in details, query or fragment).")
    return text.rstrip("/")


def record_link(protocol_id):
    """The link to a record in eArchive's web app: the setting plus /protocols/<protocol_id>. None when the setting is
    empty or invalid, or the record has no protocol_id. The stored `url` of an answer is never used: it holds the
    address as it was when the answer was first given."""
    if not protocol_id:
        return None
    try:
        base = check_web_url(current_app.config.get("EHR_ARCHIVE_WEB_URL"))
    except ArchiveError:
        return None
    return "%s/protocols/%s" % (base, quote(str(protocol_id), safe="")) if base else None


def scrub(text, secret):
    """Never let the token reach a log, an audit row or a page."""
    text = str(text or "")
    return text.replace(secret, "***") if secret else text


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        return None  # the answer is raised as an HTTPError and treated as a refusal


def build_opener():
    """No proxy (environment proxy variables are ignored), no redirects."""
    return urllib.request.build_opener(urllib.request.ProxyHandler({}), _NoRedirect())


def _disposition(name, filename=None):
    head = 'form-data; name="%s"' % name
    if filename is None:
        return head
    fallback = re.sub(r"[^A-Za-z0-9._ -]", "_", filename) or "file"
    return "%s; filename=\"%s\"; filename*=UTF-8''%s" % (head, fallback, quote(filename, safe=""))


class MultipartBody:
    """multipart/form-data built by hand and read in pieces, so a 200 MB deposit is never held in memory."""

    def __init__(self, boundary, meta_bytes, parts):
        """parts: [(part_name, original file name, mime, path)]."""
        self.boundary = boundary
        self._queue = []
        self._fh = None
        dash = ("--" + boundary).encode("ascii")
        head = dash + b"\r\nContent-Disposition: " + _disposition("meta").encode("ascii") + b"\r\n\r\n"
        self._queue.append(("b", head + meta_bytes + b"\r\n"))
        self.length = len(self._queue[0][1])
        for part_name, filename, mime, path in parts:
            if not _PART_NAME.match(part_name):
                raise ArchiveError("Unsafe part name %r." % part_name)
            safe_mime = re.sub(r"[^A-Za-z0-9.+/_-]", "", mime or "") or "application/octet-stream"
            header = (dash + b"\r\nContent-Disposition: " + _disposition(part_name, filename).encode("ascii")
                      + b"\r\nContent-Type: " + safe_mime.encode("ascii") + b"\r\n\r\n")
            self._queue += [("b", header), ("f", path), ("b", b"\r\n")]
            self.length += len(header) + os.path.getsize(path) + 2
        tail = dash + b"--\r\n"
        self._queue.append(("b", tail))
        self.length += len(tail)

    def read(self, size=-1):
        out = bytearray()
        while size is None or size < 0 or len(out) < size:
            if self._fh is None:
                if not self._queue:
                    break
                kind, value = self._queue.pop(0)
                if kind == "b":
                    out += value
                    continue
                self._fh = open(value, "rb")
            chunk = self._fh.read(65536 if size is None or size < 0 else size - len(out))
            if not chunk:
                self._fh.close()
                self._fh = None
                continue
            out += chunk
        return bytes(out)

    def close(self):
        if self._fh is not None:
            self._fh.close()
            self._fh = None


def _error_parts(raw, status):
    """(code, message, details) of an error body. eArchive answers {"error": {code, message, details?}}; there is never
    a top-level code, so only `error` is read."""
    code = message = details = None
    try:
        body = json.loads(raw.decode("utf-8", "replace"))
        inner = body.get("error") if isinstance(body, dict) else None
        if isinstance(inner, dict):
            code, message, details = inner.get("code"), inner.get("message"), inner.get("details")
    except ValueError:
        pass
    return str(code or "HTTP_%d" % status)[:60], str(message or "")[:400], details


def _cut(text, secret):
    text = re.sub(r"\s+", " ", scrub(text, secret)).strip()
    return text if len(text) <= REASONS_MAX else text[:REASONS_MAX - 1] + "…"


def reasons_text(details, secret=None):
    """The reasons of a SCHEMA_INVALID answer as one short line. eArchive's shape is
    {"formErrors": [...], "fieldErrors": {"<top-level field>": ["..."]}}: each field with its messages, then the form
    errors. Any other shape (a list, a text, other keys) is read as plain text. The token is scrubbed and the line cut."""
    def flat(value):
        if isinstance(value, dict):
            return "; ".join("%s: %s" % (k, flat(v)) for k, v in value.items())
        if isinstance(value, (list, tuple)):
            return "; ".join(flat(v) for v in value)
        return str(value)

    if details in (None, "", [], {}):
        return ""
    if isinstance(details, dict) and set(details) <= {"formErrors", "fieldErrors"}:
        fields = details.get("fieldErrors") if isinstance(details.get("fieldErrors"), dict) else {}
        forms = details.get("formErrors") if isinstance(details.get("formErrors"), list) else []
        items = ["%s: %s" % (name, ", ".join(str(m) for m in (msgs if isinstance(msgs, list) else [msgs])))
                 for name, msgs in fields.items() if msgs]
        items += [str(m) for m in forms if m]
        return _cut("; ".join(items), secret)
    return _cut(flat(details), secret)


def _detail_receipt(details, mismatch=False):
    """A Receipt from error.details {protocol_id, protocol_number}, or None when it names neither."""
    if not isinstance(details, dict):
        return None
    pid, number = details.get("protocol_id"), details.get("protocol_number")
    if pid in (None, "") and number in (None, ""):
        return None
    return Receipt(protocol_id=str(pid)[:500] if pid not in (None, "") else None,
                   protocol_number=str(number)[:500] if number not in (None, "") else None, duplicate=True,
                   mismatch=mismatch)


NUMBER_IN_TEXT = re.compile(r"([^\s«»\"'(),;:]+/\d{4}/\d+)")


class HttpTransport(Transport):
    """POST to eArchive's ingest route on this machine. `deposit_meta` is the call the queue makes.

    `delivers` is False until a token is configured (EHR_ARCHIVE_TOKEN, from the environment file only) and the URL is
    a loopback address: nothing is sent and rows wait. The token is read when needed and is never stored or logged."""
    name = "http"
    needs_meta = True

    def __init__(self, url=None, token=None):
        self._url, self._token = url, token

    def token(self):
        if self._token is not None:
            return self._token
        return (current_app.config.get("EHR_ARCHIVE_TOKEN") or "").strip()

    def base_url(self):
        return check_url(self._url if self._url is not None else current_app.config.get("EHR_ARCHIVE_URL"))

    @property
    def delivers(self):
        if not self.token():
            return False
        try:
            self.base_url()
        except ArchiveError:
            return False
        return True

    def deposit(self, manifest, files):
        raise ArchiveError("The http transport sends the meta part; it has no manifest call.")

    def deposit_meta(self, deposit_id, meta, files):
        """Send one deposit. Returns a Receipt, or raises TransientError / BlockedError. `files` follow meta['files']."""
        token = self.token()
        if not token:
            raise TransientError(_t("archive.error.no_token"))
        url = self.base_url() + INGEST_PATH
        meta_bytes = json.dumps(meta, ensure_ascii=False, sort_keys=True).encode("utf-8")
        parts = [(entry["part_name"], entry["filename"], entry["mime"], f.path) for entry, f in zip(meta["files"], files)]
        boundary = "----ehr" + secrets.token_hex(16)
        body = MultipartBody(boundary, meta_bytes, parts)
        request = urllib.request.Request(url, data=body, method="POST", headers={
            "Authorization": "Bearer " + token, "Idempotency-Key": "ehr:%s" % deposit_id,
            "Content-Type": "multipart/form-data; boundary=" + boundary, "Content-Length": str(body.length),
            "Accept": "application/json", "User-Agent": "eHR"})
        try:
            with build_opener().open(request, timeout=TIMEOUT_SECONDS) as response:
                return self._success(response.status, response.headers, response.read(1 << 20))
        except urllib.error.HTTPError as exc:
            raw = exc.read(1 << 20) if hasattr(exc, "read") else b""
            return self._refusal(exc.code, raw, token, meta)
        except (urllib.error.URLError, OSError, http.client.HTTPException) as exc:
            reason = getattr(exc, "reason", exc)
            raise TransientError("eArchive did not answer (%s)." % type(reason).__name__)
        finally:
            body.close()

    @staticmethod
    def _success(status, headers, raw):
        replay = (headers.get("Idempotency-Replayed") or "").lower() == "true"
        if status == 201 or (status == 200 and replay):
            try:
                data = json.loads(raw.decode("utf-8", "replace"))
            except ValueError:
                data = {}
            data = data if isinstance(data, dict) else {}
            return Receipt(*(str(data[k])[:500] if data.get(k) is not None else None
                             for k in ("protocol_id", "protocol_number", "url")))
        raise BlockedError("UNEXPECTED_ANSWER", "eArchive answered %d, which is not a receipt." % status)

    @staticmethod
    def _refusal(status, raw, token, meta=None):
        code, message, details = _error_parts(raw, status)
        message = scrub(message, token)
        if status >= 500 or status in RETRY_STATUSES:
            raise TransientError("eArchive answered %d." % status)
        if status in (301, 302, 303, 307, 308):
            raise BlockedError("REDIRECT_REFUSED", "eArchive answered with a redirect; the address is wrong.")
        if status == 409 and code in ("DUPLICATE_SOURCE_REF", "IDEMPOTENCY_MISMATCH"):
            # Already filed. The number is a field of error.details; the message text is only a fallback. A mismatch
            # names the record once eArchive's update of 16/11/2026 is installed; before that it has no details and
            # the row is blocked for an administrator (the reason is kept).
            receipt = _detail_receipt(details, mismatch=(code == "IDEMPOTENCY_MISMATCH"))
            if receipt is not None:
                return receipt
            if code == "DUPLICATE_SOURCE_REF":
                found = NUMBER_IN_TEXT.search(message)
                return Receipt(protocol_number=found.group(1) if found else None, duplicate=True)
        if status == 400 and code == "UNKNOWN_REGISTRY":
            hints = (meta or {}).get("folder_hints") or [{}]
            raise SiteUnknown(str(hints[0].get("hospital") or ""))
        if code == "SCHEMA_INVALID":
            reasons = reasons_text(details, token)
            if reasons:
                message = ("%s (%s)" % (message, reasons)) if message else reasons
        raise BlockedError(code, message)


def transport_name():
    name = (get_setting("archive_transport", "none") or "none").strip().lower()
    return name if name in NAMES else "none"  # a typo sends nothing


def get_transport(app=None):
    """The transport for this moment. Tests set app.config['ARCHIVE_TRANSPORT_OVERRIDE'] to an instance."""
    app = app or current_app
    override = app.config.get("ARCHIVE_TRANSPORT_OVERRIDE")
    if override is not None:
        return override
    name = transport_name()
    if name == "folder":
        return FolderTransport()
    if name == "http":
        return HttpTransport()
    return NullTransport()
