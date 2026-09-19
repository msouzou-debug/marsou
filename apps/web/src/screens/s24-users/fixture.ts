// S24 «Χρήστες» — fixture rows for the preview and the unit tests (ADR-0020).
// Obviously fake staff, no real ΟΚΥπΥ account names.
import type { AdminUser, OrgUnit, RoleCatalogueEntry } from "@ecapital/shared";

export const roleCatalogue: RoleCatalogueEntry[] = [
  { role: "admin", scope: "all" },
  { role: "estates_head", scope: "unit" },
  { role: "project_engineer", scope: "unit" },
  { role: "technician", scope: "unit" },
  { role: "finance", scope: "all" },
  { role: "clinical_approver", scope: "unit" },
  { role: "executive_readonly", scope: "all" },
  { role: "auditor_readonly", scope: "all" },
];

export const orgUnits: OrgUnit[] = [
  {
    id: "nicosia-general",
    code: "NGH",
    nameEl: "Γενικό Νοσοκομείο Λευκωσίας",
    nameEn: "Nicosia General Hospital",
    type: "HOSPITAL",
    directorate: "LEFKOSIAS",
    costCentre: "CC-NGH",
    entityCode: "1100",
    timezone: "Europe/Nicosia",
  },
  {
    id: "larnaca-general",
    code: "LAR",
    nameEl: "Γενικό Νοσοκομείο Λάρνακας",
    nameEn: "Larnaca General Hospital",
    type: "HOSPITAL",
    directorate: "LARNAKAS_AMMOCHOSTOU",
    costCentre: "CC-LAR",
    entityCode: "1300",
    timezone: "Europe/Nicosia",
  },
];

export const users: AdminUser[] = [
  {
    id: "user-1",
    subject: "dev-admin",
    username: "m.konstantinou",
    name: "Μαρία Κωνσταντίνου",
    email: "admin@ecapital.test",
    authSource: "ldap",
    active: true,
    roles: ["admin"],
    orgUnitIds: ["nicosia-general", "larnaca-general"],
    lastSignInAt: "2026-09-18T07:12:00.000Z",
    createdAt: "2026-09-01T08:00:00.000Z",
  },
  {
    id: "user-2",
    subject: "ad:e.christodoulou",
    username: "e.christodoulou",
    name: "Ελένη Χριστοδούλου",
    email: "e.christodoulou@ihcis.local",
    authSource: "ldap",
    active: true,
    roles: ["project_engineer"],
    orgUnitIds: ["larnaca-general"],
    lastSignInAt: null,
    createdAt: "2026-09-19T06:00:00.000Z",
  },
  {
    id: "user-3",
    subject: "dev-auditor",
    username: "c.loizou",
    name: "Χριστίνα Λοΐζου",
    email: "auditor@ecapital.test",
    authSource: "ldap",
    active: false,
    roles: ["auditor_readonly"],
    orgUnitIds: [],
    lastSignInAt: "2026-08-30T11:40:00.000Z",
    createdAt: "2026-09-01T08:00:00.000Z",
  },
];
