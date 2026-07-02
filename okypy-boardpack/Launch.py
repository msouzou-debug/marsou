# -*- coding: utf-8 -*-
"""
Launch.py — double-click launcher that needs no .bat file.

Windows 11 «Smart App Control» blocks downloaded script files (.bat/.cmd) with
no override. It does NOT block this path: python.exe is signed by the Python
Software Foundation, and .py files are not an enforced script type.

Works two ways:
  * Portable bundle: right-click → «Άνοιγμα με» → python\\python.exe (in this
    folder) → «Πάντα». Libraries are already inside the bundle.
  * Any installed Python (e.g. winget user install): double-click — missing
    libraries are installed automatically to the user profile (no admin).
"""
import importlib
import os
import subprocess
import sys
import traceback

BASE = os.path.dirname(os.path.abspath(__file__))
os.chdir(BASE)

if sys.stdout and hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")


def _ensure_deps() -> None:
    """The portable bundle ships its libraries; a plain Python needs them
    installed once (per-user, no admin)."""
    missing = []
    for mod in ("openpyxl", "pptx", "PIL", "playwright"):
        try:
            importlib.import_module(mod)
        except ImportError:
            missing.append(mod)
    if not missing:
        return
    print(f"Πρώτη εκτέλεση: εγκατάσταση βιβλιοθηκών ({', '.join(missing)})…")
    r = subprocess.run([sys.executable, "-m", "pip", "install", "--user",
                        "--quiet", "--disable-pip-version-check",
                        "openpyxl==3.1.5", "python-pptx==1.0.2",
                        "Pillow==11.0.0", "playwright==1.49.1"])
    if r.returncode != 0:
        raise RuntimeError("Η εγκατάσταση βιβλιοθηκών απέτυχε — ελέγξτε τη σύνδεση δικτύου.")
    # user-site may not be on sys.path yet in this process → restart once
    os.execv(sys.executable, [sys.executable, os.path.abspath(__file__), "--deps-ok"])


def main() -> None:
    if "--deps-ok" not in sys.argv:
        _ensure_deps()

    # Chromium for PDF/PPTX — downloads once into the user profile (no admin);
    # best-effort: without it the HTML deck still generates.
    try:
        print("Έλεγχος Chromium (για PDF/PPTX)…")
        subprocess.run([sys.executable, "-m", "playwright", "install", "chromium"],
                       timeout=1800, check=False)
    except Exception:
        pass

    print("Ο server ξεκινά — ο browser θα ανοίξει αυτόματα…")
    print("(κλείστε αυτό το παράθυρο για τερματισμό)")
    sys.argv = ["serve.py", "--open"]
    import serve
    serve.main()


if __name__ == "__main__":
    try:
        main()
    except SystemExit:
        raise
    except Exception:
        # keep the window open so the error can be read / photographed
        traceback.print_exc()
        try:
            input("\nΠατήστε Enter για κλείσιμο…")
        except Exception:
            pass
