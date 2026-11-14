"""Reads OAY activity totals from eFinance (proposal: docs/contracts/05-efinance-activity-link.md).

Standard library only. One GET over HTTPS with a bearer token, a 5 second limit, no redirects, a capped
response and strict checks on every value. Only a facility code and an OAY specialty name leave this server.
The token is read from the configuration (environment) and never written to a log, the database or a page.
"""
import json
import logging
import re
import socket
import ssl
import time
import urllib.error
import urllib.parse
import urllib.request
from decimal import Decimal, InvalidOperation

log = logging.getLogger("ehr.activity")

MAX_BYTES = 64 * 1024
MAX_COUNT = 100_000_000
MAX_REVENUE = Decimal("9999999999.99")
_MONTH = re.compile(r"^(\d{4})-(0[1-9]|1[0-2])$")
_LOOPBACK = ("127.0.0.1", "localhost", "::1")


class Unavailable(Exception):
    """The answer can't be used. `reason` is a short code that is safe to log and store."""

    def __init__(self, reason):
        super().__init__(reason)
        self.reason = reason


class NoData(Exception):
    pass


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        return None  # a 3xx comes back as an HTTPError and counts as unavailable


def _whole(value):
    if isinstance(value, bool) or not isinstance(value, int) or not 0 <= value <= MAX_COUNT:
        raise Unavailable("bad_value")
    return value


def _money(value):
    if isinstance(value, bool) or not isinstance(value, (int, float, str)):
        raise Unavailable("bad_value")
    try:
        number = Decimal(str(value).strip())
    except InvalidOperation:
        raise Unavailable("bad_value")
    if not number.is_finite() or number < 0 or number > MAX_REVENUE:
        raise Unavailable("bad_value")
    return number.quantize(Decimal("0.01"))


def _period(block):
    if not isinstance(block, dict):
        raise Unavailable("bad_value")
    year = block.get("year")
    if isinstance(year, bool) or not isinstance(year, int) or not 2000 <= year <= 2100:
        raise Unavailable("bad_value")
    return {"year": year, "visits": _whole(block.get("visits")), "procedures": _whole(block.get("procedures")),
            "revenue": _money(block.get("revenue"))}


def validate(body, facility_code, specialty):
    """The decoded JSON -> {'data_month', 'prev_year', 'ytd'} with Decimals, or raise NoData or Unavailable."""
    if not isinstance(body, dict):
        raise Unavailable("bad_json")
    if body.get("prev_year") in (None, {}) or body.get("ytd") in (None, {}):
        raise NoData()
    if body.get("facility_code") != facility_code or body.get("specialty") != specialty:
        raise Unavailable("mismatch")
    month = body.get("data_month")
    match = _MONTH.match(month) if isinstance(month, str) else None
    if not match:
        raise Unavailable("bad_value")
    prev, ytd = _period(body["prev_year"]), _period(body["ytd"])
    if ytd["year"] != int(match.group(1)) or prev["year"] != ytd["year"] - 1:
        raise Unavailable("bad_value")
    return {"data_month": month, "prev_year": prev, "ytd": ytd}


def _read(response, deadline):
    chunks, size = [], 0
    while True:
        if time.monotonic() > deadline:
            raise Unavailable("timeout")
        chunk = response.read(8192)
        if not chunk:
            break
        size += len(chunk)
        if size > MAX_BYTES:
            raise Unavailable("too_large")
        chunks.append(chunk)
    return b"".join(chunks)


class EFinanceClient:
    def __init__(self, base_url, token, timeout=5, ca_file=""):
        self.base_url = (base_url or "").strip().rstrip("/")
        self.token = (token or "").strip()
        self.timeout = timeout
        self.ca_file = ca_file or ""

    def configured(self):
        if not (self.base_url and self.token):
            return False
        parts = urllib.parse.urlsplit(self.base_url)
        if parts.scheme == "https" and parts.hostname:
            return True
        return parts.scheme == "http" and parts.hostname in _LOOPBACK  # plain HTTP only for a local test server

    def _opener(self):
        handlers = [_NoRedirect()]
        if self.base_url.startswith("https"):
            context = ssl.create_default_context(cafile=self.ca_file or None)  # verification stays on
            handlers.append(urllib.request.HTTPSHandler(context=context))
        return urllib.request.build_opener(*handlers)

    def fetch_one(self, facility_code, specialty):
        """Validated figures for one specialty name. Raises NoData or Unavailable."""
        query = urllib.parse.urlencode({"facility_code": facility_code, "specialty": specialty})
        req = urllib.request.Request(self.base_url + "/api/oay-activity?" + query, method="GET", headers={
            "Authorization": "Bearer " + self.token, "Accept": "application/json"})
        deadline = time.monotonic() + self.timeout
        try:
            with self._opener().open(req, timeout=self.timeout) as response:
                raw = _read(response, deadline)
        except urllib.error.HTTPError as exc:
            if exc.code == 404:
                raise NoData()
            raise Unavailable("http_%d" % exc.code)
        except (socket.timeout, TimeoutError):
            raise Unavailable("timeout")
        except urllib.error.URLError as exc:
            if isinstance(exc.reason, (socket.timeout, TimeoutError)):
                raise Unavailable("timeout")
            raise Unavailable("network")
        except (OSError, ssl.SSLError, ValueError):
            raise Unavailable("network")
        try:
            body = json.loads(raw.decode("utf-8"))
        except (ValueError, UnicodeDecodeError):
            raise Unavailable("bad_json")
        return validate(body, facility_code, specialty)

    def fetch(self, facility_code, names):
        """Try each specialty name in order until one has data.

        Returns ('figures', figures, matched_name) | ('no_data', None, None) | ('unavailable', reason, None).
        """
        for name in names:
            try:
                return "figures", self.fetch_one(facility_code, name), name
            except NoData:
                continue
            except Unavailable as exc:
                log.warning("eFinance activity link unavailable: %s", exc.reason)
                return "unavailable", exc.reason, None
        return "no_data", None, None
