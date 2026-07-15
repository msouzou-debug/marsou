"""Μετατροπή σελίδων PDF σε εικόνες PNG (PyMuPDF), με περιστροφή και τεμαχισμό."""

from __future__ import annotations

import io

import fitz  # PyMuPDF
from PIL import Image

DEFAULT_DPI = 230
# Πάνω από αυτό το ύψος (pixels) η σελίδα πίνακα κόβεται σε δύο μισά.
SPLIT_HEIGHT_PX = 2200
OVERLAP = 0.10  # 10% επικάλυψη ανάμεσα στα δύο μισά


def render_page(pdf_path: str, page_index: int, dpi: int = DEFAULT_DPI, rotate: int = 0) -> bytes:
    """Επιστρέφει PNG bytes μίας σελίδας, με προαιρετική περιστροφή (μοίρες)."""
    with fitz.open(pdf_path) as doc:
        page = doc[page_index]
        matrix = fitz.Matrix(dpi / 72, dpi / 72).prerotate(rotate)
        pix = page.get_pixmap(matrix=matrix)
        return pix.tobytes("png")


def page_count(pdf_path: str) -> int:
    with fitz.open(pdf_path) as doc:
        return doc.page_count


def split_tall_image(png_bytes: bytes, max_height: int = SPLIT_HEIGHT_PX) -> list[bytes]:
    """Αν η εικόνα είναι ψηλή, την κόβει σε πάνω/κάτω μισό με ~10% επικάλυψη."""
    img = Image.open(io.BytesIO(png_bytes))
    width, height = img.size
    if height <= max_height:
        return [png_bytes]
    mid = height // 2
    overlap_px = int(height * OVERLAP / 2)
    parts = [
        img.crop((0, 0, width, min(height, mid + overlap_px))),
        img.crop((0, max(0, mid - overlap_px), width, height)),
    ]
    result = []
    for part in parts:
        buf = io.BytesIO()
        part.save(buf, format="PNG")
        result.append(buf.getvalue())
    return result
