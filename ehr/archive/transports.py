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
FILE_ROLE_FIELD = "role"  # NEEDS eArchive's confirmation: the note says MAIN / ATTACHMENT but not the field's name
ROLE_MAIN, ROLE_ATTACHMENT = "MAIN", "ATTACHMENT"
RETRY_STATUSES = (408, 429)  # not in the note's table; a clock or a queue on their side, so waiting is right
_PART_NAME = re.compile(r"^[a-z][a-z0-9_]{0,39}$")


class TransientError(ArchiveError):
    """eArchive could not be reached or is restarting. Try again later with the same key."""


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
    """(code, message) from an error body: {code, message}, also accepted under an "error" object."""
    code = message = None
    try:
        body = json.loads(raw.decode("utf-8", "replace"))
        if isinstance(body, dict):
            inner = body.get("error") if isinstance(body.get("error"), dict) else body
            code, message = inner.get("code"), inner.get("message")
    except ValueError:
        pass
    return str(code or "HTTP_%d" % status)[:60], str(message or "")[:400]


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
            raise TransientError("EHR_ARCHIVE_TOKEN is not set.")
        url = self.base_url() + INGEST_PATH
        meta_bytes = json.dumps(meta, ensure_ascii=False, sort_keys=True).encode("utf-8")
        parts = [(entry["part_name"], entry["filename"], f.mime, f.path) for entry, f in zip(meta["files"], files)]
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
            return self._refusal(exc.code, raw, token)
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
    def _refusal(status, raw, token):
        code, message = _error_parts(raw, status)
        message = scrub(message, token)
        if status >= 500 or status in RETRY_STATUSES:
            raise TransientError("eArchive answered %d." % status)
        if status in (301, 302, 303, 307, 308):
            raise BlockedError("REDIRECT_REFUSED", "eArchive answered with a redirect; the address is wrong.")
        if status == 409 and code == "DUPLICATE_SOURCE_REF":
            found = NUMBER_IN_TEXT.search(message)
            return Receipt(protocol_number=found.group(1) if found else None, duplicate=True)
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
