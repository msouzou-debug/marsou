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

_RESIZE_ALL = """
() => {
  if (window.Chart) {
    try { window.Chart.defaults.animation = false; } catch (e) {}
    document.querySelectorAll('canvas').forEach(cv => {
      const ch = window.Chart.getChart ? window.Chart.getChart(cv) : null;
      if (ch) { try { ch.options.animation = false; ch.resize(); ch.update('none'); } catch (e) {} }
    });
  }
}
"""

# Resolves once every canvas inside the given section has actually been painted
# (non-blank pixels), so we never screenshot a chart mid-draw. Robust across
# machine speeds — the earlier fixed-delay approach could capture blank charts
# on slower hosts.
_PAINTED = """
(sel) => {
  const root = document.querySelector(sel);
  if (!root) return true;
  const cvs = Array.from(root.querySelectorAll('canvas'));
  if (!cvs.length) return true;
  return cvs.every(cv => {
    if (!cv.width || !cv.height) return false;
    try {
      const ctx = cv.getContext('2d');
      const w = cv.width, h = cv.height;
      const pts = [[w*0.5,h*0.5],[w*0.25,h*0.5],[w*0.75,h*0.5],[w*0.5,h*0.25],[w*0.5,h*0.75]];
      let ink = 0;
      for (const [x,y] of pts) {
        const d = ctx.getImageData(Math.floor(x), Math.floor(y), 1, 1).data;
        if (d[3] !== 0 && !(d[0]===255 && d[1]===255 && d[2]===255)) ink++;
      }
      return ink > 0;
    } catch (e) { return true; }  // tainted/unsupported → don't block
  });
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
            # wait for webfonts + Chart.js so charts draw deterministically
            try:
                page.evaluate("() => document.fonts && document.fonts.ready")
                page.wait_for_function("() => !!window.Chart", timeout=15000)
            except Exception:
                pass
            page.wait_for_timeout(400)
            for tab in tabs:
                page.evaluate(_activate_js(tab))
                sel = f"#sec-{tab}"
                # force a synchronous (animation-free) redraw of this tab's charts,
                # then wait until every canvas has actually painted before capture
                try:
                    page.evaluate(_RESIZE_ALL)
                    page.wait_for_function(_PAINTED, arg=sel, timeout=8000)
                except Exception:
                    page.wait_for_timeout(600)  # fallback: give charts time anyway
                page.wait_for_timeout(250)
                el = page.query_selector(sel)
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


def render_pdf(html: str, out_path: str, png_paths=None) -> str:
    """Build the PDF from the per-tab PNGs (same images as the PPTX / mobile HTML)
    — one clean page per tab. This guarantees the charts are present and avoids
    the blank / mid-chart-split pages the old CSS-paginated print produced. If
    png_paths isn't supplied, the tabs are rendered on the fly."""
    from core import ppt as pptmod
    if not png_paths:
        png_paths = render_pngs(html, os.path.dirname(out_path) or ".")
    return pptmod.build_pdf(png_paths, out_path)
