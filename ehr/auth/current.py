"""Signed-in user helpers."""
import secrets
import time

from flask import g, session

from ..extensions import db
from ..models import User


def current_user():
    """The signed-in User, or None. Cached for the request. Inactive users count as signed out."""
    if "_user" not in g:
        user = None
        uid = session.get("user_id")
        if uid:
            user = db.session.get(User, uid)
            if user is not None and not user.is_active:
                user = None
        g._user = user
    return g._user


def sign_in(user):
    """Start a fresh session: the old one (and its CSRF token) is discarded, so a session id planted before
    sign-in is worthless. `_born` and `_last` feed the lifetime checks in ehr/auth/lifetime.py."""
    lang = session.get("lang")
    session.clear()
    now = time.time()
    session["user_id"] = user.id
    session["lang"] = user.language or lang
    session["_sid"] = secrets.token_hex(16)
    session["_born"] = now
    session["_last"] = now
    session.permanent = True
    g._user = user


def sign_out():
    lang = session.get("lang")
    session.clear()
    if lang:
        session["lang"] = lang
    g._user = None
