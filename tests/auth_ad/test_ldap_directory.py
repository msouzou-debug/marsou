"""The real LdapDirectory against ldap3's offline mock, plus real sockets for transport failures."""
import shutil
import socket
import ssl
import subprocess
import threading

import pytest
from ldap3 import MOCK_SYNC, Connection, Server

from ehr.auth import ad
from ehr.auth.ad import LdapDirectory

BASE = "dc=example,dc=test"


def mock_directory(**kw):
    server = Server("fake-dc")
    boot = Connection(server, client_strategy=MOCK_SYNC)
    add = boot.strategy.add_entry
    add("cn=Ann,%s" % BASE, {"sAMAccountName": "ann", "displayName": "Ann Directory", "mail": "ann@example.test", "objectClass": "person"})
    add("cn=Bob,%s" % BASE, {"sAMAccountName": "bob", "givenName": "Bob", "sn": "Builder", "objectClass": "person"})
    add("cn=Twin 1,%s" % BASE, {"sAMAccountName": "twin", "objectClass": "person"})
    add("cn=Twin 2,%s" % BASE, {"sAMAccountName": "twin", "objectClass": "person"})
    # simple binds as user@domain: the mock looks the bind name up in its tree, so give each its password
    for name, password in (("ann", "pw-ann"), ("bob", "pw-bob"), ("twin", "pw-twin"), ("ghost", "pw-ghost")):
        server.dit["%s@example.test" % name] = {"userPassword": [password.encode()]}
    params = dict(host="fake-dc", port=636, domain="example.test", base_dn=BASE, uid_attribute="sAMAccountName",
                  ca_file="", timeout=2, server=server, strategy=MOCK_SYNC)
    params.update(kw)
    return LdapDirectory(**params)


def test_success_reads_display_name_and_mail():
    r = mock_directory().lookup("ann", "pw-ann")
    assert (r.ok, r.full_name, r.email, r.looked_up) == (True, "Ann Directory", "ann@example.test", True)


def test_name_falls_back_to_given_name_and_surname_and_email_may_be_missing():
    r = mock_directory().lookup("bob", "pw-bob")
    assert r.ok and r.full_name == "Bob Builder" and r.email is None


def test_no_base_dn_means_no_lookup():
    r = mock_directory(base_dn="").lookup("ann", "pw-ann")
    assert r.ok and not r.looked_up and r.full_name is None


def test_wrong_password_and_unknown_user_are_wrong_credentials():
    d = mock_directory()
    assert d.lookup("ann", "nope").failure == ad.CREDENTIALS
    assert d.lookup("nobody", "pw").failure == ad.CREDENTIALS


def test_user_missing_from_the_base_dn_and_ambiguous_users_are_refused():
    d = mock_directory()
    assert d.lookup("ghost", "pw-ghost").failure == ad.NOT_FOUND  # binds, but is not under the base DN
    assert d.lookup("twin", "pw-twin").failure == ad.NOT_FOUND
    assert mock_directory(base_dn="dc=other,dc=test").lookup("ann", "pw-ann").failure == ad.NOT_FOUND


def test_the_name_is_escaped_in_the_search_filter(monkeypatch):
    """The name rule already keeps filter characters out. If it is ever loosened, the escaping still holds."""
    d = mock_directory()
    d._server.dit["*)(sAMAccountName=*@example.test"] = {"userPassword": [b"pw"]}
    monkeypatch.setattr(ad, "normalise_username", lambda value: value)
    assert d.lookup("*)(sAMAccountName=*", "pw").failure == ad.NOT_FOUND  # unescaped it would match every entry


def test_the_directory_itself_refuses_an_empty_password_and_odd_names():
    class Explodes:
        def __getattr__(self, name):
            raise AssertionError("the network was touched")

    d = mock_directory(server=Explodes())
    assert d.lookup("ann", "").failure == ad.REFUSED
    assert d.lookup("ann@example.test", "pw").failure == ad.REFUSED
    assert d.lookup("EXAMPLE\\ann", "pw").failure == ad.REFUSED


def test_missing_settings_and_a_missing_ca_file_are_configuration_errors(tmp_path):
    assert mock_directory(host="").lookup("ann", "pw-ann").failure == ad.CONFIG
    real = LdapDirectory("dc.example.test", 636, "example.test", BASE, "sAMAccountName", str(tmp_path / "none.pem"), 2)
    assert real.lookup("ann", "pw").failure == ad.CONFIG
    assert LdapDirectory("dc.example.test", 636, "example.test", BASE, "sAMAccountName", "", 2).lookup("ann", "pw").failure == ad.CONFIG
    assert mock_directory(uid_attribute="a)(b").lookup("ann", "pw-ann").failure == ad.CONFIG


# --------------------------------------------------------------------------------------- real sockets

def free_port():
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def test_a_closed_port_is_cannot_connect(tmp_path):
    ca = tmp_path / "ca.pem"
    ca.write_text("x")
    d = LdapDirectory("127.0.0.1", free_port(), "example.test", BASE, "sAMAccountName", str(ca), 2)
    assert d.lookup("ann", "pw").failure == ad.CONNECT


def make_cert(tmp_path, name):
    key, crt = tmp_path / (name + ".key"), tmp_path / (name + ".pem")
    subprocess.run(["openssl", "req", "-x509", "-newkey", "rsa:2048", "-nodes", "-keyout", str(key), "-out", str(crt),
                    "-days", "2", "-subj", "/CN=localhost", "-addext", "subjectAltName=DNS:localhost"],
                   check=True, capture_output=True)
    return key, crt


@pytest.mark.skipif(shutil.which("openssl") is None, reason="needs the openssl command to make test certificates")
def test_the_server_certificate_is_checked_against_the_ca_file(tmp_path):
    key, crt = make_cert(tmp_path, "server")
    _, other = make_cert(tmp_path, "other")
    ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
    ctx.load_cert_chain(str(crt), str(key))
    sock = socket.socket()
    sock.bind(("127.0.0.1", 0))
    sock.listen(5)
    port = sock.getsockname()[1]
    stop = threading.Event()

    def serve():
        sock.settimeout(0.3)
        while not stop.is_set():
            try:
                conn, _ = sock.accept()
            except OSError:
                continue
            try:
                ctx.wrap_socket(conn, server_side=True).close()  # handshake, then hang up: not an LDAP server
            except (ssl.SSLError, OSError):
                conn.close()

    t = threading.Thread(target=serve, daemon=True)
    t.start()
    try:
        untrusted = LdapDirectory("localhost", port, "example.test", BASE, "sAMAccountName", str(other), 3)
        assert untrusted.lookup("ann", "pw").failure == ad.CERTIFICATE
        trusted = LdapDirectory("localhost", port, "example.test", BASE, "sAMAccountName", str(crt), 3)
        assert trusted.lookup("ann", "pw").failure != ad.CERTIFICATE  # the handshake passed; the fake server is not LDAP
    finally:
        stop.set()
        t.join(2)
        sock.close()
