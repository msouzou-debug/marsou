# -*- coding: utf-8 -*-
"""
core/render.py — Playwright headless Chromium outputs.

* render_pdf  — loads the injected HTML in a "print mode" that stacks every tab
                section with page-breaks, then prints to a landscape PDF with
                selectable text.
* render_pngs — activates each tab in turn and screenshots the section at
                1920-wide, returning one PNG per tab (for the PPTX).

Charts are drawn by Chart.js; we force a resize on every canvas after a tab is
shown so hidden-at-load charts paint before capture.
"""
from __future__ import annotations

import os
import tempfile

import config

# Print-mode CSS: reveal all sections, one per page. Injected at render time so
# the shipped template stays verbatim.
PRINT_CSS = """
@page { size: 1920px 1080px; margin: 0; }
body.printmode .topbar { position: static !important; }
body.printmode .section { display: block !important; page-break-before: always; padding: 24px 32px; }
body.printmode .section:first-of-type { page-break-before: auto; }
body.printmode .hero { page-break-after: always; }
"""

_RESIZE_ALL = """
() => {
  if (window.Chart) {
    document.querySelectorAll('canvas').forEach(cv => {
      const ch = window.Chart.getChart ? window.Chart.getChart(cv) : null;
      if (ch) { try { ch.resize(); ch.update('none'); } catch (e) {} }
    });
  }
}
"""


def _activate_js(section_id: str) -> str:
    return f"""
    () => {{
      document.querySelectorAll('.section').forEach(s => s.classList.remove('active'));
      const el = document.getElementById('sec-{section_id}');
      if (el) el.classList.add('active');
    }}
    """


def _write_temp_html(html: str) -> str:
    fd, path = tempfile.mkstemp(suffix=".html")
    os.close(fd)
    with open(path, "w", encoding="utf-8") as fh:
        fh.write(html)
    return path


def _find_chromium() -> str | None:
    """Locate a pre-installed Chromium when the pinned Playwright build is absent
    (e.g. managed environments that forbid `playwright install`)."""
    import glob
    root = os.environ.get("PLAYWRIGHT_BROWSERS_PATH", "")
    if not root:
        return None
    for pat in ("chromium-*/chrome-linux/chrome",
                "chromium_headless_shell-*/chrome-linux/headless_shell"):
        hits = sorted(glob.glob(os.path.join(root, pat)))
        if hits:
            return hits[-1]
    return None


def _launch(p):
    args = ["--no-sandbox", "--disable-dev-shm-usage"]
    try:
        return p.chromium.launch(args=args)
    except Exception:
        exe = _find_chromium()
        if not exe:
            raise
        return p.chromium.launch(args=args, executable_path=exe)


def render_pdf(html: str, out_path: str) -> str:
    from playwright.sync_api import sync_playwright

    tmp = _write_temp_html(html)
    try:
        with sync_playwright() as p:
            browser = _launch(p)
            page = browser.new_page(viewport={"width": 1920, "height": 1080})
            page.goto("file://" + tmp, wait_until="load", timeout=60000)
            page.add_style_tag(content=PRINT_CSS)
            page.evaluate("() => document.body.classList.add('printmode')")
            try:
                page.evaluate(_RESIZE_ALL)
            except Exception:
                pass
            page.wait_for_timeout(800)
            page.pdf(path=out_path, landscape=True, print_background=True,
                     prefer_css_page_size=True)
            browser.close()
    finally:
        os.unlink(tmp)
    return out_path


def render_pngs(html: str, out_dir: str, tabs=None, width: int = 1920) -> list[str]:
    from playwright.sync_api import sync_playwright

    tabs = tabs or config.DECK_TABS
    os.makedirs(out_dir, exist_ok=True)
    tmp = _write_temp_html(html)
    paths: list[str] = []
    try:
        with sync_playwright() as p:
            browser = _launch(p)
            page = browser.new_page(viewport={"width": width, "height": 1080},
                                    device_scale_factor=2)
            page.goto("file://" + tmp, wait_until="load", timeout=60000)
            # use the full 1920 width (drop the 1400 cap) so each tab is wider &
            # shorter → the PPTX slides read as consistent landscape, not tall strips
            page.add_style_tag(content=".content{max-width:none !important;padding:24px 44px !important}"
                               " #okypy-toolbar{display:none !important}")
            page.wait_for_timeout(500)
            for tab in tabs:
                page.evaluate(_activate_js(tab))
                try:
                    page.evaluate(_RESIZE_ALL)
                except Exception:
                    pass
                page.wait_for_timeout(450)
                el = page.query_selector(f"#sec-{tab}")
                out = os.path.join(out_dir, f"tab_{tab}.png")
                if el:
                    el.screenshot(path=out)
                else:
                    page.screenshot(path=out)
                paths.append(out)
            browser.close()
    finally:
        os.unlink(tmp)
    return paths
