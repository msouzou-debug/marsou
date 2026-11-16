"""A small fake of eArchive's ingest route (docs/external/earchive-ingest-2026-11-16.md), for tests only.

It listens on 127.0.0.1 and behaves as the note says: bearer token, loopback and forwarding-header refusal, strict meta
schema (unknown fields refused), required fields, attribute key rules, files against part names, size and sha256
checks, the limits, idempotent replay, mismatch, duplicate source_ref. Matches eArchive's answers of 16/11/2026:
each file entry is exactly kind, part_name, filename, mime, size, sha256 (anything else, `role` included, is
SCHEMA_INVALID); errors are {"error": {code, message, details?}}; DUPLICATE_SOURCE_REF carries protocol_id and
protocol_number in details; a retry is compared as canonical JSON of the whole meta (sent_at included) plus the file
hashes; an ATTACHMENT of type application/zip is opened (200 files, 50 MB each, 200 MB in all, accepted types, unique
names, 415 naming the file); a site code it does not have is 400 UNKNOWN_REGISTRY. A key is recorded only once a
request has passed validation and is filed (confirmed by eArchive on 16/11/2026: a refusal leaves nothing behind).
Answers of the second set (16/11/2026): every multipart part, a zip included, is at most `part_limit` bytes
(413 FILE_TOO_LARGE); inside a zip each file is at most `member_limit`, all together at most `unpacked_limit`, at most
200 files; the whole request is at most `request_limit`. SCHEMA_INVALID carries details
{"formErrors": [...], "fieldErrors": {"<top-level field>": ["..."]}} with English messages, except `meta` missing, not
JSON, or a part without a file name (only a message). 409 IDEMPOTENCY_MISMATCH carries protocol_id and protocol_number
in details while `mismatch_details` is True (eArchive's update installed); set it to False for the earlier behaviour.
`script` holds answers to give before any real processing (to test 5xx, 401 and so on); each is consumed once:
(status, code, message) or (status, code, message, details).
"""
import io
import zipfile
import hashlib
import json
import re
import socket
import threading
import time
from datetime import date, datetime
from email.parser import BytesParser
from http.server import BaseHTTPRequestHandler, HTTPServer

from ehr.archive.transports import FILE_FIELDS

TOKEN = "fake-ingest-token-0000"
SITES = ("HQ", "NGH", "NAM", "LGH", "LAR", "PAF", "FAM", "KYP", "POL", "MHS", "PHC", "CNS")
REQUIRED = ("schema_version", "outbox_id", "sent_at", "source_system", "source_module", "source_ref", "doc_type",
            "subject", "direction", "sender_name", "letter_date", "category", "classification", "personal_data",
            "folder_hints", "files")
OPTIONAL = ("personal_data_category", "sender_ref", "source_url", "event_date", "attributes", "amount", "currency",
            "related", "approvals", "counterparties", "registry_hint", "retention_class_hint")
MAX_ZIP_MEMBERS = 200
ACCEPTED = {"pdf", "doc", "docx", "xls", "xlsx", "ppt", "pptx", "png", "jpg", "jpeg", "tif", "tiff", "gif", "webp",
            "html", "htm", "txt", "csv", "xml", "eml", "msg", "zip"}
FORWARD = ("X-Forwarded-For", "X-Real-IP", "Forwarded", "CF-Connecting-IP", "CF-Ray")
MAX_FILE, MAX_TOTAL = 50 * 1024 * 1024, 200 * 1024 * 1024


class Refusal(Exception):
    def __init__(self, status, code, message, details=None):
        super().__init__(code)
        self.status, self.code, self.message, self.details = status, code, message, details


def free_port():
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def _sha(data):
    return hashlib.sha256(data).hexdigest()


class FakeEArchive:
    def __init__(self, token=TOKEN, size_limits=None, sites=SITES):
        self.token = token
        self.sites = tuple(sites)
        file_limit, total_limit = size_limits or (MAX_FILE, MAX_TOTAL)
        self.part_limit = self.member_limit = file_limit  # one part; one file inside a zip
        self.unpacked_limit = self.request_limit = total_limit  # all files inside a zip; everything in the request
        self.mismatch_details = True
        self.requests = []  # every call that reached the route: headers, meta, files, status
        self.filed = {}  # source_ref -> receipt
        self.keys = {}  # idempotency key -> (fingerprint, receipt)
        self.script = []  # [(status, code, message)] or [("sleep", seconds)]
        self.zips = []  # the member names of each zip that was opened
        self.port = None
        self._server = None

    # ------------------------------------------------------------------ lifecycle
    def start(self, port=None):
        self.port = port or free_port()
        fake = self

        class Handler(BaseHTTPRequestHandler):
            def log_message(self, *args):
                pass

            def do_POST(self):
                fake._handle(self)

        self._server = HTTPServer(("127.0.0.1", self.port), Handler)
        threading.Thread(target=self._server.serve_forever, daemon=True).start()
        return self

    def stop(self):
        if self._server:
            self._server.shutdown()
            self._server.server_close()
            self._server = None

    @property
    def url(self):
        return "http://127.0.0.1:%d" % self.port

    # ------------------------------------------------------------------ the route
    def _handle(self, h):
        length = int(h.headers.get("Content-Length") or 0)
        body = h.rfile.read(length)
        record = {"path": h.path, "headers": {k.lower(): v for k, v in h.headers.items()}, "meta": None, "files": {},
                  "status": None, "peer": h.client_address[0]}
        self.requests.append(record)
        status, payload, extra = 500, {"error": {"code": "INTERNAL", "message": "fake error"}}, {}
        try:
            status, payload, extra = self._process(h, body, record)
        except Refusal as r:
            error = {"code": r.code, "message": r.message}
            if r.details is not None:
                error["details"] = r.details
            status, payload = r.status, {"error": error}
        record["status"] = status
        data = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        h.send_response(status)
        h.send_header("Content-Type", "application/json; charset=utf-8")
        h.send_header("Content-Length", str(len(data)))
        for k, v in extra.items():
            h.send_header(k, v)
        h.end_headers()
        h.wfile.write(data)

    def _process(self, h, body, record):
        if h.path != "/api/v1/ingest/documents":
            raise Refusal(404, "NOT_FOUND", "No such route.")
        if record["peer"] not in ("127.0.0.1", "::1") or any(k in h.headers for k in FORWARD):
            raise Refusal(403, "LOOPBACK_ONLY", "Only direct calls from this machine are accepted.")
        auth = h.headers.get("Authorization", "")
        if not auth.startswith("Bearer ") or auth[7:] != self.token:
            raise Refusal(401, "UNAUTHORIZED", "Missing or wrong token.")
        if self.script:
            step = self.script.pop(0)
            if step[0] == "sleep":
                time.sleep(step[1])
            else:
                raise Refusal(*step)
        meta, files = self._parse(h, body, record)
        record["meta"], record["files"] = meta, files
        key = h.headers.get("Idempotency-Key", "")
        if key != "ehr:%s" % meta["outbox_id"]:
            raise Refusal(400, "SCHEMA_INVALID", "Idempotency-Key must be ehr:<outbox_id>.")
        if meta["source_system"] != "eHR":
            raise Refusal(403, "SOURCE_MISMATCH", "This token files eHR items only.")
        self._check_files(meta, files)
        # canonical JSON of the whole meta (key order and spaces do not matter, every value does) plus the file hashes
        fingerprint = _sha(json.dumps(meta, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode() +
                           b"".join(_sha(files[f["part_name"]]).encode() for f in meta["files"]))
        if key in self.keys:
            old, receipt = self.keys[key]
            if old != fingerprint:
                held = {"protocol_id": receipt["protocol_id"], "protocol_number": receipt["protocol_number"]}
                raise Refusal(409, "IDEMPOTENCY_MISMATCH", "The same key was used with different content.",
                              held if self.mismatch_details else None)
            return 200, receipt, {"Idempotency-Replayed": "true"}
        if meta["source_ref"] in self.filed:
            old = self.filed[meta["source_ref"]]
            raise Refusal(409, "DUPLICATE_SOURCE_REF", "source_ref is already filed as %s." % old["protocol_number"],
                          {"protocol_id": old["protocol_id"], "protocol_number": old["protocol_number"]})
        n = len(self.filed) + 1
        receipt = {"protocol_id": "p-%04d" % n, "protocol_number": "ΑΔ/2026/%05d" % n,
                   "url": "http://127.0.0.1:5011/protocols/p-%04d" % n, "registry": "ΑΔ",
                   "received_at": datetime.now().astimezone().isoformat(timespec="seconds")}
        self.filed[meta["source_ref"]] = receipt
        self.keys[key] = (fingerprint, receipt)
        return 201, receipt, {}

    # ------------------------------------------------------------------ parsing and checks
    def _parse(self, h, body, record):
        ctype = h.headers.get("Content-Type", "")
        if not ctype.startswith("multipart/form-data"):
            raise Refusal(400, "SCHEMA_INVALID", "multipart/form-data is required.")
        message = BytesParser().parsebytes(b"Content-Type: " + ctype.encode() + b"\r\nMIME-Version: 1.0\r\n\r\n" + body)
        if not message.is_multipart():
            raise Refusal(400, "SCHEMA_INVALID", "The body is not multipart.")
        meta, files = None, {}
        for part in message.get_payload():
            name = part.get_param("name", header="content-disposition")
            data = part.get_payload(decode=True) or b""
            if name == "meta":
                try:
                    meta = json.loads(data.decode("utf-8"))
                except ValueError:
                    raise Refusal(400, "SCHEMA_INVALID", "meta is not JSON.")
            elif name in files:
                raise Refusal(400, "SCHEMA_INVALID", "Part %s is sent twice." % name)
            else:
                if part.get_filename() is None:
                    raise Refusal(400, "SCHEMA_INVALID", "Part %s has no file name." % name)
                files[name] = data
        if not isinstance(meta, dict):
            raise Refusal(400, "SCHEMA_INVALID", "meta is missing.")
        record["meta"] = meta  # kept even when the schema check refuses it
        self._schema(meta)
        return meta, files

    @staticmethod
    def _bad(message, field=None):
        """eArchive's shape: fieldErrors keyed by the top-level field of meta, formErrors for the rest."""
        details = {"formErrors": [], "fieldErrors": {}}
        if field:
            details["fieldErrors"][field] = [message]
        else:
            details["formErrors"].append(message)
        raise Refusal(400, "SCHEMA_INVALID", "The meta part is not valid.", details)

    def _schema(self, m):
        bad = self._bad
        unknown = set(m) - set(REQUIRED) - set(OPTIONAL)
        if unknown:
            bad("Unknown field(s): %s." % ", ".join(sorted(unknown)))
        missing = [k for k in REQUIRED if k not in m]
        if missing:
            bad("Missing field(s): %s." % ", ".join(missing))
        if m["schema_version"] != 1 or isinstance(m["schema_version"], bool):
            bad("schema_version must be 1.", "schema_version")
        if not isinstance(m["outbox_id"], (int, str)) or isinstance(m["outbox_id"], bool):
            bad("outbox_id must be an integer or a string.", "outbox_id")
        for key, low, high in (("source_ref", 1, 120), ("doc_type", 1, 60), ("subject", 3, 500)):
            if not isinstance(m[key], str) or not low <= len(m[key]) <= high:
                bad("%s must be text of %d to %d characters." % (key, low, high), key)
        for key in ("source_system", "source_module", "direction", "sender_name", "category", "classification"):
            if not isinstance(m[key], str) or not m[key]:
                bad("%s must be text." % key, key)
        if m["classification"] not in ("PUBLIC", "INTERNAL", "SENSITIVE", "HIGHLY_SENSITIVE"):
            bad("classification is not allowed.", "classification")
        if m["direction"] not in ("INBOUND", "OUTBOUND", "INTERNAL"):
            bad("direction is not allowed.", "direction")
        try:
            if datetime.fromisoformat(m["sent_at"]).tzinfo is None:
                bad("sent_at needs an offset.", "sent_at")
            date.fromisoformat(m["letter_date"])
            if "event_date" in m:
                date.fromisoformat(m["event_date"])
        except (ValueError, TypeError):
            bad("A date is not in ISO form.", "letter_date")
        if not isinstance(m["personal_data"], bool):
            bad("personal_data must be true or false.", "personal_data")
        if m["personal_data"] and not m.get("personal_data_category"):
            bad("personal_data_category is required when personal_data is true.", "personal_data_category")
        hints = m["folder_hints"]
        if not isinstance(hints, list) or not 1 <= len(hints) <= 5 or not all(isinstance(x, dict) for x in hints):
            bad("folder_hints must hold 1 to 5 objects.", "folder_hints")
        for hint in hints:
            if set(hint) - {"hospital"} or hint.get("hospital") not in self.sites:
                raise Refusal(400, "UNKNOWN_REGISTRY", "Unknown site code.")
        attrs = m.get("attributes", {})
        if not isinstance(attrs, dict) or len(attrs) > 20:
            bad("attributes must be an object of at most 20 values.", "attributes")
        for k, v in attrs.items():
            if not re.fullmatch(r"[a-z0-9_]{1,40}", k):
                bad("attribute key %r is not allowed." % k, "attributes")
            if not isinstance(v, str) or len(v) > 300:
                bad("attribute %s must be text up to 300 characters." % k, "attributes")
        if "amount" in m and (isinstance(m["amount"], bool) or not isinstance(m["amount"], (int, float))):
            bad("amount must be a number.", "amount")
        for item in m.get("related", []):
            if set(item) != {"source_ref", "relation"}:
                bad("related items are {source_ref, relation}.", "related")
        for item in m.get("approvals", []):
            if set(item) - {"actor_name", "role", "action", "at", "comment"} or not {"actor_name", "action", "at"} <= set(item):
                bad("approvals items are {actor_name, role, action, at, comment?}.", "approvals")
            datetime.fromisoformat(item["at"])
        files = m["files"]
        if not isinstance(files, list) or not 1 <= len(files) <= 20:
            bad("files must hold 1 to 20 entries.", "files")
        for f in files:
            if set(f) != set(FILE_FIELDS):
                bad("a file entry has exactly the fields %s, not %s." % (sorted(FILE_FIELDS), sorted(f)), "files")
            if f["kind"] not in ("MAIN", "ATTACHMENT"):
                bad("kind must be MAIN or ATTACHMENT.", "files")
            for key in ("part_name", "filename", "mime", "sha256"):
                if not isinstance(f[key], str) or not f[key]:
                    bad("file %s must be text." % key, "files")
            if isinstance(f["size"], bool) or not isinstance(f["size"], int):
                bad("file size must be an integer.", "files")
        if len({f["part_name"] for f in files}) != len(files):
            bad("part_name must be unique.", "files")
        kinds = [f["kind"] for f in files]
        if kinds.count("MAIN") != 1 or kinds.count("ATTACHMENT") != len(files) - 1:
            bad("Exactly one MAIN file, the rest ATTACHMENT.", "files")

    def _check_files(self, meta, files):
        if set(files) != {f["part_name"] for f in meta["files"]}:
            raise Refusal(400, "SCHEMA_INVALID", "The file parts do not match meta.files.",
                          {"formErrors": [], "fieldErrors": {"files": ["The file parts do not match meta.files."]}})
        total = 0
        for f in meta["files"]:
            data = files[f["part_name"]]
            if len(data) > self.part_limit:  # every part, a zip included, is judged by its own size
                raise Refusal(413, "FILE_TOO_LARGE", "%s is too large." % f["filename"])
            ext = f["filename"].rsplit(".", 1)[-1].lower() if "." in f["filename"] else ""
            if ext not in ACCEPTED:
                raise Refusal(415, "MIME_REJECTED", "%s is not an accepted type." % f["filename"])
            if f["size"] != len(data) or f["sha256"] != _sha(data):
                raise Refusal(400, "SHA256_MISMATCH", "%s does not match its size or sha256." % f["filename"])
            total += len(data)
            if f["mime"] == "application/zip" and f["kind"] == "ATTACHMENT":
                self._open_zip(f, data)
        if total > self.request_limit:
            raise Refusal(413, "TOO_LARGE", "The deposit is too large.")

    def _open_zip(self, f, data):
        """eArchive opens a zip attachment and files each member: limits as the answers state them."""
        try:
            zf = zipfile.ZipFile(io.BytesIO(data))
            infos = [i for i in zf.infolist() if not i.is_dir()]
        except zipfile.BadZipFile:
            raise Refusal(400, "ARCHIVE_BAD_ZIP", "%s is not a readable zip." % f["filename"])
        if len(infos) > MAX_ZIP_MEMBERS:
            raise Refusal(413, "TOO_LARGE", "The zip holds more than %d files." % MAX_ZIP_MEMBERS)
        names, total = set(), 0
        for info in infos:
            ext = info.filename.rsplit(".", 1)[-1].lower() if "." in info.filename else ""
            if ext not in ACCEPTED:
                raise Refusal(415, "MIME_REJECTED", "%s (inside the zip) is not an accepted type." % info.filename)
            if info.file_size > self.member_limit:
                raise Refusal(413, "TOO_LARGE", "%s (inside the zip) is too large." % info.filename)
            if info.filename.lower() in names:
                raise Refusal(400, "ARCHIVE_BAD_ZIP", "The name %s is in the zip twice." % info.filename)
            names.add(info.filename.lower())
            total += info.file_size
        if total > self.unpacked_limit:
            raise Refusal(413, "TOO_LARGE", "The files in the zip are too large together.")
        self.zips.append([i.filename for i in infos])
