# -*- coding: utf-8 -*-
"""
Launch.py — double-click launcher that needs no .bat file.

Windows 11 «Smart App Control» blocks downloaded script files (.bat/.cmd) with
no override. It does NOT block this path: python.exe is signed by the Python
Software Foundation, and .py files are not an enforced script type.

One-time setup (portable bundle):
  1. Right-click  Launch.py  →  «Άνοιγμα με» (Open with)
  2. «Επιλογή άλλης εφαρμογής» → «Αναζήτηση εφαρμογής στον υπολογιστή»
  3. Pick  python\\python.exe  inside THIS folder, tick «Πάντα» (Always)
From then on, double-clicking Launch.py starts the board-pack server and opens
the browser — same as run.bat.
"""
import os
import subprocess
import sys

BASE = os.path.dirname(os.path.abspath(__file__))
os.chdir(BASE)

if sys.stdout and hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

# Chromium for PDF/PPTX — downloads once into the user profile (no admin);
# best-effort: without it the HTML deck still generates.
try:
    subprocess.run([sys.executable, "-m", "playwright", "install", "chromium"],
                   timeout=1800, check=False,
                   stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
except Exception:
    pass

print("Ο server ξεκινά — ο browser θα ανοίξει αυτόματα…")
print("(κλείστε αυτό το παράθυρο για τερματισμό)")
sys.argv = ["serve.py", "--open"]
import serve  # noqa: E402

serve.main()
