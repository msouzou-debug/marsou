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

    # 5) responsive layer + self-contained / offline
    html = _inject_responsive(html, rep)
    html = _inline_chartjs(html, rep)

    _validate(before, html, rep)
    return html, rep
