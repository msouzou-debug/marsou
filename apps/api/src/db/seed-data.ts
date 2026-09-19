import type { AppRole, Directorate, OrgUnit, OrgUnitType } from "@ecapital/shared";

// CAPEX-03 §3 — the eleven org units the Capex Plan sheet counts, and the
// spellings column D of it uses for them, plus HQ, the twelfth (owner
// decision, 19/09/2026 — see below). The first eleven are copied from
// apps/web/src/mocks/org-units.ts so the seeded API answers GET /org-units
// with exactly what the frontend mock answered (ADR-0005): the frontend
// swaps by base URL and sees no difference.
//
// Errata (docs/briefs/README.md): Troodos and Kyperounta are one hospital, so
// ΝΟΣΟΚΟΜΕΙΟ ΚΥΠΕΡΟΥΝΤΑΣ is an alias of Troodos, not a separate unit.
//
// HQ (owner decision, 19/09/2026): Central Administration is now a unit —
// type CENTRAL, directorate KENTRIKI_DIOIKISI (migration 0009_hq_unit.sql).
// It carries no aliases: the Capex Plan sheet has no HQ rows for the Excel
// importer to match against, unlike the other eleven, so there is no source
// spelling to record. `apps/api/src/cli/run.ts`'s orgUnitIndex builds its
// alias map from whatever is in `ecapital.org_unit` and `org_unit_alias` at
// import time, with no assumption about how many rows either table has, so a
// twelfth unit with zero aliases does not change what the importer does with
// a workbook that never mentions it.
export interface SeedOrgUnit extends OrgUnit {
  aliases: string[];
}

// ADR-0019 — the eFinance entity code for each unit, which is also the SAP
// Fund Center. Taken from INTEGRATION-eMAP §2's table of thirteen; twelve of
// them now have an eCapital unit, HQ included (owner decision, 19/09/2026).
//
// One eFinance code is still deliberately absent, because eCapital has no
// unit for it and inventing one would put a fictional service in the capital
// register: CNS (Κοινοτική Νοσηλευτική Υπηρεσία). ADR-0019 lists it as
// unmapped, and nothing here invents a unit for it.
//
// CONFIRMED, ADR-0019 and INTEGRATION-eFinance-eMAP-eCapital.md §2 (owner,
// 19/09/2026): ΠΦΥ (Πρωτοβάθμια Φροντίδα Υγείας) is eFinance's HC (Κέντρα
// Υγείας). This was an assumption until this date; it no longer is.
const unit = (
  id: string,
  code: string,
  nameEl: string,
  nameEn: string,
  type: OrgUnitType,
  directorate: Directorate,
  costCentre: string | null,
  entityCode: string | null,
  aliases: string[],
): SeedOrgUnit => ({
  id,
  code,
  nameEl,
  nameEn,
  type,
  directorate,
  costCentre,
  entityCode,
  timezone: "Europe/Nicosia",
  aliases,
});

export const seedOrgUnits: SeedOrgUnit[] = [
  unit("nicosia-general", "NGH", "Γενικό Νοσοκομείο Λευκωσίας", "Nicosia General Hospital",
    "HOSPITAL", "LEFKOSIAS", "CC-NGH-01", "NGH", ["Γ.Ν. ΛΕΥΚΩΣΙΑΣ"]),
  unit("larnaca-general", "LAR", "Γενικό Νοσοκομείο Λάρνακας", "Larnaca General Hospital",
    "HOSPITAL", "LARNAKAS_AMMOCHOSTOU", "CC-LAR-01", "LAR", ["Γ.Ν. ΛΑΡΝΑΚΑΣ"]),
  unit("paphos-general", "PAF", "Γενικό Νοσοκομείο Πάφου", "Paphos General Hospital",
    "HOSPITAL", "LEMESOU_PAFOU", "CC-PAF-01", "PAP", ["Γ.Ν. ΠΑΦΟΥ"]),
  unit("limassol-general", "LMS", "Γενικό Νοσοκομείο Λεμεσού", "Limassol General Hospital",
    "HOSPITAL", "LEMESOU_PAFOU", "CC-LMS-01", "LGH", ["Γ.Ν. ΛΕΜΕΣΟΥ"]),
  unit("troodos", "TRD", "Νοσοκομείο Τροόδους", "Troodos Hospital",
    "HOSPITAL", "LEMESOU_PAFOU", "CC-TRD-01",
    "TRD", ["ΝΟΣΟΚΟΜΕΙΟ ΤΡΟΟΔΟΥΣ", "ΝΟΣΟΚΟΜΕΙΟ ΚΥΠΕΡΟΥΝΤΑΣ", "Ν. ΚΥΠΕΡΟΥΝΤΑΣ"]),
  unit("namiii", "NAM3", "Νοσοκομείο Αρχιεπίσκοπος Μακάριος Γ΄", "Archbishop Makarios III Hospital",
    "HOSPITAL", "LEFKOSIAS", "CC-NAM3-01", "ARC", ["ΝΑΜΙΙΙ"]),
  unit("polis-chrysochous", "PCH", "Νοσοκομείο Πόλεως Χρυσοχούς", "Polis Chrysochous Hospital",
    "HOSPITAL", "LEMESOU_PAFOU", "CC-PCH-01", "CHR", ["ΝΟΣΟΚΟΜΕΙΟ ΠΟΛΕΩΣ ΧΡΥΣΟΧΟΥΣ"]),
  unit("famagusta-general", "FAM", "Γενικό Νοσοκομείο Αμμοχώστου", "Famagusta General Hospital",
    "HOSPITAL", "LARNAKAS_AMMOCHOSTOU", "CC-FAM-01", "FAM", ["Γ.Ν. ΑΜΜΟΧΩΣΤΟΥ"]),
  unit("dypsy", "DYP", "Διεύθυνση Υπηρεσιών Ψυχικής Υγείας", "Mental Health Services",
    "SERVICE", "DYPSY", "CC-DYP-01", "MH", ["ΔΥΨΥ"]),
  unit("pfy", "PFY", "Πρωτοβάθμια Φροντίδα Υγείας", "Primary Healthcare",
    "SERVICE", "PFY", "CC-PFY-01", "HC", ["ΠΡΩΤΟΒΑΘΜΙΑ ΦΡΟΝΤΙΔΑ ΥΓΕΙΑΣ"]),
  unit("ambulance", "AMB", "Υπηρεσία Ασθενοφόρων", "Ambulance Service",
    "SERVICE", "AMBULANCE", "CC-AMB-01", "AMB", ["ΥΠΗΡΕΣΙΑ ΑΣΘΕΝΟΦΟΡΩΝ"]),
  // Owner decision, 19/09/2026. No cost centre — Central Administration has
  // never had one in this register, and nothing assigns it one now — and no
  // aliases, for the reason in the header comment above.
  unit("hq", "HQ", "Κεντρικά Γραφεία", "Central Offices",
    "CENTRAL", "KENTRIKI_DIOIKISI", null, "HQ", []),
];

// One building at Nicosia General with two floors and six areas, enough for
// the M0 area tree to have something in it on first run (§15). The risk
// groups follow ICRA 2.0 Table 2: theatre and ICU are the highest band, an
// inpatient ward is high, outpatients is medium, plant and office are low.
export const seedBuilding = {
  orgUnitId: "nicosia-general",
  code: "NGH-A",
  nameEl: "Κτίριο Α — Κεντρική Πτέρυγα",
  grossAreaM2: "18400.00",
  yearBuilt: 2006,
  storeys: 2,
  floors: [
    {
      code: "00",
      nameEl: "Ισόγειο",
      level: 0,
      areas: [
        {
          code: "OPD-01",
          nameEl: "Εξωτερικά Ιατρεία",
          areaType: "OPD" as const,
          patientRiskGroup: "MEDIUM" as const,
          costCentre: "CC-NGH-OPD",
          beds: null,
        },
        {
          code: "PLT-01",
          nameEl: "Μηχανοστάσιο",
          areaType: "PLANT" as const,
          patientRiskGroup: "LOW" as const,
          costCentre: "CC-NGH-TEC",
          beds: null,
        },
        {
          code: "OFF-01",
          nameEl: "Γραφεία Τεχνικών Υπηρεσιών",
          areaType: "OFFICE" as const,
          patientRiskGroup: "LOW" as const,
          costCentre: "CC-NGH-TEC",
          beds: null,
        },
      ],
    },
    {
      code: "01",
      nameEl: "Πρώτος όροφος",
      level: 1,
      areas: [
        {
          code: "THE-01",
          nameEl: "Χειρουργείο 1",
          areaType: "THEATRE" as const,
          patientRiskGroup: "HIGHEST" as const,
          costCentre: "CC-NGH-THE",
          beds: null,
        },
        {
          code: "ICU-01",
          nameEl: "Μονάδα Εντατικής Θεραπείας",
          areaType: "ICU" as const,
          patientRiskGroup: "HIGHEST" as const,
          costCentre: "CC-NGH-ICU",
          beds: 8,
        },
        {
          code: "WRD-01",
          nameEl: "Θάλαμος Α1",
          areaType: "WARD" as const,
          patientRiskGroup: "HIGH" as const,
          costCentre: "CC-NGH-WRD",
          beds: 24,
        },
      ],
    },
  ],
};

// Seven users, so every access path the API has has somebody to walk it —
// including the finance account that ADR-0014 gives the approved budget to.
// They exist only where DEV_AUTH is on; on the real server the users come
// from Entra ID.
export interface SeedUser {
  subject: string;
  name: string;
  email: string;
  roles: AppRole[];
  orgUnitIds: string[];
}

export const seedUsers: SeedUser[] = [
  {
    subject: "dev-admin",
    name: "Μαρία Κωνσταντίνου",
    email: "admin@ecapital.test",
    roles: ["admin"],
    // Central Administration carries every unit id, as the real token will.
    orgUnitIds: seedOrgUnits.map((u) => u.id),
  },
  {
    subject: "dev-estates-nicosia",
    name: "Ανδρέας Παπαδόπουλος",
    email: "estates.nicosia@ecapital.test",
    roles: ["estates_head"],
    orgUnitIds: ["nicosia-general"],
  },
  {
    subject: "dev-engineer-larnaca",
    name: "Ελένη Χριστοδούλου",
    email: "engineer.larnaca@ecapital.test",
    roles: ["project_engineer"],
    orgUnitIds: ["larnaca-general"],
  },
  {
    subject: "dev-clinical-nicosia",
    name: "Γιώργος Σάββα",
    email: "clinical.nicosia@ecapital.test",
    roles: ["clinical_approver"],
    orgUnitIds: ["nicosia-general"],
  },
  {
    // The field persona (CAPEX-01 §2, §8): a technician raises and works the
    // defects they find on an inspection round or on a work order, and
    // nothing else. ADR-0017 says why that is a row policy and not a role
    // check on the route.
    subject: "dev-technician-nicosia",
    name: "Κυριάκος Στυλιανού",
    email: "technician.nicosia@ecapital.test",
    roles: ["technician"],
    orgUnitIds: ["nicosia-general"],
  },
  {
    subject: "dev-finance",
    name: "Δέσποινα Ιωάννου",
    email: "finance@ecapital.test",
    roles: ["finance"],
    // ADR-0014 (owner decision, 19/09/2026): once a project is APPROVED the
    // approved budget is finance's to change, and the Οικονομική Διεύθυνση
    // works across the organisation, so this account carries every unit.
    orgUnitIds: seedOrgUnits.map((u) => u.id),
  },
  {
    subject: "dev-auditor",
    name: "Χριστίνα Λοΐζου",
    email: "auditor@ecapital.test",
    roles: ["auditor_readonly"],
    // The auditor sees every unit through the role, not through a list.
    orgUnitIds: [],
  },
  {
    subject: "dev-executive",
    name: "Ανδρέας Παπαδόπουλος",
    email: "executive@ecapital.test",
    roles: ["executive_readonly"],
    // Board and CEO office: every unit, read-only, like the auditor but
    // without access to the audit log.
    orgUnitIds: [],
  },
];

// Groups→roles is a config table, not code (ADR-0009). These are placeholder
// object ids; at deployment an administrator replaces them with the real
// values — Entra object ids in oidc mode, Active Directory group DNs such as
// `CN=eCapital Admins,OU=Groups,DC=ihcis,DC=local` in ldap mode (ADR-0018).
//
// FLAG (ADR-0018): which ΟΚΥπΥ AD group grants which eCapital role is an
// administrator's decision at deployment and is not ours to guess. Nothing
// below is a real group. Until those rows exist, an AD user signs in and
// sees nothing — ADR-0009's safe direction.
export const seedRoleMappings: {
  groupId: string;
  role: AppRole;
  orgUnitId: string | null;
  note: string;
}[] = [
  {
    groupId: "00000000-0000-0000-0000-0000000000a1",
    role: "admin",
    orgUnitId: null,
    note: "eCapital Administrators",
  },
  {
    groupId: "00000000-0000-0000-0000-0000000000a2",
    role: "executive_readonly",
    orgUnitId: null,
    note: "eCapital Executive",
  },
  {
    groupId: "00000000-0000-0000-0000-0000000000a3",
    role: "auditor_readonly",
    orgUnitId: null,
    note: "eCapital Auditors",
  },
  {
    groupId: "00000000-0000-0000-0000-0000000000a4",
    role: "finance",
    orgUnitId: null,
    note: "eCapital Finance",
  },
  {
    groupId: "00000000-0000-0000-0000-0000000000b1",
    role: "estates_head",
    orgUnitId: "nicosia-general",
    note: "eCapital Estates — Nicosia General",
  },
  {
    groupId: "00000000-0000-0000-0000-0000000000b2",
    role: "project_engineer",
    orgUnitId: "larnaca-general",
    note: "eCapital Engineers — Larnaca General",
  },
  {
    groupId: "00000000-0000-0000-0000-0000000000b3",
    role: "clinical_approver",
    orgUnitId: "nicosia-general",
    note: "eCapital Clinical Approvers — Nicosia General",
  },
  {
    groupId: "00000000-0000-0000-0000-0000000000b4",
    role: "technician",
    orgUnitId: "nicosia-general",
    note: "eCapital Technicians — Nicosia General",
  },
];


// ------------------------------------------------------------------- M1 --
// The 42 fixture projects from the Capex Plan units, copied from
// apps/web/src/mocks/projects.ts so the seeded API answers GET /projects with
// what the frontend mock answered (ADR-0005). Copied and not imported:
// apps/api does not depend on apps/web, and a shared fixture would make the
// API's seed hostage to a frontend edit. PRJ-043 below is a 43rd, API-only
// fixture (owner decision, 19/09/2026): HQ has no rows in the Capex Plan
// sheet and so no equivalent in the frontend mock, but it needs one project
// of its own so S01's unit table does not show it with an empty row and a
// flat sparkline.
//
// Figures are obviously fake and round. `ref` is the fixture's own id, kept
// only so the two files can be compared by eye; the code each project ends up
// with is allocated by ecapital.allocate_project_code at seed time (ADR-0014),
// so it is NGH-2026-003 here and not the fixture's NGH-003.
//
// The natural key for a re-run is org unit + title (CAPEX-03 §2 col E), which
// is what makes `pnpm seed` safe to run twice.

export interface SeedProject {
  ref: string;
  orgUnitId: string;
  titleEl: string;
  category: "NEW_BUILD" | "RENOVATION" | "SMALL_WORKS" | "EQUIPMENT" | "MAINTENANCE_CAPITAL" | "IT";
  phase:
    | "IDEA"
    | "PREPARATION"
    | "APPROVED"
    | "TENDERED"
    | "AWARDED"
    | "IN_PROGRESS"
    | "PRACTICAL_COMPLETION"
    | "DEFECTS_LIABILITY"
    | "CLOSED";
  approvedBudget: number;
  fundingSource: "STATE_BUDGET" | "EU" | "DONATION" | "OWN";
  plannedStart: string | null;
  plannedFinish: string | null;
  rag: "GREEN" | "AMBER" | "RED";
  ragReason: string;
  sapWbs: string | null;
  tenderReference: string | null;
}

export const seedProjects: SeedProject[] = [
  {
    ref: "PRJ-001",
    orgUnitId: "polis-chrysochous",
    titleEl: "Ανακαίνιση χειρουργείων",
    category: "RENOVATION",
    phase: "IDEA",
    approvedBudget: 3115000,
    fundingSource: "STATE_BUDGET",
    plannedStart: "2027-03-13",
    plannedFinish: "2028-02-22",
    rag: "GREEN",
    ragReason: "Το έργο βρίσκεται εντός εγκεκριμένου προϋπολογισμού και χρονοδιαγράμματος",
    sapWbs: null,
    tenderReference: null,
  },
  {
    ref: "PRJ-002",
    orgUnitId: "troodos",
    titleEl: "Αντικατάσταση ψυκτικών μονάδων",
    category: "MAINTENANCE_CAPITAL",
    phase: "IDEA",
    approvedBudget: 8915000,
    fundingSource: "STATE_BUDGET",
    plannedStart: "2027-02-11",
    plannedFinish: "2029-07-15",
    rag: "GREEN",
    ragReason: "Το έργο βρίσκεται εντός εγκεκριμένου προϋπολογισμού και χρονοδιαγράμματος",
    sapWbs: null,
    tenderReference: null,
  },
  {
    ref: "PRJ-003",
    orgUnitId: "nicosia-general",
    titleEl: "Επέκταση ΤΑΕΠ",
    category: "NEW_BUILD",
    phase: "IDEA",
    approvedBudget: 10075000,
    fundingSource: "STATE_BUDGET",
    plannedStart: "2026-10-15",
    plannedFinish: "2027-12-08",
    rag: "GREEN",
    ragReason: "Το έργο βρίσκεται εντός εγκεκριμένου προϋπολογισμού και χρονοδιαγράμματος",
    sapWbs: null,
    tenderReference: null,
  },
  {
    ref: "PRJ-004",
    orgUnitId: "namiii",
    titleEl: "Νέος μαγνητικός τομογράφος",
    category: "EQUIPMENT",
    phase: "IDEA",
    approvedBudget: 7310000,
    fundingSource: "EU",
    plannedStart: "2027-06-06",
    plannedFinish: "2028-03-20",
    rag: "GREEN",
    ragReason: "Το έργο βρίσκεται εντός εγκεκριμένου προϋπολογισμού και χρονοδιαγράμματος",
    sapWbs: null,
    tenderReference: null,
  },
  {
    ref: "PRJ-005",
    orgUnitId: "nicosia-general",
    titleEl: "Αναβάθμιση συστήματος πυρανίχνευσης",
    category: "MAINTENANCE_CAPITAL",
    phase: "PREPARATION",
    approvedBudget: 1765000,
    fundingSource: "STATE_BUDGET",
    plannedStart: "2027-06-14",
    plannedFinish: "2028-10-06",
    rag: "GREEN",
    ragReason: "Το έργο βρίσκεται εντός εγκεκριμένου προϋπολογισμού και χρονοδιαγράμματος",
    sapWbs: null,
    tenderReference: null,
  },
  {
    ref: "PRJ-006",
    orgUnitId: "pfy",
    titleEl: "Αντικατάσταση ανελκυστήρων",
    category: "MAINTENANCE_CAPITAL",
    phase: "PREPARATION",
    approvedBudget: 9245000,
    fundingSource: "STATE_BUDGET",
    plannedStart: "2027-06-30",
    plannedFinish: "2029-04-17",
    rag: "GREEN",
    ragReason: "Το έργο βρίσκεται εντός εγκεκριμένου προϋπολογισμού και χρονοδιαγράμματος",
    sapWbs: null,
    tenderReference: null,
  },
  {
    ref: "PRJ-007",
    orgUnitId: "ambulance",
    titleEl: "Ανακαίνιση Μονάδας Εντατικής Θεραπείας",
    category: "RENOVATION",
    phase: "PREPARATION",
    approvedBudget: 6385000,
    fundingSource: "DONATION",
    plannedStart: "2027-10-04",
    plannedFinish: "2028-09-29",
    rag: "GREEN",
    ragReason: "Το έργο βρίσκεται εντός εγκεκριμένου προϋπολογισμού και χρονοδιαγράμματος",
    sapWbs: null,
    tenderReference: null,
  },
  {
    ref: "PRJ-008",
    orgUnitId: "dypsy",
    titleEl: "Αναβάθμιση ηλεκτρομηχανολογικών εγκαταστάσεων",
    category: "MAINTENANCE_CAPITAL",
    phase: "PREPARATION",
    approvedBudget: 9315000,
    fundingSource: "STATE_BUDGET",
    plannedStart: "2027-05-02",
    plannedFinish: "2029-06-25",
    rag: "GREEN",
    ragReason: "Το έργο βρίσκεται εντός εγκεκριμένου προϋπολογισμού και χρονοδιαγράμματος",
    sapWbs: null,
    tenderReference: null,
  },
  {
    ref: "PRJ-009",
    orgUnitId: "nicosia-general",
    titleEl: "Αντικατάσταση στέγης κτηρίου Γ",
    category: "MAINTENANCE_CAPITAL",
    phase: "PREPARATION",
    approvedBudget: 4750000,
    fundingSource: "STATE_BUDGET",
    plannedStart: "2027-02-25",
    plannedFinish: "2028-04-02",
    rag: "GREEN",
    ragReason: "Το έργο βρίσκεται εντός εγκεκριμένου προϋπολογισμού και χρονοδιαγράμματος",
    sapWbs: null,
    tenderReference: null,
  },
  {
    ref: "PRJ-010",
    orgUnitId: "nicosia-general",
    titleEl: "Ενεργειακή αναβάθμιση κτηριακού συγκροτήματος",
    category: "RENOVATION",
    phase: "PREPARATION",
    approvedBudget: 4765000,
    fundingSource: "EU",
    plannedStart: "2026-11-18",
    plannedFinish: "2028-05-21",
    rag: "GREEN",
    ragReason: "Το έργο βρίσκεται εντός εγκεκριμένου προϋπολογισμού και χρονοδιαγράμματος",
    sapWbs: null,
    tenderReference: null,
  },
  {
    ref: "PRJ-011",
    orgUnitId: "polis-chrysochous",
    titleEl: "Νέο ακτινολογικό μηχάνημα",
    category: "EQUIPMENT",
    phase: "PREPARATION",
    approvedBudget: 2400000,
    fundingSource: "STATE_BUDGET",
    plannedStart: "2027-07-14",
    plannedFinish: "2028-07-11",
    rag: "GREEN",
    ragReason: "Το έργο βρίσκεται εντός εγκεκριμένου προϋπολογισμού και χρονοδιαγράμματος",
    sapWbs: null,
    tenderReference: null,
  },
  {
    ref: "PRJ-012",
    orgUnitId: "limassol-general",
    titleEl: "Αναβάθμιση δικτύου ιατρικών αερίων",
    category: "MAINTENANCE_CAPITAL",
    phase: "PREPARATION",
    approvedBudget: 7325000,
    fundingSource: "OWN",
    plannedStart: "2026-11-02",
    plannedFinish: "2028-05-01",
    rag: "GREEN",
    ragReason: "Το έργο βρίσκεται εντός εγκεκριμένου προϋπολογισμού και χρονοδιαγράμματος",
    sapWbs: null,
    tenderReference: null,
  },
  {
    ref: "PRJ-013",
    orgUnitId: "pfy",
    titleEl: "Επέκταση χώρων στάθμευσης",
    category: "NEW_BUILD",
    phase: "PREPARATION",
    approvedBudget: 9595000,
    fundingSource: "STATE_BUDGET",
    plannedStart: "2027-06-24",
    plannedFinish: "2028-08-29",
    rag: "GREEN",
    ragReason: "Το έργο βρίσκεται εντός εγκεκριμένου προϋπολογισμού και χρονοδιαγράμματος",
    sapWbs: null,
    tenderReference: null,
  },
  {
    ref: "PRJ-014",
    orgUnitId: "paphos-general",
    titleEl: "Ανακαίνιση εξωτερικών ιατρείων",
    category: "RENOVATION",
    phase: "PREPARATION",
    approvedBudget: 11745000,
    fundingSource: "STATE_BUDGET",
    plannedStart: "2027-02-20",
    plannedFinish: "2028-01-03",
    rag: "GREEN",
    ragReason: "Το έργο βρίσκεται εντός εγκεκριμένου προϋπολογισμού και χρονοδιαγράμματος",
    sapWbs: null,
    tenderReference: null,
  },
  {
    ref: "PRJ-015",
    orgUnitId: "famagusta-general",
    titleEl: "Αντικατάσταση συστήματος κλιματισμού",
    category: "MAINTENANCE_CAPITAL",
    phase: "APPROVED",
    approvedBudget: 1290000,
    fundingSource: "STATE_BUDGET",
    plannedStart: "2026-12-01",
    plannedFinish: "2027-08-10",
    rag: "GREEN",
    ragReason: "Το έργο βρίσκεται εντός εγκεκριμένου προϋπολογισμού και χρονοδιαγράμματος",
    sapWbs: null,
    tenderReference: null,
  },
  {
    ref: "PRJ-016",
    orgUnitId: "larnaca-general",
    titleEl: "Αναβάθμιση δικτύου πυρόσβεσης",
    category: "MAINTENANCE_CAPITAL",
    phase: "APPROVED",
    approvedBudget: 3345000,
    fundingSource: "EU",
    plannedStart: "2027-02-17",
    plannedFinish: "2028-02-04",
    rag: "GREEN",
    ragReason: "Το έργο βρίσκεται εντός εγκεκριμένου προϋπολογισμού και χρονοδιαγράμματος",
    sapWbs: null,
    tenderReference: null,
  },
  {
    ref: "PRJ-017",
    orgUnitId: "troodos",
    titleEl: "Κατασκευή νέας πτέρυγας νοσηλείας",
    category: "NEW_BUILD",
    phase: "APPROVED",
    approvedBudget: 10125000,
    fundingSource: "STATE_BUDGET",
    plannedStart: "2026-10-09",
    plannedFinish: "2028-04-22",
    rag: "GREEN",
    ragReason: "Το έργο βρίσκεται εντός εγκεκριμένου προϋπολογισμού και χρονοδιαγράμματος",
    sapWbs: null,
    tenderReference: null,
  },
  {
    ref: "PRJ-018",
    orgUnitId: "paphos-general",
    titleEl: "Αντικατάσταση ιατρικού εξοπλισμού εργαστηρίων",
    category: "EQUIPMENT",
    phase: "APPROVED",
    approvedBudget: 3025000,
    fundingSource: "STATE_BUDGET",
    plannedStart: "2027-05-26",
    plannedFinish: "2028-07-15",
    rag: "GREEN",
    ragReason: "Το έργο βρίσκεται εντός εγκεκριμένου προϋπολογισμού και χρονοδιαγράμματος",
    sapWbs: null,
    tenderReference: null,
  },
  {
    ref: "PRJ-019",
    orgUnitId: "larnaca-general",
    titleEl: "Αναβάθμιση πληροφοριακού συστήματος νοσοκομείου",
    category: "IT",
    phase: "APPROVED",
    approvedBudget: 6565000,
    fundingSource: "DONATION",
    plannedStart: "2026-09-18",
    plannedFinish: "2027-10-18",
    rag: "GREEN",
    ragReason: "Το έργο βρίσκεται εντός εγκεκριμένου προϋπολογισμού και χρονοδιαγράμματος",
    sapWbs: null,
    tenderReference: null,
  },
  {
    ref: "PRJ-020",
    orgUnitId: "nicosia-general",
    titleEl: "Επισκευή στέγης χειρουργικού τομέα",
    category: "MAINTENANCE_CAPITAL",
    phase: "APPROVED",
    approvedBudget: 11915000,
    fundingSource: "STATE_BUDGET",
    plannedStart: "2027-03-03",
    plannedFinish: "2028-05-14",
    rag: "GREEN",
    ragReason: "Το έργο βρίσκεται εντός εγκεκριμένου προϋπολογισμού και χρονοδιαγράμματος",
    sapWbs: null,
    tenderReference: null,
  },
  {
    ref: "PRJ-021",
    orgUnitId: "paphos-general",
    titleEl: "Αντικατάσταση λεβητοστασίου",
    category: "MAINTENANCE_CAPITAL",
    phase: "TENDERED",
    approvedBudget: 1225000,
    fundingSource: "STATE_BUDGET",
    plannedStart: "2026-11-23",
    plannedFinish: "2028-06-05",
    rag: "GREEN",
    ragReason: "Το έργο βρίσκεται εντός εγκεκριμένου προϋπολογισμού και χρονοδιαγράμματος",
    sapWbs: null,
    tenderReference: "TND-2026-021",
  },
  {
    ref: "PRJ-022",
    orgUnitId: "nicosia-general",
    titleEl: "Ανακαίνιση τμήματος αιμοκάθαρσης",
    category: "RENOVATION",
    phase: "TENDERED",
    approvedBudget: 2655000,
    fundingSource: "EU",
    plannedStart: "2026-10-29",
    plannedFinish: "2027-07-27",
    rag: "GREEN",
    ragReason: "Το έργο βρίσκεται εντός εγκεκριμένου προϋπολογισμού και χρονοδιαγράμματος",
    sapWbs: null,
    tenderReference: "TND-2026-022",
  },
  {
    ref: "PRJ-023",
    orgUnitId: "namiii",
    titleEl: "Αναβάθμιση συστήματος ελέγχου πρόσβασης",
    category: "MAINTENANCE_CAPITAL",
    phase: "TENDERED",
    approvedBudget: 1370000,
    fundingSource: "STATE_BUDGET",
    plannedStart: "2027-03-01",
    plannedFinish: "2028-09-02",
    rag: "GREEN",
    ragReason: "Το έργο βρίσκεται εντός εγκεκριμένου προϋπολογισμού και χρονοδιαγράμματος",
    sapWbs: null,
    tenderReference: "TND-2026-023",
  },
  {
    ref: "PRJ-024",
    orgUnitId: "limassol-general",
    titleEl: "Κατασκευή νέου ακτινοθεραπευτικού τμήματος",
    category: "NEW_BUILD",
    phase: "TENDERED",
    approvedBudget: 4515000,
    fundingSource: "OWN",
    plannedStart: "2027-01-15",
    plannedFinish: "2027-11-28",
    rag: "GREEN",
    ragReason: "Το έργο βρίσκεται εντός εγκεκριμένου προϋπολογισμού και χρονοδιαγράμματος",
    sapWbs: null,
    tenderReference: "TND-2026-024",
  },
  {
    ref: "PRJ-025",
    orgUnitId: "troodos",
    titleEl: "Αντικατάσταση δικτύου ύδρευσης",
    category: "MAINTENANCE_CAPITAL",
    phase: "AWARDED",
    approvedBudget: 1595000,
    fundingSource: "STATE_BUDGET",
    plannedStart: "2026-09-04",
    plannedFinish: "2027-06-05",
    rag: "RED",
    ragReason: "Η πρόβλεψη τελικού κόστους υπερβαίνει τον εγκεκριμένο προϋπολογισμό κατά €134.000",
    sapWbs: "WBS-TRD-025",
    tenderReference: "TND-2026-025",
  },
  {
    ref: "PRJ-026",
    orgUnitId: "limassol-general",
    titleEl: "Ανακαίνιση μαιευτηρίου",
    category: "RENOVATION",
    phase: "AWARDED",
    approvedBudget: 5560000,
    fundingSource: "STATE_BUDGET",
    plannedStart: "2026-08-19",
    plannedFinish: "2027-07-27",
    rag: "GREEN",
    ragReason: "Το έργο βρίσκεται εντός εγκεκριμένου προϋπολογισμού και χρονοδιαγράμματος",
    sapWbs: "WBS-LMS-026",
    tenderReference: "TND-2026-026",
  },
  {
    ref: "PRJ-027",
    orgUnitId: "paphos-general",
    titleEl: "Αναβάθμιση φαρμακείου νοσοκομείου",
    category: "SMALL_WORKS",
    phase: "AWARDED",
    approvedBudget: 1520000,
    fundingSource: "STATE_BUDGET",
    plannedStart: "2026-06-10",
    plannedFinish: "2027-05-29",
    rag: "AMBER",
    ragReason: "Οι δαπάνες υστερούν σημαντικά έναντι του χρονοδιαγράμματος του έργου",
    sapWbs: "WBS-PAF-027",
    tenderReference: "TND-2026-027",
  },
  {
    ref: "PRJ-028",
    orgUnitId: "dypsy",
    titleEl: "Επέκταση αποθηκευτικών χώρων",
    category: "NEW_BUILD",
    phase: "AWARDED",
    approvedBudget: 1470000,
    fundingSource: "EU",
    plannedStart: "2026-08-23",
    plannedFinish: "2027-11-23",
    rag: "GREEN",
    ragReason: "Το έργο βρίσκεται εντός εγκεκριμένου προϋπολογισμού και χρονοδιαγράμματος",
    sapWbs: "WBS-DYP-028",
    tenderReference: "TND-2026-028",
  },
  {
    ref: "PRJ-029",
    orgUnitId: "namiii",
    titleEl: "Νέο σύστημα αδιάλειπτης παροχής ενέργειας",
    category: "EQUIPMENT",
    phase: "IN_PROGRESS",
    approvedBudget: 11675000,
    fundingSource: "STATE_BUDGET",
    plannedStart: "2025-12-18",
    plannedFinish: "2026-10-16",
    rag: "GREEN",
    ragReason: "Το έργο βρίσκεται εντός εγκεκριμένου προϋπολογισμού και χρονοδιαγράμματος",
    sapWbs: "WBS-NAM3-029",
    tenderReference: "TND-2026-029",
  },
  {
    ref: "PRJ-030",
    orgUnitId: "dypsy",
    titleEl: "Αναβάθμιση κέντρου υγείας",
    category: "RENOVATION",
    phase: "IN_PROGRESS",
    approvedBudget: 10690000,
    fundingSource: "STATE_BUDGET",
    plannedStart: "2026-02-06",
    plannedFinish: "2027-10-13",
    rag: "RED",
    ragReason: "Οι δεσμεύσεις υπερβαίνουν τον εγκεκριμένο προϋπολογισμό κατά €1.702.000",
    sapWbs: "WBS-DYP-030",
    tenderReference: "TND-2026-030",
  },
  {
    ref: "PRJ-031",
    orgUnitId: "larnaca-general",
    titleEl: "Αντικατάσταση οχημάτων ασθενοφόρων",
    category: "EQUIPMENT",
    phase: "IN_PROGRESS",
    approvedBudget: 3320000,
    fundingSource: "DONATION",
    plannedStart: "2025-10-16",
    plannedFinish: "2026-10-01",
    rag: "RED",
    ragReason: "Η πρόβλεψη τελικού κόστους υπερβαίνει τον εγκεκριμένο προϋπολογισμό κατά €295.000",
    sapWbs: "WBS-LAR-031",
    tenderReference: "TND-2026-031",
  },
  {
    ref: "PRJ-032",
    orgUnitId: "polis-chrysochous",
    titleEl: "Ανακαίνιση σταθμού ασθενοφόρων",
    category: "RENOVATION",
    phase: "IN_PROGRESS",
    approvedBudget: 3460000,
    fundingSource: "STATE_BUDGET",
    plannedStart: "2025-12-03",
    plannedFinish: "2027-07-20",
    rag: "GREEN",
    ragReason: "Το έργο βρίσκεται εντός εγκεκριμένου προϋπολογισμού και χρονοδιαγράμματος",
    sapWbs: "WBS-PCH-032",
    tenderReference: "TND-2026-032",
  },
  {
    ref: "PRJ-033",
    orgUnitId: "paphos-general",
    titleEl: "Αναβάθμιση τηλεπικοινωνιακού εξοπλισμού",
    category: "IT",
    phase: "IN_PROGRESS",
    approvedBudget: 430000,
    fundingSource: "STATE_BUDGET",
    plannedStart: "2026-01-19",
    plannedFinish: "2026-12-07",
    rag: "RED",
    ragReason: "Η πρόβλεψη τελικού κόστους υπερβαίνει τον εγκεκριμένο προϋπολογισμό κατά €30.000",
    sapWbs: "WBS-PAF-033",
    tenderReference: "TND-2026-033",
  },
  {
    ref: "PRJ-034",
    orgUnitId: "limassol-general",
    titleEl: "Κατασκευή νέου κέντρου ψυχικής υγείας",
    category: "NEW_BUILD",
    phase: "IN_PROGRESS",
    approvedBudget: 6000000,
    fundingSource: "EU",
    plannedStart: "2025-03-22",
    plannedFinish: "2026-10-17",
    rag: "AMBER",
    ragReason: "Οι δαπάνες υστερούν σημαντικά έναντι του χρονοδιαγράμματος του έργου",
    sapWbs: "WBS-LMS-034",
    tenderReference: "TND-2026-034",
  },
  {
    ref: "PRJ-035",
    orgUnitId: "dypsy",
    titleEl: "Αναβάθμιση μονάδας ημερήσιας νοσηλείας",
    category: "SMALL_WORKS",
    phase: "IN_PROGRESS",
    approvedBudget: 7340000,
    fundingSource: "STATE_BUDGET",
    plannedStart: "2025-04-06",
    plannedFinish: "2026-09-03",
    rag: "GREEN",
    ragReason: "Το έργο βρίσκεται εντός εγκεκριμένου προϋπολογισμού και χρονοδιαγράμματος",
    sapWbs: "WBS-DYP-035",
    tenderReference: "TND-2026-035",
  },
  {
    ref: "PRJ-036",
    orgUnitId: "larnaca-general",
    titleEl: "Ανακαίνιση χειρουργείων",
    category: "RENOVATION",
    phase: "IN_PROGRESS",
    approvedBudget: 1535000,
    fundingSource: "OWN",
    plannedStart: "2025-10-19",
    plannedFinish: "2026-08-18",
    rag: "RED",
    ragReason: "Η πρόβλεψη τελικού κόστους υπερβαίνει τον εγκεκριμένο προϋπολογισμό κατά €110.000",
    sapWbs: "WBS-LAR-036",
    tenderReference: "TND-2026-036",
  },
  {
    ref: "PRJ-037",
    orgUnitId: "ambulance",
    titleEl: "Αντικατάσταση ψυκτικών μονάδων",
    category: "MAINTENANCE_CAPITAL",
    phase: "PRACTICAL_COMPLETION",
    approvedBudget: 1285000,
    fundingSource: "STATE_BUDGET",
    plannedStart: "2025-01-21",
    plannedFinish: "2025-12-19",
    rag: "RED",
    ragReason: "Οι δεσμεύσεις υπερβαίνουν τον εγκεκριμένο προϋπολογισμό κατά €171.000",
    sapWbs: "WBS-AMB-037",
    tenderReference: "TND-2026-037",
  },
  {
    ref: "PRJ-038",
    orgUnitId: "troodos",
    titleEl: "Επέκταση ΤΑΕΠ",
    category: "NEW_BUILD",
    phase: "PRACTICAL_COMPLETION",
    approvedBudget: 1350000,
    fundingSource: "STATE_BUDGET",
    plannedStart: "2025-03-25",
    plannedFinish: "2026-01-09",
    rag: "RED",
    ragReason: "Οι δεσμεύσεις υπερβαίνουν τον εγκεκριμένο προϋπολογισμό κατά €52.000",
    sapWbs: "WBS-TRD-038",
    tenderReference: "TND-2026-038",
  },
  {
    ref: "PRJ-039",
    orgUnitId: "limassol-general",
    titleEl: "Νέος μαγνητικός τομογράφος",
    category: "EQUIPMENT",
    phase: "DEFECTS_LIABILITY",
    approvedBudget: 4970000,
    fundingSource: "STATE_BUDGET",
    plannedStart: "2024-11-09",
    plannedFinish: "2025-11-18",
    rag: "GREEN",
    ragReason: "Το έργο βρίσκεται εντός εγκεκριμένου προϋπολογισμού και χρονοδιαγράμματος",
    sapWbs: "WBS-LMS-039",
    tenderReference: "TND-2026-039",
  },
  {
    ref: "PRJ-040",
    orgUnitId: "famagusta-general",
    titleEl: "Αναβάθμιση συστήματος πυρανίχνευσης",
    category: "MAINTENANCE_CAPITAL",
    phase: "DEFECTS_LIABILITY",
    approvedBudget: 4370000,
    fundingSource: "EU",
    plannedStart: "2025-03-08",
    plannedFinish: "2026-04-14",
    rag: "GREEN",
    ragReason: "Το έργο βρίσκεται εντός εγκεκριμένου προϋπολογισμού και χρονοδιαγράμματος",
    sapWbs: "WBS-FAM-040",
    tenderReference: "TND-2026-040",
  },
  {
    ref: "PRJ-041",
    orgUnitId: "nicosia-general",
    titleEl: "Αντικατάσταση ανελκυστήρων",
    category: "MAINTENANCE_CAPITAL",
    phase: "CLOSED",
    approvedBudget: 9160000,
    fundingSource: "STATE_BUDGET",
    plannedStart: "2023-11-21",
    plannedFinish: "2024-08-22",
    rag: "GREEN",
    ragReason: "Το έργο βρίσκεται εντός εγκεκριμένου προϋπολογισμού και χρονοδιαγράμματος",
    sapWbs: "WBS-NGH-041",
    tenderReference: "TND-2026-041",
  },
  {
    ref: "PRJ-042",
    orgUnitId: "larnaca-general",
    titleEl: "Ανακαίνιση Μονάδας Εντατικής Θεραπείας",
    category: "RENOVATION",
    phase: "CLOSED",
    approvedBudget: 3125000,
    fundingSource: "STATE_BUDGET",
    plannedStart: "2024-01-15",
    plannedFinish: "2024-11-25",
    rag: "GREEN",
    ragReason: "Το έργο βρίσκεται εντός εγκεκριμένου προϋπολογισμού και χρονοδιαγράμματος",
    sapWbs: "WBS-LAR-042",
    tenderReference: "TND-2026-042",
  },
  {
    // Owner decision, 19/09/2026: HQ's one project, so the S01 unit table
    // shows a real row and sparkline for it and not an empty one. Small and
    // APPROVED — not one of seedContractPhases, so it does not also need a
    // contract, a contractor and a bill of quantities the way the awarded
    // fixtures below do.
    ref: "PRJ-043",
    orgUnitId: "hq",
    titleEl: "Αναβάθμιση δικτύου δεδομένων Κεντρικών Γραφείων",
    category: "IT",
    phase: "APPROVED",
    approvedBudget: 185000,
    fundingSource: "STATE_BUDGET",
    plannedStart: "2027-01-18",
    plannedFinish: "2027-07-30",
    rag: "GREEN",
    ragReason: "Το έργο βρίσκεται εντός εγκεκριμένου προϋπολογισμού και χρονοδιαγράμματος",
    sapWbs: null,
    tenderReference: null,
  },
];

// CAPEX-01 §15 wants every screen to have something in it on first run, and
// the S01 exceptions list is a screen. These three indices into seedProjects
// get a gate milestone whose forecast has slipped past its baseline — 45 days
// is amber, 120 and 200 are red — and these two lose their planned dates the
// way an imported row with an empty or text date cell does (CAPEX-03 V06).
// Two more projects are already overdue in the fixture itself (PRJ-035 and
// PRJ-036 are IN_PROGRESS with a planned finish behind us), so all three
// kinds of exception have something to say.
export const seedSlippedProjects: { index: number; slipDays: number }[] = [
  { index: 4, slipDays: 45 },
  { index: 16, slipDays: 120 },
  { index: 30, slipDays: 200 },
];
export const seedUndatedProjects = [9, 23];

/**
 * The gate that closes each phase, in phase order: entry `b` closes the
 * phase at index `b` of the nine (R04). A project that has moved past
 * boundary `b` has the gate ticked; the gate closing the phase it is in now
 * is still open, which is exactly what stops it moving on.
 */
export const seedGateTitles: string[] = [
  "Έγκριση ιδέας",
  "Έγκριση προϋπολογισμού",
  "Δημοσίευση διαγωνισμού",
  "Κατακύρωση διαγωνισμού",
  "Υπογραφή σύμβασης",
  "Ουσιαστική ολοκλήρωση",
  "Παράδοση χώρου στη μονάδα",
  "Λήξη περιόδου ευθύνης ελαττωμάτων",
];

/** Every project opens with this one, ungated, so even an idea has two lines. */
export const seedOpeningMilestone = "Προκαταρκτική εκτίμηση αναγκών";

/** Risks are dealt out of this pack, 0–3 per project (R07). */
export const seedRiskTexts: string[] = [
  "Καθυστέρηση στην έκδοση πολεοδομικής άδειας",
  "Αύξηση τιμών υλικών πάνω από την πρόβλεψη του προϋπολογισμού",
  "Περιορισμένη διαθεσιμότητα χώρου για εργασίες με τη μονάδα σε λειτουργία",
  "Ασυμβατότητα του εξοπλισμού με τις υπάρχουσες ηλεκτρομηχανολογικές εγκαταστάσεις",
  "Έλλειψη εξειδικευμένου προσωπικού για την επίβλεψη των εργασιών",
];

/** Issues likewise, 0–2 per project (R07). */
export const seedIssueTexts: string[] = [
  "Εκκρεμεί η απάντηση της Τεχνικής Υπηρεσίας στο αίτημα διευκρίνισης",
  "Το χρονοδιάγραμμα διακοπών ρεύματος δεν έχει συμφωνηθεί με τη μονάδα",
  "Δεν έχει οριστεί υπεύθυνος παραλαβής για τον νέο εξοπλισμό",
];

// ------------------------------------------------------------------- M1 --
// The contract register fixtures (R08, R10, R13, R31).
//
// The twelve companies below are invented. They are shaped like the firms a
// Cypriot hospital actually contracts with — building, mechanical and
// electrical, biomedical, IT, a consultant — and every one of them carries a
// registration number and a VAT number in the local format, but none of them
// exists and none of the figures is anybody's real turnover. Sample data,
// obviously sample, as CAPEX-01 §15 asks for: enough in it that every screen
// has something to show on first run.
//
// One of them is blacklisted, so the rule that a blacklisted contractor takes
// no new contract has something to refuse.

export interface SeedContractor {
  name: string;
  vatNumber: string;
  registrationNo: string;
  category:
    | "BUILDING"
    | "MECHANICAL"
    | "ELECTRICAL"
    | "BIOMEDICAL"
    | "IT"
    | "CONSULTANT"
    | "OTHER";
  sapVendorId: string;
  blacklisted: boolean;
}

export const seedContractors: SeedContractor[] = [
  { name: "Κυριάκου Τεχνικές Κατασκευές Λτδ", vatNumber: "CY10231455X", registrationNo: "HE 118422", category: "BUILDING", sapVendorId: "V-100101", blacklisted: false },
  { name: "Α. Χαραλάμπους & Υιοί Οικοδομικά Έργα Λτδ", vatNumber: "CY10244870P", registrationNo: "HE 124067", category: "BUILDING", sapVendorId: "V-100102", blacklisted: false },
  { name: "Medcon Constructions (Cyprus) Ltd", vatNumber: "CY10259013D", registrationNo: "HE 131905", category: "BUILDING", sapVendorId: "V-100103", blacklisted: false },
  { name: "Ιωνάς Ηλεκτρομηχανολογικά Έργα Λτδ", vatNumber: "CY10262288M", registrationNo: "HE 135210", category: "MECHANICAL", sapVendorId: "V-100104", blacklisted: false },
  { name: "Thermotec Μηχανολογικές Εγκαταστάσεις Λτδ", vatNumber: "CY10270941K", registrationNo: "HE 140338", category: "MECHANICAL", sapVendorId: "V-100105", blacklisted: false },
  { name: "Παπαέλληνας Ηλεκτρολογικά Δίκτυα Λτδ", vatNumber: "CY10283706T", registrationNo: "HE 147712", category: "ELECTRICAL", sapVendorId: "V-100106", blacklisted: false },
  { name: "Elektra Power Systems Ltd", vatNumber: "CY10291554B", registrationNo: "HE 152489", category: "ELECTRICAL", sapVendorId: "V-100107", blacklisted: false },
  { name: "Biomed Cyprus Ιατρικός Εξοπλισμός Λτδ", vatNumber: "CY10304127N", registrationNo: "HE 159044", category: "BIOMEDICAL", sapVendorId: "V-100108", blacklisted: false },
  { name: "Medisys Ιατροτεχνολογικά Λτδ", vatNumber: "CY10318662R", registrationNo: "HE 163901", category: "BIOMEDICAL", sapVendorId: "V-100109", blacklisted: false },
  { name: "Netcom Δίκτυα και Πληροφορική Λτδ", vatNumber: "CY10327390G", registrationNo: "HE 168255", category: "IT", sapVendorId: "V-100110", blacklisted: false },
  { name: "Αρχιτεκτονικό Γραφείο Σ. Νικολάου Λτδ", vatNumber: "CY10335018L", registrationNo: "HE 171630", category: "CONSULTANT", sapVendorId: "V-100111", blacklisted: false },
  // The blacklisted one. In real life this is a decision with a file behind
  // it; here it exists so errors.contractorBlacklisted has something to fire on.
  { name: "Λευκαρίτης Γενικές Εργολαβίες Λτδ", vatNumber: "CY10348275W", registrationNo: "HE 176184", category: "OTHER", sapVendorId: "V-100112", blacklisted: true },
];

/** A project at one of these phases has been awarded, so it has a contract. */
export const seedContractPhases = [
  "AWARDED",
  "IN_PROGRESS",
  "PRACTICAL_COMPLETION",
  "DEFECTS_LIABILITY",
  "CLOSED",
] as const;

/**
 * A short bill of quantities on three of the contracts — enough for the
 * contract screen to show a real table without pretending the whole register
 * has been priced out line by line.
 */
export const seedBoqProjects = ["PRJ-031", "PRJ-034", "PRJ-041"];

export const seedBoqItems: {
  itemNo: string;
  descriptionEl: string;
  unit: string;
  qty: number;
  rate: number;
}[] = [
  { itemNo: "A.01", descriptionEl: "Καθαιρέσεις και αποκομιδή υλικών", unit: "m3", qty: 240, rate: 38.5 },
  { itemNo: "A.02", descriptionEl: "Οπλισμένο σκυρόδεμα C25/30", unit: "m3", qty: 185, rate: 145 },
  { itemNo: "B.01", descriptionEl: "Γυψοσανίδες με μεταλλικό σκελετό", unit: "m2", qty: 1240, rate: 42 },
  { itemNo: "B.02", descriptionEl: "Χρωματισμοί εσωτερικών επιφανειών", unit: "m2", qty: 2650, rate: 11.5 },
  { itemNo: "C.01", descriptionEl: "Αεραγωγοί γαλβανισμένης λαμαρίνας", unit: "kg", qty: 4100, rate: 9.8 },
  { itemNo: "C.02", descriptionEl: "Κλιματιστικές μονάδες ανάκτησης θερμότητας", unit: "τεμ", qty: 6, rate: 18500 },
];

/**
 * The variations the seed carries, by the project their contract belongs to.
 * `valuePct` is a share of the contract's original value, so the figures stay
 * sensible whatever the project's budget happens to be.
 *
 * ΤΥ/2026 on PRJ-031 is deliberately past the 10% mark (6 + 5 + 3 = 14%), so
 * the R31 warning has a real contract to fire on. Two variations sit
 * SUBMITTED waiting for somebody to decide them, one has come back RETURNED
 * with comments and one was REJECTED outright.
 */
export interface SeedVariation {
  projectRef: string;
  number: number;
  descriptionEl: string;
  reason: "CLIENT_CHANGE" | "SITE_CONDITION" | "DESIGN_ERROR" | "STATUTORY" | "OTHER";
  valuePct: number;
  timeImpactDays: number;
  status: "DRAFT" | "SUBMITTED" | "APPROVED" | "RETURNED" | "REJECTED";
  commentEl: string | null;
}

export const seedVariations: SeedVariation[] = [
  {
    projectRef: "PRJ-031",
    number: 1,
    descriptionEl: "Αντικατάσταση δικτύου αποχέτευσης που βρέθηκε διαβρωμένο κατά τις καθαιρέσεις",
    reason: "SITE_CONDITION",
    valuePct: 6,
    timeImpactDays: 21,
    status: "APPROVED",
    commentEl: null,
  },
  {
    projectRef: "PRJ-031",
    number: 2,
    descriptionEl: "Προσθήκη πυράντοχων θυρών μετά από υπόδειξη της Πυροσβεστικής Υπηρεσίας",
    reason: "STATUTORY",
    valuePct: 5,
    timeImpactDays: 14,
    status: "APPROVED",
    commentEl: null,
  },
  {
    projectRef: "PRJ-031",
    number: 3,
    descriptionEl: "Ενίσχυση ηλεκτρικής παροχής για τον νέο εξοπλισμό του θαλάμου",
    reason: "CLIENT_CHANGE",
    valuePct: 3,
    timeImpactDays: 7,
    status: "APPROVED",
    commentEl: null,
  },
  {
    projectRef: "PRJ-031",
    number: 4,
    descriptionEl: "Αναβάθμιση δαπέδων σε αντιστατικό υλικό στους χώρους επεμβάσεων",
    reason: "CLIENT_CHANGE",
    valuePct: 2,
    timeImpactDays: 10,
    status: "SUBMITTED",
    commentEl: null,
  },
  {
    projectRef: "PRJ-031",
    number: 5,
    descriptionEl: "Πρόσθετες εργασίες στεγανοποίησης δώματος",
    reason: "DESIGN_ERROR",
    valuePct: 1.5,
    timeImpactDays: 5,
    status: "RETURNED",
    commentEl: "Στείλτε αναλυτική προμέτρηση και φωτογραφίες πριν προχωρήσουμε στην έγκριση.",
  },
  {
    projectRef: "PRJ-036",
    number: 1,
    descriptionEl: "Αντικατάσταση σωληνώσεων ιατρικών αερίων σε τμήμα του ορόφου",
    reason: "SITE_CONDITION",
    valuePct: 4,
    timeImpactDays: 18,
    status: "SUBMITTED",
    commentEl: null,
  },
  {
    projectRef: "PRJ-036",
    number: 2,
    descriptionEl: "Προμήθεια εφεδρικής μονάδας αδιάλειπτης παροχής πέραν της σύμβασης",
    reason: "CLIENT_CHANGE",
    valuePct: 9,
    timeImpactDays: 30,
    status: "REJECTED",
    commentEl: "Ο εξοπλισμός καλύπτεται από χωριστή σύμβαση προμήθειας και δεν εντάσσεται εδώ.",
  },
  {
    projectRef: "PRJ-041",
    number: 1,
    descriptionEl: "Τακτοποίηση ποσοτήτων μόνωσης σύμφωνα με την τελική επιμέτρηση",
    reason: "OTHER",
    valuePct: 4,
    timeImpactDays: 0,
    status: "APPROVED",
    commentEl: null,
  },
];

/**
 * The one contract whose performance bond has been allowed to lapse while the
 * works are still running, so the R31 bond warning has something to fire on.
 * A fixed date, not "a while ago": the seed has to look the same on every
 * machine and on every run.
 */
export const seedExpiredBond = { projectRef: "PRJ-036", bondExpiry: "2026-06-30" };


// ------------------------------------------------------------------- M1 --
// The site log fixtures (R09, R12, R35). Every one of them exists so a screen
// or a rule has something real to work on: an RFI in each state with one
// breached and one red, a site instruction with cost impact that nobody has
// priced, twelve handover defects across three finished contracts covering
// all four NHS ERIC bands with two of them past their liability date, and
// three inspection defects that belong to a unit and to nothing else.
//
// Figures are obviously fake. Nothing here is patient data: a defect
// describes a room or a piece of plant, never a person.

/**
 * An RFI as the fixture says it is. The dates are relative to the moment the
 * seed runs, because the SLA band is a fact about the clock: an RFI pinned to
 * a fixed date would be GREEN in October and BREACHED by Christmas. `slaDays`
 * is the promise, `raisedHoursAgo` is how long ago the question was asked,
 * and `answeredHoursAgo` is null while it is still open.
 */
export interface SeedRfi {
  /** 1..n within the contract, the number the API would have allocated. */
  number: number;
  questionEl: string;
  answerEl: string | null;
  slaDays: number;
  raisedHoursAgo: number;
  answeredHoursAgo: number | null;
  status: "OPEN" | "ANSWERED" | "CLOSED";
}

/** Every seeded contract gets these two: one settled, one running green. */
export const seedRfisEveryContract: SeedRfi[] = [
  {
    number: 1,
    questionEl: "Ποια στάθμη τελειωμένου δαπέδου ισχύει στον διάδρομο του ισογείου;",
    answerEl: "Ισχύει η στάθμη του αρχιτεκτονικού σχεδίου, αναθεώρηση Γ.",
    slaDays: 7,
    raisedHoursAgo: 30 * 24,
    answeredHoursAgo: 26 * 24,
    status: "CLOSED",
  },
  {
    number: 2,
    questionEl: "Επιβεβαιώνετε τον τύπο των πυράντοχων θυρών στον θάλαμο Α1;",
    answerEl: null,
    slaDays: 7,
    // Four days of seven still to run: comfortably above half, so GREEN.
    raisedHoursAgo: 3 * 24,
    answeredHoursAgo: null,
    status: "OPEN",
  },
];

/**
 * The third RFI, on two nominated contracts only. One has run out of time and
 * one is nearly out of it, so `slaState` has a BREACHED and a RED to show
 * without every contract in the register shouting at once.
 */
export const seedRfiBreached = {
  projectRef: "PRJ-036",
  rfi: {
    number: 3,
    questionEl: "Πώς αντιμετωπίζεται η διαφορά υψομέτρου που βρέθηκε στη θεμελίωση;",
    answerEl: null,
    slaDays: 7,
    // Ten days on a seven-day promise: the clock ran out three days ago.
    raisedHoursAgo: 10 * 24,
    answeredHoursAgo: null,
    status: "OPEN",
  } as SeedRfi,
};

export const seedRfiRed = {
  projectRef: "PRJ-034",
  rfi: {
    number: 3,
    questionEl: "Ποιος είναι ο τελικός χρωματολόγιος κατάλογος για τους θαλάμους;",
    answerEl: null,
    slaDays: 7,
    // Eight hours left of a hundred and sixty-eight: under a tenth, so RED.
    raisedHoursAgo: 160,
    answeredHoursAgo: null,
    status: "OPEN",
  } as SeedRfi,
};

export interface SeedSiteInstruction {
  number: number;
  textEl: string;
  costImpactFlag: boolean;
}

/** Every seeded contract gets one instruction that costs nothing. */
export const seedInstructionEveryContract: SeedSiteInstruction = {
  number: 1,
  textEl: "Μεταφέρετε τον χώρο φύλαξης υλικών στον βόρειο περιβάλλοντα χώρο.",
  costImpactFlag: false,
};

/**
 * Three contracts also carry an instruction with cost impact that nobody has
 * turned into a variation yet, which is what the fourth contract warning
 * fires on (R09, R31). Three and not fourteen: the warning has to be worth
 * reading when it appears.
 */
export const seedInstructionCostImpact = {
  projectRefs: ["PRJ-031", "PRJ-034", "PRJ-039"],
  instruction: {
    number: 2,
    textEl: "Προσθέστε δεύτερη σειρά ηχομονωτικών πάνελ στον θάλαμο μηχανημάτων.",
    costImpactFlag: true,
  } as SeedSiteInstruction,
};

export interface SeedDefect {
  /** Unique across the fixture: it is what makes the re-run idempotent. */
  descriptionEl: string;
  riskBand: "HIGH" | "SIGNIFICANT" | "MODERATE" | "LOW";
  estimatedCost: number | null;
  status: "OPEN" | "IN_PROGRESS" | "CLOSED";
  funded: boolean;
}

/**
 * Twelve handover defects over three finished contracts, four each, one per
 * risk band (R12, R35). The two contracts whose liability period has already
 * ended keep one defect open apiece — those are the two the portfolio calls
 * out in red, and the rest on them are closed, which is what a finished
 * handover normally looks like.
 */
export const seedHandoverDefects: { projectRef: string; defects: SeedDefect[] }[] = [
  {
    // Liability runs to 2026-11-18: still inside it, so nothing is overdue.
    projectRef: "PRJ-039",
    defects: [
      {
        descriptionEl: "Διαρροή στη μόνωση οροφής του χώρου του τομογράφου",
        riskBand: "HIGH",
        estimatedCost: 18500,
        status: "OPEN",
        // The one defect in the fixture that a capital project is paying for.
        funded: true,
      },
      {
        descriptionEl: "Αστοχία στεγάνωσης στο δάπεδο του προθαλάμου τομογραφίας",
        riskBand: "SIGNIFICANT",
        estimatedCost: 7400,
        status: "IN_PROGRESS",
        funded: false,
      },
      {
        descriptionEl: "Ελλιπής σήμανση εξόδου κινδύνου στον διάδρομο τομογραφίας",
        riskBand: "MODERATE",
        estimatedCost: 1200,
        status: "OPEN",
        funded: false,
      },
      {
        descriptionEl: "Φθορές βαφής στον προθάλαμο αναμονής τομογραφίας",
        riskBand: "LOW",
        estimatedCost: 450,
        status: "CLOSED",
        funded: false,
      },
    ],
  },
  {
    // Liability ended on 2025-08-22, so the one still open is overdue.
    projectRef: "PRJ-041",
    defects: [
      {
        descriptionEl: "Θόρυβος και δόνηση στον μηχανισμό του ανελκυστήρα 2",
        riskBand: "HIGH",
        estimatedCost: 22000,
        status: "OPEN",
        funded: false,
      },
      {
        descriptionEl: "Απόκλιση στάθμης στάσης του ανελκυστήρα 1",
        riskBand: "SIGNIFICANT",
        estimatedCost: 5600,
        status: "CLOSED",
        funded: false,
      },
      {
        descriptionEl: "Ελαττωματικό μπουτόν κλήσης ανελκυστήρα στον δεύτερο όροφο",
        riskBand: "MODERATE",
        estimatedCost: 900,
        status: "CLOSED",
        funded: false,
      },
      {
        descriptionEl: "Χαραγές στην επένδυση του θαλάμου του ανελκυστήρα 3",
        riskBand: "LOW",
        estimatedCost: null,
        status: "CLOSED",
        funded: false,
      },
    ],
  },
  {
    // Liability ended on 2025-11-25, so the one still in hand is overdue.
    projectRef: "PRJ-042",
    defects: [
      {
        descriptionEl: "Ανεπαρκής παροχή ιατρικών αερίων στην κλίνη 4 της ΜΕΘ",
        riskBand: "HIGH",
        estimatedCost: 31000,
        status: "IN_PROGRESS",
        funded: false,
      },
      {
        descriptionEl: "Αστάθεια θερμοκρασίας στο κλιματιστικό συγκρότημα της ΜΕΘ",
        riskBand: "SIGNIFICANT",
        estimatedCost: 12800,
        status: "CLOSED",
        funded: false,
      },
      {
        descriptionEl: "Ελλιπής στεγανοποίηση διελεύσεων καλωδίων στη ΜΕΘ",
        riskBand: "MODERATE",
        estimatedCost: 2100,
        status: "CLOSED",
        funded: false,
      },
      {
        descriptionEl: "Φθαρμένα αρμοκάλυπτρα δαπέδου στον διάδρομο της ΜΕΘ",
        riskBand: "LOW",
        estimatedCost: 700,
        status: "CLOSED",
        funded: false,
      },
    ],
  },
];

/**
 * Three defects found on inspection rounds that belong to a unit and to
 * nothing else — no contract, no project, no due date. This is the shape the
 * technician's offline capture produces (CAPEX-01 §2, §8) and the reason the
 * defect table carries its own org unit.
 */
export const seedInspectionDefects: { orgUnitId: string; defect: SeedDefect }[] = [
  {
    orgUnitId: "nicosia-general",
    defect: {
      descriptionEl: "Σκουριά στη βάση του εφεδρικού ηλεκτροπαραγωγού ζεύγους",
      riskBand: "SIGNIFICANT",
      estimatedCost: 4300,
      status: "OPEN",
      funded: false,
    },
  },
  {
    orgUnitId: "troodos",
    defect: {
      descriptionEl: "Ρωγμές στο δάπεδο του μηχανοστασίου ψύξης",
      riskBand: "MODERATE",
      estimatedCost: 2600,
      status: "OPEN",
      funded: false,
    },
  },
  {
    orgUnitId: "pfy",
    defect: {
      descriptionEl: "Διάβρωση σωληνώσεων ζεστού νερού στο κέντρο υγείας",
      riskBand: "HIGH",
      estimatedCost: 9800,
      status: "IN_PROGRESS",
      funded: false,
    },
  },
];

/** Which project the one funded handover defect is funded from. */
export const seedFundedDefect = {
  descriptionEl: "Διαρροή στη μόνωση οροφής του χώρου του τομογράφου",
  targetProjectRef: "PRJ-035",
};
