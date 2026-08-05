"""Validation gates, reconciliation and cross-checks.

Gates run in order and stop on failure with a plain-language message.
Never plug a difference: an unexplained diff is a finding (red), with the
two sides and the gap.  Known variances get a note, never a silent absorb.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Optional

from .extract import sra_sum_in_period
from .models import (Bucket, BUCKET_ORDER, ClaimsAll, GLExtract, HOSPITALS,
                     IdentifiedFile, InpatientSummary, is_hospital, ISAuditor,
                     ORG_WIDE_TYPES, PharmaClaims, PharmacistFee,
                     provider_name, REPORT_LABELS, REQUIRED_TYPES,
                     REQUIRED_TYPES_PROVIDER, ReportType, SimpleReport,
                     SRA, XMLActivity)
from .numbers import format_eur

CENT = 0.011  # "to the cent"

# report types a batch may legitimately carry more than once
_MULTI_FILE_TYPES = {ReportType.SRA, ReportType.STAFF_MAPPING}


@dataclass
class GateResult:
    number: int
    name: str
    passed: bool
    message: str = ""


@dataclass
class CheckPart:
    """One component of a check's A or B side, for the audit-trail tab.

    code: an SRA line code — the workbook writes a LIVE SUMIFS on it instead
    of a typed number, so the component re-ties when a line changes.
    cheques: restrict that SUMIFS to these cheques (empty = all)."""
    label: str
    amount: float
    code: str = ""
    cheques: list = field(default_factory=list)


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
    # "fee_net" (SUMIFS(PH) − pharma-claims source cell),
    # "codes_minus" (SUMIFS over sra_codes, restricted to `cheques` when set,
    #                minus the `minus` amount — the XML activity row)
    side_kind: str = "codes"
    # cheque numbers the SRA side is restricted to (empty = every cheque):
    # a source file that covers ONE cheque must not be compared with all
    cheques: list = field(default_factory=list)
    minus: float = 0.0            # subtracted from the SUMIFS side
    minus_label: str = ""         # what the subtraction is, for the helper cell
    # how each side is BUILT UP — the audit trail.  Empty = the side is a
    # single figure (A: the source report; B: the SRA codes).
    parts_a: list = field(default_factory=list)
    parts_b: list = field(default_factory=list)
    label_a: str = ""             # what side A is, in words
    label_b: str = ""             # what side B is, in words

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
    # mental-health only: the monthly staff roster (clinic per professional)
    # and the optional SAP cost-centre lookup
    staff: object = None
    cost_centres: object = None


@dataclass
class SplitRow:
    label: str
    amount: float
    fixed_fee: Optional[float] = None   # daily treatments (FixedFee class)
    drg: Optional[float] = None
    z_drugs: Optional[float] = None     # ZDRUG + ZPROC + ZCONSU


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


# ------------------------------------------- non-hospital provider batches

@dataclass
class ProviderBatch:
    """One ΟΑΥ provider (a mental-health unit) inside a multi-provider upload:
    its own F-code, its own cheque, its own files."""
    code: str
    label: str
    files: list = field(default_factory=list)

    @property
    def cheques(self) -> list[str]:
        out: list[str] = []
        for f in self.files:
            if f.report_type == ReportType.SRA:
                out += [c for c in f.cheques if c not in out]
        return out


def is_provider_batch(files: list[IdentifiedFile]) -> bool:
    """True when the upload is a NON-hospital provider month: at least one SRA
    made out to a provider outside the 8 hospitals, and no hospital anywhere.
    (An SRA for a satellite alongside a hospital's files is not this — that is
    the hospital's own batch and keeps the hospital path.)"""
    if any(f.hospital_code for f in files):
        return False
    return any(f.report_type == ReportType.SRA and f.provider_code
               and not is_hospital(f.provider_code) for f in files)


def group_by_provider(files: list[IdentifiedFile]
                      ) -> tuple[list[ProviderBatch], list[IdentifiedFile]]:
    """Split a multi-provider upload into one batch per provider.

    Attribution is ALWAYS content-based — folder and file names are never
    consulted (ΟΑΥ ships every unit's file under the same three folder names):
      · SRA               → the supplier F-code in its header
      · claims «all»      → its PAYMENT NO. = one provider's cheque
      · activity export   → its ProviderId column
    Returns (batches in cheque order, files that could not be attributed)."""
    batches: dict[str, ProviderBatch] = {}
    cheque_owner: dict[str, str] = {}
    for f in files:
        if f.report_type == ReportType.SRA and f.provider_code:
            b = batches.setdefault(f.provider_code, ProviderBatch(
                code=f.provider_code,
                label=provider_name(f.provider_code, f.provider_label)))
            b.files.append(f)
            for c in f.cheques:
                cheque_owner[c] = f.provider_code
    leftovers: list[IdentifiedFile] = []
    for f in files:
        if f.report_type == ReportType.SRA and f.provider_code:
            continue
        if f.report_type in ORG_WIDE_TYPES:
            # the roster and the SAP lookup belong to the whole batch, not to
            # one provider — they are loaded once and shared
            continue
        code = f.provider_code if f.provider_code in batches else None
        if code is None:
            owners = {cheque_owner[c] for c in f.cheques if c in cheque_owner}
            code = owners.pop() if len(owners) == 1 else None
        if code is None:
            leftovers.append(f)
            continue
        batches[code].files.append(f)
        # the activity export prints the provider's real name — prefer it
        if f.provider_label and f.provider_code == code:
            batches[code].label = provider_name(code, f.provider_label)
    ordered = sorted(batches.values(), key=lambda b: (b.cheques or [""])[0])
    return ordered, leftovers


def validate_provider_batches(batches: list[ProviderBatch],
                              leftovers: list[IdentifiedFile]
                              ) -> tuple[list[GateResult], Optional[tuple[int, int]], list[str]]:
    """Gates 1-3 for a multi-provider month.  Same rules as a hospital batch,
    applied PER PROVIDER: one file of each type per provider, one month
    across the upload, and each provider needs its SRA + paid claims."""
    gates: list[GateResult] = []
    notes: list[str] = []
    if leftovers:
        notes.append(
            "Προσοχή (warning): τα εξής αρχεία δεν αποδόθηκαν σε πάροχο και "
            "ΑΓΝΟΟΥΝΤΑΙ (could not be attributed to a provider — no F-code and "
            "no matching cheque): " + " · ".join(f.filename for f in leftovers))
    dupes = []
    for b in batches:
        seen: dict[ReportType, list[str]] = {}
        for f in b.files:
            if f.report_type and f.report_type not in _MULTI_FILE_TYPES:
                seen.setdefault(f.report_type, []).append(f.filename)
        dupes += [f"{b.label} ({b.code}) — {REPORT_LABELS[t]}: {', '.join(n)}"
                  for t, n in seen.items() if len(n) > 1]
    name1 = "Αναγνώριση αρχείων ανά πάροχο (files per provider)"
    if dupes:
        gates.append(GateResult(1, name1, False,
                                "Διπλά αρχεία για τον ίδιο τύπο αναφοράς στον ίδιο "
                                "πάροχο (duplicate files for one report type):\n· "
                                + "\n· ".join(dupes)))
        return gates, None, notes
    gates.append(GateResult(1, name1, True))

    periods = {(f.year, f.month) for b in batches for f in b.files
               if f.report_type == ReportType.SRA and f.year and f.month}
    name2 = "Ένας μήνας για όλους τους παρόχους (single month)"
    if len(periods) > 1:
        ps = ", ".join(f"{m:02d}/{y}" for y, m in sorted(periods))
        gates.append(GateResult(2, name2, False,
                                f"Η παρτίδα περιέχει δύο μήνες (mixed months): {ps}. "
                                "Ανεβάστε έναν μήνα τη φορά."))
        return gates, None, notes
    gates.append(GateResult(2, name2, True))
    period = periods.pop() if periods else (None, None)

    missing = []
    for b in batches:
        have = {f.report_type for f in b.files}
        for t in REQUIRED_TYPES_PROVIDER:
            if t not in have:
                missing.append(f"{b.label} ({b.code}): {REPORT_LABELS[t]}")
    name3 = "Πλήρες σετ ανά πάροχο (required set per provider)"
    if missing:
        gates.append(GateResult(3, name3, False,
                                "Λείπουν αναφορές (missing reports):\n· "
                                + "\n· ".join(missing)))
        return gates, period, notes
    gates.append(GateResult(3, name3, True))
    return gates, period, notes


def _load_shared_files(files: list):
    """The roster(s) and the SAP lookup are shared by every provider in the
    batch — they are org-wide files, not one unit's."""
    from .mapping import extract_cost_centres, extract_staff_mapping
    staff = None
    cost = None
    year, month = None, None
    for f in files:
        if f.report_type == ReportType.SRA and f.year:
            year, month = f.year, f.month
            break
    for f in files:
        if f.report_type == ReportType.STAFF_MAPPING:
            got = extract_staff_mapping(f.data, year, month)
            staff = got if staff is None else staff.merge(got)
        elif f.report_type == ReportType.COST_CENTRE_MAP:
            got = extract_cost_centres(f.data)
            if cost is None:
                cost = got
            else:
                cost.rows += got.rows
    return staff, cost


def run_provider_batches(batches: list, period, files: Optional[list] = None) -> list:
    """Reconcile every provider in a multi-provider month.
    Returns [(code, label, ReconResult), ...] in the batches' order."""
    from .extract import extract, merge_sras
    slot = {ReportType.CLAIMS_ALL: "claims", ReportType.XML_ACTIVITY: "xml_activity"}
    out = []
    year, month = period if period else (None, None)
    staff, cost = _load_shared_files(files if files is not None
                                     else [f for b in batches for f in b.files])
    for b in batches:
        bundle = ReconBundle(hospital_code=b.code, year=year, month=month)
        bundle.staff, bundle.cost_centres = staff, cost
        sras = []
        for f in b.files:
            if f.report_type == ReportType.SRA:
                sras.append(extract(f.report_type, f.data, raw_text=f.raw_text))
            elif f.report_type in slot:
                setattr(bundle, slot[f.report_type],
                        extract(f.report_type, f.data, hospital_code=b.code,
                                raw_text=f.raw_text))
        if sras:
            bundle.sra = merge_sras(sras, hospital_code=b.code)
        out.append((b.code, b.label, run_reconciliation(bundle)))
    return out


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
    # several files of the same type are EXPECTED for: SRA (a month can be
    # settled by several cheques) and the staff roster (the mental-health
    # service keeps one per profession)
    dupe_msgs = [f"{REPORT_LABELS[t]}: {', '.join(names)}"
                 for t, names in dupes.items()
                 if len(names) > 1 and t not in _MULTI_FILE_TYPES]
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


def _resolve_endo_detail(bundle: ReconBundle) -> None:
    """When no known header matched in the Ενδ. listing, pick the profiled
    candidate column whose sum equals the claims Inpatient figure (they are
    the same universe); else the rightmost candidate.  Idempotent."""
    ip = bundle.inpatient
    if ip is None or ip.detail_total is not None or not ip.detail_candidates:
        return
    claims_ip = (bundle.claims.by_segment.get("Inpatient")
                 if bundle.claims else None)
    pick = None
    if claims_ip is not None:
        pick = next((c for c in ip.detail_candidates
                     if abs(c[1] - claims_ip) <= 0.01), None)
    if pick is None:
        pick = ip.detail_candidates[-1]
    ip.detail_header, ip.detail_total, ip.detail_rows = pick[0], pick[1], pick[2]


def gate4_internal_asserts(bundle: ReconBundle) -> list[GateResult]:
    """Gate 4: Ενδ Σύνολο = sum of lines (already asserted at extraction);
    claims-all Inpatient = Ενδ Σύνολο to the cent; SRA lines sum = cheque.
    Failures are FINDINGS: the apps warn and proceed, and the diffs appear
    as documented rows in Source_crosscheck."""
    gates = []
    ok = True
    msgs = []
    _resolve_endo_detail(bundle)
    if bundle.inpatient and bundle.claims:
        claims_ip = bundle.claims.by_segment.get("Inpatient", 0.0)
        # compare against the per-claim listing sum when the file carries it —
        # the ΣΥΝΟΠΤΙΚΟΣ leaves out old-period claims paid in this cheque
        endo_side = bundle.inpatient.best_total
        d = round(claims_ip - endo_side, 2)
        if abs(d) > CENT:
            ok = False
            segs = " · ".join(f"«{k}»: {format_eur(v)}"
                              for k, v in sorted(bundle.claims.by_segment.items(),
                                                 key=lambda kv: -kv[1]))
            msgs.append("Claims «all» Inpatient ≠ Ενδ.: "
                        f"{format_eur(claims_ip)} vs {format_eur(endo_side)} "
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
    # ΟΑΥ-printed totals are never trusted: every report whose row-level
    # detail is available gets its printed total re-checked against the SUM
    if bundle.inpatient and bundle.inpatient.by_clinic:
        clinic_sum = round(sum(r.total for r in bundle.inpatient.by_clinic), 2)
        dt = bundle.inpatient.detail_total
        # the pivot may cover either universe: the month's ΣΥΝΟΠΤΙΚΟΣ or the
        # full listing (incl. old-period claims) — accept a tie to either
        if (abs(clinic_sum - bundle.inpatient.synolo) > CENT
                and (dt is None or abs(clinic_sum - dt) > CENT)):
            ok = False
            msgs.append("Ενδ.: το άθροισμα του πίνακα «per clinic» ≠ Σύνολο "
                        f"ΣΥΝΟΠΤΙΚΟΥ: {format_eur(clinic_sum)} vs "
                        f"{format_eur(bundle.inpatient.synolo)} "
                        f"(διαφορά {format_eur(round(clinic_sum - bundle.inpatient.synolo, 2))})")
    for label, rep in (("Capitation report", bundle.capitation),
                       ("Ποιοτικά Κριτήρια", bundle.quality),
                       ("Αιμοκάθαρση", bundle.hemo)):
        if rep is not None and rep.stated_total is not None:
            d = round(rep.total - rep.stated_total, 2)
            if abs(d) > CENT:
                ok = False
                msgs.append(f"{label}: το δηλωμένο σύνολο της ΟΑΥ ≠ άθροισμα "
                            f"αναλυτικών γραμμών: {format_eur(rep.stated_total)} "
                            f"vs {format_eur(rep.total)} (διαφορά {format_eur(d)}) "
                            "— χρησιμοποιείται το άθροισμα (the summation is used).")
    gates.append(GateResult(4, "Εσωτερικοί έλεγχοι (internal asserts)", ok, "\n".join(msgs)))
    return gates


# --------------------------------------------------------- reconciliation

def _sra_sum(sra: SRA, codes: list[str]) -> float:
    return round(sum(l.amount for l in sra.lines if l.code in codes), 2)


SERVICE_CODES = ["IS", "AE", "A&E", "OS", "NM", "AP", "PD"]


def run_reconciliation(bundle: ReconBundle, crosscheck_mode: bool = False) -> ReconResult:
    _resolve_endo_detail(bundle)
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
        return ("Z-procedures/tail χρεωμένα σε κλινικούς λογαριασμούς στο "
                "καθολικό της ΟΑΥ (HIO-ledger classification, not cash)."), "amber"
    if ("PHARMACIST" in up or "25501" in up) and "GL" in up:
        return ("GL ΟΑΥ ≈ flat booking vs report packages × τιμή μονάδας — "
                "γνωστό θέμα ταξινόμησης στο καθολικό της ΟΑΥ (known "
                "HIO-ledger booking issue), flag amber."), "amber"
    if ("PHARMA" in up or "ΦΑΡΜΑΚΑ" in up) and "GL" in up and diff > 0:
        return ("Pharma claims gross above GL: generics/discounts/co-pay "
                "reclass στο καθολικό της ΟΑΥ (HIO ledger)."), "amber"
    if flag_hint:
        return flag_hint, "amber"
    return ("Ανεξήγητη διαφορά (unexplained difference) — δείτε τα δύο ποσά "
            "και το άνοιγμα."), "red"


def _build_crosschecks(bundle: ReconBundle) -> list[CrossCheck]:
    sra = bundle.sra
    checks: list[CrossCheck] = []

    def P(label: str, amount: float, code: str = "", cheques=()) -> CheckPart:
        """One component of a side, for the audit-trail tab."""
        return CheckPart(label=label, amount=round(amount, 2), code=code,
                         cheques=list(cheques))

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

    # claims-file vs Ενδ. (report-vs-report) — the gate-4 tie as a visible
    # row.  The Ενδ. side is the SUM of the file's per-claim listing («στήλη
    # Συνολική αμοιβή») when present — NOT the printed ΣΥΝΟΠΤΙΚΟΣ Σύνολο,
    # which leaves out old-period claims paid in this cheque.
    endo = bundle.inpatient
    synoptikos_note = ""
    if endo is not None and endo.detail_total is not None:
        gap = round(endo.detail_total - endo.synolo, 2)
        if abs(gap) > CENT:
            synoptikos_note = (
                f" Το ΣΥΝΟΠΤΙΚΟΣ Σύνολο ({format_eur(endo.synolo)}) διαφέρει "
                f"κατά {format_eur(gap)} — απαιτήσεις εκτός του μηνιαίου "
                "πίνακα DRG (the printed summary excludes old-period claims)."
                + _claim_candidates(bundle, gap))
    if bundle.inpatient and bundle.claims:
        endo_side = endo.best_total
        d = round((claims_ip or 0.0) - endo_side, 2)
        note = (("OK — ταυτίζεται (ties out)." + synoptikos_note) if abs(d) <= CENT
                else "Ανεξήγητη διαφορά claims vs Ενδ." + _claim_candidates(bundle, d))
        name = ("Claims «all» Inpatient = Ενδ. (άθροιση στήλης «Συνολική αμοιβή»)"
                if endo.detail_total is not None else
                "Claims «all» Inpatient = Ενδ. Σύνολο (report vs report)")
        checks.append(CrossCheck(
            name=name, source_total=claims_ip or 0.0, sra_codes=[],
            sra_side=endo_side, note=note,
            flag="ok" if abs(d) <= CENT else "red"))

    if bundle.inpatient:
        add("Ενδ. Πληρωμένες Απαιτήσεις (inpatient claims file) = SRA IS",
            endo.best_total, ["IS"], alt=claims_ip)
        if checks[-1].flag == "ok" and synoptikos_note:
            checks[-1].note += synoptikos_note
        c = checks[-1]
        c.label_a, c.label_b = "Ενδ. Πληρωμένες Απαιτήσεις", "SRA"
        if endo.detail_total is not None:
            layer = round(endo.detail_total - endo.synolo, 2)
            c.parts_a = [P("ΣΥΝΟΠΤΙΚΟΣ ΠΙΝΑΚΑΣ — Σύνολο μήνα", endo.synolo)]
            if abs(layer) > CENT:
                c.parts_a.append(P("Απαιτήσεις παλαιών περιόδων στο αναλυτικό "
                                   "(εκτός ΣΥΝΟΠΤΙΚΟΥ)", layer))
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
                note=note, flag=flag, side_kind="fee_net",
                label_a="Αναφορά Αμοιβής Φαρμακοποιού", label_b="SRA",
                parts_a=[P("Συσκευασίες × τιμή μονάδας", fee)],
                parts_b=[P("SRA γραμμές PH (φαρμακείο)", ph_sum, code="PH"),
                         P("μείον Πληρωμένες ΦΑΡΜΑΚΑ (μικτά)",
                           -(bundle.pharma.total if bundle.pharma else 0.0))]))
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
                side_kind="ph_minus_fee",
                label_a="Πληρωμένες Απαιτήσεις ΦΑΡΜΑΚΑ", label_b="SRA",
                parts_a=[P("Φάρμακα (Drugs)", bundle.pharma.by_type.get("Drugs", 0.0)),
                         P("Αναλώσιμα (Consumables)",
                           bundle.pharma.by_type.get("Consumables", 0.0))],
                parts_b=[P("SRA γραμμές PH (φαρμακείο)", ph_sum, code="PH"),
                         P("μείον τιμολόγιο αμοιβής φαρμακοποιού", -fee)]))
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
        c = checks[-1]
        c.label_a, c.label_b = "Πληρωμένες Απαιτήσεις «all»", "SRA"
        c.parts_a = [P(f"DR SEGMENT: {seg}", amt)
                     for seg, amt in sorted(bundle.claims.by_segment.items())]
        if cap_extra:
            c.parts_a.append(P("Αναφορά κατά κεφαλήν (capitation)", cap_extra))
    claims_pd = (bundle.claims.by_segment.get("Personal Doctors")
                 if bundle.claims else None)
    if bundle.capitation:
        if cap_bundled and claims_pd is not None:
            # exact identity, verified Apr+May 2026: the daily PD lines pay
            # capitation + the PD fee-for-service claims; fixed-price items
            # (OOH, vaccinations) are classified apart as PD-FP
            add("Capitation + Claims «Personal Doctors» = SRA PD (ημερήσιες γραμμές)",
                round(bundle.capitation.total + claims_pd, 2), ["PD"])
            c = checks[-1]
            c.label_a, c.label_b = "Αναφορές ΟΑΥ", "SRA"
            c.parts_a = [P("Αναφορά κατά κεφαλήν (capitation)", bundle.capitation.total),
                         P("Claims «all» — DR SEGMENT Personal Doctors", claims_pd)]
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
            alt=bundle.inpatient.best_total if bundle.inpatient else claims_ip)
        gl_ip_check = checks[-1]
        add("GL: Z-catalogue & per diem (26003+26007) vs ΟΑΥ Z + αιμοκάθαρση "
            "+ παλαιές περίοδοι",
            gl.z_catalogue, [])  # report-vs-report, noted below
        if bundle.inpatient:
            c = checks[-1]
            # 26007 «ZERO COST WEIGHT DRGs / Fee per diem» also holds the
            # old-period claims the monthly ΣΥΝΟΠΤΙΚΟΣ leaves out — that
            # layer is exactly (detail listing − ΣΥΝΟΠΤΙΚΟΣ).  Verified to
            # the cent on Apr-2026 (claim 99476712: 1.297,43).
            old_layer = 0.0
            if bundle.inpatient.detail_total is not None:
                old_layer = round(bundle.inpatient.detail_total
                                  - bundle.inpatient.synolo, 2)
            c.sra_side = round(bundle.inpatient.z_catalogue + hemo_amt
                               + old_layer, 2)
            c.label_a, c.label_b = "Καθολικό ΟΑΥ (GL)", "Αναφορές ΟΑΥ"
            c.parts_a = [P("Κέντρα κόστους 26003 + 26007", gl.z_catalogue)]
            c.parts_b = [P("Ενδ. — Κατάλογος Ζ", bundle.inpatient.z_catalogue)]
            if abs(hemo_amt) > CENT:
                c.parts_b.append(P("Αιμοκάθαρση (SRA HEMO)", hemo_amt, code="HEMO"))
            if abs(old_layer) > CENT:
                c.parts_b.append(P("Απαιτήσεις παλαιών περιόδων (26007, εκτός "
                                   "ΣΥΝΟΠΤΙΚΟΥ)", old_layer))
            c.note, c.flag = _annotate("Z-CATALOGUE GL", c.source_total, c.sra_side)
            if abs(c.diff or 0) <= CENT and abs(old_layer) > CENT:
                c.note = ("OK — το 26007 (Fee per diem / zero cost weight) "
                          "περιλαμβάνει και τις απαιτήσεις παλαιών περιόδων "
                          f"εκτός ΣΥΝΟΠΤΙΚΟΥ ({format_eur(old_layer)})."
                          + _claim_candidates(bundle, old_layer))
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
                    "χρεωμένα σε κλινικούς λογαριασμούς στο καθολικό της "
                    "ΟΑΥ (same gap as the Z row: HIO-ledger classification, "
                    "not cash).")
        add("GL: ΤΑΕΠ / A&E (25801) = SRA AE", gl.ae, ["AE", "A&E"],
            alt=bundle.claims.by_segment.get("A&E") if bundle.claims else None)
        # PD fixed-price items (vaccinations, out-of-office, KPIs) sit in the
        # clinical 25xxx centres; capitation (51001001) is booked apart but
        # paid inside the SRA PD lines — compare the two wholes
        add("GL: Εξωνοσοκομειακή & ΠΙ (25xxx clinical + capitation) = "
            "SRA OS+NM+AP+PD+KPI",
            round(gl.outpatient + gl.capitation, 2),
            ["OS", "OS-ADJ", "NM", "AP", "PD", "PD-CAP", "PD-KPI", "PD-FP",
             "KPI", "MRI", "CT", "MRI/CT"],
            flag_hint="Επιταγές δορυφορικών παροχέων (άλλος κωδικός F στην "
                      "κεφαλίδα SRA, π.χ. κέντρα υγείας) μένουν εκτός του GL "
                      "αυτού του νοσοκομείου (satellite-supplier cheques sit "
                      "outside this hospital's GL vendor).",
            alt=claims_out)
        # the SRA pays the fee invoice inside the daily PH lines, so compare
        # GL 25501 to the fee REPORT (packages × unit) — known flat-booking gap
        # ΟΑΥ books the fee account NET of the CURRENT month's CRN-Packages
        # corrections, while the fee report shows it gross — verified to the
        # cent on Apr-2026 F1048: 27.584,00 − 13.141,60 = 14.442,40.
        # Corrections dated in earlier months belong to those months' ledgers.
        crn_now = (sra_sum_in_period(sra, ["PHF"], sra.year, sra.month, True,
                                     corrections_only=True)
                   if sra else 0.0)
        crn_prior = (sra_sum_in_period(sra, ["PHF"], sra.year, sra.month, False,
                                       corrections_only=True)
                     if sra else 0.0)
        add("GL ΟΑΥ λογ. 25501 (καθολικό) vs Αναφορά Αμοιβής Φαρμακοποιού "
            "+ διορθώσεις CRN-Packages τρέχοντος μήνα", gl.pharmacist_fee, [])
        if bundle.phfee:
            c = checks[-1]
            c.sra_side = round(bundle.phfee.computed + crn_now, 2)
            c.label_a, c.label_b = "Καθολικό ΟΑΥ (GL)", "Αναφορά + SRA"
            c.parts_a = [P("Κέντρο κόστους 25501", gl.pharmacist_fee)]
            unit_txt = f"{bundle.phfee.unit_price:.2f}".replace(".", ",")
            c.parts_b = [P(f"Συσκευασίες {bundle.phfee.packages} × {unit_txt} €",
                           bundle.phfee.computed)]
            if abs(crn_now) > CENT:
                c.parts_b.append(P("Διορθώσεις CRN-Packages τρέχοντος μήνα (SRA)",
                                   crn_now))
            c.note, c.flag = _annotate(c.name, c.source_total, c.sra_side)
            if abs(c.diff or 0) <= CENT and abs(crn_now) > CENT:
                c.note = (
                    "OK — το καθολικό ΟΑΥ κρατά την αμοιβή ΚΑΘΑΡΗ από τις "
                    "διορθώσεις CRN-Packages του ίδιου μήνα: "
                    f"{format_eur(bundle.phfee.computed)} (packages × τιμή) "
                    f"{format_eur(crn_now)} = {format_eur(c.sra_side)}.")
                if abs(crn_prior) > CENT:
                    c.note += (f" Οι διορθώσεις προηγούμενων μηνών "
                               f"({format_eur(crn_prior)}) βαρύνουν τα "
                               "καθολικά εκείνων των μηνών (prior-month "
                               "corrections belong to prior-month ledgers).")
        # same netting rule as the fee: the 255xx pharma centres are booked
        # NET of the CURRENT month's CRN-Drugs/OTC deductions.  ISSUANCES /
        # EOAF settlements are NOT there — they go to 11202192 (below).
        # Verified Apr-2026 F1048: 1.477.341,74 − 114.331,91 = 1.363.009,83
        ph_adj_now = (sra_sum_in_period(sra, ["PH-ADJ"], sra.year, sra.month, True)
                      if sra else 0.0)
        ph_adj_prior = (sra_sum_in_period(sra, ["PH-ADJ"], sra.year, sra.month, False)
                        if sra else 0.0)
        add("GL ΟΑΥ Φάρμακα 255xx (καθολικό) vs Πληρωμένες ΦΑΡΜΑΚΑ "
            "+ διορθώσεις τρέχοντος μήνα", gl.pharma_other, [])
        if bundle.pharma:
            c = checks[-1]
            c.sra_side = round(bundle.pharma.total + ph_adj_now, 2)
            c.label_a, c.label_b = "Καθολικό ΟΑΥ (GL)", "Αναφορά + SRA"
            c.parts_a = [P("Κέντρα κόστους 255xx (εκτός 25501)", gl.pharma_other)]
            c.parts_b = [P("Πληρωμένες Απαιτήσεις ΦΑΡΜΑΚΑ (μικτά)",
                           bundle.pharma.total)]
            if abs(ph_adj_now) > CENT:
                c.parts_b.append(P("Διορθώσεις φαρμάκων τρέχοντος μήνα (CRN/OTC, SRA)",
                                   ph_adj_now))
            c.note, c.flag = _annotate("PHARMA GL", c.sra_side, c.source_total)
            if abs(c.diff or 0) <= CENT:
                c.note = "OK — ταυτίζεται (ties out)."
                if abs(ph_adj_now) > CENT:
                    c.note = ("OK — το καθολικό ΟΑΥ κρατά τα φάρμακα ΚΑΘΑΡΑ από "
                              "τις διορθώσεις (CRN-Drugs/OTC) του ίδιου μήνα: "
                              f"{format_eur(bundle.pharma.total)} "
                              f"{format_eur(ph_adj_now)} = {format_eur(c.sra_side)}.")
                    if abs(ph_adj_prior) > CENT:
                        c.note += (f" Διορθώσεις προηγούμενων μηνών: "
                                   f"{format_eur(ph_adj_prior)} (σε εκείνα τα καθολικά).")
        # EOAF / ISSUANCES settlements land on the balance-sheet account
        if sra and any(l.code == "PH-EOAF" for l in sra.lines):
            eoaf_now = sra_sum_in_period(sra, ["PH-EOAF"], sra.year, sra.month, True)
            add("GL ΟΑΥ λογ. 11202192 (AR- Unearned Revenue- EOAF) = SRA "
                "ISSUANCES/EOAF τρέχοντος μήνα", gl.unearned_eoaf, [])
            c = checks[-1]
            c.sra_side = eoaf_now
            c.note, c.flag = _annotate(c.name, c.source_total, c.sra_side)
            if abs(c.diff or 0) <= CENT:
                c.note = ("OK — οι τακτοποιήσεις EOAF/ISSUANCES δεν περνούν από "
                          "τα κέντρα κόστους φαρμάκων· βιβλιώνονται στον "
                          "λογαριασμό ισολογισμού 11202192 (balance-sheet "
                          "account, not the 255xx pharma centres).")
        if abs(gl.other) > CENT:
            # a cost centre outside the map: never absorbed silently — show
            # it, name the centres, and let the reviewer classify it
            centres = ", ".join(
                f"{k}: {format_eur(v)}" for k, v in
                sorted(gl.other_centres.items(), key=lambda kv: -abs(kv[1]))[:8])
            add("GL ΟΑΥ: κέντρα κόστους εκτός χάρτη (unmapped cost centres)",
                gl.other, [])
            c = checks[-1]
            c.sra_side = 0.0
            c.flag = "amber"
            c.note = ("Ποσά του καθολικού ΟΑΥ σε κέντρα κόστους/λογαριασμούς "
                      "που δεν καλύπτει ο χάρτης — δεν εντάχθηκαν σε κανένα "
                      "καλάθι (not mapped to any bucket): " + centres
                      + ". Στείλτε τα διαγνωστικά ώστε να προστεθούν στον χάρτη.")
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
            alt=bundle.inpatient.best_total if bundle.inpatient else claims_ip)
        c = checks[-1]
        c.label_a, c.label_b = "IS Auditor Report", "SRA"
        c.parts_a = [P("DRG / Fixed-fee αμοιβές", bundle.isaud.drg_fees),
                     P("Κατάλογος Ζ (Procedures Total)", bundle.isaud.z_catalogue)]
        # per-row rounding across ~10k detail rows — the brief accepts small
        # tolerances (F1054: €0.45); the Diff cell still shows the live gap
        if c.flag != "ok" and c.diff is not None and abs(c.diff) <= 5.00:
            c.flag = "ok"
            c.note = ("OK — εντός ανοχής στρογγυλοποίησης του αναλυτικού "
                      f"αρχείου (rounding tolerance, διαφορά {format_eur(c.diff)}).")
    if bundle.xml_activity:
        x = bundle.xml_activity
        # Compare LIKE WITH LIKE.  The export prices ACTIVITIES and carries a
        # ClaimPaymentNumber per claim, so both sides are restricted to the
        # cheques the export actually covers, and the SRA side keeps only the
        # activity-priced streams: OS + NM + AP + the FFS part of PD
        # (personal doctors bill visits per activity; only their capitation is
        # not activity-priced).  Everything else in the outpatient bucket is
        # itemised in the note instead of being dumped into the diff.
        src = x.total
        name = "XML activity export (OS+NM+AP+ΠΙ FFS) = SRA ίδιες επιταγές"
        cheques: set[str] = set()
        dropped = 0.0
        if sra:
            all_cheques = {p[0] for p in sra.parts} or {sra.cheque_no}
            cheques = {k for k in x.by_payment if k in all_cheques} \
                if x.by_payment else set(all_cheques)
            if x.by_payment and cheques:
                src = round(sum(v for k, v in x.by_payment.items()
                                if k in cheques), 2)
                dropped = round(x.total - src, 2)
        # capitation is NOT activity-priced, so it comes off the PD side —
        # but only when it is bundled INSIDE the daily PD lines.  When the SRA
        # pays it as its own PD-CAP line it is already outside the PD code and
        # nothing is deducted.
        cap_own_line = bool(sra) and abs(_sra_sum(sra, ["PD-CAP"])) > CENT
        cap = 0.0 if cap_own_line else (
            bundle.capitation.total if bundle.capitation else 0.0)
        act_codes = ["OS", "NM", "AP", "PD"]
        add(name, src, act_codes, alt=claims_out,
            flag_hint="Κατά προσέγγιση: activity-level έναντι γραμμών SRA "
                      "(προσαρμογές/χρονισμός εκτός export).")
        c = checks[-1]
        if sra:
            # both sides on the same cheques
            in_ch = [l for l in sra.lines if not cheques or l.cheque in cheques]
            ssum = lambda codes: round(  # noqa: E731
                sum(l.amount for l in in_ch if l.code in codes), 2)
            osn, nm, ap, pd_daily = (ssum(["OS"]), ssum(["NM"]), ssum(["AP"]),
                                     ssum(["PD"]))
            c.sra_side = round(osn + nm + ap + pd_daily - cap, 2)
            c.sra_codes = act_codes
            c.side_kind = "codes_minus"
            # restrict the workbook formula to the same cheques, and net off
            # capitation, so the Excel side reproduces this number live
            c.cheques = sorted(cheques) if cheques != all_cheques else []
            c.minus, c.minus_label = cap, "Κατά κεφαλήν ΠΙ (capitation) €"
            c.label_a, c.label_b = "XML activity export", "SRA (ίδιες επιταγές)"
            c.parts_a = [P("Σύνολο export (όλες οι επιταγές)", x.total)]
            if abs(dropped) > CENT:
                c.parts_a.append(P("μείον πράξεις άλλων επιταγών", -dropped))
            c.parts_b = [P("SRA OS — εξωτερικά ιατρεία", osn, code="OS",
                           cheques=c.cheques),
                         P("SRA NM — νοσηλευτές/μαίες", nm, code="NM",
                           cheques=c.cheques),
                         P("SRA AP — επαγγελματίες υγείας", ap, code="AP",
                           cheques=c.cheques),
                         P("SRA PD — ημερήσιες γραμμές ΠΙ", pd_daily, code="PD",
                           cheques=c.cheques)]
            if abs(cap) > CENT:
                c.parts_b.append(P("μείον κατά κεφαλήν ΠΙ (capitation)", -cap))
            excluded = []
            if abs(cap) > CENT:
                excluded.append(("Κατά κεφαλήν ΠΙ μέσα στις γραμμές PD "
                                 "(capitation, δεν τιμολογείται ανά πράξη)", cap))
            elif cap_own_line:
                excluded.append(("Κατά κεφαλήν ΠΙ σε δική της γραμμή PD-CAP "
                                 "(capitation, εκτός των activity streams)",
                                 ssum(["PD-CAP"])))
            for label, codes in (
                    ("Δορυφορικός παροχέας (satellite cheque)", ["SAT"]),
                    ("Αναδρομική προσαρμογή μεθόδου αποζημίωσης (OS-ADJ)", ["OS-ADJ"]),
                    ("Σταθερές χρεώσεις ΠΙ: OOH/εμβολιασμοί (PD-FP)", ["PD-FP"]),
                    ("Ποιοτικά κριτήρια ΠΙ (PD-KPI)", ["PD-KPI", "KPI"]),
                    ("Ποιοτικά κριτήρια MRI/CT", ["MRI", "CT", "MRI/CT"])):
                v = ssum(codes)
                if abs(v) > CENT:
                    excluded.append((label, v))
            bucket = round(sum(l.amount for l in sra.lines
                               if l.bucket == Bucket.OUTPATIENT), 2)
            bridge = " ".join(f"− {lbl} {format_eur(v)}." for lbl, v in excluded)
            c.note = (
                f"Γέφυρα: σύνολο εξωνοσοκομειακών SRA {format_eur(bucket)}. "
                + bridge +
                f" = τιμολογημένα ανά πράξη {format_eur(c.sra_side)} έναντι XML "
                f"{format_eur(src)}"
                + (f" (επιταγές {', '.join(sorted(cheques))})" if cheques else "")
                + f", υπόλοιπο {format_eur(round(src - (c.sra_side or 0), 2))}. "
                + c.note)
        if x.date_from or x.date_to:
            c.note += (f" Παράθυρο export: {x.date_from} — {x.date_to}· πράξεις "
                       "που πλήρωσε η ίδια επιταγή αλλά με ημερομηνία εκτός "
                       "παραθύρου δεν περιλαμβάνονται στο αρχείο (the export "
                       "is date-windowed).")
        if abs(dropped) > CENT:
            c.note += (f" Εκτός επιταγών: {format_eur(dropped)} — απαιτήσεις "
                       "του export που πλήρωσαν άλλες επιταγές, εκτός και από "
                       "τις δύο πλευρές (activities paid by other cheques, "
                       "excluded from BOTH sides).")
        # claim-level join with the claims file: name what is in one file
        # and not the other, so the residual explains itself
        if x.by_claim and bundle.claims and bundle.claims.outpatient_by_claim:
            cl = bundle.claims.outpatient_by_claim
            only_xml = {k: v for k, v in x.by_claim.items() if k not in cl}
            only_cl = {k: v for k, v in cl.items() if k not in x.by_claim}
            both_diff = [(k, round(cl[k] - v, 2)) for k, v in x.by_claim.items()
                         if k in cl and abs(cl[k] - v) > CENT]
            bits = []
            if only_xml:
                top = sorted(only_xml.items(), key=lambda kv: -abs(kv[1]))[:3]
                bits.append(f"μόνο στο XML: {len(only_xml)} απαιτήσεις / "
                            f"{format_eur(round(sum(only_xml.values()), 2))} "
                            "(π.χ. " + ", ".join(f"{k} {format_eur(v)}"
                                                 for k, v in top) + ")")
            if only_cl:
                top = sorted(only_cl.items(), key=lambda kv: -abs(kv[1]))[:3]
                bits.append(f"μόνο στο claims: {len(only_cl)} απαιτήσεις / "
                            f"{format_eur(round(sum(only_cl.values()), 2))} "
                            "(π.χ. " + ", ".join(f"{k} {format_eur(v)}"
                                                 for k, v in top) + ")")
            if both_diff:
                tot = round(sum(v for _k, v in both_diff), 2)
                top = sorted(both_diff, key=lambda kv: -abs(kv[1]))[:3]
                bits.append(f"διαφορετικό ποσό στις ίδιες απαιτήσεις: "
                            f"{len(both_diff)} / {format_eur(tot)} "
                            "(π.χ. " + ", ".join(f"{k} {format_eur(v)}"
                                                 for k, v in top) + ")")
            if bits:
                c.note += (" Σύγκριση ανά ClaimId με το αρχείο claims — "
                           + " · ".join(bits) + ".")
            else:
                c.note += (" Σύγκριση ανά ClaimId με το αρχείο claims: κάθε "
                           "απαίτηση ταυτίζεται (every claim matches).")
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
        put("Ενδ. summary", STREAMS[0], ip.best_total)
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
    # prefer whichever source carries the THREE-WAY split (DRG / daily
    # treatments / Z-drugs) — only the Ενδ. per-claim detail table has the
    # «Procedure Class Id» that separates them; the claims file groups by
    # speciality with a single total
    endo_rows = bundle.inpatient.by_clinic if bundle.inpatient else []
    claims_rows = bundle.claims.inpatient_by_clinic if bundle.claims else []
    split_rows = [r for r in endo_rows if r.z_drugs or r.fixed_fee]
    clinic_rows = endo_rows if split_rows else (claims_rows or endo_rows)
    if clinic_rows:
        for r in clinic_rows:
            ip.rows.append(SplitRow(label=r.clinic, amount=r.total,
                                    fixed_fee=r.fixed_fee or None, drg=r.drg or None,
                                    z_drugs=r.z_drugs or None))
    elif bundle.claims:
        ip.rows.append(SplitRow("Ενδονοσοκομειακή (inpatient claims)",
                                bundle.claims.by_segment.get("Inpatient", 0.0)))
    elif bundle.inpatient:
        ip.rows.append(SplitRow("Κανονικά (Regular)", bundle.inpatient.regular))
        ip.rows.append(SplitRow("Εξειδικευμένα (Specialized)", bundle.inpatient.specialized))
        if bundle.inpatient.gennes:
            ip.rows.append(SplitRow("Γέννες (Births)", bundle.inpatient.gennes))
        ip.rows.append(SplitRow("Κατάλογος Z — φάρμακα/πράξεις (Z-drugs)",
                                bundle.inpatient.z_catalogue,
                                z_drugs=bundle.inpatient.z_catalogue))
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
    os_adj = sra_amount(["OS-ADJ"])
    if os_adj:
        out.rows.append(SplitRow(
            "Εξωνοσοκομειακή — προσαρμογές μεθόδου αποζημίωσης (OS reimb-method "
            "adjustments)", os_adj))
    sat = sra_amount(["SAT"])
    if sat:
        out.rows.append(SplitRow(
            "Επιταγές δορυφορικών παροχέων (satellite suppliers, π.χ. κέντρα "
            "υγείας)", sat))
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
    ph_eoaf = sra_amount(["PH-EOAF"])
    if ph_eoaf:
        ph.rows.append(SplitRow(
            "Φάρμακα — τακτοποιήσεις EOAF/ISSUANCES (GL 11202192 unearned "
            "revenue)", ph_eoaf))
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
