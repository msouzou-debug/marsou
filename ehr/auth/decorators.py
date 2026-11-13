from functools import wraps
from urllib.parse import urlparse

from flask import abort, redirect, request, url_for

from .current import current_user


def safe_next(target, default=None):
    """Return target only when it is a path inside this app. Reject absolute and scheme-relative URLs."""
    if not target or not isinstance(target, str):
        return default
    if any(ord(c) < 32 for c in target) or "\\" in target:
        return default
    parts = urlparse(target)
    if parts.scheme or parts.netloc or not target.startswith("/") or target.startswith("//"):
        return default
    return target


def login_required(view):
    @wraps(view)
    def wrapper(*args, **kwargs):
        if current_user() is None:
            nxt = request.full_path.rstrip("?") if request.method == "GET" else None
            return redirect(url_for("auth.login", next=nxt) if nxt else url_for("auth.login"))
        return view(*args, **kwargs)

    return wrapper


def permission_required(key):
    """Signed in and holding the permission. Without it the page answers 404, like an unknown page."""

    def deco(view):
        @wraps(view)
        @login_required
        def wrapper(*args, **kwargs):
            if not current_user().has_permission(key):
                abort(404)
            return view(*args, **kwargs)

        return wrapper

    return deco
