"""A small fake of eArchive's ingest route (docs/external/earchive-ingest-2026-11-16.md), for tests only.

It listens on 127.0.0.1 and behaves as the note says: bearer token, loopback and forwarding-header refusal, strict meta
schema (unknown fields refused), required fields, attribute key rules, files against part names, size and sha256
checks, the limits, idempotent replay, mismatch, duplicate source_ref, and error bodies with `code` and `message`.
`script` holds answers to give before any real processing (to test 5xx, 401 and so on); each is consumed once.
The note does not name the field that says MAIN or ATTACHMENT; the fake reads the one the transport sends.
"""
import hashlib
import json
import re
import socket
import threading
import time
from datetime import date, datetime
from email.parser import BytesParser
from http.server import BaseHTTPRequestHandler, HTTPServer

from ehr.archive.transports import FILE_ROLE_FIELD

TOKEN = "fake-ingest-token-0000"
SITES = ("HQ", "NGH", "NAM", "LGH", "LAR", "PAF", "FAM", "KYP", "POL", "MHS", "PHC", "CNS")
REQUIRED = ("schema_version", "outbox_id", "sent_at", "source_system", "source_module", "source_ref", "doc_type",
            "subject", "direction", "sender_name", "letter_date", "category", "classification", "personal_data",
            "folder_hints", "files")
OPTIONAL = ("personal_data_category", "sender_ref", "source_url", "event_date", "attributes", "amount", "currency",
            "related", "approvals", "counterparties", "registry_hint", "retention_class_hint")
FILE_FIELDS = ("part_name", "filename", "size", "sha256", FILE_ROLE_FIELD)
ACCEPTED = {"pdf", "doc", "docx", "xls", "xlsx", "ppt", "pptx", "png", "jpg", "jpeg", "tif", "tiff", "gif", "webp",
            "html", "htm", "txt", "csv", "xml", "eml", "msg", "zip"}
FORWARD = ("X-Forwarded-For", "X-Real-IP", "Forwarded", "CF-Connecting-IP", "CF-Ray")
MAX_FILE, MAX_TOTAL = 50 * 1024 * 1024, 200 * 1024 * 1024


class Refusal(Exception):
    def __init__(self, status, code, message):
        super().__init__(code)
        self.status, self.code, self.message = status, code, message


def free_port():
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def _sha(data):
    return hashlib.sha256(data).hexdigest()


class FakeEArchive:
    def __init__(self, token=TOKEN, size_limits=None):
        self.token = token
        self.limits = size_limits or (MAX_FILE, MAX_TOTAL)
        self.requests = []  # every call that reached the route: headers, meta, files, status
        self.filed = {}  # source_ref -> receipt
        self.keys = {}  # idempotency key -> (fingerprint, receipt)
        self.script = []  # [(status, code, message)] or [("sleep", seconds)]
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
        status, payload, extra = 500, {"code": "INTERNAL", "message": "fake error"}, {}
        try:
            status, payload, extra = self._process(h, body, record)
        except Refusal as r:
            status, payload = r.status, {"code": r.code, "message": r.message}
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
        meta, files = self._parse(h, body)
        record["meta"], record["files"] = meta, files
        key = h.headers.get("Idempotency-Key", "")
        if key != "ehr:%s" % meta["outbox_id"]:
            raise Refusal(400, "SCHEMA_INVALID", "Idempotency-Key must be ehr:<outbox_id>.")
        if meta["source_system"] != "eHR":
            raise Refusal(403, "SOURCE_MISMATCH", "This token files eHR items only.")
        self._check_files(meta, files)
        fingerprint = _sha(json.dumps(meta, sort_keys=True).encode() + b"".join(
            _sha(files[f["part_name"]]).encode() for f in meta["files"]))
        if key in self.keys:
            old, receipt = self.keys[key]
            if old != fingerprint:
                raise Refusal(409, "IDEMPOTENCY_MISMATCH", "The same key was used with different content.")
            return 200, receipt, {"Idempotency-Replayed": "true"}
        if meta["source_ref"] in self.filed:
            raise Refusal(409, "DUPLICATE_SOURCE_REF",
                          "source_ref is already filed as %s." % self.filed[meta["source_ref"]]["protocol_number"])
        n = len(self.filed) + 1
        receipt = {"protocol_id": "p-%04d" % n, "protocol_number": "ΑΔ/2026/%05d" % n,
                   "url": "http://127.0.0.1:5011/records/p-%04d" % n, "registry": "ΑΔ",
                   "received_at": datetime.now().astimezone().isoformat(timespec="seconds")}
        self.filed[meta["source_ref"]] = receipt
        self.keys[key] = (fingerprint, receipt)
        return 201, receipt, {}

    # ------------------------------------------------------------------ parsing and checks
    def _parse(self, h, body):
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
        self._schema(meta)
        return meta, files

    @staticmethod
    def _bad(message):
        raise Refusal(400, "SCHEMA_INVALID", message)

    def _schema(self, m):
        bad = self._bad
        unknown = set(m) - set(REQUIRED) - set(OPTIONAL)
        if unknown:
            bad("Unknown field(s): %s." % ", ".join(sorted(unknown)))
        missing = [k for k in REQUIRED if k not in m]
        if missing:
            bad("Missing field(s): %s." % ", ".join(missing))
        if m["schema_version"] != 1 or isinstance(m["schema_version"], bool):
            bad("schema_version must be 1.")
        if not isinstance(m["outbox_id"], (int, str)) or isinstance(m["outbox_id"], bool):
            bad("outbox_id must be an integer or a string.")
        for key, low, high in (("source_ref", 1, 120), ("doc_type", 1, 60), ("subject", 3, 500)):
            if not isinstance(m[key], str) or not low <= len(m[key]) <= high:
                bad("%s must be text of %d to %d characters." % (key, low, high))
        for key in ("source_system", "source_module", "direction", "sender_name", "category", "classification"):
            if not isinstance(m[key], str) or not m[key]:
                bad("%s must be text." % key)
        if m["classification"] not in ("PUBLIC", "INTERNAL", "SENSITIVE", "HIGHLY_SENSITIVE"):
            bad("classification is not allowed.")
        if m["direction"] not in ("INBOUND", "OUTBOUND", "INTERNAL"):
            bad("direction is not allowed.")
        try:
            if datetime.fromisoformat(m["sent_at"]).tzinfo is None:
                bad("sent_at needs an offset.")
            date.fromisoformat(m["letter_date"])
            if "event_date" in m:
                date.fromisoformat(m["event_date"])
        except (ValueError, TypeError):
            bad("A date is not in ISO form.")
        if not isinstance(m["personal_data"], bool):
            bad("personal_data must be true or false.")
        if m["personal_data"] and not m.get("personal_data_category"):
            bad("personal_data_category is required when personal_data is true.")
        hints = m["folder_hints"]
        if not isinstance(hints, list) or not 1 <= len(hints) <= 5 or not all(isinstance(x, dict) for x in hints):
            bad("folder_hints must hold 1 to 5 objects.")
        for hint in hints:
            if set(hint) - {"hospital"} or hint.get("hospital") not in SITES:
                raise Refusal(400, "UNKNOWN_REGISTRY", "Unknown site code.")
        attrs = m.get("attributes", {})
        if not isinstance(attrs, dict) or len(attrs) > 20:
            bad("attributes must be an object of at most 20 values.")
        for k, v in attrs.items():
            if not re.fullmatch(r"[a-z0-9_]{1,40}", k):
                bad("attribute key %r is not allowed." % k)
            if not isinstance(v, str) or len(v) > 300:
                bad("attribute %s must be text up to 300 characters." % k)
        if "amount" in m and (isinstance(m["amount"], bool) or not isinstance(m["amount"], (int, float))):
            bad("amount must be a number.")
        for item in m.get("related", []):
            if set(item) != {"source_ref", "relation"}:
                bad("related items are {source_ref, relation}.")
        for item in m.get("approvals", []):
            if set(item) - {"actor_name", "role", "action", "at", "comment"} or not {"actor_name", "action", "at"} <= set(item):
                bad("approvals items are {actor_name, role, action, at, comment?}.")
            datetime.fromisoformat(item["at"])
        files = m["files"]
        if not isinstance(files, list) or not 1 <= len(files) <= 20:
            bad("files must hold 1 to 20 entries.")
        for f in files:
            if set(f) != set(FILE_FIELDS):
                bad("a file entry has fields %s." % sorted(f))
        if len({f["part_name"] for f in files}) != len(files):
            bad("part_name must be unique.")
        roles = [f[FILE_ROLE_FIELD] for f in files]
        if roles.count("MAIN") != 1 or roles.count("ATTACHMENT") != len(files) - 1:
            bad("Exactly one MAIN file, the rest ATTACHMENT.")

    def _check_files(self, meta, files):
        if set(files) != {f["part_name"] for f in meta["files"]}:
            raise Refusal(400, "SCHEMA_INVALID", "The file parts do not match meta.files.")
        total = 0
        for f in meta["files"]:
            data = files[f["part_name"]]
            ext = f["filename"].rsplit(".", 1)[-1].lower() if "." in f["filename"] else ""
            if len(data) > self.limits[0]:
                raise Refusal(413, "TOO_LARGE", "%s is too large." % f["filename"])
            if ext not in ACCEPTED:
                raise Refusal(415, "MIME_REJECTED", "%s is not an accepted type." % f["filename"])
            if f["size"] != len(data) or f["sha256"] != _sha(data):
                raise Refusal(400, "SHA256_MISMATCH", "%s does not match its size or sha256." % f["filename"])
            total += len(data)
        if total > self.limits[1]:
            raise Refusal(413, "TOO_LARGE", "The deposit is too large.")
