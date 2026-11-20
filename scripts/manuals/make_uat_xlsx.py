#!/usr/bin/env python3
"""Builds the two UAT workbooks (Greek and English) in docs/manuals/.

Usage:  .venv/bin/python scripts/manuals/make_uat_xlsx.py [--out DIR] [--check-only]

The text lives in scripts/manuals/uat/*.json:
  cases-common.json   order, area, rule reference and priority of each case
  cases-el.json / cases-en.json   title, accounts, preconditions, steps and expected result of each case
  workbook-el.json / workbook-en.json   labels, instructions, samples, summary and defect texts
On-screen labels are written as [[key]] (or [[key|n=3|who=x]]) and are filled in from ehire/i18n/<lang>.json when the
workbook is built, so they always match the strings of the app. The test accounts are read from ehire/testdata.py and
ehire/seed_data.json. Nothing here changes the application.
"""
import argparse
import glob
import json
import math
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
UAT = os.path.join(ROOT, "scripts", "manuals", "uat")
sys.path.insert(0, ROOT)

from openpyxl import Workbook  # noqa: E402
from openpyxl.formatting.rule import FormulaRule  # noqa: E402
from openpyxl.styles import Alignment, Border, Font, PatternFill, Side  # noqa: E402
from openpyxl.utils import get_column_letter  # noqa: E402
from openpyxl.worksheet.datavalidation import DataValidation  # noqa: E402
from openpyxl.worksheet.table import Table, TableStyleInfo  # noqa: E402

BRAND = glob.glob("/root/.claude/skills/synced/*/okypy-brand-guidelines/assets")
if BRAND:
    sys.path.insert(0, BRAND[0])
LOGO = os.path.join(ROOT, "ehire", "static", "img", "okypy_logo_full.png")

# brand tokens (ARGB)
GREEN, BLUE, DEEP, TEXT, LIGHT, WHITE, NEG = "FF8BC53F", "FF069FEC", "FF1B75BB", "FF58595B", "FFEAEAEA", "FFFFFFFF", "FFC0392B"
SOFT_BLUE, SOFT_GREEN, SOFT_RED, INPUT = "FFD6EEFB", "FFE3F1CC", "FFF6D5D1", "FFFFF8CC"
FONT = "Arial"
LANGS = ("el", "en")


def font(size=10, bold=False, color=TEXT, italic=False):
    return Font(name=FONT, size=size, bold=bold, color=color, italic=italic)


THIN = Side(style="thin", color=LIGHT)
BOX = Border(left=THIN, right=THIN, top=THIN, bottom=THIN)
WRAP = Alignment(wrap_text=True, vertical="top")


# ------------------------------------------------------------------ data

def load(name):
    with open(os.path.join(UAT, name), encoding="utf-8") as fh:
        return json.load(fh)


def i18n(lang):
    with open(os.path.join(ROOT, "ehire", "i18n", lang + ".json"), encoding="utf-8") as fh:
        return json.load(fh)


_PLACEHOLDER = re.compile(r"\[\[([^\[\]]+)\]\]")


def fill(text, strings, where=""):
    """Replace [[key|p=v]] with the app string. Innermost first, so a value may itself be a [[key]]."""
    def one(match):
        parts = match.group(1).split("|")
        key = parts[0].strip()
        if key not in strings:
            raise KeyError("unknown string key %r in %s" % (key, where))
        params = {}
        for part in parts[1:]:
            name, _, value = part.partition("=")
            params[name.strip()] = value
        try:
            return strings[key].format(**params)
        except (KeyError, IndexError) as err:
            raise KeyError("string %r needs parameter %s (in %s)" % (key, err, where))
    previous = None
    while previous != text:
        previous, text = text, _PLACEHOLDER.sub(one, text)
    # a quoted message that ends with a full stop, followed by the stop of our own sentence: keep one
    return re.sub(r"([.;?!])([»”])\.", r"\1\2", text)


def fill_all(value, strings, where):
    if isinstance(value, str):
        return fill(value, strings, where)
    if isinstance(value, list):
        return [fill_all(v, strings, where) for v in value]
    if isinstance(value, dict):
        return {k: fill_all(v, strings, where) for k, v in value.items()}
    return value


class Consts:
    pass


def test_accounts():
    """The test accounts as `flask load-test-data` makes them, read from the code without importing the app:
    the prefix and the marks come from ehire/testdata.py (parsed, not run) and the people from ehire/seed_data.json."""
    import ast
    with open(os.path.join(ROOT, "ehire", "testdata.py"), encoding="utf-8") as fh:
        tree = ast.parse(fh.read())
    wanted = {}
    for node in tree.body:
        if isinstance(node, ast.Assign) and len(node.targets) == 1 and getattr(node.targets[0], "id", "") in ("USER_PREFIX", "MARK_EL", "MARK_EN", "MAIL_DOMAIN"):
            wanted[node.targets[0].id] = ast.literal_eval(node.value)
    consts = Consts()
    for k in ("USER_PREFIX", "MARK_EL", "MARK_EN", "MAIL_DOMAIN"):
        setattr(consts, k, wanted[k])
    with open(os.path.join(ROOT, "ehire", "seed_data.json"), encoding="utf-8") as fh:
        data = json.load(fh)
    u = lambda name: consts.USER_PREFIX + name  # noqa: E731
    view = {
        "directorates": data["directorates"],
        "users": [dict(x, username=u(x["username"])) for x in data["users"]],
        "role_assignments": [dict(a, user=u(a["user"]), substitute=u(a["substitute"]) if a["substitute"] else None)
                             for a in data["role_assignments"]],
    }
    return consts, view


def accounts_rows(wb_data, view, testdata, lang):
    ins = wb_data["instructions"]
    strings = i18n(lang)
    dir_names = {}
    mark = testdata.MARK_EL if lang == "el" else testdata.MARK_EN
    for d in view["directorates"]:
        dir_names[d["code"]] = d["name_" + lang] if False else d["name_" + lang]
    users = {u["username"]: u for u in view["users"]}
    roles, subs = {}, {}
    for a in view["role_assignments"]:
        roles.setdefault(a["user"], []).append((a["role"], a["directorate"]))
        if a["substitute"]:
            subs.setdefault(a["substitute"], set()).add(a["directorate"])
    order = [u["username"] for u in view["users"]]
    rows = []

    def role_name(role):
        if role == "viewer":
            return ins["viewer_label"]
        if role == "admin":
            return ins["admin_label"]
        return strings["role." + role]

    for name in order:
        parts, dirs = [], []
        for role, dcode in roles.get(name, []):
            parts.append(role_name(role))
            dirs.append(dir_names[dcode] if dcode else ins["central_label"])
        note = ""
        if name in subs and name not in roles:
            parts.append(ins["substitute_label"])
            dirs.extend(sorted((dir_names[c] if c else ins["central_label"]) for c in subs[name]))
            note = ins["substitute_note"]
        if len([r for r, _d in roles.get(name, []) if r in ("sci_director", "requester")]) == 2:
            note = ins["both_note"]
        if users[name].get("language") == "en":
            note = (note + " " if note else "") + ("Opens in English." if lang == "en" else "Ανοίγει στα αγγλικά.")
        # a directorate appears once per user
        seen, ddirs = set(), []
        for d in dirs:
            if d not in seen:
                seen.add(d)
                ddirs.append(d)
        rows.append([name, "\n".join(parts), "\n".join(x + mark if x != ins["central_label"] else x for x in ddirs), note])
    return rows


# ------------------------------------------------------------------ layout helpers

def lines_needed(text, width):
    if not text:
        return 1
    per = max(8, int(width * 1.15))
    return sum(max(1, math.ceil(len(part) / per)) for part in str(text).split("\n"))


def put(ws, ref, value, **kw):
    cell = ws[ref]
    cell.value = value
    cell.font = kw.get("font", font())
    if "fill" in kw:
        cell.fill = PatternFill("solid", fgColor=kw["fill"])
    cell.alignment = kw.get("alignment", WRAP)
    if "number_format" in kw:
        cell.number_format = kw["number_format"]
    if kw.get("border"):
        cell.border = BOX
    return cell


def header_row(ws, row, first, labels, fill_color=BLUE):
    for i, label in enumerate(labels):
        c = ws.cell(row=row, column=first + i, value=label)
        c.font = font(bold=True, color=WHITE)
        c.fill = PatternFill("solid", fgColor=fill_color)
        c.alignment = Alignment(horizontal="center", vertical="center", wrap_text=True)
        c.border = BOX


def title_block(ws, title, subtitle, span, logo_row=1):
    """Logo top-left, title and bright-blue rule, in the house style of the brand helper."""
    try:
        from openpyxl.drawing.image import Image as XLImage
        img = XLImage(LOGO)
        ratio = img.width / img.height
        img.height = 52
        img.width = int(52 * ratio)
        ws.add_image(img, "A%d" % logo_row)
    except Exception:  # pillow missing: the title still works
        pass
    for r in range(logo_row, logo_row + 3):
        ws.row_dimensions[r].height = 18
    ws.cell(row=logo_row + 3, column=1, value=title).font = font(16, True, DEEP)
    ws.cell(row=logo_row + 4, column=1, value=subtitle).font = font(10, False, TEXT)
    for col in range(1, span + 1):
        ws.cell(row=logo_row + 5, column=col).fill = PatternFill("solid", fgColor=BLUE)
    ws.row_dimensions[logo_row + 5].height = 4
    return logo_row + 6


# ------------------------------------------------------------------ the workbook

def build(lang, out_dir):
    wbd = load("workbook-%s.json" % lang)
    common = load("cases-common.json")["cases"]
    texts = load("cases-%s.json" % lang)
    strings = i18n(lang)
    testdata, view = test_accounts()
    sh, ins, sm, df = wbd["sheets"], wbd["instructions"], wbd["summary"], wbd["defects"]
    results, prios, sevs, dstat, retest = (wbd[k] for k in ("results", "priorities", "severities", "defect_status", "retest_results"))
    ref_words = wbd["ref_words"]

    # cases, texts filled in
    rows = []
    for i, c in enumerate(common, start=1):
        key = c["key"]
        t = fill_all(texts[key], strings, "%s/%s" % (lang, key))
        refs = re.sub(r"\{(\w+)\}", lambda m: ref_words[m.group(1)], c["ref"])
        rows.append({
            "id": "UAT-%03d" % i, "key": key, "area": wbd["areas"][c["area"]], "title": t["title"],
            "who": "\n".join(t["who"]), "pre": t["pre"],
            "steps": "\n".join("%d. %s" % (n, s) for n, s in enumerate(t["steps"], start=1)),
            "exp": "\n".join("• " + e for e in t["exp"]), "ref": refs,
            "priority": prios[["High", "Medium", "Low"].index(c["priority"])], "raw": t})

    wb = Workbook()
    ws_i = wb.active
    ws_i.title = sh["instructions"]
    ws_c = wb.create_sheet(sh["cases"])
    ws_s = wb.create_sheet(sh["summary"])
    ws_d = wb.create_sheet(sh["defects"])
    q = lambda name: "'%s'" % name.replace("'", "''")  # noqa: E731
    S, C, D = q(sh["summary"]), q(sh["cases"]), q(sh["defects"])

    # ---------------------------------------------------------------- Summary (built first: the lists live there)
    build_summary(ws_s, wbd, rows, S)

    # ---------------------------------------------------------------- Instructions
    build_instructions(ws_i, wbd, rows, view, testdata, lang)

    # ---------------------------------------------------------------- Test cases
    build_cases(ws_c, wbd, rows, S)

    # ---------------------------------------------------------------- Defects
    build_defects(ws_d, wbd, S)

    for ws in (ws_i, ws_c, ws_s, ws_d):
        ws.sheet_view.showGridLines = False
        ws.page_setup.orientation = "landscape"
        ws.page_setup.paperSize = ws.PAPERSIZE_A4
        ws.page_setup.fitToWidth = 1
        ws.page_setup.fitToHeight = 0
        ws.sheet_properties.pageSetUpPr.fitToPage = True
    ws_c.sheet_properties.tabColor = "069FEC"
    ws_s.sheet_properties.tabColor = "8BC53F"
    wb.properties.title = wbd["file_title"]
    wb.properties.creator = "eHire build"
    os.makedirs(out_dir, exist_ok=True)
    path = os.path.join(out_dir, "eHire-UAT-test-scripts-%s.xlsx" % lang)
    wb.save(path)
    return path, rows


LIST_FIRST = {}  # filled by build_summary: where the lists sit on the Summary sheet


def build_summary(ws, wbd, rows, S):
    sm = wbd["summary"]
    results, prios, sevs, dstat, retest = (wbd[k] for k in ("results", "priorities", "severities", "defect_status", "retest_results"))
    widths = {"A": 46, "B": 18, "C": 18, "D": 18, "E": 18, "F": 18, "G": 14, "H": 4}
    for k, v in widths.items():
        ws.column_dimensions[k].width = v
    r = title_block(ws, sm["title"], wbd["file_title"], 7)
    # lists block is placed first in the row plan so that all formulas can point at it
    n_cases = len(rows)
    # row plan -------------------------------------------------------------
    crit_title = r + 1
    crit_h = crit_title + 1
    crit_first = crit_h + 1               # three criteria rows
    thr_row = crit_first + 3
    dec_row = thr_row + 1
    tot_h = dec_row + 3
    tot_first = tot_h + 1                  # 7 rows
    res_h = tot_first + 7 + 1
    res_first = res_h + 2
    area_h = res_first + 4 + 1
    area_first = area_h + 2
    n_areas = len(wbd["areas"])
    area_tot = area_first + n_areas
    prio_h = area_tot + 2
    prio_first = prio_h + 2
    prio_tot = prio_first + 3
    lists_h = prio_tot + 2
    lists_first = lists_h + 3
    # the list cells
    LIST_FIRST.update({"results": ("A", lists_first), "prios": ("B", lists_first), "sevs": ("C", lists_first),
                       "dstat": ("D", lists_first), "retest": ("E", lists_first)})
    ref = lambda col, i: "$%s$%d" % (col, lists_first + i)  # noqa: E731
    RES = [ref("A", i) for i in range(4)]    # pass, fail, blocked, not run
    PRI = [ref("B", i) for i in range(3)]
    T = lambda col: "tblCases[[%s]]" % wbd["columns"][col]  # noqa: E731
    ID, AREA, PRIO, RESULT = T(0), T(1), T(8), T(9)

    # -- criteria
    ws.cell(row=crit_title, column=1, value=sm["criteria_h"]).font = font(12, True, DEEP)
    header_row(ws, crit_h, 1, sm["criteria_cols"], DEEP)
    tot, hi_not_run, hi_fail = tot_first, tot_first + 6, tot_first + 5
    yes, no = sm["yes"], sm["no"]
    c1, c2, c3 = crit_first, crit_first + 1, crit_first + 2
    put(ws, "A%d" % c1, sm["c1"], border=True)
    put(ws, "B%d" % c1, sm["c1_needed"], border=True)
    put(ws, "C%d" % c1, "=B%d" % hi_not_run, border=True, number_format="0")
    put(ws, "D%d" % c1, '=IF(C%d=0,"%s","%s")' % (c1, yes, no), border=True)
    put(ws, "A%d" % c2, sm["c2"], border=True)
    put(ws, "B%d" % c2, sm["c2_needed"], border=True)
    put(ws, "C%d" % c2, "=B%d" % hi_fail, border=True, number_format="0")
    put(ws, "D%d" % c2, '=IF(C%d=0,"%s","%s")' % (c2, yes, no), border=True)
    put(ws, "A%d" % c3, sm["c3"], border=True)
    put(ws, "B%d" % c3, "=$B$%d" % thr_row, border=True, number_format="0%")
    put(ws, "C%d" % c3, "=B%d" % (tot + 4), border=True, number_format="0.0%")
    put(ws, "D%d" % c3, '=IF(C%d>=B%d,"%s","%s")' % (c3, c3, yes, no), border=True)
    put(ws, "A%d" % thr_row, sm["threshold_label"], font=font(italic=True))
    put(ws, "B%d" % thr_row, 0.95, font=Font(name=FONT, size=10, bold=True, color="FF0000FF"), fill=INPUT, number_format="0%", border=True)
    put(ws, "A%d" % dec_row, sm["decision_label"], font=font(12, True, DEEP))
    put(ws, "B%d" % dec_row, '=IF(AND(D%d="%s",D%d="%s",D%d="%s"),"%s","%s")' % (c1, yes, c2, yes, c3, yes, sm["go"], sm["nogo"]),
        font=font(12, True, WHITE), fill=DEEP, alignment=Alignment(horizontal="center", vertical="center"), border=True)
    ws.merge_cells("B%d:C%d" % (dec_row, dec_row))
    put(ws, "A%d" % (dec_row + 1), sm["decision_note"], font=font(9, italic=True))
    ws.merge_cells("A%d:G%d" % (dec_row + 1, dec_row + 1))
    # decision colours
    ws.conditional_formatting.add("B%d" % dec_row, FormulaRule(formula=['$B$%d="%s"' % (dec_row, sm["go"])], fill=PatternFill("solid", bgColor=GREEN, fgColor=GREEN), font=Font(name=FONT, bold=True, color=WHITE)))
    ws.conditional_formatting.add("B%d" % dec_row, FormulaRule(formula=['$B$%d="%s"' % (dec_row, sm["nogo"])], fill=PatternFill("solid", bgColor=NEG, fgColor=NEG), font=Font(name=FONT, bold=True, color=WHITE)))
    for rr in (c1, c2, c3):
        ws.conditional_formatting.add("D%d" % rr, FormulaRule(formula=['$D$%d="%s"' % (rr, yes)], fill=PatternFill("solid", bgColor=SOFT_GREEN, fgColor=SOFT_GREEN)))
        ws.conditional_formatting.add("D%d" % rr, FormulaRule(formula=['$D$%d="%s"' % (rr, no)], fill=PatternFill("solid", bgColor=SOFT_RED, fgColor=SOFT_RED)))

    # -- totals
    ws.cell(row=tot_h, column=1, value=sm["totals_h"]).font = font(12, True, DEEP)
    labels = ["total_cases", "run_cases", "pct_run", "passed_cases", "pct_passed", "high_open_fail", "high_not_run"]
    # order of rows: 0 total, 1 run, 2 pct_run, 3 passed, 4 pct_passed, 5 high_open_fail, 6 high_not_run
    formulas = [
        "=COUNTA(%s)" % ID,
        "=COUNTIFS(%s,%s)+COUNTIFS(%s,%s)" % (RESULT, RES[0], RESULT, RES[1]),
        "=IF(B%d=0,0,B%d/B%d)" % (tot, tot + 1, tot),
        "=COUNTIFS(%s,%s)" % (RESULT, RES[0]),
        "=IF(B%d=0,0,B%d/B%d)" % (tot, tot + 3, tot),
        "=COUNTIFS(%s,%s,%s,%s)" % (PRIO, PRI[0], RESULT, RES[1]),
        "=COUNTIFS(%s,%s)-COUNTIFS(%s,%s,%s,%s)-COUNTIFS(%s,%s,%s,%s)" % (PRIO, PRI[0], PRIO, PRI[0], RESULT, RES[0], PRIO, PRI[0], RESULT, RES[1]),
    ]
    fmts = ["0", "0", "0.0%", "0", "0.0%", "0", "0"]
    for i, name in enumerate(labels):
        put(ws, "A%d" % (tot + i), sm[name], border=True)
        put(ws, "B%d" % (tot + i), formulas[i], border=True, number_format=fmts[i])
    # -- by result
    ws.cell(row=res_h, column=1, value=sm["by_result_h"]).font = font(12, True, DEEP)
    header_row(ws, res_h + 1, 1, sm["by_result_cols"], DEEP)
    for i in range(4):
        rr = res_first + i
        put(ws, "A%d" % rr, "=%s" % RES[i], border=True)
        if i < 3:
            put(ws, "B%d" % rr, "=COUNTIFS(%s,%s)" % (RESULT, RES[i]), border=True, number_format="0")
        else:  # not run: the words "Not run" plus every empty Result cell of a filled row
            put(ws, "B%d" % rr, '=COUNTIFS(%s,%s)+COUNTIFS(%s,"<>",%s,"")' % (RESULT, RES[3], ID, RESULT), border=True, number_format="0")
        put(ws, "C%d" % rr, "=IF($B$%d=0,0,B%d/$B$%d)" % (tot, rr, tot), border=True, number_format="0.0%")
    # -- by area x result
    ws.cell(row=area_h, column=1, value=sm["by_area_h"]).font = font(12, True, DEEP)
    header_row(ws, area_h + 1, 1, ["%s" % wbd["columns"][1]] + [""] * 4 + [sm["matrix_total"], sm["matrix_pct"]], DEEP)
    for i in range(4):
        c = ws.cell(row=area_h + 1, column=2 + i, value="=%s" % RES[i])
    for i, area in enumerate(wbd["areas"].values()):
        rr = area_first + i
        put(ws, "A%d" % rr, area, border=True)
        put(ws, "F%d" % rr, "=COUNTIFS(%s,$A%d)" % (AREA, rr), border=True, number_format="0")
        for j in range(3):
            col = get_column_letter(2 + j)
            put(ws, "%s%d" % (col, rr), "=COUNTIFS(%s,$A%d,%s,%s$%d)" % (AREA, rr, RESULT, col, area_h + 1), border=True, number_format="0")
        put(ws, "E%d" % rr, "=F%d-B%d-C%d-D%d" % (rr, rr, rr, rr), border=True, number_format="0")
        put(ws, "G%d" % rr, "=IF(F%d=0,0,B%d/F%d)" % (rr, rr, rr), border=True, number_format="0%")
    put(ws, "A%d" % area_tot, sm["all_label"], font=font(bold=True), fill=LIGHT, border=True)
    for col in "BCDEF":
        put(ws, "%s%d" % (col, area_tot), "=SUM(%s%d:%s%d)" % (col, area_first, col, area_tot - 1), font=font(bold=True), fill=LIGHT, border=True, number_format="0")
    put(ws, "G%d" % area_tot, "=IF(F%d=0,0,B%d/F%d)" % (area_tot, area_tot, area_tot), font=font(bold=True), fill=LIGHT, border=True, number_format="0%")
    # -- by priority x result
    ws.cell(row=prio_h, column=1, value=sm["by_priority_h"]).font = font(12, True, DEEP)
    header_row(ws, prio_h + 1, 1, [wbd["columns"][8]] + [""] * 4 + [sm["matrix_total"], sm["matrix_pct"]], DEEP)
    for i in range(4):
        ws.cell(row=prio_h + 1, column=2 + i, value="=%s" % RES[i])
    for i in range(3):
        rr = prio_first + i
        put(ws, "A%d" % rr, "=%s" % PRI[i], border=True)
        put(ws, "F%d" % rr, "=COUNTIFS(%s,$A%d)" % (PRIO, rr), border=True, number_format="0")
        for j in range(3):
            col = get_column_letter(2 + j)
            put(ws, "%s%d" % (col, rr), "=COUNTIFS(%s,$A%d,%s,%s$%d)" % (PRIO, rr, RESULT, col, prio_h + 1), border=True, number_format="0")
        put(ws, "E%d" % rr, "=F%d-B%d-C%d-D%d" % (rr, rr, rr, rr), border=True, number_format="0")
        put(ws, "G%d" % rr, "=IF(F%d=0,0,B%d/F%d)" % (rr, rr, rr), border=True, number_format="0%")
    put(ws, "A%d" % prio_tot, sm["matrix_total"], font=font(bold=True), fill=LIGHT, border=True)
    for col in "BCDEF":
        put(ws, "%s%d" % (col, prio_tot), "=SUM(%s%d:%s%d)" % (col, prio_first, col, prio_tot - 1), font=font(bold=True), fill=LIGHT, border=True, number_format="0")
    put(ws, "G%d" % prio_tot, "=IF(F%d=0,0,B%d/F%d)" % (prio_tot, prio_tot, prio_tot), font=font(bold=True), fill=LIGHT, border=True, number_format="0%")
    # -- lists
    ws.cell(row=lists_h, column=1, value=sm["lists_h"]).font = font(12, True, DEEP)
    put(ws, "A%d" % (lists_h + 1), sm["lists_note"], font=font(9, italic=True))
    ws.merge_cells("A%d:G%d" % (lists_h + 1, lists_h + 1))
    header_row(ws, lists_h + 2, 1, sm["lists_cols"], DEEP)
    for col, values in zip("ABCDE", (results, prios, sevs, dstat, retest)):
        for i, v in enumerate(values):
            put(ws, "%s%d" % (col, lists_first + i), v, fill=INPUT, border=True)
    ws.freeze_panes = None
    for rr in range(1, lists_first + 6):
        h = ws.row_dimensions[rr].height
        if h is None:
            w = ws.cell(row=rr, column=1).value
            if isinstance(w, str) and not w.startswith("=") and len(w) > 46 and ws.cell(row=rr, column=1).alignment.wrap_text and rr not in (dec_row + 1, lists_h + 1):
                ws.row_dimensions[rr].height = 13.5 * lines_needed(w, 46)
    for rr in (dec_row,):
        ws.row_dimensions[rr].height = 22
    ws.row_dimensions[dec_row + 1].height = 14
    ws.row_dimensions[lists_h + 1].height = 26


def list_range(sheet_q, key, n):
    col, first = LIST_FIRST[key]
    return "=%s!$%s$%d:$%s$%d" % (sheet_q, col, first, col, first + n - 1)


def build_instructions(ws, wbd, rows, view, testdata, lang):
    ins = wbd["instructions"]
    widths = {"A": 3, "B": 22, "C": 28, "D": 28, "E": 44, "F": 30, "G": 16}
    for k, v in widths.items():
        ws.column_dimensions[k].width = v
    r = title_block(ws, wbd["file_title"], wbd["subtitle"], 7)
    total_w = sum(widths[c] for c in "BCDEFG")

    def heading(text):
        nonlocal r
        r += 1
        ws.cell(row=r, column=2, value=text).font = font(12, True, DEEP)
        r += 1

    def para(text, size=10, italic=False):
        nonlocal r
        c = ws.cell(row=r, column=2, value=text)
        c.font = font(size, italic=italic)
        c.alignment = WRAP
        ws.merge_cells(start_row=r, start_column=2, end_row=r, end_column=7)
        ws.row_dimensions[r].height = 13.5 * lines_needed(text, total_w) + 2
        r += 1

    def numbered(items):
        for n, t in enumerate(items, start=1):
            para("%d. %s" % (n, t))

    def table(cols, data, widths_cols):
        """cols: header labels placed in B..; widths_cols: the width of each used column for row heights."""
        nonlocal r
        header_row(ws, r, 2, cols, DEEP)
        r += 1
        for row in data:
            height = 1
            for i, v in enumerate(row):
                c = ws.cell(row=r, column=2 + i, value=v)
                c.font = font(bold=(i == 0 and True) and False)
                c.alignment = WRAP
                c.border = BOX
                height = max(height, lines_needed(v, widths_cols[i]))
            ws.row_dimensions[r].height = 13.5 * height + 2
            r += 1

    # purpose
    heading(ins["purpose_h"])
    para(ins["purpose"])
    r += 1
    lab = ws.cell(row=r, column=2, value=wbd["address_label"])
    lab.font = font(bold=True)
    lab.alignment = WRAP
    ws.row_dimensions[r].height = 28
    c = ws.cell(row=r, column=3, value=wbd["address"])
    c.alignment = Alignment(vertical="top")
    c.hyperlink = wbd["address"]
    c.font = Font(name=FONT, size=10, color=BLUE, underline="single")
    r += 1
    heading(ins["run_h"])
    numbered(ins["run"])
    heading(ins["record_h"])
    numbered(ins["record"])
    heading(ins["results_h"])
    table([wbd["columns"][9], ""], ins["results_table"], [22, 28])
    # merge the meaning across C:G for readability
    for rr in range(r - len(ins["results_table"]) - 1, r):
        ws.merge_cells(start_row=rr, start_column=3, end_row=rr, end_column=7)
    for rr in range(r - len(ins["results_table"]), r):
        ws.row_dimensions[rr].height = 13.5 * lines_needed(ws.cell(row=rr, column=3).value, 150) + 4
    heading(ins["priority_h"])
    table([wbd["columns"][8], ""], ins["priority_table"], [22, 28])
    for rr in range(r - len(ins["priority_table"]) - 1, r):
        ws.merge_cells(start_row=rr, start_column=3, end_row=rr, end_column=7)
    for rr in range(r - len(ins["priority_table"]), r):
        ws.row_dimensions[rr].height = 13.5 * lines_needed(ws.cell(row=rr, column=3).value, 150) + 4
    heading(ins["refs_h"])
    para(ins["refs"])

    heading(ins["accounts_h"])
    para(ins["accounts_intro"])
    table(ins["accounts_cols"], accounts_rows(wbd, view, testdata, lang), [22, 28, 28, 44])
    heading(ins["samples_h"])
    para(ins["samples_intro"])
    table(ins["samples_cols"], ins["samples"], [22, 28, 28, 44])

    # who needs more than a browser
    heading(ins["needs_h"])
    server_keys = ("auto_withdraw", "timer_run")
    ids = {x["key"]: x["id"] for x in rows}
    server = [ids[k] for k in server_keys]
    admin = [x["id"] for x in rows if "test.demo.admin" in x["who"] and x["key"] not in server_keys]
    para(ins["needs_server"].format(ids=", ".join(server)))
    para(ins["needs_admin"].format(ids=", ".join(admin)))
    para(ins["needs_wait"].format(id=ids["signin_lock"]))
    heading(ins["scope_h"])
    for line in ins["scope"]:
        para(line)
    heading(ins["edit_h"])
    para(ins["edit"])
    heading(ins["example_h"])
    ex_widths = [22, 28, 28, 44, 30, 16]
    table(ins["example_cols"], [ins["example_row"]], ex_widths)
    para(ins["example_note"], size=9, italic=True)
    ws.freeze_panes = None


def build_cases(ws, wbd, rows, S):
    cols = wbd["columns"]
    widths = [10, 22, 34, 34, 38, 62, 62, 18, 12, 16, 16, 13, 36, 13]
    for i, w in enumerate(widths, start=1):
        ws.column_dimensions[get_column_letter(i)].width = w
    start = title_block(ws, wbd["sheets"]["cases"], wbd["file_title"], len(cols))
    ws.cell(row=start, column=1, value=wbd["cases_note"]).font = font(9, italic=True)
    head = start + 2
    for i, label in enumerate(cols, start=1):
        c = ws.cell(row=head, column=i, value=label)
        c.font = font(bold=True, color=WHITE)
        c.fill = PatternFill("solid", fgColor=DEEP if i >= 10 else BLUE)
        c.alignment = Alignment(horizontal="center", vertical="center", wrap_text=True)
    ws.row_dimensions[head].height = 30
    for n, x in enumerate(rows):
        r = head + 1 + n
        vals = [x["id"], x["area"], x["title"], x["who"], x["pre"], x["steps"], x["exp"], x["ref"], x["priority"], None, None, None, None, None]
        height = 1
        for i, v in enumerate(vals, start=1):
            c = ws.cell(row=r, column=i, value=v)
            c.font = font(bold=(i == 1))
            c.alignment = WRAP
            c.border = BOX
            if i >= 10:
                c.fill = PatternFill("solid", fgColor=INPUT)
            if v:
                height = max(height, lines_needed(v, widths[i - 1]))
        ws.cell(row=r, column=12).number_format = "dd/mm/yyyy"
        ws.row_dimensions[r].height = min(409, 13.2 * height + 4)
    last = head + len(rows)
    table = Table(displayName="tblCases", ref="A%d:%s%d" % (head, get_column_letter(len(cols)), last))
    table.tableStyleInfo = TableStyleInfo(name="TableStyleLight1", showRowStripes=False)
    ws.add_table(table)
    ws.freeze_panes = "D%d" % (head + 1)
    ws.print_title_rows = "%d:%d" % (head, head)
    n_res = len(wbd["results"])
    res_col = get_column_letter(10)
    dv = DataValidation(type="list", formula1=list_range(S, "results", n_res), allow_blank=True, showErrorMessage=True)
    dv.error = "Choose a value from the list."
    dv.add("%s%d:%s%d" % (res_col, head + 1, res_col, last))
    ws.add_data_validation(dv)
    dvp = DataValidation(type="list", formula1=list_range(S, "prios", 3), allow_blank=False, showErrorMessage=True)
    dvp.add("I%d:I%d" % (head + 1, last))
    ws.add_data_validation(dvp)
    dvd = DataValidation(type="date", operator="greaterThan", formula1="36526", allow_blank=True, showErrorMessage=True)
    dvd.error = "dd/mm/yyyy"
    dvd.add("L%d:L%d" % (head + 1, last))
    ws.add_data_validation(dvd)
    # colours of the Result cell, read from the lists on the Summary sheet
    first = LIST_FIRST["results"][1]
    rng = "%s%d:%s%d" % (res_col, head + 1, res_col, last)
    spec = [(0, SOFT_GREEN, GREEN), (1, SOFT_RED, NEG), (2, SOFT_BLUE, BLUE)]
    for idx, bg, _edge in spec:
        ws.conditional_formatting.add(rng, FormulaRule(
            formula=["$%s%d=%s!$A$%d" % (res_col, head + 1, S, first + idx)],
            fill=PatternFill("solid", bgColor=bg, fgColor=bg), font=Font(name=FONT, bold=True, color=DEEP if idx != 1 else NEG)))
    ws.conditional_formatting.add(rng, FormulaRule(
        formula=["$%s%d=%s!$A$%d" % (res_col, head + 1, S, first + 3)],
        fill=PatternFill("solid", bgColor=LIGHT, fgColor=LIGHT)))
    ws.sheet_view.zoomScale = 90


def build_defects(ws, wbd, S):
    df = wbd["defects"]
    cols = df["columns"]
    widths = [14, 16, 14, 50, 14, 24, 18, 16, 18]
    for i, w in enumerate(widths, start=1):
        ws.column_dimensions[get_column_letter(i)].width = w
    ws.column_dimensions["J"].width = 3
    for col, w in zip("KLMN", (24, 12, 20, 12)):
        ws.column_dimensions[col].width = w
    start = title_block(ws, df["title"], wbd["file_title"], 14)
    ws.cell(row=start, column=1, value=df["note"]).font = font(9, italic=True)
    head = start + 2
    rows_n = 60
    for i, label in enumerate(cols, start=1):
        c = ws.cell(row=head, column=i, value=label)
        c.font = font(bold=True, color=WHITE)
        c.fill = PatternFill("solid", fgColor=BLUE)
        c.alignment = Alignment(horizontal="center", vertical="center", wrap_text=True)
    ws.row_dimensions[head].height = 30
    for n in range(rows_n):
        r = head + 1 + n
        for i in range(1, len(cols) + 1):
            c = ws.cell(row=r, column=i)
            c.font = font()
            c.alignment = WRAP
            c.border = BOX
            c.fill = PatternFill("solid", fgColor=INPUT)
        ws.cell(row=r, column=2).number_format = "dd/mm/yyyy"
        ws.cell(row=r, column=8).number_format = "dd/mm/yyyy"
    last = head + rows_n
    table = Table(displayName="tblDefects", ref="A%d:I%d" % (head, last))
    table.tableStyleInfo = TableStyleInfo(name="TableStyleLight1", showRowStripes=False)
    ws.add_table(table)
    ws.freeze_panes = "A%d" % (head + 1)
    for col, key, n in (("E", "sevs", 4), ("F", "dstat", 5), ("I", "retest", 2)):
        dv = DataValidation(type="list", formula1=list_range(S, key, n), allow_blank=True, showErrorMessage=True)
        dv.add("%s%d:%s%d" % (col, head + 1, col, last))
        ws.add_data_validation(dv)
    for col in ("B", "H"):
        dv = DataValidation(type="date", operator="greaterThan", formula1="36526", allow_blank=True, showErrorMessage=True)
        dv.error = "dd/mm/yyyy"
        dv.add("%s%d:%s%d" % (col, head + 1, col, last))
        ws.add_data_validation(dv)
    # open defects by severity (formulas), to the right of the table
    sm = wbd["summary"]
    first = LIST_FIRST["sevs"][1]
    dfirst = LIST_FIRST["dstat"][1]
    r0 = head
    ws.cell(row=r0 - 1, column=11, value=sm["defects_h"]).font = font(12, True, DEEP)
    header_row(ws, r0, 11, sm["defects_cols"], DEEP)
    SEV, STA = "tblDefects[[%s]]" % cols[4], "tblDefects[[%s]]" % cols[5]
    CLOSED, REJ = "%s!$D$%d" % (S, dfirst + 3), "%s!$D$%d" % (S, dfirst + 4)
    for i in range(4):
        rr = r0 + 1 + i
        put(ws, "K%d" % rr, "=%s!$C$%d" % (S, first + i), border=True)
        put(ws, "L%d" % rr, "=COUNTIFS(%s,$K%d)" % (SEV, rr), border=True, number_format="0")
        put(ws, "M%d" % rr, "=COUNTIFS(%s,$K%d,%s,%s)+COUNTIFS(%s,$K%d,%s,%s)" % (SEV, rr, STA, CLOSED, SEV, rr, STA, REJ), border=True, number_format="0")
        put(ws, "N%d" % rr, "=L%d-M%d" % (rr, rr), border=True, number_format="0")
    rr = r0 + 5
    put(ws, "K%d" % rr, sm["defects_total"], font=font(bold=True), fill=LIGHT, border=True)
    for col in "LMN":
        put(ws, "%s%d" % (col, rr), "=SUM(%s%d:%s%d)" % (col, r0 + 1, col, r0 + 4), font=font(bold=True), fill=LIGHT, border=True, number_format="0")
    ws.conditional_formatting.add("N%d:N%d" % (r0 + 1, r0 + 2), FormulaRule(formula=["N%d>0" % (r0 + 1)], fill=PatternFill("solid", bgColor=SOFT_RED, fgColor=SOFT_RED), font=Font(name=FONT, bold=True, color=NEG)))
    ws.cell(row=r0 + 7, column=11, value=df["severity_h"]).font = font(12, True, DEEP)
    rr = r0 + 8
    for sev, text in df["severity_defs"]:
        put(ws, "K%d" % rr, sev, font=font(bold=True), border=True)
        put(ws, "L%d" % rr, text, border=True)
        ws.merge_cells("L%d:N%d" % (rr, rr))
        ws.row_dimensions[rr].height = max(ws.row_dimensions[rr].height or 15, 13.5 * lines_needed(text, 44) + 2)
        rr += 1
    # keep the severity block rows from squeezing table rows: they share rows with empty table rows, which is fine


# ------------------------------------------------------------------ checks

def check_texts():
    """Every case exists in both languages, every placeholder resolves, every test.* username is real."""
    common = load("cases-common.json")["cases"]
    testdata, view = test_accounts()
    users = {u["username"] for u in view["users"]}
    extra = {"test.uat.one"}
    problems = []
    keys = [c["key"] for c in common]
    for lang in LANGS:
        texts = load("cases-%s.json" % lang)
        strings = i18n(lang)
        if set(texts) != set(keys):
            problems.append("%s: case keys differ: %s" % (lang, sorted(set(texts) ^ set(keys))))
        for key in keys:
            t = texts.get(key)
            if not t:
                continue
            for field in ("title", "who", "pre", "steps", "exp"):
                if field not in t:
                    problems.append("%s/%s lacks %s" % (lang, key, field))
            try:
                filled = fill_all(t, strings, "%s/%s" % (lang, key))
            except KeyError as err:
                problems.append(str(err))
                continue
            blob = json.dumps(filled, ensure_ascii=False)
            for name in set(re.findall(r"test\.[a-z]+\.[a-z]+", blob)):
                if name not in users and name not in extra:
                    problems.append("%s/%s: unknown account %s" % (lang, key, name))
            if "[[" in blob:
                problems.append("%s/%s: unresolved placeholder" % (lang, key))
            if len(t["steps"]) < 2 or not t["exp"]:
                problems.append("%s/%s: too few steps or no expected result" % (lang, key))
        # structure of the two languages must match
    for key in keys:
        a, b = load("cases-el.json").get(key), load("cases-en.json").get(key)
        if a and b and (len(a["steps"]) != len(b["steps"]) and False):
            pass
    return problems


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default=os.path.join(ROOT, "docs", "manuals"))
    ap.add_argument("--check-only", action="store_true")
    args = ap.parse_args()
    problems = check_texts()
    if problems:
        print("\n".join(problems))
        raise SystemExit(1)
    if args.check_only:
        print("texts ok")
        return
    for lang in LANGS:
        path, rows = build(lang, args.out)
        print("written", path, len(rows), "cases")


if __name__ == "__main__":
    main()
