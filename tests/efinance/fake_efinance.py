"""A small stand-in for eFinance's two endpoints of contract 07, for tests and screenshots only.

It speaks version 2 of the contract: `GET /api/ehire/cost-centres` (`as_of`, `items[]` with `code`, `name`,
`entity_code`, `active`) and `GET /api/ehire/budget?cost_centre=&year=` (`cost_centre`, `entity_code`, `year`,
`level`, `lines[]` with `budget_code`, `description`, `payroll`, `budget`, `spent`, `open_requisitions`, `available`,
`budget_updated_at`, `spent_covers`), with a bearer token, on 127.0.0.1.

Switches (attribute `mode`, consumed on every call until changed): an int status (401, 404, 500...), "timeout"
(sleeps past the client's limit), "redirect", "bad_json", "huge" (a body over the size cap). `cost_centres` and
`budgets` hold the data; `spelling = "cost_centres"` answers the list under `cost_centres` with `name_el` (the other
spelling eHire accepts); `honour_payroll` makes `payroll=1` return salary lines only (eFinance may or may not);
`etag` turns ETag / If-None-Match on. Every call is recorded in `calls`; with `fail_if_called` set, a call is
recorded in `forbidden` and answered 500, so a test can prove that nothing called it.

Run on its own it serves invented sample data for the screenshots:
`python -m tests.efinance.fake_efinance PORT [--scenario=sample|none_loaded|unavailable] [CODE...]`.
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


COVERS = "efinance_invoices_only"


def cc(code, name, entity, active=True, name_en=None):
    """A cost-centre row as eFinance sends it (`name` is the Greek name; `name_en` only when given)."""
    row = {"code": code, "name": name, "entity_code": entity, "active": active}
    if name_en is not None:
        row["name_en"] = name_en
    return row


def line(code, description, budget, spent="0.00", open_requisitions="0.00", available=None, payroll=True,
         updated="2026-11-20T08:00:00Z", covers=COVERS):
    """A budget line as eFinance sends it. `budget` None: no budget loaded (then `available` is None too). Amounts may
    be numbers or decimal strings, as in eFinance's answers."""
    if available is None and budget is not None:
        available = budget
    return {"budget_code": code, "description": description, "payroll": payroll, "budget": budget, "spent": spent,
            "open_requisitions": open_requisitions, "available": available,
            "budget_updated_at": updated if budget is not None else None, "spent_covers": covers}


class FakeEFinance:
    def __init__(self, token=TOKEN):
        self.token = token
        self.cost_centres = []
        self.budgets = {}  # (code, year) -> [line]
        self.as_of = "2026-11-23T06:30:00Z"
        self.spelling = "items"  # or "cost_centres" (with name_el)
        self.honour_payroll = False
        self.level = "entity"
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
                if parts.path == "/api/ehire/cost-centres":
                    return self._cost_centres()
                if parts.path == "/api/ehire/budget":
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
                if fake.spelling == "cost_centres":
                    rows = [dict({k: v for k, v in r.items() if k != "name"}, name_el=r.get("name"))
                            if "name" in r else r for r in fake.cost_centres]
                    return self._json({"as_of": fake.as_of, "cost_centres": rows}, headers)
                self._json({"as_of": fake.as_of, "items": fake.cost_centres}, headers)

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
                if fake.honour_payroll and query.get("payroll") == "1":
                    lines = [l for l in lines if l.get("payroll")]
                entity = next((c["entity_code"] for c in fake.cost_centres if c["code"] == code), None)
                self._json({"cost_centre": code, "entity_code": entity, "year": year, "level": fake.level,
                            "lines": lines})

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


def _this_year():
    from datetime import datetime, timedelta, timezone

    return (datetime.now(timezone.utc) + timedelta(hours=2)).year  # Cyprus time, near enough for invented data


SAMPLE_LINES = [line("2102", "BASIC PAY", "4250000.00"), line("2103", "13TH SALARY", None),
                line("2105", "COST OF LIVING ALLOW", 310000), line("2121", "OVERTIME", None),
                line("2401", "SOCIAL INS.FUND-8.3%", "352750.00"),
                line("3003", "SUBSISTENCE ALLOWANCE", "12000.00", payroll=False)]  # not a salary line: ignored


def sample(fake, year=None, scenario="sample"):
    """Invented data for the screenshots: the demo cost centres, and salary lines of which some have a budget loaded
    (`sample`), none has (`none_loaded`), or every call fails (`unavailable`). No real figures."""
    year = year or _this_year()
    fake.cost_centres = [cc("CC-100", "Παθολογική Κλινική", "NGH"), cc("CC-200", "Χειρουργική Κλινική", "NGH"),
                         cc("CC-300", "Διοίκηση", "NGH"), cc("CC-400", "Ακτινολογικό", "LGH")]
    lines = SAMPLE_LINES
    if scenario == "none_loaded":
        lines = [line(l["budget_code"], l["description"], None, payroll=l["payroll"]) for l in SAMPLE_LINES]
    fake.budgets = {("CC-100", year): list(lines), ("CC-200", year): list(lines[:1]), ("CC-300", year): []}
    if scenario == "unavailable":
        fake.mode = 503
    return fake


if __name__ == "__main__":  # python -m tests.efinance.fake_efinance PORT [--scenario=NAME] [CODE...]: for screenshots
    port = int(sys.argv[1])
    args = sys.argv[2:]
    scenario = next((a.split("=", 1)[1] for a in args if a.startswith("--scenario=")), "sample")
    fake = sample(FakeEFinance(), scenario=scenario)
    for code in (a for a in args if not a.startswith("--")):  # cost centres of a seeded database: sample lines each
        fake.cost_centres.append(cc(code, "Κέντρο κόστους " + code, "NGH"))
        fake.budgets[(code, _this_year())] = fake.budgets[("CC-100", _this_year())]
    fake.start(port)
    print("fake eFinance on %s, token %s, scenario %s" % (fake.url, fake.token, scenario), flush=True)
    while True:
        time.sleep(3600)
