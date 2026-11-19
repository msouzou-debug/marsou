"""`flask send-archive` (cron) and `flask archive-transport`."""
import click
from flask import current_app
from flask.cli import with_appcontext

from ..extensions import db
from ..models import ArchiveDeposit, Facility, Setting, audit
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
            check_url(current_app.config.get("EHIRE_ARCHIVE_URL"))
        except ArchiveError as exc:
            raise click.ClickException(str(exc))
        if not (current_app.config.get("EHIRE_ARCHIVE_TOKEN") or "").strip():
            click.echo("Note: EHIRE_ARCHIVE_TOKEN is not set, so nothing is sent until it is.", err=True)
    row = db.session.get(Setting, "archive_transport")
    if row is None:
        row = Setting(key="archive_transport")
        db.session.add(row)
    row.value, row.updated_at = name, utcnow()
    audit("setting_changed", object_type="setting", object_id="archive_transport",
          detail={"before": before, "after": name})
    db.session.commit()
    click.echo("archive_transport=%s" % name)


@click.command("archive-sites")
@with_appcontext
def archive_sites_command():
    """List every active facility with its Directorate and its eArchive site code (or "none"), and how many have none.
    Send the facilities without a code to eArchive so a code can be added. No request data is printed."""
    rows = (Facility.query.filter_by(is_active=True).order_by(Facility.directorate_id, Facility.code).all())
    table = [(f.code, f.name_en or f.name_el, f.directorate.name_en if f.directorate else "",
              (f.archive_site_code or "").strip() or "none") for f in rows]
    header = ("Facility code", "Facility", "Directorate", "eArchive site code")
    widths = [max(len(str(r[i])) for r in [header] + table) for i in range(4)]
    for r in [header] + table:
        click.echo("  ".join(str(c).ljust(w) for c, w in zip(r, widths)).rstrip())
    click.echo("")
    click.echo("Facilities without a code: %d of %d" % (sum(1 for r in table if r[3] == "none"), len(table)))


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


SAMPLES = (  # folder name, which deposit, how many attachments to add (the demo requests carry none)
    ("1-submitted", 0), ("2-approved-with-attachments-submitted", 2), ("3-approved-with-attachments-decided", 2),
    ("4-rejected-submitted", 0), ("5-rejected-decided", 0), ("6-many-attachments-zip", 25))


def _pick_samples(rows):
    """Six deposits from the seeded demo requests. The decided deposits of an approved and a rejected request come with
    the submitted ones they supersede, so eArchive sees complete chains. Sample 1 is a request still in progress and
    sample 6 a third request; no request is used twice."""
    from ..models import Request
    from . import pdf

    def status(d):
        return pdf._as_of(d).get("status")

    def by(kind, test, skip=()):
        return next((d for d in rows if d.kind == kind and test(d) and d.request_id not in skip), None)

    def twin(decided):
        return next((d for d in rows if d.request_id == decided.request_id and d.kind == "submitted"), None)

    approved = by("decided", lambda d: status(d) == "approved" and twin(d) is not None)
    rejected = by("decided", lambda d: status(d) == "rejected" and twin(d) is not None)
    used = {d.request_id for d in (approved, rejected) if d is not None}
    pending = by("submitted", lambda d: db.session.get(Request, d.request_id).status == "in_progress", skip=used)
    used |= {pending.request_id} if pending is not None else set()
    many = by("submitted", lambda d: True, skip=used)
    found = (pending, twin(approved) if approved else None, approved, twin(rejected) if rejected else None, rejected, many)
    for (name, _), row in zip(SAMPLES, found):
        if row is None:
            raise click.ClickException("No demo request fits %r. Run `flask seed-demo` and `flask seed-cases` first." % name)
    return found


@click.command("archive-samples")
@click.argument("directory", type=click.Path(file_okay=False))
@with_appcontext
def archive_samples_command(directory):
    """Write six sample deposits for eArchive's own test: a submitted request; an approved one with attachments as its
    submitted and its decided deposit; a rejected one as submitted and decided; and one with 25 attachments in a zip.
    The folders are numbered in the order to send them, so every decided deposit follows the one it supersedes.

    Built from the invented demo requests only (run seed-demo and seed-cases first). Each folder holds meta.json as
    it would be sent, the files under the names in meta.json, and curl-example.txt with a placeholder for the token.
    Refused in production."""
    import hashlib
    import json
    import os
    import tempfile

    from ..models import AuditLog
    from . import bundle
    from . import meta as meta_mod
    from . import pdf
    from .transports import INGEST_PATH, DEFAULT_URL, DepositFile

    if current_app.config.get("EHIRE_ENV") == "production":
        raise click.ClickException("Sample deposits are made from demo data only (refused when EHIRE_ENV=production).")
    seeded = {r.request_id for r in AuditLog.query.filter_by(event="seed_case")}
    rows = [d for d in ArchiveDeposit.query.order_by(ArchiveDeposit.id) if d.request_id in seeded]
    picked = [(name, row, count) for (name, count), row in zip(SAMPLES, _pick_samples(rows))]
    os.makedirs(directory, exist_ok=True)
    for name, row, count in picked:
        if os.path.exists(os.path.join(directory, name)):
            raise click.ClickException("%s already exists; give an empty folder." % os.path.join(directory, name))
    for name, row, count in picked:
        out = os.path.join(directory, name)
        os.makedirs(out)
        prepared = pdf.prepare(row)
        with tempfile.TemporaryDirectory(prefix="ehire-sample-") as work:
            attachments = []  # (manifest entry, bytes, path)
            for i in range(1, count + 1):
                file_name, lines = SAMPLE_ATTACHMENTS[i - 1] if count == 2 else (
                    "attachment-%02d.pdf" % i, ["Sample attachment %02d" % i, "Invented text for a test deposit."])
                data = _tiny_pdf(lines)
                path = os.path.join(work, "%02d-%s" % (i, file_name))
                with open(path, "wb") as fh:
                    fh.write(data)
                entry = {"role": "document", "document_id": None, "stored_as": "%02d-%s" % (i, file_name),
                         "name": file_name, "mime": "application/pdf", "size": len(data),
                         "sha256": hashlib.sha256(data).hexdigest(), "round": 1, "uploaded_by": "",
                         "uploaded_at": None, "path": path}
                attachments.append((entry, data, path))
                prepared["documents"].append(entry)
                prepared["context"]["documents"].append({"name": file_name, "size": "%d B" % len(data), "round": "",
                                                         "who": "", "when": "", "sha256": entry["sha256"]})
            main_data = pdf.convert(pdf.render_html(prepared["context"]))
            manifest = pdf.final_manifest(prepared, hashlib.sha256(main_data).hexdigest(), len(main_data))
            blobs = [main_data] + [d for _, d, _ in attachments]
            if bundle.needs_zip(manifest):
                pairs = [(e, DepositFile(e["stored_as"], e["name"], e["mime"], e["size"], e["sha256"], p))
                         for e, _, p in attachments]
                zips = bundle.build_zips(pairs, work, "sample")
                blobs = [main_data]
                for _, dep in zips:
                    with open(dep.path, "rb") as fh:
                        blobs.append(fh.read())
                manifest["files"] = [manifest["files"][0]] + [e for e, _ in zips]
            meta = meta_mod.build(row, manifest)
        for entry, blob in zip(meta["files"], blobs):  # files carry the names meta.json gives them
            with open(os.path.join(out, entry["filename"]), "wb") as fh:
                fh.write(blob)
        with open(os.path.join(out, "meta.json"), "wb") as fh:
            fh.write(json.dumps(meta, ensure_ascii=False, sort_keys=True).encode("utf-8"))
        lines = ["# Sample deposit '%s' (invented data). Run from this folder against a TEST eArchive." % name,
                 "# Replace <EHR_INGEST_TOKEN> with the token. The same Idempotency-Key and content replay the receipt;",
                 "# eArchive files each source_ref once: send a sample to a test instance, not twice to the real one.",
                 "curl -sS -X POST %s%s \\" % (DEFAULT_URL, INGEST_PATH),
                 "  -H 'Authorization: Bearer <EHR_INGEST_TOKEN>' \\",
                 "  -H 'Idempotency-Key: ehire:%s' \\" % row.id,
                 "  -F 'meta=<meta.json' \\"]
        for entry in meta["files"]:
            lines.append("  -F '%s=@%s;type=%s' \\" % (entry["part_name"], entry["filename"], entry["mime"]))
        lines[-1] = lines[-1].rstrip(" \\")
        with open(os.path.join(out, "curl-example.txt"), "w", encoding="utf-8") as fh:
            fh.write("\n".join(lines) + "\n")
        click.echo("%s: %d file(s), source_ref %s" % (name, len(meta["files"]), meta["source_ref"]))


def register(app):
    app.cli.add_command(send_archive_command)
    app.cli.add_command(archive_transport_command)
    app.cli.add_command(archive_sites_command)
    app.cli.add_command(archive_samples_command)
