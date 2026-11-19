"""Flash messages that carry a string key and parameters. base.html translates them when the page is drawn,
so the text follows the language of the person who sees it."""
from flask import flash


def flash_key(key, category="info", **params):
    """Queue a message. Plain `flash("key", category)` keeps working for messages without parameters."""
    flash({"key": key, "params": params}, category)
