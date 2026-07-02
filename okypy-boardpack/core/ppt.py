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


def build_pdf(png_paths: list[str], out_path: str, dpi: int = 150,
              max_w: int = 1700) -> str:
    """Multi-page PDF, one page per tab image (same PNGs as the PPTX / mobile
    HTML). Each page is sized to its image so nothing is cropped or split across
    pages and every chart is present — the reason we build the PDF from the
    captured tabs instead of CSS print pagination. Pages are downscaled to
    ``max_w`` and JPEG-compressed so the file (and the deck that embeds it) stays
    a sensible size while charts/text remain crisp."""
    imgs = []
    for png in png_paths:
        if not png or not os.path.exists(png):
            continue
        im = Image.open(png).convert("RGB")
        if im.width > max_w:
            im = im.resize((max_w, round(im.height * max_w / im.width)), Image.LANCZOS)
        imgs.append(im)
    if not imgs:
        raise ValueError("Δεν υπάρχουν εικόνες για το PDF.")
    imgs[0].save(out_path, "PDF", save_all=True, append_images=imgs[1:],
                 resolution=dpi, quality=80)
    for im in imgs:
        im.close()
    return out_path


def build_pptx(png_paths: list[str], out_path: str, max_w: int = 2200) -> str:
    prs = Presentation()
    prs.slide_width = Emu(SLIDE_W)
    prs.slide_height = Emu(SLIDE_H)
    blank = prs.slide_layouts[6]
    tmpdir = tempfile.mkdtemp(prefix="okypy_ppt_")
    n = 0

    for png in png_paths:
        with Image.open(png) as im:
            im = im.convert("RGB")
            # downscale + JPEG so slides stay crisp on any projector without
            # bloating the file (and the deck that embeds it)
            if im.width > max_w:
                im = im.resize((max_w, round(im.height * max_w / im.width)), Image.LANCZOS)
            iw, ih = im.size
            target = iw / _AR                       # height of a full-width 16:9 slice
            k = max(1, round(ih / target))          # 1 slide unless the tab is tall
            if k == 1:
                p = os.path.join(tmpdir, f"s{n}.jpg")
                im.save(p, "JPEG", quality=82); n += 1
                _add(prs, blank, p)
                continue
            ph = math.ceil(ih / k)
            for i in range(k):
                y0, y1 = i * ph, min((i + 1) * ph, ih)
                if y1 - y0 < ph * 0.25:             # skip a near-empty tail slice
                    break
                piece = im.crop((0, y0, iw, y1))
                p = os.path.join(tmpdir, f"s{n}.jpg")
                piece.save(p, "JPEG", quality=82); n += 1
                _add(prs, blank, p)

    prs.save(out_path)
    return out_path
