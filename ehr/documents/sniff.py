"""Magic-byte checks for the file types eHR accepts. The server decides the type: extension AND content must agree."""
import zipfile

OLE2 = b"\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1"
PNG = b"\x89PNG\r\n\x1a\n"
CHUNK = 1 << 20

# Allowed extension -> mime type served. Fixed here, never taken from the client.
MIME = {
    "pdf": "application/pdf",
    "doc": "application/msword",
    "docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "xls": "application/vnd.ms-excel",
    "xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "png": "image/png",
    "jpg": "image/jpeg",
    "jpeg": "image/jpeg",
}
OFFICE = ("doc", "docx", "xls", "xlsx")
IMAGES = ("png", "jpg", "jpeg")


def extension(name):
    name = (name or "").rsplit("/", 1)[-1].rsplit("\\", 1)[-1]
    return name.rsplit(".", 1)[-1].lower() if "." in name else ""


def _ole_has_stream(path, names):
    """Directory entries of an OLE2 file hold their names in UTF-16LE. Scan for them in chunks."""
    needles = [n.encode("utf-16-le") for n in names]
    keep = max(len(n) for n in needles)
    tail = b""
    with open(path, "rb") as fh:
        while True:
            block = fh.read(CHUNK)
            if not block:
                return False
            data = tail + block
            if any(n in data for n in needles):
                return True
            tail = data[-keep:]


def _ooxml(path, folder):
    try:
        with zipfile.ZipFile(path) as zf:
            names = zf.namelist()
    except (zipfile.BadZipFile, OSError):
        return False
    return "[Content_Types].xml" in names and any(n.startswith(folder) for n in names)


def matches(path, ext):
    """True when the file at `path` really is what its extension says."""
    if ext not in MIME:
        return False
    with open(path, "rb") as fh:
        head = fh.read(1024)
    if ext == "pdf":
        return b"%PDF-" in head
    if ext == "png":
        return head.startswith(PNG)
    if ext in ("jpg", "jpeg"):
        return head.startswith(b"\xff\xd8\xff")
    if ext == "doc":
        return head.startswith(OLE2) and _ole_has_stream(path, ["WordDocument"])
    if ext == "xls":
        return head.startswith(OLE2) and _ole_has_stream(path, ["Workbook", "Book"])
    if ext == "docx":
        return _ooxml(path, "word/")
    if ext == "xlsx":
        return _ooxml(path, "xl/")
    return False
