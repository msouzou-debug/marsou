"""Version every static URL with a short hash of the file: /static/css/x.css?v=1a2b3c4d5e.

A new release changes the hash, so browsers and any cache in front of the app (the Cloudflare tunnel caches .css and
.js) fetch the new file at once. Without it a page from the new release can arrive with the previous release's
stylesheet. Pages themselves are sent with `Cache-Control: no-store`, so they always carry the current URLs."""
import hashlib
import os

_cache = {}  # path -> (mtime_ns, size, digest)


def _digest(path):
    try:
        st = os.stat(path)
    except OSError:
        return None
    hit = _cache.get(path)
    if hit and hit[0] == st.st_mtime_ns and hit[1] == st.st_size:
        return hit[2]
    h = hashlib.sha256()
    with open(path, "rb") as fh:
        for block in iter(lambda: fh.read(65536), b""):
            h.update(block)
    digest = h.hexdigest()[:10]
    _cache[path] = (st.st_mtime_ns, st.st_size, digest)
    return digest


def init_static_versions(app):
    folder = os.path.realpath(app.static_folder)

    @app.url_defaults
    def _add_version(endpoint, values):
        if endpoint != "static" or "v" in values or not values.get("filename"):
            return
        path = os.path.realpath(os.path.join(folder, values["filename"]))
        if not path.startswith(folder + os.sep):
            return
        digest = _digest(path)
        if digest:
            values["v"] = digest
