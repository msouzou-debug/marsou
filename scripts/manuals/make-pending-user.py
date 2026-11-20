"""Adds one invented Active Directory user who signed in once and waits for activation, so the Users page shows the
waiting count in the screenshots. Demo database only: run by take-screenshots.sh after seed-demo."""
import sys

sys.path.insert(0, ".")
from wsgi import app  # noqa: E402

from ehire.extensions import db  # noqa: E402
from ehire.models import User  # noqa: E402

with app.app_context():
    if User.query.filter_by(username="ad.newcomer").first() is None:
        db.session.add(User(username="ad.newcomer", full_name="Νέος Χρήστης AD (δείγμα)", auth_source="ad",
                            password_hash=None, must_change_password=False, is_active=False, language="el"))
        db.session.commit()
