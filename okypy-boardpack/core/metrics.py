# -*- coding: utf-8 -*-
"""
core/metrics.py — turn loaded categories into the deck's numbers.

Produces, in raw euros (formatting happens in core/inject.py):
  * the two results tables (ΜΗΝΑ = month, ΣΩΡΕΥΤΙΚΑ = YTD), 7 rows each;
  * the two variance tables (ΑΠΟΚΛΙΣΕΙΣ ΕΣΟΔΩΝ / ΕΞΟΔΩΝ), YTD;
  * the ΣΥΝΟΨΗ headline figures;
  * the exec bar-chart series (prior-cumulative + current month);
  * a reconciliation report (spec §5.4) — export is blocked unless it is clean.

All rules of spec §5 live here.
"""
from __future__ import annotations

from dataclasses import dataclass, field

import config
from core.load import Category, LoadResult


# ── row containers ───────────────────────────────────────────────────────────
@dataclass
class Row:
    label: str
    v2026: float
    v2025: float
    budget: float
    kind: str = "detail"    # 'detail' | 'subtotal' | 'ebitda'
    fav: str = "rev"        # favourability side: 'rev' (higher=good) | 'exp' (lower=good)

    @property
    def vpy(self) -> float:      # variance vs Π/Υ
        return self.v2026 - self.budget

    @property
    def v25(self) -> float:      # variance 2026 vs 2025
        return self.v2026 - self.v2025


@dataclass
class VarianceTable:
    rows: list[Row] = field(default_factory=list)      # shown material categories
    loipes: Row | None = None                          # balancing «Λοιπές κατηγορίες»
    total: Row | None = None                           # ΣΥΝΟΛΟ


@dataclass
class Metrics:
    mm: int
    year: int
    results_month: list[Row] = field(default_factory=list)
    results_ytd: list[Row] = field(default_factory=list)
    var_rev: VarianceTable = field(default_factory=VarianceTable)
    var_exp: VarianceTable = field(default_factory=VarianceTable)
    headline: dict = field(default_factory=dict)
    charts: dict = field(default_factory=dict)
    monthly: dict = field(default_factory=dict)     # phase-2 sec-monthly
    overview: dict = field(default_factory=dict)     # phase-2 sec-overview P&L
    hospitals: list = field(default_factory=list)    # phase-2 sec-hospitals
    loipa: dict = field(default_factory=dict)         # phase-2 sec-loipaexp
    oay: dict = field(default_factory=dict)            # phase-2 sec-oay
    recon_ok: bool = True
    breaches: list[dict] = field(default_factory=list)


# ── group membership ─────────────────────────────────────────────────────────
def _is_alla_esoda(c: Category) -> bool:
    return c.name in config.GROUP_ALLA_ESODA


def _is_kostos_prosopikou(c: Category) -> bool:
    return c.name in config.GROUP_KOSTOS_PROSOPIKOU


def _period_2026(c: Category, month: bool) -> float:
    return c.m2026 if month else c.ytd2026


def _period_2025(c: Category, month: bool) -> float:
    return c.m2025 if month else c.ytd2025


def _period_budget(c: Category, month: bool, mm: int) -> float:
    # Monthly budget = cumulative period budget (col N) ÷ MM (spec §4).
    return c.budget_period / mm if month else c.budget_period


def _sum(cats, fn) -> float:
    return sum(fn(c) for c in cats)


def _results_rows(load: LoadResult, month: bool, mm: int) -> list[Row]:
    rev = load.revenue()
    exp = load.expense()
    alla = [c for c in rev if _is_alla_esoda(c)]
    oay = [c for c in rev if not _is_alla_esoda(c)]
    kostos = [c for c in exp if _is_kostos_prosopikou(c)]
    loipa = [c for c in exp if not _is_kostos_prosopikou(c)]

    def mk(label, cats, fav, kind="detail"):
        return Row(
            label=label,
            v2026=_sum(cats, lambda c: _period_2026(c, month)),
            v2025=_sum(cats, lambda c: _period_2025(c, month)),
            budget=_sum(cats, lambda c: _period_budget(c, month, mm)),
            kind=kind, fav=fav,
        )

    r_oay = mk(config.LABEL_ESODA_OAY, oay, "rev")
    r_alla = mk(config.LABEL_ALLA_ESODA, alla, "rev")
    r_srev = mk(config.LABEL_SYNOLO_ESODON, rev, "rev", kind="subtotal")
    r_kostos = mk(config.LABEL_KOSTOS_PROSOPIKOU, kostos, "exp")
    r_loipa = mk(config.LABEL_LOIPA_LEITOURGIKA, loipa, "exp")
    r_sexp = mk(config.LABEL_SYNOLO_EXODON, exp, "exp", kind="subtotal")

    r_ebitda = Row(
        label=config.LABEL_EBITDA,
        v2026=r_srev.v2026 - r_sexp.v2026,
        v2025=r_srev.v2025 - r_sexp.v2025,
        budget=r_srev.budget - r_sexp.budget,
        kind="ebitda", fav="rev",
    )
    return [r_oay, r_alla, r_srev, r_kostos, r_loipa, r_sexp, r_ebitda]


def _variance_table(cats, total_row: Row, adverse_sign: int, mm: int) -> VarianceTable:
    """Build one ΑΠΟΚΛΙΣΕΙΣ table (YTD).

    ``adverse_sign`` = -1 for revenue (a negative variance is adverse), +1 for
    expenses (a positive variance is adverse). Shown rows have |vΠΥ| ≥ threshold;
    «Λοιπές» balances each column so all three foot exactly (spec §5.3).
    """
    thr = config.VARIANCE_THRESHOLD_EUR
    cat_rows = []
    for c in cats:
        v2026, v2025, budget = c.ytd2026, c.ytd2025, c.budget_period
        vpy = v2026 - budget
        if abs(vpy) >= thr:
            label = config.VARIANCE_DISPLAY_LABELS.get(c.name, c.name)
            cat_rows.append(Row(label=label, v2026=v2026, v2025=v2025, budget=budget,
                                kind="detail", fav="rev" if adverse_sign < 0 else "exp"))

    # adverse first (by |variance| desc), then favourable (by |variance| desc)
    def is_adverse(r: Row) -> bool:
        return (r.vpy < 0) if adverse_sign < 0 else (r.vpy > 0)

    adverse = sorted((r for r in cat_rows if is_adverse(r)), key=lambda r: -abs(r.vpy))
    favourable = sorted((r for r in cat_rows if not is_adverse(r)), key=lambda r: -abs(r.vpy))
    shown = adverse + favourable

    fav_side = "rev" if adverse_sign < 0 else "exp"
    loipes = Row(
        label=config.LABEL_LOIPES,
        v2026=total_row.v2026 - sum(r.v2026 for r in shown),
        v2025=total_row.v2025 - sum(r.v2025 for r in shown),
        budget=total_row.budget - sum(r.budget for r in shown),
        kind="detail", fav=fav_side,
    )
    total = Row(
        label=(config.LABEL_SYNOLO_ESODON_CAPS if adverse_sign < 0 else config.LABEL_SYNOLO_EXODON_CAPS),
        v2026=total_row.v2026, v2025=total_row.v2025, budget=total_row.budget,
        kind="total", fav=fav_side,
    )
    return VarianceTable(rows=shown, loipes=loipes, total=total)


def compute(load: LoadResult, mm: int, year: int = config.TEMPLATE_YEAR) -> Metrics:
    m = Metrics(mm=mm, year=year)
    m.results_month = _results_rows(load, month=True, mm=mm)
    m.results_ytd = _results_rows(load, month=False, mm=mm)

    ytd = {r.label: r for r in m.results_ytd}
    srev, sexp, ebitda = (
        ytd[config.LABEL_SYNOLO_ESODON],
        ytd[config.LABEL_SYNOLO_EXODON],
        ytd[config.LABEL_EBITDA],
    )
    kostos = ytd[config.LABEL_KOSTOS_PROSOPIKOU]

    m.var_rev = _variance_table(load.revenue(), srev, adverse_sign=-1, mm=mm)
    m.var_exp = _variance_table(load.expense(), sexp, adverse_sign=+1, mm=mm)

    # ── headline figures ─────────────────────────────────────────────────────
    m.headline = {
        "rev_ytd": srev.v2026, "rev_bud": srev.budget, "rev_2025": srev.v2025,
        "rev_vpy": srev.vpy, "rev_vpy_pct": _pct(srev.v2026, srev.budget),
        "exp_ytd": sexp.v2026, "exp_bud": sexp.budget, "exp_2025": sexp.v2025,
        "exp_vpy": sexp.vpy, "exp_vpy_pct": _pct(sexp.v2026, sexp.budget),
        "ebitda_ytd": ebitda.v2026, "ebitda_bud": ebitda.budget, "ebitda_2025": ebitda.v2025,
        "ebitda_vpy": ebitda.vpy, "ebitda_yoy": ebitda.v25,
        "pay_ytd": kostos.v2026, "pay_bud": kostos.budget, "pay_2025": kostos.v2025,
        "gap_exp": sexp.vpy,   # expense overrun (+ = adverse)
        "gap_rev": srev.vpy,   # revenue shortfall (− = adverse)
    }

    # ── exec bar-chart series (prior-cumulative + current month) ─────────────
    rm, ry = _by_label(m.results_month), _by_label(m.results_ytd)
    m.charts = {
        "rev": _chart_series(ry[config.LABEL_SYNOLO_ESODON], rm[config.LABEL_SYNOLO_ESODON]),
        "exp": _chart_series(ry[config.LABEL_SYNOLO_EXODON], rm[config.LABEL_SYNOLO_EXODON]),
    }

    m.monthly = _monthly(load, mm)
    m.overview = _overview(load)
    m.hospitals = _hospitals(load)
    m.loipa = _loipa(load, mm)
    m.oay = _oay(load, mm)

    _reconcile(m, load)
    return m


def _oay(load: LoadResult, mm: int) -> dict:
    """ΟΑΥ Έσοδα tab: the 7 OAY category lines, the inpatient/outpatient monthly
    series, and the per-unit inpatient/outpatient breakdowns."""
    by = {c.name: c for c in load.revenue()}
    cats = []
    for nm in config.OAY_ORDER:
        c = by.get(nm)
        if not c:
            continue
        cats.append({"label": config.OAY_LABELS.get(nm, nm),
                     "ytd": c.ytd2026, "bud": c.budget_period, "y25": c.ytd2025})
    total = {"ytd": sum(c["ytd"] for c in cats), "bud": sum(c["bud"] for c in cats),
             "y25": sum(c["y25"] for c in cats)}

    def series(nm):
        c = by.get(nm)
        if not c:
            return {"m26": [0] * mm, "m25": [0] * mm, "mbud": [0] * mm}
        mbud = (c.budget_period / mm) if mm else 0.0
        return {"m26": list(c.months2026), "m25": list(c.months2025), "mbud": [mbud] * mm}

    def by_hosp(nm):
        rows = []
        for spec in config.HOSPITALS:
            v = load.oay_by_hosp.get(nm, {}).get(spec["code"])
            if not v or (abs(v[0]) < 1.0 and abs(v[1]) < 1.0):
                continue
            rows.append({"name": spec["name"], "ytd": v[0], "bud": v[1]})
        rows.sort(key=lambda r: -r["ytd"])
        return rows

    return {"cats": cats, "total": total,
            "inp_series": series(config.INP_CATEGORY), "exo_series": series(config.EXO_CATEGORY),
            "inp_hosp": by_hosp(config.INP_CATEGORY), "exo_hosp": by_hosp(config.EXO_CATEGORY)}


def _loipa(load: LoadResult, mm: int) -> dict:
    """Operating-expenses tab: the 5 non-payroll categories, their monthly
    series, and the Άλλες Λειτουργικές overrun sub-analysis."""
    by_name = {c.name: c for c in load.expense()}
    cats, monthly = [], []
    for nm in config.LOIPA_ORDER:
        c = by_name.get(nm)
        if not c:
            continue
        cats.append({"name": nm, "label": config.LOIPA_LABELS.get(nm, nm),
                     "ytd": c.ytd2026, "bud": c.budget_period, "y25": c.ytd2025})
        monthly.append(list(c.months2026))
    total = {"ytd": sum(c["ytd"] for c in cats),
             "bud": sum(c["bud"] for c in cats),
             "y25": sum(c["y25"] for c in cats)}

    alles_total = next((c for c in cats if c["name"] == config.ALLES_CATEGORY), None)
    thr = config.LOIPA_SUB_THRESHOLD_EUR
    subs = [{"desc": _titlecase_gr(d), "ytd": v[0], "bud": v[1]}
            for d, v in load.alles_sub.items()]
    shown = sorted([s for s in subs if (s["ytd"] - s["bud"]) >= thr],
                   key=lambda s: -(s["ytd"] - s["bud"]))
    shown_ytd = sum(s["ytd"] for s in shown)
    shown_bud = sum(s["bud"] for s in shown)
    at_ytd = alles_total["ytd"] if alles_total else 0.0
    at_bud = alles_total["bud"] if alles_total else 0.0
    loipes = {"ytd": at_ytd - shown_ytd, "bud": at_bud - shown_bud,
              "count": max(0, len(subs) - len(shown))}

    return {"cats": cats, "monthly": monthly, "total": total,
            "alles_total": alles_total, "alles_shown": shown, "alles_loipes": loipes}


def _titlecase_gr(s: str) -> str:
    """Greek ALL-CAPS description → sentence-ish case for the sub-table."""
    s = s.strip()
    if s.isupper():
        return s.capitalize()
    return s


def _hospitals(load: LoadResult) -> list:
    """Build the per-unit records for the Ανά Νοσηλευτήριο tab (D.hosps)."""
    out = []
    for spec in config.HOSPITALS:
        a = load.hospitals.get(spec["code"])
        if a is None:
            continue
        kind = spec["kind"]
        rec = {
            "n": spec["name"], "r": a.r, "rb": a.rb, "e": a.e, "eb": a.eb,
            "n25": a.r25 - a.e25,                         # 2025 EBITDA net (source basis)
            "rp": (a.r / a.rb * 100.0) if a.rb else 0.0,
            "rnoph": a.rnoph, "ph": 0, "d": a.d,
            "central": kind == "central",
        }
        if kind == "special":
            opdef = a.rnoph - a.e                          # EBITDA pre-Public-Health
            net_before = opdef - a.d                       # after depreciation
            rec.update({"special": True, "opdef": opdef, "net_before": net_before,
                        "ph_clear": -net_before, "ph_oh": config.HOSPITAL_PH_OH})
        out.append(rec)
    return out


def _monthly(load: LoadResult, mm: int) -> dict:
    """Per-month totals for the sec-monthly tab (2026 & 2025)."""
    def tot(cats, year_attr, k):
        return sum(getattr(c, year_attr)[k] for c in cats if k < len(getattr(c, year_attr)))
    rev, exp = load.revenue(), load.expense()
    rev26 = [tot(rev, "months2026", k) for k in range(mm)]
    exp26 = [tot(exp, "months2026", k) for k in range(mm)]
    rev25 = [tot(rev, "months2025", k) for k in range(mm)]
    exp25 = [tot(exp, "months2025", k) for k in range(mm)]
    return {
        "rev26": rev26, "exp26": exp26,
        "ebitda26": [rev26[k] - exp26[k] for k in range(mm)],
        "rev25": rev25, "exp25": exp25,
        "ebitda25": [rev25[k] - exp25[k] for k in range(mm)],
    }


def _overview(load: LoadResult) -> dict:
    """Category-level P&L lines for the sec-overview tab."""
    rev = []
    for c in load.revenue():
        g = "other" if c.name in config.GROUP_ALLA_ESODA else "oay"
        rev.append({"l": c.name, "ytd": c.ytd2026, "bud": c.budget_period,
                    "y25": c.ytd2025, "g": g})
    # OAY lines first (by size), then the two "other" lines (by size)
    rev.sort(key=lambda r: (0 if r["g"] == "oay" else 1, -r["ytd"]))

    exp_by_name = {c.name: c for c in load.expense()}
    exp = []
    for nm in config.GROUP_KOSTOS_PROSOPIKOU:        # 3 personnel lines, fixed order
        c = exp_by_name.pop(nm, None)
        if c:
            exp.append({"l": c.name, "ytd": c.ytd2026, "bud": c.budget_period, "y25": c.ytd2025})
    rest = [{"l": c.name, "ytd": c.ytd2026, "bud": c.budget_period, "y25": c.ytd2025}
            for c in exp_by_name.values()]
    rest.sort(key=lambda r: -r["ytd"])
    exp.extend(rest)

    return {
        "rev_cats": rev, "exp_cats": exp,
        "pharma_rev": load.pharma_rev, "pharma_exp": load.pharma_exp, "dep": load.dep,
    }


def _by_label(rows: list[Row]) -> dict[str, Row]:
    return {r.label: r for r in rows}


def _chart_series(ytd_row: Row, month_row: Row) -> dict:
    """Two stacked segments per bar: Ιαν–(MM-1) prior + current month, for
    the 2026 / 2025 / Π/Υ columns."""
    def prior(y, mth):
        return y - mth
    return {
        "prior": [prior(ytd_row.v2026, month_row.v2026),
                  prior(ytd_row.v2025, month_row.v2025),
                  prior(ytd_row.budget, month_row.budget)],
        "cur": [month_row.v2026, month_row.v2025, month_row.budget],
        "total": [ytd_row.v2026, ytd_row.v2025, ytd_row.budget],
    }


def _pct(a: float, b: float) -> float:
    return (a - b) / abs(b) * 100.0 if b else 0.0


# ── reconciliation gate (spec §5.4) ──────────────────────────────────────────
def _reconcile(m: Metrics, load: LoadResult) -> None:
    tol = config.RECON_TOLERANCE_EUR
    breaches: list[dict] = []

    def check(name: str, gap: float):
        if abs(gap) > tol:
            breaches.append({"name": name, "gap": gap})

    for tag, rows in (("Μήνας", m.results_month), ("YTD", m.results_ytd)):
        d = _by_label(rows)
        check(f"[{tag}] Έσοδα ΟΑΥ + Άλλα = Σύνολο Εσόδων",
              d[config.LABEL_ESODA_OAY].v2026 + d[config.LABEL_ALLA_ESODA].v2026
              - d[config.LABEL_SYNOLO_ESODON].v2026)
        check(f"[{tag}] Προσωπικό + Λοιπά = Σύνολο Εξόδων",
              d[config.LABEL_KOSTOS_PROSOPIKOU].v2026 + d[config.LABEL_LOIPA_LEITOURGIKA].v2026
              - d[config.LABEL_SYNOLO_EXODON].v2026)
        check(f"[{tag}] Σύνολο Εσόδων − Σύνολο Εξόδων = EBITDA",
              d[config.LABEL_SYNOLO_ESODON].v2026 - d[config.LABEL_SYNOLO_EXODON].v2026
              - d[config.LABEL_EBITDA].v2026)

    for tag, vt in (("ΕΣΟΔΑ", m.var_rev), ("ΕΞΟΔΑ", m.var_exp)):
        for col in ("v2026", "v2025", "budget"):
            shown = sum(getattr(r, col) for r in vt.rows)
            gap = shown + getattr(vt.loipes, col) - getattr(vt.total, col)
            check(f"[Απόκλ. {tag}] shown + Λοιπές = ΣΥΝΟΛΟ ({col})", gap)

    # 2025 revenue after §5.1 exclusions ties to the deck's 2025 total.
    rev25 = sum(c.ytd2025 for c in load.revenue())
    check("2025 Έσοδα (YTD) = σύνολο deck 2025", rev25 - config.DECK_2025_REVENUE_YTD)

    m.breaches = breaches
    m.recon_ok = not breaches
