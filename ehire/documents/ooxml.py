"""Safety check for Word and Excel files (OOXML) before they are accepted or sent to LibreOffice.

An OOXML file is a zip. A zip bomb is a small file that expands to gigabytes. The check reads the zip's table of
contents and then streams each entry through the decompressor into nowhere (nothing is written to disk), stopping
at the limit. Rejects: too many entries, an entry path that is absolute or contains "..", a repeated entry name,
a total uncompressed size over the limit, an entry that compresses more than RATIO:1 once it is bigger than
RATIO_FLOOR, or a damaged entry. It does not parse the XML, and it cannot stop every attack on LibreOffice.
"""
import zipfile

MAX_ENTRIES = 2000
RATIO = 100
RATIO_FLOOR = 1024 * 1024  # entries under 1 MB are exempt from the ratio rule
CHUNK = 1 << 16


def _bad_name(name):
    if not name or name.startswith(("/", "\\")) or (len(name) > 1 and name[1] == ":"):
        return True
    return ".." in name.replace("\\", "/").split("/")


def is_safe(path, max_total_bytes):
    """True when the zip at `path` passes every rule above."""
    try:
        with zipfile.ZipFile(path) as zf:
            infos = zf.infolist()
            if len(infos) > MAX_ENTRIES:
                return False
            seen, declared = set(), 0
            for info in infos:
                if _bad_name(info.filename) or info.filename in seen:
                    return False
                seen.add(info.filename)
                declared += info.file_size
                if declared > max_total_bytes:
                    return False
                if info.file_size > RATIO_FLOOR and (info.compress_size <= 0 or info.file_size / info.compress_size > RATIO):
                    return False
            real = 0
            for info in infos:
                if info.is_dir():
                    continue
                with zf.open(info) as fh:
                    while True:
                        block = fh.read(CHUNK)
                        if not block:
                            break
                        real += len(block)
                        if real > max_total_bytes:
                            return False
    except (zipfile.BadZipFile, OSError, RuntimeError, EOFError, NotImplementedError, ValueError):
        return False
    return True
