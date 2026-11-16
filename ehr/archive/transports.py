"""How a deposit leaves eHR. One small interface; eArchive's real interface is not known yet (contract 06).

`deposit(manifest, files) -> reference`. It must be idempotent on the manifest's `key` (request number + kind): a
second call with the same key must not create a second record. A transport signals failure by raising; the queue
records the message and tries again at the next run.
"""
import hashlib
import json
import os
import re
import secrets
import shutil
from dataclasses import dataclass

from flask import current_app

from ..models import get_setting

NAMES = ("none", "folder", "http")


class ArchiveError(Exception):
    """A problem with a deposit that is worth showing to an administrator as it is."""


@dataclass(frozen=True)
class DepositFile:
    """One file of a deposit: `stored_as` is the name inside the deposit, `path` is where eHR holds it."""
    stored_as: str
    name: str
    mime: str
    size: int
    sha256: str
    path: str


class Transport:
    name = "none"
    delivers = False  # False: nothing is sent and rows stay queued

    def deposit(self, manifest, files):
        raise NotImplementedError


class NullTransport(Transport):
    """The default. Sends nothing. Deposits wait in the queue until a real transport is chosen."""
    name = "none"
    delivers = False

    def deposit(self, manifest, files):
        raise ArchiveError("No archive transport is set up (archive_transport = none).")


def canonical(manifest):
    """The manifest as the bytes that are written and compared: sorted keys, UTF-8, no line noise."""
    return json.dumps(manifest, ensure_ascii=False, sort_keys=True, indent=2).encode("utf-8") + b"\n"


def manifest_hash(manifest):
    return hashlib.sha256(canonical(manifest)).hexdigest()


def safe_name(text, limit=80):
    """A file or folder name that is safe on any disk: no path parts, no control or odd characters."""
    name = re.sub(r"[^\w.\- ]", "_", (text or "").replace("\\", "/").rsplit("/", 1)[-1], flags=re.UNICODE)
    name = re.sub(r"\s+", " ", name).strip(" .") or "file"
    if len(name) > limit:
        stem, dot, ext = name.rpartition(".")
        name = (stem[: limit - len(ext) - 1] + "." + ext) if dot and len(ext) < 10 else name[:limit]
    return name


class FolderTransport(Transport):
    """Writes each deposit as a folder `<number>-<kind>/` inside EHR_ARCHIVE_DROP_DIR: manifest.json, the PDF and the
    documents. Written under a temporary name and renamed, so a reader never sees half a deposit. An existing deposit
    with the same manifest is a successful retry; one with a different manifest is refused, never overwritten."""
    name = "folder"
    delivers = True

    def __init__(self, drop_dir=None):
        self._drop_dir = drop_dir

    def drop_dir(self):
        path = self._drop_dir or current_app.config.get("EHR_ARCHIVE_DROP_DIR") or ""
        if not path:
            raise ArchiveError("EHR_ARCHIVE_DROP_DIR is not set.")
        path = os.path.abspath(path)
        if not os.path.isdir(path):
            raise ArchiveError("The archive drop folder does not exist: %s" % path)
        return path

    def deposit(self, manifest, files):
        root = self.drop_dir()
        folder = manifest.get("folder")
        if not folder or folder != safe_name(folder):
            raise ArchiveError("The manifest has no usable folder name.")
        final = os.path.join(root, folder)
        wanted = manifest_hash(manifest)
        if os.path.lexists(final):
            return self._existing(final, folder, wanted)
        tmp = os.path.join(root, ".%s.tmp-%s" % (folder, secrets.token_hex(4)))
        os.mkdir(tmp)
        try:
            for f in files:
                shutil.copyfile(f.path, os.path.join(tmp, f.stored_as))
            with open(os.path.join(tmp, "manifest.json"), "wb") as fh:
                fh.write(canonical(manifest))
                fh.flush()
                os.fsync(fh.fileno())
            try:
                os.rename(tmp, final)
            except OSError:  # somebody else made it first; fine if it is the same deposit
                if not os.path.isdir(final):
                    raise
                return self._existing(final, folder, wanted)
        finally:
            if os.path.isdir(tmp):
                shutil.rmtree(tmp, ignore_errors=True)
        return folder

    @staticmethod
    def _existing(final, folder, wanted):
        try:
            with open(os.path.join(final, "manifest.json"), "rb") as fh:
                found = hashlib.sha256(fh.read()).hexdigest()
        except OSError:
            found = None
        if found != wanted:
            raise ArchiveError("The folder %s is already in the drop folder with different contents; "
                               "it was not overwritten." % folder)
        return folder


class HttpTransport(Transport):
    """To be written when eArchive's interface is known. It does not guess. While it is the chosen transport nothing
    is sent (`delivers` is False), so rows stay queued instead of failing."""
    name = "http"
    delivers = False

    def deposit(self, manifest, files):
        raise NotImplementedError("The eArchive HTTP transport is not written yet: eArchive's interface is not known "
                                  "(docs/contracts/06-earchive-deposit.md, open questions).")


def transport_name():
    name = (get_setting("archive_transport", "none") or "none").strip().lower()
    return name if name in NAMES else "none"  # a typo sends nothing


def get_transport(app=None):
    """The transport for this moment. Tests set app.config['ARCHIVE_TRANSPORT_OVERRIDE'] to an instance."""
    app = app or current_app
    override = app.config.get("ARCHIVE_TRANSPORT_OVERRIDE")
    if override is not None:
        return override
    name = transport_name()
    if name == "folder":
        return FolderTransport()
    if name == "http":
        return HttpTransport()
    return NullTransport()
