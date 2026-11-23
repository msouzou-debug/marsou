"""A small stand-in for eFinance's two endpoints of contract 07, for tests and screenshots only.

It listens on 127.0.0.1 and answers `GET /api/v1/ehire/cost-centres` and `GET /api/v1/ehire/budget` with a bearer
token. Switches (attribute `mode`, consumed on every call until changed): an int status (401, 404, 500...), "timeout"
(sleeps past the client's limit), "redirect", "bad_json", "huge" (a body over the size cap). `cost_centres` and
`budgets` hold the data; `etag` turns ETag / If-None-Match on. Every call is recorded in `calls`; with
`fail_if_called` set, a call is recorded in `forbidden` and answered 500, so a test can prove that nothing called it.
Run on its own (`python -m tests.efinance.fake_efinance PORT`) it serves invented sample data for the screenshots.
"""
import json
import socket
import sys
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlsplit

TOKEN = "fake-efinance-token-7d1e"


def free_port():
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def cc(code, name, entity, active=True, name_en=None):
    return {"code": code, "name_el": name, "name_en": name_en, "entity_code": entity, "active": active}


def line(article, name, budget, spent, committed, available, name_en=None):
    return {"article": article, "name_el": name, "name_en": name_en, "budget": budget, "spent": spent,
            "committed": committed, "available": available}


class FakeEFinance:
    def __init__(self, token=TOKEN):
        self.token = token
        self.cost_centres = []
        self.budgets = {}  # (code, year) -> [line]
        self.as_of = "2026-11-23T06:30:00Z"
        self.etag = None  # a string turns ETag on
        self.mode = None
        self.delay = 0
        self.fail_if_called = False
        self.calls = []
        self.forbidden = []
        self.port = None
        self._server = None

    # ------------------------------------------------------------------ server
    def start(self, port=None):
        fake = self

        class Handler(BaseHTTPRequestHandler):
            def log_message(self, *args):
                pass

            def _send(self, status, body=b"", headers=None):
                self.send_response(status)
                for k, v in (headers or {}).items():
                    self.send_header(k, v)
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                if body:
                    try:
                        self.wfile.write(body)
                    except (BrokenPipeError, ConnectionResetError):
                        pass

            def do_GET(self):  # noqa: N802
                parts = urlsplit(self.path)
                query = {k: v[0] for k, v in parse_qs(parts.query).items()}
                call = {"path": parts.path, "query": query, "auth": self.headers.get("Authorization"),
                        "if_none_match": self.headers.get("If-None-Match"),
                        "forwarded": any(self.headers.get(h) for h in ("Via", "X-Forwarded-For"))}
                fake.calls.append(call)
                if fake.fail_if_called:
                    fake.forbidden.append(call)
                    return self._send(500, b"{}")
                if fake.delay:
                    time.sleep(fake.delay)
                if self.headers.get("Authorization") != "Bearer " + fake.token:
                    return self._send(401, b'{"error": "unauthorized"}')
                mode = fake.mode
                if mode == "timeout":
                    time.sleep(1.5)
                    return self._send(200, b"{}")
                if mode == "redirect":
                    return self._send(302, headers={"Location": "http://127.0.0.1:1/elsewhere"})
                if isinstance(mode, int):
                    return self._send(mode, b'{"error": "x"}')
                if mode == "bad_json":
                    return self._send(200, b"{not json", {"Content-Type": "application/json"})
                if mode == "huge":
                    return self._send(200, b'{"x": "' + b"a" * (5 * 1024 * 1024) + b'"}')
                if parts.path == "/api/v1/ehire/cost-centres":
                    return self._cost_centres()
                if parts.path == "/api/v1/ehire/budget":
                    return self._budget(query)
                return self._send(404, b"{}")

            def _json(self, body, headers=None):
                data = json.dumps(body, ensure_ascii=False).encode("utf-8")
                self._send(200, data, dict({"Content-Type": "application/json"}, **(headers or {})))

            def _cost_centres(self):
                headers = {}
                if fake.etag:
                    if self.headers.get("If-None-Match") == fake.etag:
                        return self._send(304)
                    headers["ETag"] = fake.etag
                self._json({"as_of": fake.as_of, "cost_centres": fake.cost_centres}, headers)

            def _budget(self, query):
                code, year = query.get("cost_centre"), query.get("year")
                known = {c["code"] for c in fake.cost_centres} | {k[0] for k in fake.budgets}
                if code not in known:
                    return self._send(404, b'{"error": "unknown cost centre"}')
                try:
                    year = int(year)
                except (TypeError, ValueError):
                    return self._send(400, b"{}")
                lines = list(fake.budgets.get((code, year), []))
                if query.get("article"):
                    lines = [l for l in lines if l["article"] == query["article"]]
                entity = next((c["entity_code"] for c in fake.cost_centres if c["code"] == code), None)
                self._json({"cost_centre": code, "entity_code": entity, "year": year, "as_of": fake.as_of,
                            "currency": "EUR", "lines": lines})

        self.port = port or free_port()
        self._server = ThreadingHTTPServer(("127.0.0.1", self.port), Handler)
        self._server.daemon_threads = True
        threading.Thread(target=self._server.serve_forever, daemon=True).start()
        return self

    @property
    def url(self):
        return "http://127.0.0.1:%d" % self.port

    def stop(self):
        if self._server is not None:
            self._server.shutdown()
            self._server.server_close()


def sample(fake, year=2026):
    """Invented data for the screenshots: the demo cost centres, and budgets with a healthy line, one at zero and
    one below the cost of two posts. No real figures."""
    fake.cost_centres = [cc("CC-100", "Παθολογική Κλινική", "NGH"), cc("CC-200", "Χειρουργική Κλινική", "NGH"),
                         cc("CC-300", "Διοίκηση", "NGH"), cc("CC-400", "Ακτινολογικό", "LGH")]
    fake.budgets = {
        ("CC-100", year): [line("02101", "Μισθοί μόνιμου προσωπικού", "250000.00", "180340.12", "20000.00", "49659.88"),
                           line("02102", "Μισθοί έκτακτου προσωπικού", "80000.00", "61200.00", "18800.00", "0.00"),
                           line("02110", "Υπερωρίες", "30000.00", "12000.00", "0.00", "18000.00")],
        ("CC-200", year): [line("02101", "Μισθοί μόνιμου προσωπικού", "400000.00", "100000.00", "0.00", "300000.00")],
        ("CC-300", year): [],
    }
    return fake


if __name__ == "__main__":  # python -m tests.efinance.fake_efinance PORT [CODE...]: sample data, for screenshots
    port = int(sys.argv[1])
    fake = sample(FakeEFinance())
    extra = sys.argv[2:]
    for code in extra:  # cost centres of a seeded database: give each the first sample budget
        fake.cost_centres.append(cc(code, "Κέντρο κόστους " + code, "NGH"))
        fake.budgets[(code, 2026)] = fake.budgets[("CC-100", 2026)]
    fake.start(port)
    print("fake eFinance on %s, token %s" % (fake.url, fake.token), flush=True)
    while True:
        time.sleep(3600)
