"""Excel export of the request list (contract 03, section 1).

Sheet 1 holds one row per request in a real Excel Table. Sheet 2 holds three small tables where every number is a
formula over sheet 1 (COUNTIFS, SUMIFS, AVERAGEIFS and SUM), so a change in sheet 1 flows through and an auditor can
read each cell. Sheet 3 explains. Leaver names, costs and comments never go in: they stay in the app.

Text that starts with = + - @ or a tab or line break is stored as a string with the quote prefix, so a spreadsheet
program can't run it as a formula.
"""
import io

from openpyxl import Workbook
from openpyxl.styles import Alignment, Font
from openpyxl.utils import get_column_letter
from openpyxl.worksheet.table import Table, TableStyleInfo

from ehr import i18n
from ehr.models import CATEGORIES, REQUEST_STATUSES, RequestDocument
from ehr.extensions import db

from .request_view import status_line, stops_for, user_names

MIMETYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
TABLE = "tblRequests"
DANGEROUS = ("=", "+", "-", "@", "\t", "\r", "\n")
DATE_FORMAT = "dd/mm/yyyy"

# (name, header string key, width)
COLUMNS = (
    ("number", "export.col.number", 18), ("status", "export.col.status", 16), ("step", "export.col.step", 26),
    ("directorate", "field.directorate", 22), ("facility", "field.facility", 30),
    ("cost_centre", "field.cost_centre", 30), ("category", "field.category", 16),
    ("position", "field.position", 30), ("posts", "field.positions_count", 12), ("reason", "field.reason", 26),
    ("requester", "export.col.requester", 24), ("waiting_on", "export.col.waiting_on", 36),
    ("days", "export.col.days_waiting", 16), ("round", "export.col.round", 9), ("documents", "export.col.documents", 12),
    ("submitted", "export.col.submitted", 13), ("closed", "export.col.closed", 13),
)
COL = {name: i + 1 for i, (name, _k, _w) in enumerate(COLUMNS)}


def put(ws, row, column, value, number_format=None, formula=False):
    """Write one cell. Strings that could run as a formula are forced to text with the quote prefix.
    Only the summary formulas this module builds are written with `formula=True`."""
    cell = ws.cell(row=row, column=column)
    cell.value = value
    if isinstance(value, str) and value[:1] in DANGEROUS and not formula:
        cell.data_type = "s"
        cell.quotePrefix = True
    if number_format:
        cell.number_format = number_format
    return cell


def _day(value):
    return value.date() if value is not None else None


def request_rows(reqs, tr, now, days_off):
    """One dict per request, in the user's language. Plain data; no workbook code."""
    ids = [r.id for r in reqs]
    counts = {}
    if ids:
        for rid, n in (db.session.query(RequestDocument.request_id, db.func.count(RequestDocument.id))
                       .filter(RequestDocument.request_id.in_(ids)).group_by(RequestDocument.request_id)):
            counts[rid] = n
    lang = tr.lang
    rows = []
    for r in reqs:
        names = user_names([], [t.assignee_user_id for t in r.tasks if t.assignee_user_id])
        waiting, days = "", None
        if r.status == "in_progress":
            line = status_line(r, days_off, now, names)
            parts = []
            for w in line.get("waiting", []):
                parts.append(tr("role." + w["role"]) + (" (%s)" % w["who"] if w.get("who") else ""))
            waiting = "; ".join(parts)
            day_list = [w["days"] for w in line.get("waiting", [])]
            days = max(day_list) if day_list else 0
        elif r.status == "returned":
            waiting = tr("role.requester")
        step = ""
        if r.status in ("in_progress", "returned") and r.current_step:
            step = "%d. %s" % (r.current_step, tr("step.%d" % r.current_step))
        rows.append({
            "number": r.number or "", "status": tr("status." + r.status), "step": step,
            "directorate": r.directorate.name(lang) if r.directorate else "",
            "facility": r.facility.name(lang) if r.facility else "",
            "cost_centre": ("%s %s" % (r.cost_centre.code, r.cost_centre.name(lang))) if r.cost_centre else "",
            "category": tr("category." + r.category) if r.category else "",
            "position": r.position.name(lang) if r.position else "",
            "posts": r.positions_count, "reason": tr("reason." + r.reason) if r.reason else "",
            "requester": r.creator.full_name if r.creator else "", "waiting_on": waiting, "days": days,
            "round": r.round, "documents": counts.get(r.id, 0),
            "submitted": _day(r.submitted_at), "closed": _day(r.closed_at)})
    return rows


class _Translator:
    def __init__(self, lang):
        self.lang = lang

    def __call__(self, key, **params):
        return i18n.translate(key, self.lang, **params)


def _ref(tr, name):
    """Structured reference to one column of the table: tblRequests[[Header]]."""
    header = tr(dict((n, k) for n, k, _w in COLUMNS)[name]).replace("'", "''")
    for ch in "[]#":
        header = header.replace(ch, "'" + ch)
    return "%s[[%s]]" % (TABLE, header)


def _sheet_requests(ws, rows, tr):
    for name, key, width in COLUMNS:
        cell = put(ws, 1, COL[name], tr(key))
        cell.font = Font(bold=True)
        cell.alignment = Alignment(vertical="center", wrap_text=True)
        ws.column_dimensions[get_column_letter(COL[name])].width = width
    for i, row in enumerate(rows, start=2):
        for name, _k, _w in COLUMNS:
            value = row[name]
            if name in ("submitted", "closed"):
                put(ws, i, COL[name], value, DATE_FORMAT)
            elif name in ("posts", "days", "round", "documents"):
                put(ws, i, COL[name], value)
            else:
                put(ws, i, COL[name], value or None)
    last = max(len(rows) + 1, 2)  # a table needs a data row; an empty export keeps one blank row
    table = Table(displayName=TABLE, ref="A1:%s%d" % (get_column_letter(len(COLUMNS)), last))
    table.tableStyleInfo = TableStyleInfo(name="TableStyleMedium2", showRowStripes=True)
    ws.add_table(table)
    ws.freeze_panes = "A2"
    ws.row_dimensions[1].height = 32


def _heading(ws, row, text):
    cell = put(ws, row, 1, text)
    cell.font = Font(bold=True, size=12)


def _group_table(ws, start, title_key, label_key, values, column, tr):
    """A heading, a header row, one row per value and a total row. Returns the next free row."""
    _heading(ws, start, tr(title_key))
    header = start + 1
    for col, text in enumerate((tr(label_key), tr("export.summary.count"), tr("export.summary.posts")), start=1):
        put(ws, header, col, text).font = Font(bold=True)
    first = header + 1
    status, posts = _ref(tr, column), _ref(tr, "posts")
    for i, value in enumerate(values):
        r = first + i
        put(ws, r, 1, value)
        put(ws, r, 2, "=COUNTIFS(%s,$A%d)" % (status, r), formula=True)
        put(ws, r, 3, "=SUMIFS(%s,%s,$A%d)" % (posts, status, r), formula=True)
    last = first + len(values) - 1
    total = last + 1
    put(ws, total, 1, tr("export.summary.total")).font = Font(bold=True)
    for col in (2, 3):
        letter = get_column_letter(col)
        put(ws, total, col, "=SUM(%s%d:%s%d)" % (letter, first, letter, last), formula=True).font = Font(bold=True)
    return total + 2, first


def _sheet_summary(ws, rows, tr):
    ws.column_dimensions["A"].width = 44
    ws.column_dimensions["B"].width = 14
    ws.column_dimensions["C"].width = 14
    statuses = [tr("status." + s) for s in REQUEST_STATUSES]
    directorates = sorted({r["directorate"] for r in rows if r["directorate"]})
    categories = [tr("category." + c) for c in CATEGORIES]
    row, status_first = _group_table(ws, 1, "export.summary.by_status", "export.col.status", statuses, "status", tr)
    row, _ = _group_table(ws, row, "export.summary.by_directorate", "field.directorate", directorates,
                          "directorate", tr)
    row, _ = _group_table(ws, row, "export.summary.by_category", "field.category", categories, "category", tr)
    # Average working days waiting, open requests only: the row of "In progress" in the first table is the criterion.
    open_label = "$A$%d" % (status_first + REQUEST_STATUSES.index("in_progress"))
    put(ws, row, 1, tr("export.summary.avg_days")).font = Font(bold=True)
    cell = put(ws, row, 2, "=IFERROR(AVERAGEIFS(%s,%s,%s),\"\")" % (_ref(tr, "days"), _ref(tr, "status"), open_label),
               formula=True)
    cell.number_format = "0.0"
    ws.cell(row=row, column=1).alignment = Alignment(wrap_text=True, vertical="top")


def _sheet_notes(ws, tr, user_name, now):
    ws.column_dimensions["A"].width = 110
    lines = [tr("export.notes.generated", date="%02d/%02d/%04d" % (now.day, now.month, now.year), who=user_name),
             tr("export.notes.rows"), tr("export.notes.formulas"), tr("export.notes.days")]
    for i, text in enumerate(lines, start=1):
        put(ws, i, 1, text).alignment = Alignment(wrap_text=True, vertical="top")


def build(reqs, lang, user, now, days_off):
    """The workbook as bytes."""
    tr = _Translator(lang)
    rows = request_rows(reqs, tr, now, days_off)
    wb = Workbook()
    ws1 = wb.active
    ws1.title = tr("export.sheet.requests")
    _sheet_requests(ws1, rows, tr)
    _sheet_summary(wb.create_sheet(tr("export.sheet.summary")), rows, tr)
    _sheet_notes(wb.create_sheet(tr("export.sheet.notes")), tr, user.full_name, now)
    wb.properties.creator = "eHR"
    wb.properties.title = tr("export.sheet.requests")
    out = io.BytesIO()
    wb.save(out)
    return out.getvalue()
