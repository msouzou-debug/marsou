"""Validation gates, reconciliation and cross-checks.

Gates run in order and stop on failure with a plain-language message.
Never plug a difference: an unexplained diff is a finding (red), with the
two sides and the gap.  Known variances get a note, never a silent absorb.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Optional

from .models import (Bucket, BUCKET_ORDER, ClaimsAll, GLExtract, HOSPITALS,
                     IdentifiedFile, InpatientSummary, ISAuditor,
                     ORG_WIDE_TYPES, PharmaClaims, PharmacistFee,
                     REPORT_LABELS, REQUIRED_TYPES, ReportType, SimpleReport,
                     SRA, XMLActivity)
from .numbers import format_eur

CENT = 0.011  # "to the cent"


@dataclass
class GateResult:
    number: int
    name: str
    passed: bool
    message: str = ""


@dataclass
class CrossCheck:
    name: str
    source_total: float           # blue input off the source report
    sra_codes: list[str]          # SRA line codes the green formula sums
    sra_side: Optional[float]     # computed here for display / verification
    note: str = ""
    flag: str = "ok"              # ok | amber | red
    # workbook formula shape: "codes" (SUMIFS over sra_codes),
    # "ph_minus_fee" (SUMIFS(PH) − fee packages×unit),
    # "fee_net" (SUMIFS(PH) − pharma-claims source cell)
    side_kind: str = "codes"

    @property
    def diff(self) -> Optional[float]:
        if self.sra_side is None:
            return None
        return round(self.source_total - self.sra_side, 2)


@dataclass
class ReconBundle:
    hospital_code: str
    year: int
    month: int
    sra: Optional[SRA] = None
    inpatient: Optional[InpatientSummary] = None
    claims: Optional[ClaimsAll] = None
    pharma: Optional[PharmaClaims] = None
    phfee: Optional[PharmacistFee] = None
    capitation: Optional[SimpleReport] = None
    quality: Optional[SimpleReport] = None
    hemo: Optional[SimpleReport] = None
    gl: Optional[GLExtract] = None
    isaud: Optional[ISAuditor] = None
    xml_activity: Optional[XMLActivity] = None


@dataclass
class SplitRow:
    label: str
    amount: float
    fixed_fee: Optional[float] = None
    drg: Optional[float] = None


@dataclass
class SplitSection:
    title: str
    bucket: Optional[Bucket]
    rows: list[SplitRow] = field(default_factory=list)

    @property
    def subtotal(self) -> float:
        return round(sum(r.amount for r in self.rows), 2)


@dataclass
class ReconResult:
    bundle: ReconBundle
    crosscheck_mode: bool
    buckets: dict[Bucket, float] = field(default_factory=dict)
    crosschecks: list[CrossCheck] = field(default_factory=list)
    split: list[SplitSection] = field(default_factory=list)
    matrix: list[dict] = field(default_factory=list)   # cross-check mode rows
    matrix_columns: list[str] = field(default_factory=list)

    @property
    def cheque_total(self) -> Optional[float]:
        return self.bundle.sra.stated_total if self.bundle.sra else None

    @property
    def sra_residual(self) -> float:
        """Documented parsing residual (lines − stated).  Zero-checks are
        allowed to read exactly this value — it is shown as a red row in
        Source_crosscheck, never silently absorbed."""
        if not self.bundle.sra:
            return 0.0
        return round(self.bundle.sra.lines_total - self.bundle.sra.stated_total, 2)

    @property
    def open_variances(self) -> list[CrossCheck]:
        return [c for c in self.crosschecks
                if c.diff is not None and abs(c.diff) > CENT and c.flag != "ok"]


# ------------------------------------------------------------------ gates

def _next_month(period: tuple[int, int]) -> tuple[int, int]:
    y, m = period
    return (y + 1, 1) if m == 12 else (y, m + 1)


def validate_batch(files: list[IdentifiedFile], crosscheck_mode: bool = False
                   ) -> tuple[list[GateResult], Optional[str],
                              Optional[tuple[int, int]], list[str]]:
    """Gates 1-3.  Returns (gates, hospital_code, (year, month), notes).

    notes: informational messages that are not failures — e.g. the SRA being
    dated one month after the claim reports (ΟΑΥ pays in arrears)."""
    gates: list[GateResult] = []
    notes: list[str] = []

    # Gate 1 — each recognised file maps to exactly one report type.
    # UNRECOGNISED files are excluded with a warning, never a hard stop: a
    # full-month dump may contain report types the app doesn't know yet —
    # they are captured in the diagnostics so support can add them.
    bad = [f for f in files if f.error or f.report_type is None]
    if bad:
        notes.append(
            "Προσοχή (warning): τα εξής αρχεία δεν αναγνωρίστηκαν και ΑΓΝΟΟΥΝΤΑΙ "
            "στη συμφωνία (unrecognised files, ignored): "
            + " · ".join(f.filename for f in bad)
            + ". Δείτε τα Διαγνωστικά και κατεβάστε την αναφορά για να προστεθούν "
              "(download the diagnostics report so they can be supported).")
        files = [f for f in files if f not in bad]
    dupes = {}
    for f in files:
        if f.report_type:
            dupes.setdefault(f.report_type, []).append(f.filename)
    # multiple SRAs are allowed — a month can be settled by several cheques
    dupe_msgs = [f"{REPORT_LABELS[t]}: {', '.join(names)}"
                 for t, names in dupes.items()
                 if len(names) > 1 and t != ReportType.SRA]
    if dupe_msgs:
        gates.append(GateResult(1, "Αναγνώριση αρχείων (file identification)", False,
                                "Διπλά αρχεία για τον ίδιο τύπο αναφοράς (duplicate files "
                                "for one report type):\n· " + "\n· ".join(dupe_msgs)))
        return gates, None, None, notes
    gates.append(GateResult(1, "Αναγνώριση αρχείων (file identification)", True))

    # Gate 2 — single hospital, single month (org-wide reports don't vote).
    # The SRA votes separately: ΟΑΥ pays in arrears, so an SRA dated one
    # month after the claim reports is the SAME settlement, not a mixed batch.
    hospitals = {f.hospital_code for f in files
                 if f.hospital_code and f.report_type not in ORG_WIDE_TYPES}
    sra_periods = {(f.year, f.month) for f in files
                   if f.report_type == ReportType.SRA and f.year and f.month}
    # org-wide files (GL, IS Auditor) span providers/months — they don't vote
    other_periods = {(f.year, f.month) for f in files
                     if f.report_type != ReportType.SRA and f.year and f.month
                     and f.report_type not in ORG_WIDE_TYPES}
    gate2_name = "Ένα νοσοκομείο, ένας μήνας (single hospital/month)"
    if len(hospitals) > 1:
        names = ", ".join(f"{h} ({HOSPITALS[h][1]})" for h in sorted(hospitals))
        gates.append(GateResult(2, gate2_name, False,
                                f"Η παρτίδα περιέχει δύο νοσοκομεία (mixed batch): {names}. "
                                "Ανεβάστε έναν φορέα τη φορά."))
        return gates, None, None, notes
    if len(other_periods) > 1:
        ps = ", ".join(f"{m:02d}/{y}" for y, m in sorted(other_periods))
        gates.append(GateResult(2, gate2_name, False,
                                f"Η παρτίδα περιέχει δύο μήνες (mixed months): {ps}. "
                                "Ανεβάστε έναν μήνα τη φορά."))
        return gates, None, None, notes
    if not hospitals:
        gates.append(GateResult(2, gate2_name, False,
                                "Δεν εντοπίστηκε νοσοκομείο σε κανένα αρχείο "
                                "(no hospital code detected in any file)."))
        return gates, None, None, notes
    hospital = hospitals.pop()
    service = other_periods.pop() if other_periods else None
    period = service
    # The SRA's period is already the derived SERVICE month (document date −1,
    # ΟΑΥ pays in arrears).  A month mismatch is a warning, never a hard stop:
    # a wrong month's SRA will not tie out and the reconciliation shows it.
    if sra_periods:
        fmt = lambda p: f"{p[1]:02d}/{p[0]}"  # noqa: E731
        if service is None:
            period = sorted(sra_periods)[0]
            notes.append(
                f"Μήνας υπηρεσιών από το SRA: {fmt(period)} (ημερομηνία εγγράφου "
                f"{fmt(_next_month(period))} — η ΟΑΥ πληρώνει με καθυστέρηση / "
                "paid in arrears).")
        else:
            matching = {sp for sp in sra_periods if sp == service}
            mismatched = sorted(sra_periods - matching)
            if matching:
                doc = _next_month(service)
                notes.append(
                    f"Το SRA φέρει ημερομηνία {fmt(doc)} — αντιστοιχίστηκε στον μήνα "
                    f"υπηρεσιών {fmt(service)} (η ΟΑΥ πληρώνει με καθυστέρηση / "
                    "SRA is dated one month after the service month).")
            for sp in mismatched:
                notes.append(
                    f"Προσοχή (warning): SRA φαίνεται να αφορά τον {fmt(sp)} "
                    f"(ημερομηνία εγγράφου {fmt(_next_month(sp))}), ενώ οι υπόλοιπες "
                    f"αναφορές τον {fmt(service)}. Αν ανέβηκε λάθος SRA, οι έλεγχοι "
                    "δεν θα δέσουν — η συμφωνία θα δείξει τη διαφορά (a wrong "
                    "month's SRA will not tie out).")
    if period is None:
        period = (None, None)
    gates.append(GateResult(2, gate2_name, True))

    # Gate 3 — required set complete (or cross-check mode)
    have = {f.report_type for f in files}
    required = [t for t in REQUIRED_TYPES if not (crosscheck_mode and t == ReportType.SRA)]
    missing = [t for t in required if t not in have]
    if missing:
        gates.append(GateResult(3, "Πλήρες σετ αναφορών (required set complete)", False,
                                "Λείπουν αναφορές (missing reports):\n· "
                                + "\n· ".join(REPORT_LABELS[t] for t in missing)))
        return gates, hospital, period, notes
    gates.append(GateResult(3, "Πλήρες σετ αναφορών (required set complete)", True))
    return gates, hospital, period, notes


def conditional_requirements(sra: SRA) -> list[ReportType]:
    """Which conditional reports the SRA's lines demand."""
    needed = []
    codes = {l.code for l in sra.lines}
    if "PD-CAP" in codes:
        needed.append(ReportType.CAPITATION)
    if codes & {"KPI", "PD-KPI", "MRI", "CT", "MRI/CT"}:
        needed.append(ReportType.QUALITY_CRITERIA)
    if "HEMO" in codes:
        needed.append(ReportType.HEMODIALYSIS)
    return needed


def _claim_candidates(bundle: ReconBundle, diff: float) -> str:
    """Claims whose single amount equals the diff — usually old-period claims
    paid in this cheque but absent from the Ενδ. summary."""
    if not bundle.claims or not bundle.claims.inpatient_rows:
        return ""
    hits = [(cid, date, amt) for cid, date, amt in bundle.claims.inpatient_rows
            if abs(amt - abs(diff)) <= 0.01]
    if not hits:
        return ""
    shown = " · ".join(f"claim {cid} ({date}) {format_eur(amt)}"
                       for cid, date, amt in hits[:3])
    return (f"\nΠιθανή αιτία — απαίτηση παλαιότερης περιόδου που πληρώθηκε τώρα "
            f"(old-period claim paid in this cheque): {shown}")


def gate4_internal_asserts(bundle: ReconBundle) -> list[GateResult]:
    """Gate 4: Ενδ Σύνολο = sum of lines (already asserted at extraction);
    claims-all Inpatient = Ενδ Σύνολο to the cent; SRA lines sum = cheque.
    Failures are FINDINGS: the apps warn and proceed, and the diffs appear
    as documented rows in Source_crosscheck."""
    gates = []
    ok = True
    msgs = []
    if bundle.inpatient and bundle.claims:
        claims_ip = bundle.claims.by_segment.get("Inpatient", 0.0)
        d = round(claims_ip - bundle.inpatient.synolo, 2)
        if abs(d) > CENT:
            ok = False
            segs = " · ".join(f"«{k}»: {format_eur(v)}"
                              for k, v in sorted(bundle.claims.by_segment.items(),
                                                 key=lambda kv: -kv[1]))
            msgs.append("Claims «all» Inpatient ≠ Ενδ. Σύνολο: "
                        f"{format_eur(claims_ip)} vs {format_eur(bundle.inpatient.synolo)} "
                        f"(διαφορά {format_eur(d)})"
                        + _claim_candidates(bundle, d)
                        + f"\nΤιμές DR SEGMENT στο αρχείο claims: {segs}")
    if bundle.sra:
        parts = bundle.sra.parts or [(bundle.sra.cheque_no, bundle.sra.lines_total,
                                      bundle.sra.stated_total)]
        for cheque, lines_total, stated in parts:
            d = round(lines_total - stated, 2)
            if abs(d) > CENT:
                ok = False
                msgs.append(f"Άθροισμα γραμμών SRA #{cheque} ≠ δηλωμένο σύνολο επιταγής: "
                            f"{format_eur(lines_total)} vs {format_eur(stated)} "
                            f"(διαφορά {format_eur(d)})")
    gates.append(GateResult(4, "Εσωτερικοί έλεγχοι (internal asserts)", ok, "\n".join(msgs)))
    return gates


# --------------------------------------------------------- reconciliation

def _sra_sum(sra: SRA, codes: list[str]) -> float:
    return round(sum(l.amount for l in sra.lines if l.code in codes), 2)


SERVICE_CODES = ["IS", "AE", "A&E", "OS", "NM", "AP", "PD"]


def run_reconciliation(bundle: ReconBundle, crosscheck_mode: bool = False) -> ReconResult:
    res = ReconResult(bundle=bundle, crosscheck_mode=crosscheck_mode)
    if not crosscheck_mode and bundle.sra:
        for b in BUCKET_ORDER:
            res.buckets[b] = round(sum(l.amount for l in bundle.sra.lines if l.bucket == b), 2)
        res.crosschecks = _build_crosschecks(bundle)
    else:
        res.matrix, res.matrix_columns = _build_matrix(bundle)
        res.crosschecks = _build_crosschecks(bundle)  # SRA side None everywhere
    res.split = build_split(bundle)
    return res


def _annotate(name: str, source: float, sra_side: Optional[float], flag_hint: str = "") -> tuple[str, str]:
    """(note, flag) with the brief's known-variance annotations."""
    if sra_side is None:
        return "", "ok"
    diff = round(source - sra_side, 2)
    if abs(diff) <= CENT:
        return "OK — ταυτίζεται (ties out)", "ok"
    up = name.upper()
    if ("ΠΟΙΟΤΙΚ" in up or "QUALITY" in up) and source == 0:
        return ("Η εξαγωγή Ποιοτικών Κριτηρίων δεν περιέχει ποσά (κενό αρχείο) "
                "ενώ το SRA πληρώνει γραμμές KPI/MRI-CT — κατεβάστε ξανά την "
                "αναφορά από την πύλη ΟΑΥ (the quality-criteria export is "
                "empty; re-download it from the HIO portal)."), "red"
    if "Z-CATALOGUE" in up and "GL" in up and diff < 0:
        return ("GL κάτω από ΟΑΥ: Z-procedures/tail booked to clinical accounts. "
                "Classification, not cash."), "amber"
    if "PHARMACIST" in up and "GL" in up:
        return ("GL ≈ flat booking vs report packages × 1,60 € — known booking "
                "issue, flag amber."), "amber"
    if "PHARMA" in up and "GL" in up and diff > 0:
        return "Pharma claims gross above GL: generics/discounts/co-pay reclass.", "amber"
    if flag_hint:
        return flag_hint, "amber"
    return ("Ανεξήγητη διαφορά (unexplained difference) — δείτε τα δύο ποσά "
            "και το άνοιγμα."), "red"


def _build_crosschecks(bundle: ReconBundle) -> list[CrossCheck]:
    sra = bundle.sra
    checks: list[CrossCheck] = []

    def add(name: str, source: float, codes: list[str], flag_hint: str = "",
            alt: Optional[float] = None):
        # alt = report-vs-report comparison side used in cross-check mode
        # (no SRA), so known variances still get flagged without a cheque
        side = _sra_sum(sra, codes) if sra else alt
        note, flag = _annotate(name, source, side, flag_hint)
        checks.append(CrossCheck(name=name, source_total=round(source, 2),
                                 sra_codes=codes if sra else [], sra_side=side,
                                 note=note, flag=flag))

    claims_ip = bundle.claims.by_segment.get("Inpatient") if bundle.claims else None
    claims_out = (round(bundle.claims.by_segment.get("Outpatient Specialists", 0.0)
                        + bundle.claims.by_segment.get("Nurses-Midwives", 0.0)
                        + bundle.claims.by_segment.get("Allied Health", 0.0), 2)
                  if bundle.claims else None)

    sra_code_set = {l.code for l in sra.lines} if sra else set()

    # documented finding: SRA line sum vs stated cheque (only when broken)
    if sra:
        residual = round(sra.lines_total - sra.stated_total, 2)
        if abs(residual) > CENT:
            checks.append(CrossCheck(
                name="SRA: άθροισμα γραμμών = δηλωμένο σύνολο επιταγής (lines vs stated)",
                source_total=sra.stated_total, sra_codes=[], sra_side=sra.lines_total,
                note="Διαφορά ανάλυσης γραμμών (αναδιπλωμένες γραμμές PDF;) — δείτε "
                     "τα Διαγνωστικά. Τεκμηριωμένη διαφορά, εμφανίζεται και στα "
                     "zero-checks (documented parsing residual).",
                flag="red"))

    # claims-file vs Ενδ. summary (report-vs-report) — the gate-4 tie as a
    # visible row, with old-claim candidates named when it breaks
    if bundle.inpatient and bundle.claims:
        d = round((claims_ip or 0.0) - bundle.inpatient.synolo, 2)
        note = ("OK — ταυτίζεται (ties out)" if abs(d) <= CENT else
                "Ανεξήγητη διαφορά claims vs Ενδ." + _claim_candidates(bundle, d))
        checks.append(CrossCheck(
            name="Claims «all» Inpatient = Ενδ. Σύνολο (report vs report)",
            source_total=claims_ip or 0.0, sra_codes=[],
            sra_side=bundle.inpatient.synolo, note=note,
            flag="ok" if abs(d) <= CENT else "red"))

    if bundle.inpatient:
        add("Ενδ. Πληρωμένες Απαιτήσεις (inpatient claims file) = SRA IS",
            bundle.inpatient.synolo, ["IS"], alt=claims_ip)
        c = checks[-1]
        # when SRA IS ties the claims file to the cent, the gap vs the Ενδ.
        # summary is the old-period claims — name them instead of «unexplained»
        if (sra and claims_ip is not None and c.sra_side is not None
                and abs(c.sra_side - claims_ip) <= CENT
                and abs(c.diff or 0) > CENT):
            c.flag = "amber"
            c.note = ("Το SRA IS ταυτίζεται με το αρχείο Claims «all» — η "
                      "διαφορά προς την Ενδ. είναι απαιτήσεις παλαιότερων "
                      "περιόδων που πληρώθηκαν τώρα (SRA IS ties the claims "
                      "file; the gap vs the Ενδ. summary is old-period "
                      "claims paid in this cheque)."
                      + _claim_candidates(bundle, c.diff or 0.0))
    if "PH" in sra_code_set and (bundle.pharma or bundle.phfee):
        # Newer SRAs pay ALL pharmacy invoices as daily «PH - HCP SERVICES»
        # lines — including the pharmacist-fee invoice.  Credit notes and
        # manual adjustments are classified apart (PH-ADJ / PHF), so the
        # daily lines obey the clean identity, verified Feb+Apr 2026:
        #   SRA PH = pharma claims gross + fee(packages × unit)
        ph_sum = _sra_sum(sra, ["PH"])
        phf_sum = _sra_sum(sra, ["PHF"])
        fee = bundle.phfee.computed if bundle.phfee else 0.0
        if bundle.phfee:
            unit_str = f"{bundle.phfee.unit_price:.2f}".replace(".", ",")
            side_net = round(ph_sum
                             - (bundle.pharma.total if bundle.pharma else 0.0), 2)
            note, flag = _annotate("fee net", fee, side_net)
            if abs(fee - (side_net or 0)) <= CENT:
                note = ("OK — το τιμολόγιο αμοιβής πληρώνεται μέσα στις "
                        "ημερήσιες γραμμές PH (fee invoice paid inside the "
                        "daily PH lines).")
                if abs(phf_sum) > CENT:
                    note += (" Οι διορθώσεις CRN-Packages εμφανίζονται "
                             "χωριστά ως PHF (package-correction credit "
                             "notes shown separately as PHF).")
            checks.append(CrossCheck(
                name=f"Αμοιβή Φαρμακοποιού (packages × {unit_str} €) = "
                     "SRA PH − claims",
                source_total=round(fee, 2), sra_codes=["PH"], sra_side=side_net,
                note=note, flag=flag, side_kind="fee_net"))
        if bundle.pharma:
            side_a = round(ph_sum - fee, 2)
            note, flag = _annotate("pharma vs PH", bundle.pharma.total, side_a)
            if abs(bundle.pharma.total - (side_a or 0)) <= CENT:
                note = ("OK — SRA PH μείον το τιμολόγιο αμοιβής φαρμακοποιού "
                        "(PH lines net of the pharmacist-fee invoice).")
            checks.append(CrossCheck(
                name="Φάρμακα & Αναλώσιμα (pharma claims gross) = SRA PH − αμοιβή "
                     "φαρμακοποιού", source_total=bundle.pharma.total,
                sra_codes=["PH"], sra_side=side_a, note=note, flag=flag,
                side_kind="ph_minus_fee"))
    else:
        if bundle.pharma:
            drugs = bundle.pharma.by_type.get("Drugs", 0.0)
            add("Φάρμακα (pharma drugs) = SRA PHD", drugs, ["PHD"])
            cons = bundle.pharma.by_type.get("Consumables", 0.0)
            if cons:
                add("Αναλώσιμα (pharma consumables) = SRA PHC", cons, ["PHC"])
        if bundle.phfee:
            unit_str = f"{bundle.phfee.unit_price:.2f}".replace(".", ",")
            add(f"Αμοιβή Φαρμακοποιού (packages × {unit_str} €) = SRA PHF",
                bundle.phfee.computed, ["PHF"])
    cap_bundled = (bundle.capitation is not None and sra is not None
                   and "PD-CAP" not in sra_code_set)
    if bundle.claims:
        cap_extra = bundle.capitation.total if cap_bundled else 0.0
        name = ("Πληρωμένες Απαιτήσεις «all» + capitation ≈ SRA service lines"
                if cap_extra else
                "Πληρωμένες Απαιτήσεις «all» (HCP claims ex-capitation) ≈ SRA service lines")
        add(name, round(bundle.claims.total + cap_extra, 2), SERVICE_CODES,
            flag_hint="Κατά προσέγγιση: οι γραμμές SRA περιέχουν προσαρμογές "
                      "(ADJ/COR) και επιταγές δορυφορικών παροχέων που δεν "
                      "υπάρχουν στο αρχείο claims (approximate: SRA includes "
                      "adjustments and satellite-supplier cheques absent from "
                      "the claims export).")
    claims_pd = (bundle.claims.by_segment.get("Personal Doctors")
                 if bundle.claims else None)
    if bundle.capitation:
        if cap_bundled and claims_pd is not None:
            # exact identity, verified Apr+May 2026: the daily PD lines pay
            # capitation + the PD fee-for-service claims; fixed-price items
            # (OOH, vaccinations) are classified apart as PD-FP
            add("Capitation + Claims «Personal Doctors» = SRA PD (ημερήσιες γραμμές)",
                round(bundle.capitation.total + claims_pd, 2), ["PD"])
        elif cap_bundled:
            # newer SRAs bundle capitation inside the PD service lines
            add("Capitation report ≈ SRA PD (bundled with FFS)",
                bundle.capitation.total, ["PD", "PD-CAP"],
                flag_hint="Κατά προσέγγιση: η κατά κεφαλήν αμοιβή πληρώνεται μέσα "
                          "στις γραμμές PD (capitation bundled in PD lines).")
        else:
            add("Capitation report = SRA PD capitation", bundle.capitation.total, ["PD-CAP"])
    if bundle.quality:
        add("Ποιοτικά Κριτήρια (quality criteria) = SRA KPI/MRI-CT",
            bundle.quality.total, ["KPI", "PD-KPI", "MRI", "CT", "MRI/CT"])
    if bundle.hemo:
        add("Αιμοκάθαρση (hemodialysis report) = SRA HEMO", bundle.hemo.total, ["HEMO"])

    if bundle.gl:
        gl = bundle.gl
        hemo_amt = _sra_sum(sra, ["HEMO"]) if sra else 0.0
        # GL inpatient income (26xxx) includes hemodialysis (per diem) and
        # the A&E-referral adjustment — verified to the cent on Apr-2026:
        # 26xxx = SRA IS + HEMO + IS-ADJ
        add("GL: Ενδονοσοκομειακή (26001+26002+26003+26007) = SRA IS + "
            "αιμοκάθαρση + προσαρμογές", gl.inpatient,
            ["IS", "IS-ADJ", "HEMO"],
            alt=bundle.inpatient.synolo if bundle.inpatient else claims_ip)
        gl_ip_check = checks[-1]
        add("GL: Z-catalogue & per diem (26003+26007) vs ΟΑΥ Z + αιμοκάθαρση",
            gl.z_catalogue, [])  # report-vs-report, noted below
        if bundle.inpatient:
            c = checks[-1]
            c.sra_side = round(bundle.inpatient.z_catalogue + hemo_amt, 2)
            c.note, c.flag = _annotate("Z-CATALOGUE GL", c.source_total, c.sra_side)
            cand = _claim_candidates(bundle, c.diff or 0.0)
            if abs(c.diff or 0) > CENT and cand:
                c.note += cand
                c.flag = "amber"
            # the SAME gap on both rows = the known Z-tail classification
            # issue, not a cash break — say so on the inpatient row too
            if (abs(gl_ip_check.diff or 0) > CENT and c.diff is not None
                    and abs((gl_ip_check.diff or 0) - c.diff) <= CENT):
                gl_ip_check.flag = "amber"
                gl_ip_check.note = (
                    "Ίδια διαφορά με τη γραμμή Z — Z-procedures/tail "
                    "χρεωμένα σε κλινικούς λογαριασμούς (same gap as the "
                    "Z row: classification, not cash).")
        add("GL: ΤΑΕΠ / A&E (25801) = SRA AE", gl.ae, ["AE", "A&E"],
            alt=bundle.claims.by_segment.get("A&E") if bundle.claims else None)
        # PD fixed-price items (vaccinations, out-of-office, KPIs) sit in the
        # clinical 25xxx centres; capitation (51001001) is booked apart but
        # paid inside the SRA PD lines — compare the two wholes
        add("GL: Εξωνοσοκομειακή & ΠΙ (25xxx clinical + capitation) = "
            "SRA OS+NM+AP+PD+KPI",
            round(gl.outpatient + gl.capitation, 2),
            ["OS", "NM", "AP", "PD", "PD-CAP", "PD-KPI", "PD-FP", "KPI", "MRI",
             "CT", "MRI/CT"],
            flag_hint="Επιταγές δορυφορικών παροχέων (άλλος κωδικός F στην "
                      "κεφαλίδα SRA, π.χ. κέντρα υγείας) μένουν εκτός του GL "
                      "αυτού του νοσοκομείου (satellite-supplier cheques sit "
                      "outside this hospital's GL vendor).",
            alt=claims_out)
        # the SRA pays the fee invoice inside the daily PH lines, so compare
        # GL 25501 to the fee REPORT (packages × unit) — known flat-booking gap
        add("GL: Αμοιβή Φαρμακοποιού - pharmacist fee (25501) vs αναφορά "
            "αμοιβής", gl.pharmacist_fee, [])
        if bundle.phfee:
            c = checks[-1]
            c.sra_side = bundle.phfee.computed
            c.note, c.flag = _annotate(c.name, c.source_total, c.sra_side)
        add("GL: Φάρμακα (255xx) vs pharma claims gross", gl.pharma_other, [])
        if bundle.pharma:
            c = checks[-1]
            c.sra_side = bundle.pharma.total
            # source=GL, comparison=claims; per brief the note is on claims>GL
            c.note, c.flag = _annotate("PHARMA GL", c.sra_side, c.source_total)
            c.note = c.note if abs(c.diff or 0) > CENT else "OK — ταυτίζεται (ties out)"
        if gl.capitation:
            if sra and "PD-CAP" in sra_code_set:
                add("GL: Capitation (51001001) = SRA PD capitation",
                    gl.capitation, ["PD-CAP"],
                    alt=bundle.capitation.total if bundle.capitation else None)
            else:
                # capitation is bundled inside the SRA PD lines — tie the GL
                # account to the capitation REPORT instead (exact on Apr-2026)
                add("GL: Capitation (51001001) = Capitation report",
                    gl.capitation, [],
                    alt=bundle.capitation.total if bundle.capitation else None)
                if bundle.capitation:
                    c = checks[-1]
                    c.sra_side = bundle.capitation.total
                    c.note, c.flag = _annotate(c.name, c.source_total, c.sra_side)

    if bundle.isaud:
        add("IS Auditor: inpatient (DRG fees + Z-catalogue) = SRA IS",
            bundle.isaud.inpatient_total, ["IS"],
            flag_hint="IS Auditor org-wide detail; μικρές διαφορές στρογγυλοποίησης.",
            alt=bundle.inpatient.synolo if bundle.inpatient else claims_ip)
        c = checks[-1]
        # per-row rounding across ~10k detail rows — the brief accepts small
        # tolerances (F1054: €0.45); the Diff cell still shows the live gap
        if c.flag != "ok" and c.diff is not None and abs(c.diff) <= 5.00:
            c.flag = "ok"
            c.note = ("OK — εντός ανοχής στρογγυλοποίησης του αναλυτικού "
                      f"αρχείου (rounding tolerance, διαφορά {format_eur(c.diff)}).")
    if bundle.xml_activity:
        x = bundle.xml_activity
        src, name = x.total, "XML activity export (OS+NM+AP) = SRA OS+NM+AP"
        if sra and x.by_payment:
            # the PAYMENT NO. gate: keep only activities the uploaded
            # cheques actually paid — the export may span other payments
            cheques = {p[0] for p in sra.parts} or {sra.cheque_no}
            matched = round(sum(v for k, v in x.by_payment.items()
                                if k in cheques), 2)
            dropped = round(x.total - matched, 2)
            if matched and abs(dropped) > CENT:
                src = matched
                name = ("XML activity (μόνο PAYMENT NO. αυτών των επιταγών) "
                        "= SRA OS+NM+AP")
        add(name, src, ["OS", "NM", "AP"], alt=claims_out,
            flag_hint="Κατά προσέγγιση: activity-level έναντι γραμμών SRA "
                      "(προσαρμογές/χρονισμός εκτός export).")
        if src != x.total:
            checks[-1].note += (f" Εκτός επιταγών: {format_eur(round(x.total - src, 2))} "
                                "(activities paid by other cheques, excluded).")
    return checks


# ----------------------------------------------- cross-check mode matrix

STREAMS = ["Ενδονοσοκομειακή (Inpatient)", "DRG fees", "Z-catalogue",
           "ΤΑΕΠ (A&E)", "Εξωνοσοκομειακή (Outpatient OS+NM+AP)",
           "Φάρμακα (Pharma drugs)", "Αναλώσιμα (Consumables)",
           "Αμοιβή Φαρμακοποιού (Pharmacist fee)", "Capitation"]


def _build_matrix(bundle: ReconBundle) -> tuple[list[dict], list[str]]:
    """Streams as rows, reports as columns, Range = max−min of populated cells."""
    cols: dict[str, dict[str, float]] = {}

    def put(col: str, stream: str, value: float):
        cols.setdefault(col, {})[stream] = round(value, 2)

    if bundle.inpatient:
        ip = bundle.inpatient
        put("Ενδ. summary", STREAMS[0], ip.synolo)
        put("Ενδ. summary", STREAMS[1], ip.regular + ip.specialized)
        put("Ενδ. summary", STREAMS[2], ip.z_catalogue)
    if bundle.claims:
        c = bundle.claims
        put("Claims «all»", STREAMS[0], c.by_segment.get("Inpatient", 0.0))
        put("Claims «all»", STREAMS[3], c.by_segment.get("A&E", 0.0))
        put("Claims «all»", STREAMS[4],
            c.by_segment.get("Outpatient Specialists", 0.0)
            + c.by_segment.get("Nurses-Midwives", 0.0)
            + c.by_segment.get("Allied Health", 0.0))
    if bundle.pharma:
        put("Pharma claims", STREAMS[5], bundle.pharma.by_type.get("Drugs", 0.0))
        if bundle.pharma.by_type.get("Consumables"):
            put("Pharma claims", STREAMS[6], bundle.pharma.by_type["Consumables"])
    if bundle.phfee:
        put("Pharmacist fee", STREAMS[7], bundle.phfee.computed)
    if bundle.capitation:
        put("Capitation report", STREAMS[8], bundle.capitation.total)
    if bundle.gl:
        gl = bundle.gl
        put("GL", STREAMS[0], gl.inpatient)
        put("GL", STREAMS[2], gl.z_catalogue)
        put("GL", STREAMS[3], gl.ae)
        put("GL", STREAMS[4], gl.outpatient)
        put("GL", STREAMS[5], gl.pharma_other)
        put("GL", STREAMS[7], gl.pharmacist_fee)
        if gl.capitation:
            put("GL", STREAMS[8], gl.capitation)
    if bundle.isaud:
        put("IS Auditor", STREAMS[0], bundle.isaud.inpatient_total)
        put("IS Auditor", STREAMS[1], bundle.isaud.drg_fees)
        put("IS Auditor", STREAMS[2], bundle.isaud.z_catalogue)
    if bundle.xml_activity:
        put("XML activity", STREAMS[4], bundle.xml_activity.total)

    columns = list(cols.keys())
    rows = []
    for stream in STREAMS:
        values = {col: cols[col].get(stream) for col in columns}
        present = [v for v in values.values() if v is not None]
        if not present:
            continue
        rng = round(max(present) - min(present), 2) if len(present) > 1 else None
        rows.append({"stream": stream, "values": values, "range": rng})
    return rows, columns


# --------------------------------------------------- By_Clinic_Split data

def build_split(bundle: ReconBundle) -> list[SplitSection]:
    """SAP posting sheet data.  Sections sum to the cheque via reconciling
    rows when a stream's detail differs from its SRA line."""
    sra = bundle.sra
    sections: list[SplitSection] = []

    def sra_amount(codes: list[str]) -> Optional[float]:
        return _sra_sum(sra, codes) if sra else None

    # Inpatient by clinic (Fixed Fee / DRG columns) — from the claims detail
    # when present, else the Ενδ. workbook's «per clinic» pivot sheet
    ip = SplitSection("Ενδονοσοκομειακή περίθαλψη (Inpatient)", Bucket.INPATIENT)
    clinic_rows = (bundle.claims.inpatient_by_clinic if bundle.claims else []) \
        or (bundle.inpatient.by_clinic if bundle.inpatient else [])
    if clinic_rows:
        for r in clinic_rows:
            ip.rows.append(SplitRow(label=r.clinic, amount=r.total,
                                    fixed_fee=r.fixed_fee or None, drg=r.drg or None))
    elif bundle.claims:
        ip.rows.append(SplitRow("Ενδονοσοκομειακή (inpatient claims)",
                                bundle.claims.by_segment.get("Inpatient", 0.0)))
    elif bundle.inpatient:
        ip.rows.append(SplitRow("Κανονικά (Regular)", bundle.inpatient.regular))
        ip.rows.append(SplitRow("Εξειδικευμένα (Specialized)", bundle.inpatient.specialized))
        if bundle.inpatient.gennes:
            ip.rows.append(SplitRow("Γέννες (Births)", bundle.inpatient.gennes))
        ip.rows.append(SplitRow("Κατάλογος Z (Z-catalogue)", bundle.inpatient.z_catalogue))
        for label, amount in bundle.inpatient.other.items():
            ip.rows.append(SplitRow(label, amount))
    elif sra:
        is_amt = sra_amount(["IS"])
        if is_amt:
            ip.rows.append(SplitRow("Ενδονοσοκομειακή (SRA IS)", is_amt))
    _tie_section(ip, sra_amount(["IS"]))
    if bundle.hemo or (sra and any(l.code == "HEMO" for l in sra.lines)):
        hemo_amt = sra_amount(["HEMO"]) if sra else (bundle.hemo.total if bundle.hemo else 0.0)
        if hemo_amt:
            # bucket depends on the patient — default Inpatient per ΟΑΥ's own
            # «ADJ-IS» label; flip the blue Bucket cell on the SRA tab to
            # Outpatient and every SUMIFS re-ties
            ip.rows.append(SplitRow(
                "Αιμοκάθαρση (Hemodialysis — Inpatient ή Outpatient ανά ασθενή)",
                hemo_amt))
    is_adj = sra_amount(["IS-ADJ"])
    if is_adj:
        ip.rows.append(SplitRow(
            "Ενδονοσοκομειακή — προσαρμογή παραπομπών ΤΑΕΠ "
            "(A&E-referral adjustment, GL 26xxx)", is_adj))
    is_prior = sra_amount(["IS-PRIOR"])
    if is_prior:
        ip.rows.append(SplitRow(
            "Τακτοποίηση προηγούμενων περιόδων — DRG "
            "(prior-period settlement, e.g. year-end DRG true-up)", is_prior))
    sections.append(ip)

    ae = SplitSection("ΤΑΕΠ (A&E)", Bucket.AE)
    ae_amt = sra_amount(["AE", "A&E"])
    if ae_amt is None and bundle.claims:
        ae_amt = bundle.claims.by_segment.get("A&E", 0.0)
    ae.rows.append(SplitRow("Ατυχήματα & Επείγοντα (A&E)", ae_amt or 0.0))
    ae_adj = sra_amount(["AE-ADJ"])
    if ae_adj:
        ae.rows.append(SplitRow(
            "ΤΑΕΠ — προσαρμογές/παραπομπές (A&E adjustments/referrals)", ae_adj))
    sections.append(ae)

    out = SplitSection("Εξωνοσοκομειακή περίθαλψη (Outpatient)", Bucket.OUTPATIENT)
    if bundle.claims and bundle.claims.os_by_specialty:
        for spec, amt in sorted(bundle.claims.os_by_specialty.items(), key=lambda kv: -kv[1]):
            out.rows.append(SplitRow(f"Ειδικοί Ιατροί — {spec} (OS)", amt))
        _tie_rows(out, sra_amount(["OS"]), "Ειδικοί Ιατροί — διαφορά προς SRA (OS diff)")
    else:
        os_amt = sra_amount(["OS"])
        if os_amt is None and bundle.claims:
            os_amt = bundle.claims.by_segment.get("Outpatient Specialists", 0.0)
        if os_amt:
            out.rows.append(SplitRow("Ειδικοί Ιατροί (Outpatient Specialists)", os_amt))
    nm_amt = sra_amount(["NM"])
    if nm_amt is None and bundle.claims:
        nm_amt = bundle.claims.by_segment.get("Nurses-Midwives", 0.0)
    if nm_amt:
        out.rows.append(SplitRow("Νοσηλευτές/Μαίες (Nurses-Midwives)", nm_amt))
    ap_amt = sra_amount(["AP"])
    if ap_amt is None and bundle.claims:
        ap_amt = bundle.claims.by_segment.get("Allied Health", 0.0)
    if ap_amt:
        out.rows.append(SplitRow("Άλλοι Επαγγελματίες Υγείας (Allied Health)", ap_amt))
    pd_ffs = sra_amount(["PD"])
    if pd_ffs:
        out.rows.append(SplitRow("Προσωπικοί Ιατροί — FFS (PD fee-for-service)", pd_ffs))
    pd_fp = sra_amount(["PD-FP"])
    if pd_fp:
        out.rows.append(SplitRow(
            "Προσωπικοί Ιατροί — σταθερές χρεώσεις (PD fixed price: OOH, "
            "εμβολιασμοί)", pd_fp))
    pd_cap = sra_amount(["PD-CAP"])
    if pd_cap is None and bundle.capitation:
        pd_cap = bundle.capitation.total
    if pd_cap:
        out.rows.append(SplitRow("Προσωπικοί Ιατροί — κατά κεφαλήν (PD capitation)", pd_cap))
    kpi = sra_amount(["KPI", "PD-KPI", "MRI", "CT", "MRI/CT"])
    if kpi is None and bundle.quality:
        kpi = bundle.quality.total
    if kpi:
        out.rows.append(SplitRow("Ποιοτικά Κριτήρια / MRI-CT (Quality criteria)", kpi))
    if sra:
        unmapped = [l for l in sra.lines if l.channel == "Unmapped"]
        for l in unmapped:
            out.rows.append(SplitRow(f"Προσαρμογή (adjustment): {l.description}", l.amount))
    sections.append(out)

    ph = SplitSection("Φάρμακα (Pharma)", Bucket.PHARMA)
    ph_claims = sra_amount(["PH"])
    if ph_claims:
        ph.rows.append(SplitRow("Φάρμακα & Αναλώσιμα — PH (pharmacy claims)", ph_claims))
    drugs = sra_amount(["PHD"])
    if drugs is None and bundle.pharma:
        drugs = bundle.pharma.by_type.get("Drugs", 0.0)
    if drugs:
        ph.rows.append(SplitRow("Φάρμακα (Drugs)", drugs))
    cons = sra_amount(["PHC"])
    if cons is None and bundle.pharma:
        cons = bundle.pharma.by_type.get("Consumables", 0.0)
    if cons and not (ph_claims and sra):
        ph.rows.append(SplitRow("Αναλώσιμα (Consumables)", cons))
    fee = sra_amount(["PHF"])
    if fee is None and bundle.phfee:
        fee = bundle.phfee.computed
    if fee:
        label = ("Αμοιβή Φαρμακοποιού — διορθώσεις CRN-Packages (fee corrections)"
                 if ph_claims else "Αμοιβή Φαρμακοποιού (Pharmacist fee)")
        ph.rows.append(SplitRow(label, fee))
    ph_adj = sra_amount(["PH-ADJ"])
    if ph_adj:
        ph.rows.append(SplitRow(
            "Φάρμακα — προσαρμογές/πιστωτικά (pharmacy adjustments/CRN)", ph_adj))
    ph_prior = sra_amount(["PH-PRIOR"])
    if ph_prior:
        ph.rows.append(SplitRow(
            "Τακτοποίηση προηγούμενων περιόδων — φάρμακα (prior-period "
            "settlement, e.g. innovative antibiotics)", ph_prior))
    sections.append(ph)

    return sections


def _tie_section(section: SplitSection, target: Optional[float]) -> None:
    _tie_rows(section, target, "Διαφορά προς SRA (reconciling diff to SRA)")


def _tie_rows(section: SplitSection, target: Optional[float], label: str) -> None:
    """If the detail rows don't sum to the SRA line, add a visible reconciling
    row so the grand total still ties to the cheque — never silently plugged,
    the row is labelled as a diff."""
    if target is None or not section.rows:
        return
    gap = round(target - section.subtotal, 2)
    if abs(gap) > 0.005:
        section.rows.append(SplitRow(label, gap))
