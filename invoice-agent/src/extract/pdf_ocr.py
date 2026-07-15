"""OCR path (Stage 2d) for scanned PDFs — pytesseract + pdf2image, Greek and
English. If the OCR stack isn't installed the invoice degrades to the review
queue (workload, never wrong postings — §8)."""

from . import pdf_text


class OcrUnavailable(Exception):
    pass


def available():
    try:
        import pdf2image  # noqa: F401
        import pytesseract

        pytesseract.get_tesseract_version()
        return True
    except Exception:  # noqa: BLE001
        return False


def extract(path):
    if not available():
        raise OcrUnavailable(
            "OCR stack not installed (pytesseract + pdf2image + tesseract-ocr with ell+eng)"
        )
    import pdf2image
    import pytesseract

    pages = pdf2image.convert_from_path(path, dpi=300)
    text = "\n".join(pytesseract.image_to_string(p, lang="ell+eng") for p in pages)
    return pdf_text.parse_fields(text, "ocr", base_confidence=0.7)
