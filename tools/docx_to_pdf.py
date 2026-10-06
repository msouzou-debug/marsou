# -*- coding: utf-8 -*-
"""
Renders the project's .docx documents to PDF with reportlab.

LibreOffice is unusable in the build container (it cannot load docx or xlsx at all), so
the conversion is done directly rather than shelled out. Only the constructs these
documents actually use are handled: Normal paragraphs with per-run bold/size/colour,
List Bullet, List Number, Table Grid tables, and monospace runs.

    python3 tools/docx_to_pdf.py docs/TAEP_odigies_egkatastasis_IT.docx [...]
"""
import sys
from pathlib import Path
from xml.sax.saxutils import escape

from docx import Document
from docx.table import Table
from docx.text.paragraph import Paragraph
from reportlab.lib import colors
from reportlab.lib.enums import TA_JUSTIFY
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.units import cm
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import (BaseDocTemplate, Frame, PageTemplate, Paragraph as P,
                                Spacer, Table as T, TableStyle)

FONTS = Path("/usr/share/fonts/truetype/liberation")
NAVY = colors.HexColor("#1F3864")
GREY = colors.HexColor("#444444")


def register_fonts():
    pdfmetrics.registerFont(TTFont("Doc", FONTS / "LiberationSans-Regular.ttf"))
    pdfmetrics.registerFont(TTFont("Doc-Bold", FONTS / "LiberationSans-Bold.ttf"))
    pdfmetrics.registerFont(TTFont("Doc-Italic", FONTS / "LiberationSans-Italic.ttf"))
    pdfmetrics.registerFont(TTFont("Doc-BoldItalic",
                                   FONTS / "LiberationSans-BoldItalic.ttf"))
    pdfmetrics.registerFont(TTFont("Mono", FONTS / "LiberationMono-Regular.ttf"))
    pdfmetrics.registerFontFamily("Doc", normal="Doc", bold="Doc-Bold",
                                  italic="Doc-Italic", boldItalic="Doc-BoldItalic")


BODY = ParagraphStyle("body", fontName="Doc", fontSize=9.2, leading=13.4,
                      alignment=TA_JUSTIFY, spaceAfter=5)
H1 = ParagraphStyle("h1", fontName="Doc-Bold", fontSize=15, leading=19,
                    textColor=NAVY, spaceAfter=3)
H2 = ParagraphStyle("h2", fontName="Doc-Bold", fontSize=11, leading=15,
                    textColor=NAVY, spaceBefore=11, spaceAfter=4)
LIST = ParagraphStyle("list", parent=BODY, leftIndent=0.62 * cm,
                      bulletIndent=0.12 * cm, spaceAfter=3)
CODE = ParagraphStyle("code", fontName="Mono", fontSize=7.9, leading=10.6,
                      textColor=GREY, leftIndent=0.5 * cm, spaceAfter=0)
CELL = ParagraphStyle("cell", fontName="Doc", fontSize=8.4, leading=11.4)
CELL_H = ParagraphStyle("cellh", parent=CELL, fontName="Doc-Bold", textColor=NAVY)
FOOT = ParagraphStyle("foot", parent=BODY, fontSize=7.4, leading=10,
                      textColor=GREY, fontName="Doc-Italic", spaceBefore=10)


def run_markup(run):
    """One docx run as reportlab inline markup."""
    text = escape(run.text).replace("\n", "<br/>")
    if not text:
        return ""
    colour = None
    if run.font.color is not None and run.font.color.rgb is not None:
        colour = "#" + str(run.font.color.rgb)
    if colour and colour.lower() == "#000000":
        colour = None
    if colour:
        text = '<font color="%s">%s</font>' % (colour, text)
    if run.bold:
        text = "<b>%s</b>" % text
    if run.italic:
        text = "<i>%s</i>" % text
    return text


def is_monospace(paragraph):
    runs = [r for r in paragraph.runs if r.text.strip()]
    return bool(runs) and all((r.font.name or "") in ("Consolas", "Courier New")
                              for r in runs)


def lead_size(paragraph):
    for run in paragraph.runs:
        if run.text.strip():
            return (run.font.size.pt if run.font.size else None), bool(run.bold)
    return None, False


def flow_paragraph(paragraph, counter):
    """One docx paragraph as a list of flowables. counter is a one-item list."""
    text = "".join(run_markup(r) for r in paragraph.runs)
    style_name = paragraph.style.name

    if is_monospace(paragraph):
        counter[0] = 0
        raw = escape(paragraph.text) or "&nbsp;"
        return [P(raw.replace(" ", "&nbsp;"), CODE)]

    if style_name == "List Bullet":
        counter[0] = 0
        return [P(text, LIST, bulletText="•")]

    if style_name == "List Number":
        counter[0] += 1
        return [P(text, LIST, bulletText="%d." % counter[0])]

    counter[0] = 0
    if not paragraph.text.strip():
        return [Spacer(1, 3)]

    size, bold = lead_size(paragraph)
    if bold and size and size >= 15:
        return [P(paragraph.text, H1)]
    if bold and size and size >= 11.5:
        return [P(paragraph.text, H2)]
    if size and size <= 9 and not bold:
        return [P(text, FOOT)]
    return [P(text, BODY)]


def flow_table(table, width):
    rows, header = [], True
    for row in table.rows:
        cells = []
        for cell in row.cells:
            style = CELL_H if header else CELL
            cells.append(P("<br/>".join(escape(p.text) for p in cell.paragraphs), style))
        rows.append(cells)
        header = False
    columns = len(table.columns)
    # keep the docx widths where they were set, otherwise share the frame evenly
    declared = [c.width.cm if c.width is not None else None for c in table.columns]
    if all(w for w in declared):
        total = sum(declared)
        widths = [w / total * width for w in declared]
    else:
        widths = [width / columns] * columns
    t = T(rows, colWidths=widths, repeatRows=1, hAlign="LEFT")
    t.setStyle(TableStyle([
        ("GRID", (0, 0), (-1, -1), 0.4, colors.HexColor("#B8C2D4")),
        ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#EEF2F8")),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LEFTPADDING", (0, 0), (-1, -1), 4),
        ("RIGHTPADDING", (0, 0), (-1, -1), 4),
        ("TOPPADDING", (0, 0), (-1, -1), 3),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 3),
    ]))
    return [Spacer(1, 3), t, Spacer(1, 7)]


def body_items(document):
    """Paragraphs and tables in document order."""
    body = document.element.body
    paragraphs = iter(document.paragraphs)
    tables = iter(document.tables)
    for child in body.iterchildren():
        if child.tag.endswith("}p"):
            yield next(paragraphs)
        elif child.tag.endswith("}tbl"):
            yield next(tables)


def convert(source, target=None):
    source = Path(source)
    target = Path(target) if target else source.with_suffix(".pdf")
    document = Document(source)

    margin = 2.0 * cm
    width = A4[0] - 2 * margin
    story, counter = [], [0]
    for item in body_items(document):
        if isinstance(item, Paragraph):
            story.extend(flow_paragraph(item, counter))
        elif isinstance(item, Table):
            counter[0] = 0
            story.extend(flow_table(item, width))

    def footer(canvas, doc):
        canvas.saveState()
        canvas.setFont("Doc", 7.5)
        canvas.setFillColor(GREY)
        canvas.drawCentredString(A4[0] / 2, 1.2 * cm, str(doc.page))
        canvas.restoreState()

    # invariant: no /CreationDate, so the same source gives the same bytes
    doc = BaseDocTemplate(str(target), pagesize=A4, invariant=1,
                          leftMargin=margin, rightMargin=margin,
                          topMargin=1.8 * cm, bottomMargin=1.8 * cm,
                          title=source.stem, author="ΟΚΥπΥ")
    frame = Frame(margin, 1.8 * cm, width, A4[1] - 3.6 * cm, id="main",
                  leftPadding=0, rightPadding=0, topPadding=0, bottomPadding=0)
    doc.addPageTemplates([PageTemplate(id="page", frames=[frame], onPage=footer)])
    doc.build(story)
    return target


def main(argv):
    if not argv:
        print(__doc__)
        return 1
    register_fonts()
    for source in argv:
        print("wrote", convert(source))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
