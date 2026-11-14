"""Active Directory sign-in over LDAPS.

How it works (follows eFinance, with a stricter transport):
- The user's own credentials bind as `<username>@<domain>`. There is no service account.
- The typed name must be a bare sAMAccountName. "@", "\\" and anything outside a conservative set are refused
  before the network is touched. An empty password is refused too: an empty-password simple bind is an anonymous
  bind and "succeeds".
- LDAPS only, the server certificate is checked against the organisation's CA file. No StartTLS, no plain LDAP
  (plain is possible only when EHR_AD_USE_SSL is off, which production refuses).
- After the bind, when a base DN is set, one search on the same connection reads the display name and the email.

The web code talks to a `Directory` (anything with `lookup(username, password) -> AdResult`), so tests inject a
fake. Passwords and bind strings with passwords are never logged or stored here.
"""
import re
import ssl
from dataclasses import dataclass
from typing import Optional

from flask import current_app

# Failure classes. The web page shows one generic message for all of them; `flask ad-test` prints the class.
CONNECT = "cannot_connect"
CERTIFICATE = "certificate_not_trusted"
CREDENTIALS = "wrong_credentials"
NOT_FOUND = "user_not_found_in_base_dn"
CONFIG = "configuration"
REFUSED = "username_or_password_refused"
FAILURE_TEXT = {
    CONNECT: "cannot connect to the directory server",
    CERTIFICATE: "the server certificate is not trusted (check EHR_AD_CA_FILE and the server name)",
    CREDENTIALS: "wrong credentials",
    NOT_FOUND: "signed in, but the user was not found under the base DN",
    CONFIG: "the Active Directory settings are incomplete or unreadable",
    REFUSED: "the username or password was refused before any network call",
}

_USERNAME = re.compile(r"^[a-z0-9][a-z0-9._-]{0,63}$")
_ATTRIBUTE = re.compile(r"^[A-Za-z][A-Za-z0-9-]{0,63}$")


@dataclass
class AdResult:
    ok: bool
    failure: Optional[str] = None
    full_name: Optional[str] = None
    email: Optional[str] = None
    looked_up: bool = False  # True when a base DN search ran, so empty name or email values are real


def normalise_username(typed):
    """The bare, lowercased sAMAccountName, or None when the text is not one."""
    if not isinstance(typed, str):
        return None
    name = typed.strip().lower()
    return name if _USERNAME.match(name) else None


def enabled():
    return bool(current_app.config.get("EHR_AD_ENABLED"))


def get_directory():
    """The directory for this app. Tests put a fake in `app.extensions['ehr_ad']`."""
    fake = current_app.extensions.get("ehr_ad")
    return fake if fake is not None else LdapDirectory.from_config(current_app.config)


def authenticate(username, password, directory=None):
    """Check the credentials against AD. Never raises for a bad user or a down server: returns AdResult."""
    name = normalise_username(username)
    if name is None or not isinstance(password, str) or password == "":
        return AdResult(False, REFUSED)
    try:
        return (directory or get_directory()).lookup(name, password)
    except Exception as err:  # a directory bug must not become a 500 on the sign-in page
        current_app.logger.warning("AD sign-in: unexpected %s", type(err).__name__)
        return AdResult(False, CONNECT)


class LdapDirectory:
    """The real directory, through ldap3. `server` and `strategy` exist so tests can use ldap3's offline mock."""

    def __init__(self, host, port, domain, base_dn, uid_attribute, ca_file, timeout, use_ssl=True,
                 server=None, strategy=None):
        self.host, self.port, self.domain = host, port, domain
        self.base_dn, self.uid_attribute = base_dn, uid_attribute
        self.ca_file, self.timeout, self.use_ssl = ca_file, timeout, use_ssl
        self._server, self._strategy = server, strategy

    @classmethod
    def from_config(cls, cfg):
        return cls(cfg.get("EHR_AD_SERVER"), cfg.get("EHR_AD_PORT", 636), cfg.get("EHR_AD_DOMAIN"),
                   cfg.get("EHR_AD_BASE_DN"), cfg.get("EHR_AD_UID_ATTRIBUTE") or "sAMAccountName",
                   cfg.get("EHR_AD_CA_FILE"), cfg.get("EHR_AD_TIMEOUT", 5), cfg.get("EHR_AD_USE_SSL", True))

    def _make_server(self):
        from ldap3 import NONE, Server, Tls

        if self._server is not None:
            return self._server
        tls = Tls(validate=ssl.CERT_REQUIRED, ca_certs_file=self.ca_file) if self.use_ssl else None
        return Server(self.host, port=int(self.port), use_ssl=self.use_ssl, tls=tls, get_info=NONE,
                      connect_timeout=self.timeout)

    def lookup(self, username, password):
        from ldap3 import SIMPLE, SUBTREE, Connection
        from ldap3.core.exceptions import LDAPException
        from ldap3.utils.conv import escape_filter_chars

        if username != normalise_username(username) or not password:  # callers check first; this is the last guard
            return AdResult(False, REFUSED)
        if not self.host or not self.domain or not _ATTRIBUTE.match(self.uid_attribute or ""):
            return AdResult(False, CONFIG)
        if self.use_ssl and self._server is None and not (self.ca_file and _readable(self.ca_file)):
            return AdResult(False, CONFIG)
        conn = None
        try:
            server = self._make_server()
            extra = {"client_strategy": self._strategy} if self._strategy else {}
            conn = Connection(server, user="%s@%s" % (username, self.domain), password=password,
                              authentication=SIMPLE, auto_bind=False, receive_timeout=self.timeout, **extra)
            if not conn.bind():
                return AdResult(False, _bind_failure(conn))
            if not self.base_dn:
                return AdResult(True)
            conn.search(self.base_dn, "(%s=%s)" % (self.uid_attribute, escape_filter_chars(username)),
                        search_scope=SUBTREE, attributes=["displayName", "givenName", "sn", "mail"], size_limit=2)
            entries = [e for e in (conn.response or []) if e.get("type") == "searchResEntry"]
            if len(entries) != 1:  # none, or ambiguous: either way this directory does not describe one user
                return AdResult(False, NOT_FOUND)
            attrs = entries[0].get("attributes") or {}
            name = _first(attrs, "displayName") or " ".join(
                p for p in (_first(attrs, "givenName"), _first(attrs, "sn")) if p) or username
            return AdResult(True, full_name=name[:200], email=(_first(attrs, "mail") or None), looked_up=True)
        except LDAPException as err:
            return AdResult(False, _classify(err))
        except (OSError, ssl.SSLError) as err:
            return AdResult(False, _classify(err))
        finally:
            if conn is not None:
                try:
                    conn.unbind()
                except Exception:  # noqa: BLE001 closing a dead connection may fail; nothing to do about it
                    pass


def _readable(path):
    try:
        with open(path, "rb"):
            return True
    except OSError:
        return False


def _first(attrs, key):
    value = attrs.get(key)
    if isinstance(value, (list, tuple)):
        value = value[0] if value else None
    value = (str(value).strip() if value is not None else "")
    return value or None


def _bind_failure(conn):
    description = str((conn.result or {}).get("description") or "")
    return CREDENTIALS if description in ("invalidCredentials", "") else (
        CREDENTIALS if "credential" in description.lower() else CONNECT)


def _classify(err):
    text = ("%s %s" % (type(err).__name__, err)).lower()
    if "certificate" in text or "cert_verify" in text or "ssl" in text and "verify" in text:
        return CERTIFICATE
    if "configuration" in type(err).__name__.lower():
        return CONFIG
    return CONNECT
