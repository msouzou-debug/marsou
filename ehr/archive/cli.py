"""`flask send-archive` (cron) and `flask archive-transport`."""
import click
from flask import current_app
from flask.cli import with_appcontext

from ..extensions import db
from ..models import Setting, audit
from ..models.access import utcnow
from .queue import flush
from .transports import NAMES, ArchiveError, check_url, transport_name


@click.command("send-archive")
@click.option("--limit", default=50, show_default=True, help="Most deposits to try in one run.")
@with_appcontext
def send_archive_command(limit):
    """Make the PDFs of queued deposits and hand them to the archive transport. A deposit eArchive cannot take yet
    waits and is tried again with growing gaps; a refused one is blocked until an administrator retries it."""
    counts = flush(limit=limit)
    click.echo("rendered=%(rendered)d stored=%(stored)d failed=%(failed)d waiting=%(waiting)d" % counts)


@click.command("archive-transport")
@click.argument("name", required=False, type=click.Choice(NAMES))
@with_appcontext
def archive_transport_command(name):
    """Show the archive transport, or set it: none (default, sends nothing), folder or http."""
    before = transport_name()
    if name is None or name == before:
        click.echo("archive_transport=%s" % before)
        return
    if name == "http":
        try:
            check_url(current_app.config.get("EHR_ARCHIVE_URL"))
        except ArchiveError as exc:
            raise click.ClickException(str(exc))
        if not (current_app.config.get("EHR_ARCHIVE_TOKEN") or "").strip():
            click.echo("Note: EHR_ARCHIVE_TOKEN is not set, so nothing is sent until it is.", err=True)
    row = db.session.get(Setting, "archive_transport")
    if row is None:
        row = Setting(key="archive_transport")
        db.session.add(row)
    row.value, row.updated_at = name, utcnow()
    audit("setting_changed", object_type="setting", object_id="archive_transport",
          detail={"before": before, "after": name})
    db.session.commit()
    click.echo("archive_transport=%s" % name)


SAMPLE_ATTACHMENTS = (("job-description.pdf", ["Sample job description", "Invented text for a test deposit."]),
                      ("rota-2026.pdf", ["Sample ward rota 2026", "Invented text for a test deposit."]))


def _tiny_pdf(lines):
    """A one-page PDF with a few ASCII lines. Hand-built so the samples need nothing but the standard library."""
    text = "BT /F1 12 Tf 72 760 Td 16 TL " + " ".join("(%s) Tj T*" % l.replace("(", "").replace(")", "") for l in lines) + " ET"
    objects = ["<< /Type /Catalog /Pages 2 0 R >>", "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
               "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R "
               "/Resources << /Font << /F1 5 0 R >> >> >>",
               "<< /Length %d >>\nstream\n%s\nendstream" % (len(text), text),
               "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>"]
    out, offsets = b"%PDF-1.4\n", []
    for i, body in enumerate(objects, 1):
        offsets.append(len(out))
        out += ("%d 0 obj\n%s\nendobj\n" % (i, body)).encode("ascii")
    xref = len(out)
    out += ("xref\n0 %d\n0000000000 65535 f \n" % (len(objects) + 1)).encode("ascii")
    out += "".join("%010d 00000 n \n" % o for o in offsets).encode("ascii")
    out += ("trailer\n<< /Size %d /Root 1 0 R >>\nstartxref\n%d\n%%%%EOF\n" % (len(objects) + 1, xref)).encode("ascii")
    return out


@click.command("archive-samples")
@click.argument("directory", type=click.Path(file_okay=False))
@with_appcontext
def archive_samples_command(directory):
    """Write three sample deposits (submitted, approved with attachments, rejected) for eArchive's own test.

    Built from the invented demo requests only (run seed-demo and seed-cases first). Each folder holds meta.json as
    it would be sent, the files, and curl-example.txt with a placeholder for the token. Refused in production."""
    import hashlib
    import json
    import os

    from .. import localtime
    from ..models import ArchiveDeposit, AuditLog
    from . import meta as meta_mod
    from . import pdf
    from .transports import INGEST_PATH, DEFAULT_URL, FILE_ROLE_FIELD

    if current_app.config.get("EHR_ENV") == "production":
        raise click.ClickException("Sample deposits are made from demo data only (refused when EHR_ENV=production).")
    seeded = {r.request_id for r in AuditLog.query.filter_by(event="seed_case")}
    rows = [d for d in ArchiveDeposit.query.order_by(ArchiveDeposit.id) if d.request_id in seeded]

    def status(d):
        return (pdf._as_of(d).get("status"))

    wanted = (("submitted", lambda d: d.kind == "submitted" and status(d) == "in_progress", False),
              ("approved-with-attachments", lambda d: d.kind == "decided" and status(d) == "approved", True),
              ("rejected", lambda d: d.kind == "decided" and status(d) == "rejected", False))
    picked = []
    for name, test, attach in wanted:
        row = next((d for d in rows if test(d)), None)
        if row is None:
            raise click.ClickException("No demo request fits %r. Run `flask seed-demo` and `flask seed-cases` first." % name)
        picked.append((name, row, attach))
    os.makedirs(directory, exist_ok=True)
    for name, row, attach in picked:
        if os.path.exists(os.path.join(directory, name)):
            raise click.ClickException("%s already exists; give an empty folder." % os.path.join(directory, name))
    for name, row, attach in picked:
        out = os.path.join(directory, name)
        os.makedirs(out)
        prepared = pdf.prepare(row)
        extra = []
        if attach:
            for i, (file_name, lines) in enumerate(SAMPLE_ATTACHMENTS, 1):
                data = _tiny_pdf(lines)
                with open(os.path.join(out, file_name), "wb") as fh:
                    fh.write(data)
                digest = hashlib.sha256(data).hexdigest()
                entry = {"role": "document", "document_id": None, "stored_as": "%02d-%s" % (i, file_name),
                         "name": file_name, "mime": "application/pdf", "size": len(data), "sha256": digest, "round": 1,
                         "uploaded_by": "", "uploaded_at": None, "path": os.path.join(out, file_name)}
                extra.append(entry)
                prepared["documents"].append(entry)
                prepared["context"]["documents"].append({"name": file_name, "size": "%d B" % len(data), "round": "",
                                                         "who": "", "when": "", "sha256": digest})
        data = pdf.convert(pdf.render_html(prepared["context"]))
        main_name = prepared["pdf_stored_as"]
        with open(os.path.join(out, main_name), "wb") as fh:
            fh.write(data)
        manifest = pdf.final_manifest(prepared, hashlib.sha256(data).hexdigest(), len(data))
        meta = meta_mod.build(row, manifest)
        with open(os.path.join(out, "meta.json"), "wb") as fh:
            fh.write(json.dumps(meta, ensure_ascii=False, sort_keys=True).encode("utf-8"))
        lines = ["# Sample deposit '%s' (invented data). Run from this folder against a TEST eArchive." % name,
                 "# Replace <EHR_INGEST_TOKEN> with the token. The same Idempotency-Key and content replay the receipt;",
                 "# eArchive files each source_ref once: send a sample to a test instance, not twice to the real one.",
                 "curl -sS -X POST %s%s \\" % (DEFAULT_URL, INGEST_PATH),
                 "  -H 'Authorization: Bearer <EHR_INGEST_TOKEN>' \\",
                 "  -H 'Idempotency-Key: ehr:%s' \\" % row.id,
                 "  -F 'meta=<meta.json' \\"]
        for entry in meta["files"]:
            local = entry["filename"]
            lines.append("  -F '%s=@%s;type=application/pdf' \\" % (entry["part_name"], local))
        lines[-1] = lines[-1].rstrip(" \\")
        with open(os.path.join(out, "curl-example.txt"), "w", encoding="utf-8") as fh:
            fh.write("\n".join(lines) + "\n")
        click.echo("%s: %d file(s), source_ref %s" % (name, len(meta["files"]), meta["source_ref"]))


def register(app):
    app.cli.add_command(send_archive_command)
    app.cli.add_command(archive_transport_command)
    app.cli.add_command(archive_samples_command)
