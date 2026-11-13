"""Pages: viewer in both languages, form section, request page, static files."""
import json
import re
from pathlib import Path

import pytest

from ehr.models import RequestDocument
from tests.documents import samples
from tests.documents.dhelpers import draft, login_as, upload
from tests.requests.helpers import full_form

ROOT = Path(__file__).resolve().parents[2] / "ehr"
KEYS = json.loads((ROOT / "i18n/en.json").read_text(encoding="utf-8"))
USED = ["docs.title", "docs.view", "docs.add", "docs.choose", "docs.upload", "docs.remove", "docs.download",
        "docs.empty", "docs.allowed", "docs.count.one", "docs.count.many", "docs.added.one", "docs.added.many",
        "docs.removed", "docs.error.too_large", "docs.error.type", "docs.error.empty", "docs.error.locked",
        "docs.draft_first", "viewer.title", "viewer.back", "viewer.page", "viewer.prev", "viewer.next",
        "viewer.zoom_in", "viewer.zoom_out", "viewer.loading", "viewer.no_preview", "viewer.converted", "page.round"]
KNOWN_MISSING = set()  # keys the strings agent had not written yet; none now


def raw_keys(html):
    html = re.sub(r"(href|src|action|formaction|class|id|name|for|value|data-[\w-]+)=\"[^\"]*\"", "", html)
    return re.findall(r"(?<![\w/.-])(?:docs|viewer)\.[a-z_.]+[a-z]|(?<![\w/.-])page\.round", html)


def test_every_key_used_exists_in_both_languages():
    el = json.loads((ROOT / "i18n/el.json").read_text(encoding="utf-8"))
    missing = [k for k in USED if (k not in KEYS or k not in el) and k not in KNOWN_MISSING]
    assert missing == []


def make(client, name, content, submit=True):
    req = draft(client)
    upload(client, req.id, (name, content))
    doc = RequestDocument.query.filter_by(request_id=req.id).one()
    if submit:
        client.post("/requests/%d/edit" % req.id, data=full_form(intent="submit"))
    return req.id, doc.id


@pytest.mark.parametrize("lang", ["el", "en"])
@pytest.mark.parametrize("name,content,kind", [("a.pdf", samples.pdf_bytes(), "pdf"),
                                              ("b.png", samples.png_bytes(), "image")])
def test_viewer_renders_without_raw_keys(seeded, client, storage, lang, name, content, kind):
    rid, did = make(client, name, content)
    html = client.get("/requests/%d/documents/%d?lang=%s" % (rid, did, lang)).get_data(as_text=True)
    assert 'data-kind="%s"' % kind in html
    assert raw_keys(html) == []
    assert "/requests/%d?do=review" % rid in html  # back to the request, action card one tap away
    assert "file?download=1" in html
    assert "http://" not in html and "https://" not in html
    if lang == "en":
        assert 'aria-label="Zoom in"' in html and "Back to the request" in html
        assert ("Previous page" in html) == (kind == "pdf")


def test_viewer_has_the_text_fallback_without_script(seeded, client, storage):
    rid, did = make(client, "a.pdf", samples.pdf_bytes())
    html = client.get("/requests/%d/documents/%d?lang=en" % (rid, did)).get_data(as_text=True)
    assert 'id="ehr-v-fallback"' in html and "This file can" in html


def test_new_request_page_says_save_first(seeded, client, storage):
    login_as(client, "nic.requester")
    html = client.get("/requests/new?lang=en").get_data(as_text=True)
    assert "Save the request as a draft first" in html and 'type="file"' not in html


@pytest.mark.parametrize("lang", ["el", "en"])
def test_edit_page_has_picker_list_and_remove(seeded, client, storage, lang):
    req = draft(client)
    upload(client, req.id, ("a.pdf", samples.pdf_bytes()), ("b.png", samples.png_bytes()))
    html = client.get("/requests/%d/edit?lang=%s" % (req.id, lang)).get_data(as_text=True)
    assert raw_keys(html) == []
    assert 'type="file"' in html and "multiple" in html and "image/png" in html and "image/jpeg" in html
    assert html.count('form="ehr-docs-remove"') == 2
    assert 'id="ehr-docs-upload" method="post" enctype="multipart/form-data"' in html
    assert html.count('name="csrf_token"') >= 4
    # The two small forms sit outside the main form: forms can't be nested.
    main = html.split('id="ehr-request-form"', 1)[1].split("</form>", 1)[0]
    assert "<form" not in main
    assert "ehr-docs-input" in main and "a.pdf" in main


def test_request_page_lists_documents_with_count_and_round(seeded, client, storage):
    rid, did = make(client, "a.pdf", samples.pdf_bytes())
    login_as(client, "nic.accountant")
    html = client.get("/requests/%d?lang=en" % rid).get_data(as_text=True)
    assert "1 document" in html and "Round 1" in html and "a.pdf" in html
    assert "/documents/%d\"" % did in html and "download=1" in html
    assert "ehr-docs-remove" not in html and "Remove" not in html.split('id="sec-documents"')[1][:2500]
    assert raw_keys(html) == []


def test_module_script_is_served_with_a_javascript_type(seeded, client):
    for path in ("js/viewer.js", "vendor/pdfjs/pdf.min.mjs", "vendor/pdfjs/pdf.worker.min.mjs"):
        r = client.get("/static/" + path)
        assert r.status_code == 200 and "javascript" in r.headers["Content-Type"], path
        r.close()


def test_pdfjs_files_match_the_checksum_list():
    import hashlib
    sums = dict(reversed(line.split("  ", 1)) for line in
                (ROOT / "static/vendor/CHECKSUMS.sha256").read_text().splitlines() if line.strip())
    for rel in ("pdfjs/LICENSE", "pdfjs/pdf.min.mjs", "pdfjs/pdf.worker.min.mjs"):
        assert hashlib.sha256((ROOT / "static/vendor" / rel).read_bytes()).hexdigest() == sums[rel]


def test_own_scripts_and_styles_have_no_outside_urls():
    for path in [ROOT / "static/js/viewer.js", ROOT / "static/js/documents.js", ROOT / "static/css/documents.css"]:
        text = path.read_text(encoding="utf-8")
        assert "http://" not in text and "https://" not in text, path
