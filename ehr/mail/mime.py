"""The MIME message for one email: text/plain and text/html as alternatives, the logo inline next to the HTML.

Structure: multipart/alternative [ text/plain, multipart/related [ text/html, image/png <okypylogo> ] ].
The outbox stores subject, html and text only; the logo is attached here, at send time.
"""
from email.message import EmailMessage

from .layout import LOGO_CID, LOGO_FILE


def logo_bytes():
    return LOGO_FILE.read_bytes()


def build_message(sender, to, subject, html, text):
    msg = EmailMessage()
    if sender:
        msg["From"] = sender
    msg["To"] = to
    msg["Subject"] = subject
    msg.set_content(text)
    msg.add_alternative(html, subtype="html")
    if ("cid:" + LOGO_CID) in html:
        msg.get_payload()[1].add_related(logo_bytes(), "image", "png", cid="<%s>" % LOGO_CID,
                                         disposition="inline", filename=LOGO_FILE.name)
    return msg
