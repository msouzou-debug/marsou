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

    # Gate 1 — all files parse; each maps to exactly one report type
    bad = [f for f in files if f.error or f.report_type is None]
    dupes = {}
    for f in files:
        if f.report_type:
            dupes.setdefault(f.report_type, []).append(f.filename)
    dupe_msgs = [f"{REPORT_LABELS[t]}: {', '.join(names)}"
                 for t, names in dupes.items() if len(names) > 1]
    if bad:
        msg = "· " + "\n· ".join(f"{f.filename}: {f.error or 'άγνωστος τύπος'}" for f in bad)
        gates.append(GateResult(1, "Αναγνώριση αρχείων (file identification)", False,
                                f"Κάποια αρχεία δεν αναγνωρίστηκαν (unidentified files):\n{msg}"))
        return gates, None, None, notes
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
        sp = sra_periods.pop()
        doc = _next_month(sp)
        fmt = lambda p: f"{p[1]:02d}/{p[0]}"  # noqa: E731
        if service is None:
            period = sp
            notes.append(
                f"Μήνας υπηρεσιών από το SRA: {fmt(sp)} (ημερομηνία εγγράφου "
                f"{fmt(doc)} — η ΟΑΥ πληρώνει με καθυστέρηση / paid in arrears).")
        elif sp == service:
            notes.append(
                f"Το SRA φέρει ημερομηνία {fmt(doc)} — αντιστοιχίστηκε στον μήνα "
                f"υπηρεσιών {fmt(service)} (η ΟΑΥ πληρώνει με καθυστέρηση / "
                "SRA is dated one month after the service month).")
        else:
            notes.append(
                f"Προσοχή (warning): το SRA φαίνεται να αφορά τον {fmt(sp)} "
                f"(ημερομηνία εγγράφου {fmt(doc)}), ενώ οι υπόλοιπες αναφορές τον "
                f"{fmt(service)}. Αν ανέβηκε λάθος SRA, οι έλεγχοι δεν θα δέσουν — "
                "η συμφωνία θα δείξει τη διαφορά (a wrong month's SRA will not "
                "tie out; the checks will show the break).")
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


def gate4_internal_asserts(bundle: ReconBundle) -> list[GateResult]:
    """Gate 4: Ενδ Σύνολο = sum of lines (already asserted at extraction);
    claims-all Inpatient = Ενδ Σύνολο to the cent; SRA lines sum = cheque."""
    gates = []
    ok = True
    msgs = []
    if bundle.inpatient and bundle.claims:
        claims_ip = bundle.claims.by_segment.get("Inpatient", 0.0)
        d = round(claims_ip - bundle.inpatient.synolo, 2)
        if abs(d) > CENT:
            ok = False
            msgs.append("Claims «all» Inpatient ≠ Ενδ. Σύνολο: "
                        f"{format_eur(claims_ip)} vs {format_eur(bundle.inpatient.synolo)} "
                        f"(διαφορά {format_eur(d)})")
    if bundle.sra:
        d = round(bundle.sra.lines_total - bundle.sra.stated_total, 2)
        if abs(d) > CENT:
            ok = False
            msgs.append("Άθροισμα γραμμών SRA ≠ δηλωμένο σύνολο επιταγής: "
                        f"{format_eur(bundle.sra.lines_total)} vs "
                        f"{format_eur(bundle.sra.stated_total)} (διαφορά {format_eur(d)})")
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

    if bundle.inpatient:
        add("Ενδ. Πληρωμένες Απαιτήσεις (inpatient claims file) = SRA IS",
            bundle.inpatient.synolo, ["IS"], alt=claims_ip)
    if bundle.pharma:
        if "PH" in sra_code_set:
            # newer SRAs pay pharmacy claims as daily «PH - HCP SERVICES»
            # invoices (drugs + consumables together)
            add("Φάρμακα & Αναλώσιμα (pharma claims gross) = SRA PH",
                bundle.pharma.total, ["PH", "PHD", "PHC"])
        else:
            drugs = bundle.pharma.by_type.get("Drugs", 0.0)
            add("Φάρμακα (pharma drugs) = SRA PHD", drugs, ["PHD"])
            cons = bundle.pharma.by_type.get("Consumables", 0.0)
            if cons:
                add("Αναλώσιμα (pharma consumables) = SRA PHC", cons, ["PHC"])
    if bundle.phfee:
        unit_str = f"{bundle.phfee.unit_price:.2f}".replace(".", ",")
        add(f"Αμοιβή Φαρμακοποιού (packages × {unit_str} €) = SRA PHF",
            bundle.phfee.computed, ["PHF"])
    if bundle.claims:
        add("Πληρωμένες Απαιτήσεις «all» (HCP claims ex-capitation) ≈ SRA service lines",
            bundle.claims.total, SERVICE_CODES,
            flag_hint="Κατά προσέγγιση έλεγχος (approximate: PD FFS timing/scope).")
    if bundle.capitation:
        add("Capitation report = SRA PD capitation", bundle.capitation.total, ["PD-CAP"])
    if bundle.quality:
        add("Ποιοτικά Κριτήρια (quality criteria) = SRA KPI/MRI-CT",
            bundle.quality.total, ["KPI", "PD-KPI", "MRI", "CT", "MRI/CT"])
    if bundle.hemo:
        add("Αιμοκάθαρση (hemodialysis report) = SRA HEMO", bundle.hemo.total, ["HEMO"])

    if bundle.gl:
        gl = bundle.gl
        add("GL: Ενδονοσοκομειακή (26001+26002+26003+26007) = SRA IS", gl.inpatient,
            ["IS"], alt=bundle.inpatient.synolo if bundle.inpatient else claims_ip)
        add("GL: Z-catalogue (26003+26007) vs ΟΑΥ Z",
            gl.z_catalogue, [])  # report-vs-report, noted below
        if bundle.inpatient:
            c = checks[-1]
            c.sra_side = bundle.inpatient.z_catalogue
            c.note, c.flag = _annotate("Z-CATALOGUE GL", c.source_total, c.sra_side)
        add("GL: ΤΑΕΠ / A&E (25801) = SRA AE", gl.ae, ["AE", "A&E"],
            alt=bundle.claims.by_segment.get("A&E") if bundle.claims else None)
        add("GL: Εξωνοσοκομειακή (25xxx clinical) = SRA OS+NM+AP",
            gl.outpatient, ["OS", "NM", "AP"], alt=claims_out)
        add("GL: Αμοιβή Φαρμακοποιού - pharmacist fee (25501) = SRA PHF",
            gl.pharmacist_fee, ["PHF"],
            alt=bundle.phfee.computed if bundle.phfee else None)
        add("GL: Φάρμακα (255xx) vs pharma claims gross", gl.pharma_other, [])
        if bundle.pharma:
            c = checks[-1]
            c.sra_side = bundle.pharma.total
            # source=GL, comparison=claims; per brief the note is on claims>GL
            c.note, c.flag = _annotate("PHARMA GL", c.sra_side, c.source_total)
            c.note = c.note if abs(c.diff or 0) > CENT else "OK — ταυτίζεται (ties out)"
        if gl.capitation:
            add("GL: Capitation (51001001) = SRA PD capitation", gl.capitation,
                ["PD-CAP"], alt=bundle.capitation.total if bundle.capitation else None)

    if bundle.isaud:
        add("IS Auditor: inpatient (DRG fees + Z-catalogue) = SRA IS",
            bundle.isaud.inpatient_total, ["IS"],
            flag_hint="IS Auditor org-wide detail; μικρές διαφορές στρογγυλοποίησης.",
            alt=bundle.inpatient.synolo if bundle.inpatient else claims_ip)
    if bundle.xml_activity:
        add("XML activity export (OS+NM+AP) = SRA OS+NM+AP",
            bundle.xml_activity.total, ["OS", "NM", "AP"], alt=claims_out)
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
    _tie_section(ip, sra_amount(["IS"]))
    if bundle.hemo or (sra and any(l.code == "HEMO" for l in sra.lines)):
        hemo_amt = sra_amount(["HEMO"]) if sra else (bundle.hemo.total if bundle.hemo else 0.0)
        if hemo_amt:
            ip.rows.append(SplitRow("Αιμοκάθαρση (Hemodialysis adjustment)", hemo_amt))
    sections.append(ip)

    ae = SplitSection("ΤΑΕΠ (A&E)", Bucket.AE)
    ae_amt = sra_amount(["AE", "A&E"])
    if ae_amt is None and bundle.claims:
        ae_amt = bundle.claims.by_segment.get("A&E", 0.0)
    ae.rows.append(SplitRow("Ατυχήματα & Επείγοντα (A&E)", ae_amt or 0.0))
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
        ph.rows.append(SplitRow("Αμοιβή Φαρμακοποιού (Pharmacist fee)", fee))
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
