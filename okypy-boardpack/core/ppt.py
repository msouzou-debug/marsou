# -*- coding: utf-8 -*-
"""
core/ppt.py — assemble a 16:9 PPTX from the per-tab PNGs.

One full-bleed image per slide, aspect-preserving (letterboxed on a white
background). Faithful look, not natively editable — accepted per spec §2/§9.
"""
from __future__ import annotations

from pptx import Presentation
from pptx.util import Emu
from PIL import Image

# 16:9 at 13.333" × 7.5" (EMU: 914400 per inch)
SLIDE_W = Emu(12192000)
SLIDE_H = Emu(6858000)


def build_pptx(png_paths: list[str], out_path: str) -> str:
    prs = Presentation()
    prs.slide_width = SLIDE_W
    prs.slide_height = SLIDE_H
    blank = prs.slide_layouts[6]  # fully blank

    for png in png_paths:
        slide = prs.slides.add_slide(blank)
        with Image.open(png) as im:
            iw, ih = im.size
        # fit within the slide, preserve aspect, centre
        scale = min(SLIDE_W / iw, SLIDE_H / ih)
        w = int(iw * scale)
        h = int(ih * scale)
        left = int((SLIDE_W - w) / 2)
        top = int((SLIDE_H - h) / 2)
        slide.shapes.add_picture(png, left, top, width=w, height=h)

    prs.save(out_path)
    return out_path
