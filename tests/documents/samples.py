"""Small valid files built in code. Invented text only."""
import io
import struct
import zipfile
import zlib


def pdf_bytes(pages=2, texts=None):
    """A valid multi-page PDF with one line of text per page (Helvetica, no embedded font)."""
    texts = texts or ["Sample page %d" % (i + 1) for i in range(pages)]
    objs = {}
    n = len(texts)
    kids = " ".join("%d 0 R" % (4 + 2 * i) for i in range(n))
    objs[1] = "<< /Type /Catalog /Pages 2 0 R >>"
    objs[2] = "<< /Type /Pages /Kids [%s] /Count %d >>" % (kids, n)
    objs[3] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>"
    for i, text in enumerate(texts):
        page_id, content_id = 4 + 2 * i, 5 + 2 * i
        objs[page_id] = ("<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents %d 0 R "
                         "/Resources << /Font << /F1 3 0 R >> >> >>" % content_id)
        stream = "BT /F1 28 Tf 60 760 Td (%s) Tj ET\n0.1 0.45 0.73 rg 60 600 300 80 re f" % text
        objs[content_id] = "<< /Length %d >>\nstream\n%s\nendstream" % (len(stream), stream)
    out = io.BytesIO()
    out.write(b"%PDF-1.4\n")
    offsets = {}
    for num in sorted(objs):
        offsets[num] = out.tell()
        out.write(("%d 0 obj\n%s\nendobj\n" % (num, objs[num])).encode("latin-1"))
    xref = out.tell()
    out.write(("xref\n0 %d\n0000000000 65535 f \n" % (len(objs) + 1)).encode())
    for num in sorted(objs):
        out.write(("%010d 00000 n \n" % offsets[num]).encode())
    out.write(("trailer\n<< /Size %d /Root 1 0 R >>\nstartxref\n%d\n%%%%EOF\n" % (len(objs) + 1, xref)).encode())
    return out.getvalue()


def png_bytes(width=320, height=200):
    """A plain blue PNG with a lighter stripe."""
    rows = b""
    for y in range(height):
        row = b"".join((b"\x1b\x75\xbb" if 80 < y < 120 else b"\xdc\xe9\xf5") for _ in range(width))
        rows += b"\x00" + row

    def chunk(tag, data):
        body = tag + data
        return struct.pack(">I", len(data)) + body + struct.pack(">I", zlib.crc32(body) & 0xFFFFFFFF)

    return (b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0))
            + chunk(b"IDAT", zlib.compress(rows)) + chunk(b"IEND", b""))


def jpeg_bytes():
    """Only the signature and padding: enough for the type check, not a picture."""
    return b"\xff\xd8\xff\xe0\x00\x10JFIF\x00" + b"\x00" * 64 + b"\xff\xd9"


def _zip(entries):
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as zf:
        for name, data in entries.items():
            zf.writestr(name, data)
    return buf.getvalue()


def docx_bytes():
    return _zip({"[Content_Types].xml": "<Types/>", "word/document.xml": "<w:document/>"})


def xlsx_bytes():
    return _zip({"[Content_Types].xml": "<Types/>", "xl/workbook.xml": "<workbook/>"})


def doc_bytes():
    return b"\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1" + b"\x00" * 64 + "WordDocument".encode("utf-16-le") + b"\x00" * 64


def xls_bytes():
    return b"\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1" + b"\x00" * 64 + "Workbook".encode("utf-16-le") + b"\x00" * 64
