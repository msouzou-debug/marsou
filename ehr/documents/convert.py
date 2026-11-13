"""Office to PDF on the server, behind an interface. Tests use FakeConverter; no converter means no preview."""
import os
import shutil
import subprocess
import tempfile


class Converter:
    """`to_pdf(src_path, dst_path) -> bool`. `src_path` carries the real extension (.docx, .xls ...)."""

    def available(self):
        return False

    def to_pdf(self, src_path, dst_path):
        raise NotImplementedError


class NullConverter(Converter):
    def to_pdf(self, src_path, dst_path):
        return False


class LibreOfficeConverter(Converter):
    def __init__(self, binary=None, timeout=60):
        self.binary = binary or shutil.which("soffice") or shutil.which("libreoffice")
        self.timeout = timeout

    def available(self):
        return bool(self.binary) and os.access(self.binary, os.X_OK)

    def to_pdf(self, src_path, dst_path):
        if not self.available():
            return False
        with tempfile.TemporaryDirectory(prefix="ehr-lo-") as work:
            profile = os.path.join(work, "profile")
            outdir = os.path.join(work, "out")
            os.makedirs(outdir)
            cmd = [self.binary, "-env:UserInstallation=file://" + profile, "--headless", "--norestore",
                   "--convert-to", "pdf", "--outdir", outdir, src_path]
            try:
                subprocess.run(cmd, check=True, timeout=self.timeout, shell=False, cwd=work,
                               stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            except (subprocess.SubprocessError, OSError):
                return False
            result = os.path.join(outdir, os.path.splitext(os.path.basename(src_path))[0] + ".pdf")
            if not os.path.isfile(result) or os.path.getsize(result) == 0:
                return False
            shutil.move(result, dst_path)
            return True


def default_converter(config):
    """The converter named by EHR_SOFFICE_BIN, else whatever is on PATH, else NullConverter."""
    conv = LibreOfficeConverter(config.get("EHR_SOFFICE_BIN") or None, config.get("EHR_CONVERT_TIMEOUT", 60))
    return conv if conv.available() else NullConverter()


def get_converter(app):
    """Tests replace `app.extensions["ehr_converter"]`."""
    if "ehr_converter" not in app.extensions:
        app.extensions["ehr_converter"] = default_converter(app.config)
    return app.extensions["ehr_converter"]
