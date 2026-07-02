# -*- coding: utf-8 -*-
"""
core/ppt.py — assemble a 16:9 PPTX from the per-tab PNGs.

Every slide is full-bleed 16:9 landscape. Tabs taller than a slide are paginated
into consecutive 16:9 slices (so nothing becomes a tall portrait strip and no
content is dropped). Faithful look, not natively editable — accepted per spec.
"""
from __future__ import annotations

import os
import tempfile

from pptx import Presentation
from pptx.util import Emu
from PIL import Image

# 16:9 at 13.333in × 7.5in (914400 EMU per inch)
SLIDE_W = 12192000
SLIDE_H = 6858000
_AR = 16 / 9  # width / height


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
            w, h = im.size
            chunk = max(1, round(w / _AR))       # 16:9 slice height at full width
            y = 0
            while y < h:
                piece = im.crop((0, y, w, min(y + chunk, h)))
                if piece.height < chunk:          # pad last slice to a full 16:9
                    canvas = Image.new("RGB", (w, chunk), "white")
                    canvas.paste(piece, (0, 0))
                    piece = canvas
                p = os.path.join(tmpdir, f"s{n}.png")
                piece.save(p)
                prs.slides.add_slide(blank).shapes.add_picture(
                    p, Emu(0), Emu(0), width=Emu(SLIDE_W), height=Emu(SLIDE_H))
                n += 1
                y += chunk

    prs.save(out_path)
    return out_path
