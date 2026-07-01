# -*- coding: utf-8 -*-
"""
core/inject.py — fill the approved template with fresh numbers + commentary.

Design (spec §7): do NOT rebuild the deck. Start from the verbatim approved
`presentation_template.html` and inject into stable, text-anchored positions:
  1. the four sec-exec table bodies (anchored by title → <tbody>);
  2. the exec bar-chart series in the inline <script>;
  3. the ΣΥΝΟΨΗ headline figures + period strings;
  4. the inpatient narrative + up to 4 alert lines.
Then validate structure (tag-balance delta preserved) and `node --check` the
inline script before returning. Any breach raises — the caller must not write.
"""
from __future__ import annotations

import re
import shutil
import subprocess
import tempfile
from dataclasses import dataclass, field

import config
from core.metrics import Metrics, Row, VarianceTable

EURO = "€"   # €
MINUS = "−"  # − (real minus, never hyphen)
NBSP = "\xa0"


# ── report ───────────────────────────────────────────────────────────────────
@dataclass
class InjectReport:
    replacements: list[tuple[str, int]] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)

    def note(self, label: str, count: int, required: bool = False):
        self.replacements.append((label, count))
        if required and count == 0:
            self.warnings.append(f"Δεν βρέθηκε το άγκυρα-κείμενο για «{label}».")


# ── formatting (spec §6) ─────────────────────────────────────────────────────
def _m1(v: float) -> float:
    mv = round(v / 1e6, 1)
    return 0.0 if mv == 0 else mv  # kill -0.0


def fmt_m(v: float) -> str:
    """€46,6  /  −€4,0  (millions, 1 decimal, Greek comma, real minus)."""
    mv = _m1(v)
    sign = MINUS if mv < 0 else ""
    return f"{sign}{EURO}{abs(mv):.1f}".replace(".", ",")


def fmt_var(v: float) -> str:
    """+€1,9 / −€0,2 / €0,0 (signed variance)."""
    mv = _m1(v)
    sign = "+" if mv > 0 else (MINUS if mv < 0 else "")
    return f"{sign}{EURO}{abs(mv):.1f}".replace(".", ",")


def fmt_mM(v: float) -> str:
    return fmt_m(v) + "Μ"


def fmt_varM(v: float) -> str:
    return fmt_var(v) + "Μ"


def fmt_absM(v: float) -> str:
    return f"{EURO}{abs(_m1(v)):.1f}".replace(".", ",") + "Μ"


def fmt_pct(p: float) -> str:
    sign = "+" if p > 0 else (MINUS if p < 0 else "")
    return f"{sign}{abs(p):.1f}".replace(".", ",") + "%"


def fmt_pct_plain(p: float) -> str:
    return f"{p:.1f}".replace(".", ",") + "%"


def _jm(v: float) -> str:
    """JS millions, dot decimal, 1 place (for chart data)."""
    return f"{v / 1e6:.1f}"


def _jarr(arr) -> str:
    return "[" + ", ".join(_jm(x) for x in arr) + "]"


def _vcls(v: float, fav: str) -> str:
    mv = _m1(v)
    if mv == 0:
        return "vz"
    if fav == "rev":
        return "vp" if mv > 0 else "vn"
    return "vn" if mv > 0 else "vp"  # expense: over budget = adverse (vn)


# ── results-table rows (ΜΗΝΑ / ΣΩΡΕΥΤΙΚΑ) ────────────────────────────────────
def _result_row_html(r: Row) -> str:
    if r.kind == "ebitda":
        lbl = "padding:10px 16px;font-weight:800;color:var(--neg);background:#FFF0F5"
        n26 = "text-align:center;padding:10px 10px;font-weight:800;color:var(--neg);background:#FFF0F5"
        noth = "text-align:center;padding:10px 10px;font-weight:700;color:var(--neg);background:#FFF0F5"
        var = "text-align:center;padding:10px 10px;font-weight:800;background:#FFF0F5"
        return ('<tr style="border-top:2px solid var(--ink-200)">'
                f'<td style="{lbl}">{r.label}</td>'
                f'<td style="{n26}">{fmt_m(r.v2026)}</td>'
                f'<td style="{noth}">{fmt_m(r.v2025)}</td>'
                f'<td style="{noth}">{fmt_m(r.budget)}</td>'
                f'<td style="{var}" class="{_vcls(r.vpy, r.fav)}">{fmt_var(r.vpy)}</td>'
                f'<td style="{var}" class="{_vcls(r.v25, r.fav)}">{fmt_var(r.v25)}</td>'
                '</tr>')
    if r.kind == "subtotal":
        bg = "#eef2f6"
        lbl = f"padding:10px 16px;font-weight:700;background:{bg}"
        num = f"text-align:center;padding:10px 10px;font-weight:700;background:{bg}"
    else:  # detail
        bg = "#fff"
        lbl = f"padding:8px 16px 8px 30px;background:{bg};color:var(--ink-700)"
        num = f"text-align:center;padding:8px 10px;background:{bg}"
    return ('<tr>'
            f'<td style="{lbl}">{r.label}</td>'
            f'<td style="{num}">{fmt_m(r.v2026)}</td>'
            f'<td style="{num}">{fmt_m(r.v2025)}</td>'
            f'<td style="{num}">{fmt_m(r.budget)}</td>'
            f'<td style="{num}" class="{_vcls(r.vpy, r.fav)}">{fmt_var(r.vpy)}</td>'
            f'<td style="{num}" class="{_vcls(r.v25, r.fav)}">{fmt_var(r.v25)}</td>'
            '</tr>')


def _results_body(rows: list[Row]) -> str:
    return "\n            ".join(_result_row_html(r) for r in rows)


# ── variance-table rows (ΑΠΟΚΛΙΣΕΙΣ) ─────────────────────────────────────────
def _variance_detail_html(r: Row, adverse: bool) -> str:
    bg = "#FCE4EC" if adverse else "#fff"
    lbl = f"padding:8px 14px;background:{bg}"
    num = f"text-align:center;padding:8px 10px;background:{bg}"
    return ('<tr>'
            f'<td style="{lbl}">{r.label}</td>'
            f'<td style="{num}">{fmt_m(r.v2026)}</td>'
            f'<td style="{num}">{fmt_m(r.v2025)}</td>'
            f'<td style="{num}">{fmt_m(r.budget)}</td>'
            f'<td style="{num}" class="{_vcls(r.vpy, r.fav)}">{fmt_var(r.vpy)}</td>'
            f'<td style="{num}" class="{_vcls(r.v25, r.fav)}">{fmt_var(r.v25)}</td>'
            '</tr>')


def _variance_total_html(r: Row) -> str:
    lbl = "padding:9px 14px"
    num = "text-align:center;padding:9px 10px"
    return ('<tr class="tr-total">\n'
            f'              <td style="{lbl}">{r.label}</td>\n'
            f'              <td style="{num}">{fmt_m(r.v2026)}</td>\n'
            f'              <td style="{num}">{fmt_m(r.v2025)}</td>\n'
            f'              <td style="{num}">{fmt_m(r.budget)}</td>\n'
            f'              <td style="{num}" class="{_vcls(r.vpy, r.fav)}">{fmt_var(r.vpy)}</td>\n'
            f'              <td style="{num}" class="{_vcls(r.v25, r.fav)}">{fmt_var(r.v25)}</td>\n'
            '            </tr>')


def _variance_body(vt: VarianceTable) -> str:
    adverse_neg = vt.total.fav == "rev"  # revenue: negative vpy is adverse
    parts = []
    for r in vt.rows:
        adverse = (r.vpy < 0) if adverse_neg else (r.vpy > 0)
        parts.append(_variance_detail_html(r, adverse))
    parts.append(_variance_detail_html(vt.loipes, adverse=False))  # ΣΥΝΟΛΟ/Λοιπές stay white
    body = "\n            ".join(parts)
    return body + "\n            " + _variance_total_html(vt.total)


# ── tbody splice ─────────────────────────────────────────────────────────────
def _replace_tbody(html: str, anchor: str, body: str) -> str:
    i = html.index(anchor)
    ts = html.index("<tbody>", i)
    te = html.index("</tbody>", ts)
    return html[:ts + len("<tbody>")] + "\n            " + body + "\n          " + html[te:]


# ── exec bar charts ──────────────────────────────────────────────────────────
def _process_chart_slice(slice_: str, total: float, prior_label: str, cur_label: str,
                         prior_arr, cur_arr) -> str:
    slice_ = re.sub(r"makeRefLinePlugin\(\s*[-\d.]+",
                    f"makeRefLinePlugin({_jm(total)}", slice_, count=1)
    pairs = list(re.finditer(r"label:'([^']*)',(\s*)data:\[([^\]]*)\]", slice_))
    if len(pairs) >= 2:
        labels = [prior_label, cur_label]
        arrs = [_jarr(prior_arr), _jarr(cur_arr)]
        for k in (1, 0):  # replace from the later match first to keep offsets
            mobj = pairs[k]
            repl = f"label:'{labels[k]}',{mobj.group(2)}data:{arrs[k]}"
            slice_ = slice_[:mobj.start()] + repl + slice_[mobj.end():]
    return slice_


def _inject_exec_charts(html: str, m: Metrics, mm: int, rep: InjectReport) -> str:
    prior_label = "Ιαν–" + config.MONTHS[mm - 1]["short"] if mm > 1 else config.MONTHS[mm]["short"]
    cur_label = config.MONTHS[mm]["nom"]

    def do(html, chart_id, end_marker, key):
        try:
            start = html.index(f"getElementById('{chart_id}')")
        except ValueError:
            rep.warnings.append(f"Δεν βρέθηκε το γράφημα {chart_id}.")
            return html
        end = html.index(end_marker, start)
        c = m.charts[key]
        new_slice = _process_chart_slice(html[start:end], c["total"][0],
                                         prior_label, cur_label, c["prior"], c["cur"])
        rep.note(f"chart {chart_id}", 1)
        return html[:start] + new_slice + html[end:]

    # expense first (later in the file), then revenue — keeps indices valid.
    html = do(html, "execExpChart", "})();", "exp")
    html = do(html, "execRevChart", "getElementById('execExpChart')", "rev")
    return html


# ── period / headline strings ────────────────────────────────────────────────
def _localize_period(html: str, mm: int, year: int, rep: InjectReport) -> str:
    T = config.MONTHS[config.TEMPLATE_MONTH]
    G = config.MONTHS[mm]
    pairs = [
        ("Ιανουάριος – " + T["nom"],  f"Ιανουάριος – {G['nom']}"),   # sec-title (nom, spaced)
        ("Ιανουάριος–" + T["nom"],    f"Ιανουάριος–{G['nom']}"),      # footer (nom, unspaced)
        ("ΙΑΝ–" + T["caps_short"],    f"ΙΑΝ–{G['caps_short']}"),      # caps range
        ("Ιαν–" + T["short"],         f"Ιαν–{G['short']}"),           # short range
        (T["caps_gen"] + " " + str(config.TEMPLATE_YEAR),
         f"{G['caps_gen']} {year}"),                                  # month table header
        ("Π/Υ " + T["gen"],           f"Π/Υ {G['gen']}"),             # ÷ note month
        ("Ετήσιος Π/Υ ÷ " + str(config.TEMPLATE_MONTH),
         f"Ετήσιος Π/Υ ÷ {mm}"),                                      # divisor
    ]
    for old, new in pairs:
        n = html.count(old)
        html = html.replace(old, new)
        rep.note(f"period «{old}»", n, required=True)
    return html


def _localize_headline(html: str, h: dict, rep: InjectReport) -> str:
    rev_impl = h["rev_ytd"] / h["rev_bud"] * 100 if h["rev_bud"] else 0
    exp_impl = h["exp_ytd"] / h["exp_bud"] * 100 if h["exp_bud"] else 0
    pay_impl = (h["pay_ytd"] / h["pay_bud"] * 100) if h.get("pay_bud") else None

    # ORDER MATTERS: signed forms before their unsigned substrings.
    pairs = [
        # EBITDA total (deficit-big shows the figure without a € sign)
        ("−24,3Μ", fmt_mM(h["ebitda_ytd"]).replace(EURO, "")),
        ("−€24,3Μ", fmt_mM(h["ebitda_ytd"])),
        # EBITDA variance vs Π/Υ (both −11,8 and the −11,7 rounding variant)
        ("−€11,8Μ", fmt_mM(h["ebitda_vpy"])),
        ("−€11,7Μ", fmt_mM(h["ebitda_vpy"])),
        ("€11,8Μ", fmt_absM(h["ebitda_vpy"])),
        # EBITDA budget / 2025 / YoY
        ("−€12,5Μ", fmt_mM(h["ebitda_bud"])),
        ("−€14,1Μ", fmt_mM(h["ebitda_2025"])),
        ("−€10,2Μ", fmt_mM(h["ebitda_yoy"])),
        # Revenue / OpEx totals & budgets
        ("€219,0Μ", fmt_absM(h["rev_ytd"])),
        ("€224,3Μ", fmt_absM(h["rev_bud"])),
        ("€243,3Μ", fmt_absM(h["exp_ytd"])),
        ("€236,8Μ", fmt_absM(h["exp_bud"])),
        # Summary chips
        ("+€6,5Μ", fmt_varM(h["gap_exp"])),
        ("−€5,3Μ", fmt_varM(h["gap_rev"])),
        # Percentages in the KPI pills
        ("(−2,2%)", f"({fmt_pct(h['rev_vpy_pct'])})"),
        ("(+2,7%)", f"({fmt_pct(h['exp_vpy_pct'])})"),
        # Implementation bars (labels + JS width for revenue)
        ("97,8%", fmt_pct_plain(rev_impl)),
        ("'97.8%'", f"'{rev_impl:.1f}%'"),
        ("102,7%", fmt_pct_plain(exp_impl)),
    ]
    if pay_impl is not None:
        pairs.append(("103,6%", fmt_pct_plain(pay_impl)))
    for old, new in pairs:
        n = html.count(old)
        if old == new:
            continue
        html = html.replace(old, new)
        rep.note(f"headline «{old}»", n)
    return html


# ── commentary + alerts ──────────────────────────────────────────────────────
def _escape_lt(text: str) -> str:
    return text.replace("<", "&lt;")


def get_inpatient_default(html: str) -> str:
    """Current approved inpatient prose (for the textarea prefill)."""
    try:
        i = html.index("LOSI")
    except ValueError:
        return ""
    span_start = html.rindex("<span", 0, i)
    span_end = html.index("</span>", i)
    seg = html[span_start:span_end]
    b_end = seg.index("</b>") + len("</b>")
    return seg[b_end:].strip().replace("&lt;", "<")


def _inject_inpatient(html: str, text: str, rep: InjectReport) -> str:
    if not text.strip():
        rep.note("inpatient narrative", 0)
        return html
    i = html.index("LOSI") if "LOSI" in html else -1
    if i < 0:
        # fall back to the first Πλευρά Εσόδων bullet body
        anchor = "Πλευρά Εσόδων"
        i = html.index(anchor)
    span_start = html.rindex("<span", 0, i)
    span_end = html.index("</span>", i)
    seg = html[span_start:span_end]
    b_end = seg.index("</b>") + len("</b>")
    new_seg = seg[:b_end] + " " + _escape_lt(text.strip())
    rep.note("inpatient narrative", 1)
    return html[:span_start] + new_seg + html[span_end:]


_ALERT_RE = re.compile(
    r'<div class="alert-card (neg|amb)"><div class="alert-icon">(🔴|🟡)</div>\s*'
    r'<div><div class="alert-h">(.*?)</div>(.*?)</div>\s*</div>',
    re.S,
)


def get_alert_defaults(html: str) -> list[dict]:
    """Parse the current 4 hero alert cards for the UI prefill."""
    out = []
    for mobj in _ALERT_RE.finditer(html):
        icon = mobj.group(2)
        out.append({"severity": icon, "title": mobj.group(3).strip(), "body": ""})
    return out[:4]


def _alert_card_html(a: dict) -> str:
    icon = a.get("severity", "🔴").strip()
    cls = "neg" if icon == "🔴" else "amb"
    title = a.get("title", "").strip()
    body = a.get("body", "").strip()
    body_html = ""
    if body:
        body_html = (f'<div class="alert-b" style="font-size:10.5px;'
                     f'color:var(--ink-500);margin-top:2px">{body}</div>')
    return (f'<div class="alert-card {cls}"><div class="alert-icon">{icon}</div>\n'
            f'        <div><div class="alert-h">{title}</div>{body_html}</div>\n'
            f'      </div>')


def _inject_alerts(html: str, alerts: list[dict], rep: InjectReport) -> str:
    alerts = [a for a in (alerts or []) if a.get("title", "").strip()]
    matches = list(_ALERT_RE.finditer(html))
    if not matches:
        rep.warnings.append("Δεν βρέθηκαν οι κάρτες alert στο hero.")
        return html
    start, end = matches[0].start(), matches[-1].end()
    if not alerts:
        # no user alerts → drop the whole run (keep the deck clean)
        new_block = ""
    else:
        new_block = "\n      ".join(_alert_card_html(a) for a in alerts)
    rep.note("alert cards", len(alerts))
    return html[:start] + new_block + html[end:]


# ══════════════════════════════════════════════════════════════════════════════
# PHASE 2 — sec-overview (analytical P&L) and sec-monthly tabs
# ══════════════════════════════════════════════════════════════════════════════
def _kv(v: float) -> str:
    """KPI-tile value: signed, Greek comma, Μ suffix, no € (e.g. 219,0Μ / −24,3Μ)."""
    mv = _m1(v)
    sign = MINUS if mv < 0 else ""
    return f"{sign}{abs(mv):.1f}".replace(".", ",") + "Μ"


def _js(v: float) -> str:
    return str(int(round(v)))


# ── D-object field setters (operate only inside `const D={ … };`) ─────────────
def _d_bounds(html: str) -> tuple[int, int]:
    s = html.index("const D={")
    e = html.index("\n};", s)
    return s, e


def _set_d_scalar(html: str, field: str, value) -> str:
    s, e = _d_bounds(html)
    block = html[s:e]
    block2 = re.sub(rf"({re.escape(field)}:)\s*-?[\d.]+", rf"\g<1>{_js(value)}", block, count=1)
    return html[:s] + block2 + html[e:]


def _set_d_array(html: str, field: str, arr_str: str) -> str:
    """Replace `field:[ … ]` inside the D block, bracket-aware so nested arrays
    (e.g. loipaExpMonths) and arrays-of-objects are handled correctly."""
    s, e = _d_bounds(html)
    block = html[s:e]
    mobj = re.search(rf"(?:^|[,{{\s]){re.escape(field)}:\s*\[", block)
    if not mobj:
        raise ValueError(f"D field not found: {field}")
    b = block.index("[", mobj.end() - 1)
    depth, j = 0, b
    while j < len(block):
        ch = block[j]
        if ch == "[":
            depth += 1
        elif ch == "]":
            depth -= 1
            if depth == 0:
                break
        j += 1
    new_block = block[:b] + arr_str + block[j + 1:]
    return html[:s] + new_block + html[e:]


# ── sec-overview ─────────────────────────────────────────────────────────────
def _pl_rev_js(cats) -> str:
    items = ["{l:'%s',ytd:%s,bud:%s,y25:%s,g:'%s'}" %
             (r["l"].replace("'", "’"), _js(r["ytd"]), _js(r["bud"]), _js(r["y25"]), r["g"])
             for r in cats]
    return "[\n    " + ",\n    ".join(items) + "\n  ]"


def _pl_exp_js(cats) -> str:
    items = ["{l:'%s',ytd:%s,bud:%s,y25:%s}" %
             (r["l"].replace("'", "’"), _js(r["ytd"]), _js(r["bud"]), _js(r["y25"]))
             for r in cats]
    return "[\n    " + ",\n    ".join(items) + "\n  ]"


def _overview_kpi_tiles(h: dict) -> str:
    ebitda_vpy_pct = h["ebitda_vpy"] / abs(h["ebitda_bud"]) * 100 if h["ebitda_bud"] else 0
    pay_vpy = h["pay_ytd"] - h["pay_bud"]
    pay_vpy_pct = pay_vpy / abs(h["pay_bud"]) * 100 if h["pay_bud"] else 0
    pay_share = h["pay_ytd"] / h["exp_ytd"] * 100 if h["exp_ytd"] else 0
    return (
        '<div class="kpis k5">\n'
        f'    <div class="kpi b"><div class="kl">Έσοδα YTD (net)</div><div class="kv">{_kv(h["rev_ytd"])}</div>'
        f'<div class="kb amb">vs Π/Υ {fmt_varM(h["rev_vpy"])} ({fmt_pct(h["rev_vpy_pct"])})</div>'
        f'<div class="ks">Π/Υ {fmt_absM(h["rev_bud"])} | 2025 {fmt_absM(h["rev_2025"])}</div></div>\n'
        f'    <div class="kpi r"><div class="kl">OpEx YTD (EBITDA)</div><div class="kv">{_kv(h["exp_ytd"])}</div>'
        f'<div class="kb neg">vs Π/Υ {fmt_varM(h["exp_vpy"])} ({fmt_pct(h["exp_vpy_pct"])})</div>'
        f'<div class="ks">Π/Υ {fmt_absM(h["exp_bud"])} | 2025 {fmt_absM(h["exp_2025"])}</div></div>\n'
        f'    <div class="kpi r"><div class="kl">EBITDA 2026</div><div class="kv" style="color:var(--neg)">{_kv(h["ebitda_ytd"])}</div>'
        f'<div class="kb neg">vs Π/Υ {fmt_varM(h["ebitda_vpy"])} ({fmt_pct(ebitda_vpy_pct)})</div>'
        f'<div class="ks">Π/Υ {fmt_mM(h["ebitda_bud"])}</div></div>\n'
        f'    <div class="kpi r"><div class="kl">EBITDA 2025 (διορθ.)</div><div class="kv" style="color:var(--neg)">{_kv(h["ebitda_2025"])}</div>'
        f'<div class="kb neg">YoY {fmt_varM(h["ebitda_yoy"])}</div>'
        f'<div class="ks">2025 Διορθ. (ex Αποσβ.)</div></div>\n'
        f'    <div class="kpi r"><div class="kl">Κόστος Προσωπικού</div><div class="kv">{_kv(h["pay_ytd"])}</div>'
        f'<div class="kb neg">vs Π/Υ {fmt_varM(pay_vpy)} ({fmt_pct(pay_vpy_pct)})</div>'
        f'<div class="ks">{fmt_pct_plain(pay_share)} OpEx | 2025 {fmt_absM(h["pay_2025"])} ✓</div></div>\n'
        '  </div>'
    )


def _inject_overview(html: str, m: Metrics, rep: InjectReport) -> str:
    ov = m.overview
    h = m.headline
    # 1) the D-driven P&L table
    html = _set_d_array(html, "plRevCats", _pl_rev_js(ov["rev_cats"]))
    html = _set_d_array(html, "plExpCats", _pl_exp_js(ov["exp_cats"]))
    for field, key in (("totRev26", "rev_ytd"), ("totRevBud", "rev_bud"), ("totRev25", "rev_2025"),
                       ("totExp26", "exp_ytd"), ("totExpBud", "exp_bud"), ("totExp25", "exp_2025"),
                       ("ebitda26Tot", "ebitda_ytd"), ("ebitdaBud", "ebitda_bud"),
                       ("ebitda25Tot", "ebitda_2025")):
        html = _set_d_scalar(html, field, h[key])
    html = _set_d_scalar(html, "pharmaBudRev", ov["pharma_rev"].budget)
    html = _set_d_scalar(html, "pharmaBudExp", ov["pharma_exp"].budget)

    # 2) pharma / D&A actual display strings inside buildPL()
    try:
        bs = html.index("function buildPL()")
        be = html.index("document.getElementById('plBody')", bs)
        seg = html[bs:be]
        seg = seg.replace("€59,6Μ", fmt_mM(ov["pharma_rev"].ytd2026))
        seg = seg.replace("€39,3Μ", fmt_mM(ov["pharma_rev"].ytd2025))
        seg = seg.replace("€6,3Μ", fmt_mM(ov["dep"].ytd2026))
        seg = seg.replace("€3,3Μ", fmt_mM(ov["dep"].ytd2025))
        html = html[:bs] + seg + html[be:]
    except ValueError:
        rep.warnings.append("Δεν εντοπίστηκε το buildPL() — παραλείφθηκαν pharma/D&A ενδείξεις.")

    # 3) KPI tiles (scoped to sec-overview)
    ov_s = html.index('id="sec-overview"')
    ov_e = html.index('id="sec-monthly"')
    k_s = html.index('<div class="kpis k5">', ov_s)
    k_e = html.index('<div class="card">', k_s)
    if k_s < ov_e:
        html = html[:k_s] + _overview_kpi_tiles(h) + "\n\n  " + html[k_e:]
        rep.note("overview tab", 1)
    return html


# ── sec-monthly ──────────────────────────────────────────────────────────────
def _monthly_kpi_tiles(m: Metrics) -> str:
    mo = m.monthly
    worst = min(range(m.mm), key=lambda k: mo["ebitda26"][k]) if m.mm else -1
    tiles = []
    for k in range(m.mm):
        name = config.MONTHS[k + 1]["nom"]
        eb, rev, exp = mo["ebitda26"][k], mo["rev26"][k], mo["exp26"][k]
        if k == worst:
            tiles.append(
                f'<div class="kpi r" style="border-top-color:#AD1457"><div class="kl">{name} ⚠️</div>'
                f'<div class="kv" style="color:#AD1457;font-weight:600">{_kv(eb)}</div>'
                f'<div class="ks">Έσ: {fmt_mM(rev)} | OpEx: {fmt_mM(exp)}</div></div>')
        else:
            tiles.append(
                f'<div class="kpi r"><div class="kl">{name}</div>'
                f'<div class="kv" style="color:var(--neg)">{_kv(eb)}</div>'
                f'<div class="ks">Έσ: {fmt_mM(rev)} | OpEx: {fmt_mM(exp)}</div></div>')
    return '<div class="kpis k5">\n    ' + "\n    ".join(tiles) + "\n  </div>"


def _monthly_detail_rows(m: Metrics) -> str:
    mo = m.monthly
    rows = []
    for k in range(m.mm):
        name = config.MONTHS[k + 1]["nom"]
        r26, e26, b26 = mo["rev26"][k], mo["exp26"][k], mo["ebitda26"][k]
        r25, e25, b25 = mo["rev25"][k], mo["exp25"][k], mo["ebitda25"][k]
        yoy = b26 - b25
        label = f"<b>{name} ⚠️</b>" if b26 == min(mo["ebitda26"]) else name
        eb_style = ';font-weight:800' if b26 == min(mo["ebitda26"]) else ''
        rows.append(
            f'<tr><td>{label}</td>'
            f'<td style="text-align:center">{fmt_m(r26)}</td>'
            f'<td style="text-align:center">{fmt_m(e26)}</td>'
            f'<td style="text-align:center{eb_style}" class="{_vcls(b26, "rev")}">{fmt_var(b26)}</td>'
            f'<td style="text-align:center">{fmt_m(r25)}</td>'
            f'<td style="text-align:center">{fmt_m(e25)}</td>'
            f'<td style="text-align:center" class="{_vcls(b25, "rev")}">{fmt_var(b25)}</td>'
            f'<td style="text-align:center{eb_style}" class="{_vcls(yoy, "rev")}">{fmt_var(yoy)}</td></tr>')
    h = m.headline
    yoy_tot = h["ebitda_yoy"]
    rows.append(
        '<tr class="tr-ebitda"><td>ΣΥΝ. YTD EBITDA</td>'
        f'<td style="text-align:center">{fmt_m(h["rev_ytd"])}</td>'
        f'<td style="text-align:center">{fmt_m(h["exp_ytd"])}</td>'
        f'<td style="text-align:center" class="vn">{fmt_var(h["ebitda_ytd"])}</td>'
        f'<td style="text-align:center">{fmt_m(h["rev_2025"])}</td>'
        f'<td style="text-align:center">{fmt_m(h["exp_2025"])}</td>'
        f'<td style="text-align:center" class="vn">{fmt_var(h["ebitda_2025"])}</td>'
        f'<td style="text-align:center" class="{_vcls(yoy_tot, "rev")}">{fmt_var(yoy_tot)}</td></tr>')
    return "\n        ".join(rows)


def _inject_monthly(html: str, m: Metrics, rep: InjectReport) -> str:
    mo = m.monthly
    months_js = "[" + ",".join(f"'{config.MONTHS[k + 1]['short']}'" for k in range(m.mm)) + "]"
    html = _set_d_array(html, "months", months_js)
    for field in ("rev26", "exp26", "ebitda26", "rev25", "exp25", "ebitda25"):
        html = _set_d_array(html, field, "[" + ",".join(_js(x) for x in mo[field]) + "]")

    # KPI tiles (scoped to sec-monthly)
    mn_s = html.index('id="sec-monthly"')
    mn_e = html.index('id="sec-hospitals"')
    k_s = html.index('<div class="kpis k5">', mn_s)
    k_e = html.index('<div class="g2">', k_s)
    if k_s < mn_e:
        html = html[:k_s] + _monthly_kpi_tiles(m) + "\n\n  " + html[k_e:]

    # monthly detail table
    html = _replace_tbody(html, "Μηνιαία Λεπτομέρεια EBITDA", _monthly_detail_rows(m))
    rep.note("monthly tab", 1)
    return html


# ── sec-hospitals ────────────────────────────────────────────────────────────
def _hosps_js(hosps) -> str:
    parts = []
    for h in hosps:
        s = ("{n:'%s',r:%s,rb:%s,e:%s,eb:%s,n25:%s,rp:%.1f,rnoph:%s,ph:0,central:%s,d:%s"
             % (h["n"].replace("'", "’"), _js(h["r"]), _js(h["rb"]), _js(h["e"]),
                _js(h["eb"]), _js(h["n25"]), h["rp"], _js(h["rnoph"]),
                "true" if h["central"] else "false", _js(h["d"])))
        if h.get("special"):
            s += (",special:true,opdef:%s,net_before:%s,ph_clear:%s,ph_oh:%s"
                  % (_js(h["opdef"]), _js(h["net_before"]), _js(h["ph_clear"]), _js(h["ph_oh"])))
        parts.append(s + "}")
    return "[\n    " + ",\n    ".join(parts) + "\n  ]"


def _inject_hospitals(html: str, m: Metrics, rep: InjectReport) -> str:
    if not m.hospitals:
        rep.warnings.append("Δεν βρέθηκαν δεδομένα ανά νοσηλευτήριο.")
        return html
    html = _set_d_array(html, "hosps", _hosps_js(m.hospitals))
    rep.note("hospitals tab", 1)
    return html


# ── sec-loipaexp (operating expenses ex payroll) ─────────────────────────────
def _loipa_tiles(lp: dict) -> str:
    by = {c["name"]: c for c in lp["cats"]}
    tot = lp["total"]
    def tile(cls, label, c, extra_ks):
        vpy = c["ytd"] - c["bud"]
        pct = vpy / c["bud"] * 100 if c["bud"] else 0
        kbcls = "pos" if vpy < 0 else "neg"
        return (f'<div class="kpi {cls}"><div class="kl">{label}</div><div class="kv">{_kv(c["ytd"])}</div>\n'
                f'      <div class="kb {kbcls}">vs Π/Υ {fmt_varM(vpy)} ({fmt_pct(pct)})</div>'
                f'<div class="ks">{extra_ks}</div></div>')
    an = by.get("Ανάλωση Προμηθειών", {"ytd": 0, "bud": 0})
    al = by.get("Άλλες Λειτουργικές δαπάνες", {"ytd": 0, "bud": 0})
    sy = by.get("Συντηρήσεις", {"ytd": 0, "bud": 0})
    an_share = an["ytd"] / tot["ytd"] * 100 if tot["ytd"] else 0
    tot_vpy = tot["ytd"] - tot["bud"]
    tot_kb = "pos" if tot_vpy < 0 else "neg"
    tot_pct = tot_vpy / tot["bud"] * 100 if tot["bud"] else 0
    an_ks = "Π/Υ " + fmt_absM(an["bud"]) + " | " + fmt_pct_plain(an_share) + " του OpEx"
    al_ks = "Π/Υ " + fmt_absM(al["bud"]) + " ⚠️"
    sy_ks = "Π/Υ " + fmt_absM(sy["bud"])
    return (
        '<div class="kpis k4" style="margin-bottom:16px">\n'
        f'    <div class="kpi a"><div class="kl">Σύνολο Λειτ. Εξόδων</div><div class="kv">{_kv(tot["ytd"])}</div>\n'
        f'      <div class="kb {tot_kb}">vs Π/Υ {fmt_varM(tot_vpy)} ({fmt_pct(tot_pct)})</div>'
        f'<div class="ks">Π/Υ {fmt_absM(tot["bud"])}</div></div>\n'
        f'    {tile("r", "Ανάλωση Προμηθειών", an, an_ks)}\n'
        f'    {tile("a", "Άλλες Λειτουργικές", al, al_ks)}\n'
        f'    {tile("g", "Συντηρήσεις", sy, sy_ks)}\n'
        '  </div>'
    )


def _loipa_tbody(lp: dict, ov: dict) -> str:
    tot = lp["total"]
    def cell(v, cls=""):
        c = f' class="{cls}"' if cls else ""
        return f'<td style="text-align:center"{c}>{v}</td>'
    def main_row(c, denom, bg=""):
        vpy = c["ytd"] - c["bud"]; pct = vpy / c["bud"] * 100 if c["bud"] else 0
        cls = _vcls(vpy, "exp"); share = c["ytd"] / denom * 100 if denom else 0
        style = f' style="background:{bg}"' if bg else ""
        pad = ' style="padding-left:16px"' if bg else ""
        return (f'<tr{style}><td{pad}>{c["label"]}</td>{cell(fmt_m(c["ytd"]))}{cell(fmt_m(c["y25"]))}'
                f'{cell(fmt_m(c["bud"]))}{cell(fmt_var(vpy), cls)}{cell(fmt_pct(pct), cls)}{cell(fmt_pct_plain(share))}</tr>')
    by = {c["name"]: c for c in lp["cats"]}
    rows = [main_row(by[n], tot["ytd"]) for n in ("Ανάλωση Προμηθειών", "Συντηρήσεις", "Ηλεκτρισμός") if n in by]

    # Άλλες Λειτουργικές overrun sub-analysis
    RED = "rgba(192,57,43,.04)"
    at = lp["alles_total"]
    rows.append(f'<tr style="background:{RED}"><td colspan="7" style="padding:6px 8px;font-weight:700;'
                'font-size:11.5px;color:#AD1457">⚠️ Άλλες Λειτουργικές δαπάνες — Ανάλυση Υπερβάσεων (YTD vs Π/Υ)</td></tr>')
    at_ytd = at["ytd"] if at else 0
    for s in lp["alles_shown"]:
        vpy = s["ytd"] - s["bud"]; pct = vpy / s["bud"] * 100 if s["bud"] else 0
        cls = _vcls(vpy, "exp"); share = s["ytd"] / at_ytd * 100 if at_ytd else 0
        rows.append(f'<tr style="background:{RED}"><td style="padding-left:16px">{s["desc"]}</td>'
                    f'{cell(fmt_m(s["ytd"]))}{cell("—", "vz")}{cell(fmt_m(s["bud"]))}'
                    f'{cell(fmt_var(vpy), cls)}{cell(fmt_pct(pct), cls)}{cell(fmt_pct_plain(share))}</tr>')
    lo = lp["alles_loipes"]
    lo_vpy = lo["ytd"] - lo["bud"]; lo_pct = lo_vpy / lo["bud"] * 100 if lo["bud"] else 0
    lo_cls = _vcls(lo_vpy, "exp"); lo_share = lo["ytd"] / at_ytd * 100 if at_ytd else 0
    rows.append(f'<tr style="background:{RED}"><td style="padding-left:16px;font-style:italic;opacity:.8">'
                f'Λοιπές υποκατηγορίες ({lo["count"]} κωδικοί)</td>'
                f'{cell(fmt_m(lo["ytd"]))}{cell("—", "vz")}{cell(fmt_m(lo["bud"]))}'
                f'{cell(fmt_var(lo_vpy), lo_cls)}{cell(fmt_pct(lo_pct), lo_cls)}{cell(fmt_pct_plain(lo_share))}</tr>')
    if at:
        av = at["ytd"] - at["bud"]; ap = av / at["bud"] * 100 if at["bud"] else 0; acls = _vcls(av, "exp")
        rows.append(f'<tr class="tr-total" style="background:rgba(192,57,43,.08)"><td><b>Σύνολο Άλλες Λειτουργικές ⚠️</b></td>'
                    f'{cell(fmt_m(at["ytd"]))}{cell(fmt_m(at["y25"]))}{cell(fmt_m(at["bud"]))}'
                    f'{cell(fmt_var(av), acls)}{cell(fmt_pct(ap), acls)}{cell("100%")}</tr>')

    if "Αγορά Υπηρεσιών" in by:
        rows.append(main_row(by["Αγορά Υπηρεσιών"], tot["ytd"]))

    tv = tot["ytd"] - tot["bud"]; tp = tv / tot["bud"] * 100 if tot["bud"] else 0; tcls = _vcls(tv, "exp")
    rows.append(f'<tr class="tr-total"><td>ΣΥΝΟΛΟ Λειτουργικών Εξόδων</td>'
                f'{cell(fmt_m(tot["ytd"]))}{cell(fmt_m(tot["y25"]))}{cell(fmt_m(tot["bud"]))}'
                f'{cell(fmt_var(tv), tcls)}{cell(fmt_pct(tp), tcls)}{cell("100%")}</tr>')

    ph, dep = ov["pharma_exp"], ov["dep"]
    rows.append('<tr style="opacity:.65;font-style:italic"><td>Φάρμακα Β Φάσης * (pass-through)</td>'
                f'{cell(fmt_m(ph.ytd2026))}{cell(fmt_m(ph.ytd2025))}{cell(fmt_m(ph.budget))}'
                f'{cell("—", "vz")}{cell("net €0", "vz")}{cell("—")}</tr>')
    rows.append('<tr style="opacity:.65;font-style:italic"><td>Αποσβέσεις &amp; Προβλέψεις (εξαιρ.)</td>'
                f'{cell(fmt_m(dep.ytd2026))}{cell(fmt_m(dep.ytd2025))}{cell(fmt_m(dep.budget))}'
                f'{cell("—", "vz")}{cell("EBITDA εξαιρ.", "vz")}{cell("—")}</tr>')
    return "\n          ".join(rows)


def _inject_loipaexp(html: str, m: Metrics, rep: InjectReport) -> str:
    lp = m.loipa
    if not lp.get("cats"):
        rep.warnings.append("Δεν βρέθηκαν δεδομένα Λειτουργικών Εξόδων.")
        return html
    # monthly stacked chart data
    monthly_js = "[\n    " + ",\n    ".join(
        "[" + ",".join(_js(x) for x in series) + "]" for series in lp["monthly"]) + "\n  ]"
    html = _set_d_array(html, "loipaExpMonths", monthly_js)
    html = _set_d_array(html, "loipaExpL",
                        "[" + ",".join(f"'{l}'" for l in config.LOIPA_CHART_LABELS) + "]")
    html = _set_d_array(html, "loipaExpYTD", "[" + ",".join(_js(c["ytd"]) for c in lp["cats"]) + "]")
    html = _set_d_array(html, "loipaExpBud", "[" + ",".join(_js(c["bud"]) for c in lp["cats"]) + "]")

    # KPI tiles (scoped to sec-loipaexp)
    s = html.index('id="sec-loipaexp"')
    k_s = html.index('<div class="kpis k4"', s)
    k_e = html.index('<div class="g2b">', k_s)
    html = html[:k_s] + _loipa_tiles(lp) + "\n\n  " + html[k_e:]

    # summary table
    html = _replace_tbody(html, "Λειτουργικά Έξοδα — Σύνοψη", _loipa_tbody(lp, m.overview))
    rep.note("loipaexp tab", 1)
    return html


# ── sec-oay (ΟΑΥ revenue analysis) ───────────────────────────────────────────
def _oay_badge(pct: float) -> str:
    for thr, label, cls in config.OAY_BADGE:
        if pct >= thr:
            return f'<span class="bdg {cls}">{label}</span>'
    return ""


def _oay_tiles(oay: dict) -> str:
    by = {c["label"]: c for c in oay["cats"]}
    def tile(cls, label, key, kb_cls):
        c = by.get(key, {"ytd": 0, "bud": 0, "y25": 0})
        vpy = c["ytd"] - c["bud"]; pct = vpy / c["bud"] * 100 if c["bud"] else 0
        ks = "Π/Υ " + fmt_absM(c["bud"]) + " | 2025 " + fmt_absM(c["y25"])
        return (f'<div class="kpi {cls}"><div class="kl">{label}</div><div class="kv">{_kv(c["ytd"])}</div>'
                f'<div class="kb {kb_cls}">vs Π/Υ {fmt_varM(vpy)} ({fmt_pct(pct)})</div>'
                f'<div class="ks">{ks}</div></div>')
    return (
        '<div class="kpis k4">\n'
        f'    {tile("r", "Ενδονοσοκομεικά", "Ενδονοσοκομεική Φρ. ΟΑΥ", "neg")}\n'
        f'    {tile("r", "Εξωνοσοκομεικά", "Εξωνοσοκομειακή Φρ. ΟΑΥ", "neg")}\n'
        f'    {tile("a", "Ημερήσιες Νοσηλείες", "Ημερήσιες Νοσηλείες ΟΑΥ", "amb")}\n'
        f'    {tile("g", "ΤΑΕΠ ΟΑΥ", "ΤΑΕΠ ΟΑΥ", "pos")}\n'
        '  </div>'
    )


def _oay_full_rows(oay: dict) -> str:
    def vcell(v):
        return ('<td style="text-align:center" class="vz">—</td>' if round(v / 1e5) == 0
                else f'<td style="text-align:center" class="{_vcls(v, "rev")}">{fmt_var(v)}</td>')
    def row(c, total=False):
        vpy = c["ytd"] - c["bud"]; pct = vpy / c["bud"] * 100 if c["bud"] else 0
        yoy = c["ytd"] - c["y25"]; ypct = yoy / abs(c["y25"]) * 100 if c["y25"] else 0
        tr = '<tr class="tr-total">' if total else "<tr>"
        pc = "vz" if round(vpy / 1e5) == 0 else _vcls(vpy, "rev")
        yc = _vcls(yoy, "rev")
        return (f'{tr}<td>{c["label"]}</td>'
                f'<td style="text-align:center">{fmt_m(c["ytd"])}</td>'
                f'<td style="text-align:center">{fmt_m(c["bud"])}</td>'
                f'{vcell(vpy)}'
                f'<td style="text-align:center" class="{pc}">{fmt_pct(pct)}</td>'
                f'<td style="text-align:center">{fmt_m(c["y25"])}</td>'
                f'<td style="text-align:center" class="{yc}">{fmt_var(yoy)}</td>'
                f'<td style="text-align:center" class="{yc}">{fmt_pct(ypct)}</td></tr>')
    rows = [row(c) for c in oay["cats"]]
    t = oay["total"]; t = {"label": "ΣΥΝΟΛΟ ΟΑΥ", **t}
    rows.append(row(t, total=True))
    return "\n        ".join(rows)


def _oay_hosp_rows(hosps: list, total_label="ΣΥΝΟΛΟ") -> str:
    rows = []
    tot_ytd = tot_bud = 0.0
    for h in hosps:
        vpy = h["ytd"] - h["bud"]; pct = vpy / h["bud"] * 100 if h["bud"] else 0
        tot_ytd += h["ytd"]; tot_bud += h["bud"]
        cls = _vcls(vpy, "rev")
        rows.append(f'<tr><td>{h["name"]}</td>'
                    f'<td style="text-align:center">{fmt_m(h["ytd"])}</td>'
                    f'<td style="text-align:center">{fmt_m(h["bud"])}</td>'
                    f'<td style="text-align:center" class="{cls}">{fmt_var(vpy)}</td>'
                    f'<td style="text-align:center" class="{cls}">{fmt_pct(pct)}</td>'
                    f'<td style="text-align:center">{_oay_badge(pct)}</td></tr>')
    tv = tot_ytd - tot_bud; tp = tv / tot_bud * 100 if tot_bud else 0
    rows.append(f'<tr class="tr-total"><td>{total_label}</td>'
                f'<td style="text-align:center">{fmt_m(tot_ytd)}</td>'
                f'<td style="text-align:center">{fmt_m(tot_bud)}</td>'
                f'<td style="text-align:center" class="{_vcls(tv, "rev")}">{fmt_var(tv)}</td>'
                f'<td style="text-align:center" class="{_vcls(tv, "rev")}">{fmt_pct(tp)}</td>'
                '<td></td></tr>')
    return "\n        ".join(rows)


def _oay_chart(html: str, cid: str, series: dict) -> str:
    start = html.index(f"getElementById('{cid}')")
    end = html.index("options:", start)
    seg = html[start:end]
    arrs = [series["m26"], series["m25"], series["mbud"]]
    js = ["[" + ",".join(f"{x / 1e6:.1f}" for x in a) + "]" for a in arrs]
    hits = list(re.finditer(r"data:\[[^\]]*\]", seg))
    for k in range(min(3, len(hits)) - 1, -1, -1):
        seg = seg[:hits[k].start()] + "data:" + js[k] + seg[hits[k].end():]
    return html[:start] + seg + html[end:]


def _inject_oay(html: str, m: Metrics, rep: InjectReport) -> str:
    oay = m.oay
    if not oay.get("cats"):
        rep.warnings.append("Δεν βρέθηκαν δεδομένα ΟΑΥ.")
        return html
    # KPI tiles (scoped to sec-oay)
    s = html.index('id="sec-oay"')
    k_s = html.index('<div class="kpis k4">', s)
    k_e = html.index('<div class="callout', k_s)
    html = html[:k_s] + _oay_tiles(oay) + "\n\n  " + html[k_e:]
    # full table + by-hospital tables
    html = _replace_tbody(html, "ΟΑΥ Πλήρης Πίνακας", _oay_full_rows(oay))
    html = _replace_tbody(html, "Ενδονοσοκομεικά ΟΑΥ ανά Νοσηλευτήριο", _oay_hosp_rows(oay["inp_hosp"]))
    html = _replace_tbody(html, "Εξωνοσοκομεικά ΟΑΥ ανά Νοσηλευτήριο", _oay_hosp_rows(oay["exo_hosp"]))
    # monthly charts
    html = _oay_chart(html, "inpMonthChart", oay["inp_series"])
    html = _oay_chart(html, "exoMonthChart", oay["exo_series"])
    rep.note("oay tab", 1)
    return html


# ── sec-allaesoda (Άλλα Έσοδα) ───────────────────────────────────────────────
def _alla_tiles(ae: dict) -> str:
    tot = ae["total"]
    top = ae["subs"][:3]
    tv = tot["ytd"] - tot["bud"]; tp = tv / tot["bud"] * 100 if tot["bud"] else 0
    cards = [f'<div class="kpi b"><div class="kl">Σύνολο Άλλα Έσοδα</div><div class="kv">{_kv(tot["ytd"])}</div>\n'
             f'      <div class="kb {"pos" if tv > 0 else "neg"}">vs Π/Υ {fmt_varM(tv)} ({fmt_pct(tp)})</div>'
             f'<div class="ks">Π/Υ {fmt_absM(tot["bud"])} | 2025 {fmt_absM(tot["y25"])}</div></div>']
    for c, cls in zip(top, ("r", "g", "a")):
        v = c["ytd"] - c["bud"]; p = v / c["bud"] * 100 if c["bud"] else 0
        pk = "—" if c["bud"] == 0 else fmt_pct(p)
        cards.append(f'<div class="kpi {cls}"><div class="kl">{c["label"]}</div><div class="kv">{_kv(c["ytd"])}</div>\n'
                     f'      <div class="kb {"pos" if v > 0 else "neg"}">vs Π/Υ {fmt_varM(v)} ({pk})</div>'
                     f'<div class="ks">Π/Υ {fmt_absM(c["bud"])}</div></div>')
    return '<div class="kpis k4" style="margin-bottom:16px">\n    ' + "\n    ".join(cards) + "\n  </div>"


def _alla_sub_rows(ae: dict) -> str:
    def row(c, total=False):
        vpy = c["ytd"] - c["bud"]; yoy = c["ytd"] - c["y25"]
        pct = "—" if c["bud"] == 0 else fmt_pct(vpy / c["bud"] * 100)
        ypct = "—" if c["y25"] == 0 else fmt_pct(yoy / abs(c["y25"]) * 100)
        pcls = "vz" if c["bud"] == 0 else _vcls(vpy, "rev")
        ycls = "vz" if c["y25"] == 0 else _vcls(yoy, "rev")
        tr = '<tr class="tr-total">' if total else "<tr>"
        return (f'{tr}<td>{c["label"]}</td>'
                f'<td style="text-align:center">{fmt_m(c["ytd"])}</td>'
                f'<td style="text-align:center">{fmt_m(c["bud"])}</td>'
                f'<td style="text-align:center" class="{_vcls(vpy, "rev")}">{fmt_var(vpy)}</td>'
                f'<td style="text-align:center" class="{pcls}">{pct}</td>'
                f'<td style="text-align:center">{fmt_m(c["y25"])}</td>'
                f'<td style="text-align:center" class="{ycls}">{fmt_var(yoy)}</td>'
                f'<td style="text-align:center" class="{ycls}">{ypct}</td></tr>')
    rows = [row(c) for c in ae["subs"]]
    rows.append(row({"label": "ΣΥΝΟΛΟ Άλλα Έσοδα", **ae["total"]}, total=True))
    return "\n        ".join(rows)


def _alla_hosp_rows(ae: dict) -> str:
    rows = []
    for h in ae["hosp"]:
        v = h["ytd"] - h["bud"]; p = v / h["bud"] * 100 if h["bud"] else 0
        pk = "—" if h["bud"] == 0 else fmt_pct(p)
        rows.append(f'<tr><td>{h["name"]}</td><td style="text-align:center">{fmt_m(h["ytd"])}</td>'
                    f'<td style="text-align:center">{fmt_m(h["bud"])}</td>'
                    f'<td style="text-align:center" class="{_vcls(v, "rev")}">{pk}</td></tr>')
    t = ae["total"]; tv = t["ytd"] - t["bud"]; tp = tv / t["bud"] * 100 if t["bud"] else 0
    rows.append(f'<tr class="tr-total"><td>ΣΥΝΟΛΟ</td><td style="text-align:center">{fmt_m(t["ytd"])}</td>'
                f'<td style="text-align:center">{fmt_m(t["bud"])}</td>'
                f'<td style="text-align:center" class="{_vcls(tv, "rev")}">{fmt_pct(tp)}</td></tr>')
    return "\n        ".join(rows)


def _inject_allaesoda(html: str, m: Metrics, rep: InjectReport) -> str:
    ae = m.allaesoda
    if not ae.get("subs"):
        rep.warnings.append("Δεν βρέθηκαν δεδομένα Άλλων Εσόδων.")
        return html
    # by-hospital chart data
    html = _set_d_array(html, "loipaRevH", "[" + ",".join(f"'{h['name']}'" for h in ae["hosp"]) + "]")
    html = _set_d_array(html, "loipaRevYTD", "[" + ",".join(_js(h["ytd"]) for h in ae["hosp"]) + "]")
    # KPI tiles (scoped)
    s = html.index('id="sec-allaesoda"')
    k_s = html.index('<div class="kpis k4"', s)
    k_e = html.index('<div class="callout', k_s)
    html = html[:k_s] + _alla_tiles(ae) + "\n\n  " + html[k_e:]
    # tables
    html = _replace_tbody(html, "Άλλα Έσοδα — Ανάλυση Υποκατηγοριών", _alla_sub_rows(ae))
    html = _replace_tbody(html, "Κατανομή ανά Νοσηλευτήριο", _alla_hosp_rows(ae))
    rep.note("allaesoda tab", 1)
    return html


# ── responsive layer (mobile / tablet) ───────────────────────────────────────
# Appended to the output only (the on-disk template stays verbatim). The deck
# already stacks .g2 / hero at ≤900px and scrolls tables; this collapses the
# inline two-column grids, tightens padding, and makes the nav swipeable.
RESPONSIVE_CSS = """
/* okypy-responsive: mobile & tablet */
@media (max-width:1024px){
  .content{padding:20px 20px 52px !important;}
}
@media (max-width:900px){
  [style*="grid-template-columns:1fr 1fr"]{grid-template-columns:1fr !important;}
  [style*="grid-template-columns:1.15fr 1fr"]{grid-template-columns:1fr !important;}
  [style*="grid-template-columns:1.5fr 1fr"]{grid-template-columns:1fr !important;}
  .content{padding:16px 14px 48px !important;}
  .hero{padding:22px 16px 20px !important;}
  .hero .inner{gap:22px !important;}
  .topbar .inner{padding:10px 14px !important;}
  .sec-title{font-size:16px !important;}
  .deficit-big{font-size:52px !important;}
}
@media (max-width:560px){
  .content{padding:12px 10px 40px !important;}
  .hero{padding:18px 12px 16px !important;}
  .hero h1{font-size:19px !important;}
  .deficit-big{font-size:40px !important;}
  .nav{flex-wrap:nowrap !important;overflow-x:auto;-webkit-overflow-scrolling:touch;}
  .nav-btn{white-space:nowrap;}
  table{font-size:11.5px !important;}
  .sf-grid{grid-template-columns:1fr !important;}
}
"""


def _inject_responsive(html: str, rep: InjectReport) -> str:
    tag = f"<style>{RESPONSIVE_CSS}</style>"
    if "</head>" in html:
        rep.note("responsive CSS", 1)
        return html.replace("</head>", tag + "\n</head>", 1)
    rep.warnings.append("Δεν βρέθηκε </head> — παραλείφθηκε το responsive CSS.")
    return html


# ── offline: inline vendored Chart.js ────────────────────────────────────────
_BASE = __import__("os").path.dirname(__import__("os").path.dirname(__import__("os").path.abspath(__file__)))


def _inline_chartjs(html: str, rep: InjectReport) -> str:
    import os
    path = os.path.join(_BASE, config.CHARTJS_VENDOR)
    if config.CHARTJS_CDN_TAG not in html:
        return html
    if not os.path.exists(path):
        rep.warnings.append("Δεν βρέθηκε τοπικό Chart.js — τα γραφήματα θα χρειαστούν δίκτυο (CDN).")
        return html
    with open(path, encoding="utf-8") as fh:
        js = fh.read()
    rep.note("inline Chart.js (offline)", 1)
    return html.replace(config.CHARTJS_CDN_TAG, f"<script>{js}</script>")


# ── validation ───────────────────────────────────────────────────────────────
def _strip_code(html: str) -> str:
    """Remove <script>/<style> bodies so tag-like strings inside JS/CSS don't
    skew the HTML tag-balance check."""
    html = re.sub(r"<script[^>]*>.*?</script>", "", html, flags=re.S)
    html = re.sub(r"<style[^>]*>.*?</style>", "", html, flags=re.S)
    return html


def _tag_delta(html: str) -> dict:
    html = _strip_code(html)
    d = {}
    for tag in ("div", "tr", "td", "tbody", "table", "span"):
        opened = len(re.findall(r"<" + tag + r"[\s>]", html))
        closed = html.count("</" + tag + ">")
        d[tag] = opened - closed
    return d


def _extract_inline_script(html: str) -> str | None:
    # the second <script> holds the code; the first is the Chart.js CDN src.
    scripts = re.findall(r"<script[^>]*>(.*?)</script>", html, re.S)
    for s in scripts:
        if "const D=" in s or "function show" in s:
            return s
    return None


def _node_check(script: str, rep: InjectReport) -> None:
    node = shutil.which("node")
    if not node:
        rep.warnings.append("node δεν βρέθηκε — παραλείφθηκε το `node --check`.")
        return
    with tempfile.NamedTemporaryFile("w", suffix=".js", delete=False, encoding="utf-8") as fh:
        fh.write(script)
        path = fh.name
    res = subprocess.run([node, "--check", path], capture_output=True, text=True)
    if res.returncode != 0:
        raise ValueError("Το inline <script> απέτυχε στο `node --check`:\n" + res.stderr.strip())


def _validate(before: str, after: str, rep: InjectReport) -> None:
    db, da = _tag_delta(before), _tag_delta(after)
    for tag in db:
        if db[tag] != da[tag]:
            raise ValueError(
                f"Ασυμφωνία ετικετών <{tag}>: το injection άλλαξε το ισοζύγιο "
                f"({db[tag]} → {da[tag]}). Ματαίωση εγγραφής."
            )
    script = _extract_inline_script(after)
    if script is None:
        raise ValueError("Δεν εντοπίστηκε το inline <script> για έλεγχο.")
    _node_check(script, rep)


# ── entry point ──────────────────────────────────────────────────────────────
def inject(template_html: str, m: Metrics, mm: int, year: int,
           inpatient_text: str = "", alerts: list[dict] | None = None) -> tuple[str, InjectReport]:
    rep = InjectReport()
    before = template_html
    html = template_html

    # 1) four table bodies (before any string localization)
    html = _replace_tbody(html, "ΑΠΟΤΕΛΕΣΜΑΤΑ " + config.MONTHS[config.TEMPLATE_MONTH]["caps_gen"],
                          _results_body(m.results_month))
    rep.note("table ΑΠΟΤΕΛΕΣΜΑΤΑ ΜΗΝΑ", 1)
    html = _replace_tbody(html, "ΣΩΡΕΥΤΙΚΑ ΑΠΟΤΕΛΕΣΜΑΤΑ", _results_body(m.results_ytd))
    rep.note("table ΣΩΡΕΥΤΙΚΑ", 1)
    html = _replace_tbody(html, "ΑΠΟΚΛΙΣΕΙΣ ΕΣΟΔΩΝ vs Π/Υ", _variance_body(m.var_rev))
    rep.note("table ΑΠΟΚΛΙΣΕΙΣ ΕΣΟΔΩΝ", 1)
    html = _replace_tbody(html, "ΑΠΟΚΛΙΣΕΙΣ ΕΞΟΔΩΝ vs Π/Υ", _variance_body(m.var_exp))
    rep.note("table ΑΠΟΚΛΙΣΕΙΣ ΕΞΟΔΩΝ", 1)

    # 2) exec bar charts
    html = _inject_exec_charts(html, m, mm, rep)

    # 3) headline figures + period strings
    html = _localize_headline(html, m.headline, rep)
    html = _localize_period(html, mm, year, rep)

    # 4) commentary + alerts
    html = _inject_inpatient(html, inpatient_text, rep)
    html = _inject_alerts(html, alerts or [], rep)

    # 4b) phase-2 tabs (analytical P&L + monthly + hospitals)
    html = _inject_overview(html, m, rep)
    html = _inject_monthly(html, m, rep)
    html = _inject_hospitals(html, m, rep)
    html = _inject_loipaexp(html, m, rep)
    html = _inject_oay(html, m, rep)
    html = _inject_allaesoda(html, m, rep)

    # 5) responsive layer + self-contained / offline
    html = _inject_responsive(html, rep)
    html = _inline_chartjs(html, rep)

    _validate(before, html, rep)
    return html, rep
