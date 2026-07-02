# -*- coding: utf-8 -*-
"""
core/ppt.py — 16:9 PPTX that matches the HTML deck exactly.

Each tab is rendered from the live HTML (real charts, real styling) to one image.
Tabs close to 16:9 become one slide; tall tabs are split into equal ~16:9 pieces
(so nothing becomes a tiny centred strip and there are no empty/overlapping
slides). Every piece is placed full-width, centred on the deck background.
"""
from __future__ import annotations

import math
import os
import tempfile

from pptx import Presentation
from pptx.util import Emu
from pptx.dml.color import RGBColor
from PIL import Image

SLIDE_W = 12192000          # 13.333in
SLIDE_H = 6858000           # 7.5in  (16:9)
_AR = SLIDE_W / SLIDE_H
DECK_BG = RGBColor(0xF7, 0xF8, 0xFA)


def _add(prs, blank, img_path):
    slide = prs.slides.add_slide(blank)
    slide.background.fill.solid()
    slide.background.fill.fore_color.rgb = DECK_BG
    with Image.open(img_path) as im:
        iw, ih = im.size
    scale = min(SLIDE_W / iw, SLIDE_H / ih)
    w, h = int(iw * scale), int(ih * scale)
    slide.shapes.add_picture(img_path, Emu(int((SLIDE_W - w) / 2)),
                             Emu(int((SLIDE_H - h) / 2)), width=Emu(w), height=Emu(h))


def build_pptx(png_paths: list[str], out_path: str) -> str:
    prs = Presentation()
    prs.slide_width = Emu(SLIDE_W)
    prs.slide_height = Emu(SLIDE_H)
    blank = prs.slide_layouts[6]
    tmpdir = tempfile.mkdtemp(prefix="okypy_ppt_")
    n = 0

    for png in png_paths:
        with Image.open(png) as im:
            im = im.convert("RGB")
            iw, ih = im.size
            target = iw / _AR                       # height of a full-width 16:9 slice
            k = max(1, round(ih / target))          # 1 slide unless the tab is tall
            if k == 1:
                _add(prs, blank, png)
                continue
            ph = math.ceil(ih / k)
            for i in range(k):
                y0, y1 = i * ph, min((i + 1) * ph, ih)
                if y1 - y0 < ph * 0.25:             # skip a near-empty tail slice
                    break
                piece = im.crop((0, y0, iw, y1))
                p = os.path.join(tmpdir, f"s{n}.png")
                piece.save(p)
                _add(prs, blank, p)
                n += 1

    prs.save(out_path)
    return out_path
