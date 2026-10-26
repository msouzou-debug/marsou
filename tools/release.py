#!/usr/bin/env python3
"""Stamp the app version and publish the app to docs/ (GitHub Pages).

Run before committing a release:

    python3 tools/release.py

The version is 1.<build>, where <build> is the number the next commit will
have on this branch, so it always increases. The same version is written into
the service worker's cache name: a changed sw.js is what makes installed
copies pick up the release and discard their old offline cache.
"""
import datetime
import pathlib
import re
import shutil
import subprocess

ROOT = pathlib.Path(__file__).resolve().parent.parent
APP = ROOT / "iphone_app"
DOCS = ROOT / "docs"
PUBLISHED = ["index.html", "sw.js", "install.html", "manifest.webmanifest"]


def main():
    count = int(subprocess.check_output(
        ["git", "rev-list", "--count", "HEAD"], cwd=ROOT).decode().strip())
    version = f"1.{count + 1}"
    build = datetime.date.today().isoformat()

    index = APP / "index.html"
    text = index.read_text(encoding="utf-8")
    text, n = re.subn(r'^const APP_VERSION="[^"]*", APP_BUILD="[^"]*";$',
                      f'const APP_VERSION="{version}", APP_BUILD="{build}";', text, flags=re.M)
    if n != 1:
        raise SystemExit("could not find the APP_VERSION / APP_BUILD declaration in index.html")
    index.write_text(text, encoding="utf-8")

    sw = APP / "sw.js"
    stext, n3 = re.subn(r'const CACHE = "[^"]*"', f'const CACHE = "clean-shot-{version}"',
                        sw.read_text(encoding="utf-8"))
    if n3 != 1:
        raise SystemExit("could not find CACHE in sw.js")
    sw.write_text(stext, encoding="utf-8")

    for name in PUBLISHED:
        shutil.copy2(APP / name, DOCS / name)
    print(f"v{version} ({build}) stamped and published to docs/")


if __name__ == "__main__":
    main()
