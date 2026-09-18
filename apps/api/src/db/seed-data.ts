import type { AppRole, Directorate, OrgUnit, OrgUnitType } from "@ecapital/shared";

// CAPEX-03 §3 — the eleven org units and the spellings column D of the capex
// plan uses for them. Values copied from apps/web/src/mocks/org-units.ts so
// the seeded API answers GET /org-units with exactly what the frontend mock
// answered (ADR-0005): the frontend swaps by base URL and sees no difference.
//
// Errata (docs/briefs/README.md): Troodos and Kyperounta are one hospital, so
// ΝΟΣΟΚΟΜΕΙΟ ΚΥΠΕΡΟΥΝΤΑΣ is an alias of Troodos, not a twelfth unit.

export interface SeedOrgUnit extends OrgUnit {
  aliases: string[];
}

const unit = (
  id: string,
  code: string,
  nameEl: string,
  nameEn: string,
  type: OrgUnitType,
  directorate: Directorate,
  costCentre: string,
  aliases: string[],
): SeedOrgUnit => ({
  id,
  code,
  nameEl,
  nameEn,
  type,
  directorate,
  costCentre,
  timezone: "Europe/Nicosia",
  aliases,
});

export const seedOrgUnits: SeedOrgUnit[] = [
  unit("nicosia-general", "NGH", "Γενικό Νοσοκομείο Λευκωσίας", "Nicosia General Hospital",
    "HOSPITAL", "LEFKOSIAS", "CC-NGH-01", ["Γ.Ν. ΛΕΥΚΩΣΙΑΣ"]),
  unit("larnaca-general", "LAR", "Γενικό Νοσοκομείο Λάρνακας", "Larnaca General Hospital",
    "HOSPITAL", "LARNAKAS_AMMOCHOSTOU", "CC-LAR-01", ["Γ.Ν. ΛΑΡΝΑΚΑΣ"]),
  unit("paphos-general", "PAF", "Γενικό Νοσοκομείο Πάφου", "Paphos General Hospital",
    "HOSPITAL", "LEMESOU_PAFOU", "CC-PAF-01", ["Γ.Ν. ΠΑΦΟΥ"]),
  unit("limassol-general", "LMS", "Γενικό Νοσοκομείο Λεμεσού", "Limassol General Hospital",
    "HOSPITAL", "LEMESOU_PAFOU", "CC-LMS-01", ["Γ.Ν. ΛΕΜΕΣΟΥ"]),
  unit("troodos", "TRD", "Νοσοκομείο Τροόδους", "Troodos Hospital",
    "HOSPITAL", "LEMESOU_PAFOU", "CC-TRD-01",
    ["ΝΟΣΟΚΟΜΕΙΟ ΤΡΟΟΔΟΥΣ", "ΝΟΣΟΚΟΜΕΙΟ ΚΥΠΕΡΟΥΝΤΑΣ", "Ν. ΚΥΠΕΡΟΥΝΤΑΣ"]),
  unit("namiii", "NAM3", "Νοσοκομείο Αρχιεπίσκοπος Μακάριος Γ΄", "Archbishop Makarios III Hospital",
    "HOSPITAL", "LEFKOSIAS", "CC-NAM3-01", ["ΝΑΜΙΙΙ"]),
  unit("polis-chrysochous", "PCH", "Νοσοκομείο Πόλεως Χρυσοχούς", "Polis Chrysochous Hospital",
    "HOSPITAL", "LEMESOU_PAFOU", "CC-PCH-01", ["ΝΟΣΟΚΟΜΕΙΟ ΠΟΛΕΩΣ ΧΡΥΣΟΧΟΥΣ"]),
  unit("famagusta-general", "FAM", "Γενικό Νοσοκομείο Αμμοχώστου", "Famagusta General Hospital",
    "HOSPITAL", "LARNAKAS_AMMOCHOSTOU", "CC-FAM-01", ["Γ.Ν. ΑΜΜΟΧΩΣΤΟΥ"]),
  unit("dypsy", "DYP", "Διεύθυνση Υπηρεσιών Ψυχικής Υγείας", "Mental Health Services",
    "SERVICE", "DYPSY", "CC-DYP-01", ["ΔΥΨΥ"]),
  unit("pfy", "PFY", "Πρωτοβάθμια Φροντίδα Υγείας", "Primary Healthcare",
    "SERVICE", "PFY", "CC-PFY-01", ["ΠΡΩΤΟΒΑΘΜΙΑ ΦΡΟΝΤΙΔΑ ΥΓΕΙΑΣ"]),
  unit("ambulance", "AMB", "Υπηρεσία Ασθενοφόρων", "Ambulance Service",
    "SERVICE", "AMBULANCE", "CC-AMB-01", ["ΥΠΗΡΕΣΙΑ ΑΣΘΕΝΟΦΟΡΩΝ"]),
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

// Five users so every M0 access path has somebody to walk it. They exist only
// where DEV_AUTH is on; on the real server the users come from Entra ID.
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
    subject: "dev-auditor",
    name: "Χριστίνα Λοΐζου",
    email: "auditor@ecapital.test",
    roles: ["auditor_readonly"],
    // The auditor sees every unit through the role, not through a list.
    orgUnitIds: [],
  },
];

// Groups→roles is a config table, not code (ADR-0009). These are placeholder
// object ids; the ΟΚΥπΥ tenant's real group ids replace them at deployment.
export const seedRoleMappings: {
  entraGroupId: string;
  role: AppRole;
  orgUnitId: string | null;
  note: string;
}[] = [
  {
    entraGroupId: "00000000-0000-0000-0000-0000000000a1",
    role: "admin",
    orgUnitId: null,
    note: "eCapital Administrators",
  },
  {
    entraGroupId: "00000000-0000-0000-0000-0000000000a2",
    role: "executive_readonly",
    orgUnitId: null,
    note: "eCapital Executive",
  },
  {
    entraGroupId: "00000000-0000-0000-0000-0000000000a3",
    role: "auditor_readonly",
    orgUnitId: null,
    note: "eCapital Auditors",
  },
  {
    entraGroupId: "00000000-0000-0000-0000-0000000000b1",
    role: "estates_head",
    orgUnitId: "nicosia-general",
    note: "eCapital Estates — Nicosia General",
  },
  {
    entraGroupId: "00000000-0000-0000-0000-0000000000b2",
    role: "project_engineer",
    orgUnitId: "larnaca-general",
    note: "eCapital Engineers — Larnaca General",
  },
  {
    entraGroupId: "00000000-0000-0000-0000-0000000000b3",
    role: "clinical_approver",
    orgUnitId: "nicosia-general",
    note: "eCapital Clinical Approvers — Nicosia General",
  },
];
