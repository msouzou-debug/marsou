import { ProjectDetail, type ProjectSummary } from "@ecapital/shared";
import { orgUnits } from "./org-units";

// S03's ProjectDetail (contract §"M1 (R04–R07)"): milestones, risks, issues
// and audit trail on top of the S02 summary. The API for these does not
// exist yet (ADR-0005), so this generates deterministic fixtures from the
// project's own id — the same id always produces the same detail, with no
// `Math.random` anywhere, so a screenshot or a test built against PRJ-007
// today still matches PRJ-007 next week.
//
// The generator is intentionally a little noisy (2–4 milestones, 0–3 risks,
// 0–2 issues, 3–6 audit entries) so the 42 fixtures collectively exercise
// every state S03 has to render: a gate milestone, an overdue forecast with
// no actual date, an empty risk or issue list, and a longer one.

// ---------------------------------------------------------------- rng

/** FNV-1a: a small, fast, deterministic string hash. Not cryptographic —
 *  it only has to be stable, not secure. */
function hashSeed(input: string): number {
  let h = 2166136261;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** mulberry32: a tiny seeded PRNG. Deterministic for a given seed, which is
 *  the whole point — no `Math.random` in fixture generation. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function next() {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A fresh generator for one (project, purpose) pair, so shuffling the risk
 *  count for PRJ-007 never perturbs its milestone count. */
function rngFor(projectId: string, purpose: string): () => number {
  return mulberry32(hashSeed(`${projectId}:${purpose}`));
}

function intBetween(rng: () => number, min: number, max: number): number {
  return min + Math.floor(rng() * (max - min + 1));
}

function pick<T>(id: string, purpose: string, index: number, items: readonly T[]): T {
  return items[hashSeed(`${id}:${purpose}:${index}`) % items.length];
}

// A fixed "today" for the fixtures, close to the authoring date, so a
// project's milestones and issues land plausibly in the past or the future
// depending on its own planned dates rather than on whenever the tests run.
const TODAY = "2026-09-18";

function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function daysBetween(fromIso: string, toIso: string): number {
  return Math.round(
    (new Date(`${toIso}T00:00:00.000Z`).getTime() - new Date(`${fromIso}T00:00:00.000Z`).getTime()) / 86_400_000,
  );
}

// ---------------------------------------------------------------- milestones

const MILESTONE_TITLES = [
  "Έγκριση μελέτης",
  "Υπογραφή σύμβασης",
  "Έναρξη εργασιών",
  "Ολοκλήρωση Η/Μ εγκαταστάσεων",
  "Παράδοση κτιριακού κελύφους",
  "Προσωρινή παραλαβή έργου",
];

function buildMilestones(project: ProjectSummary): ProjectDetail["milestones"] {
  const rng = rngFor(project.id, "milestones");
  const count = intBetween(rng, 2, 4); // RULE: 2–4 milestones per project.
  const gateIndex = intBetween(rng, 0, count - 1); // RULE: exactly one gate.

  const start = project.plannedStart ?? TODAY;
  const finish = project.plannedFinish ?? addDays(start, 365);
  const totalDays = Math.max(30, daysBetween(start, finish));

  return Array.from({ length: count }, (_, index) => {
    const fraction = (index + 1) / (count + 1);
    const baselineDate = addDays(start, Math.round(totalDays * fraction));
    // Forecast drifts off the baseline — a small slip on some, none on others.
    const driftDays = intBetween(rngFor(project.id, `milestone-drift-${index}`), -5, 30);
    const forecastDate = addDays(baselineDate, driftDays);
    // Earlier milestones (lower fraction) are more likely already delivered.
    const isDone = rngFor(project.id, `milestone-done-${index}`)() > fraction;
    return {
      id: `${project.id}-MS-${index + 1}`,
      projectId: project.id,
      titleEl: MILESTONE_TITLES[index % MILESTONE_TITLES.length],
      baselineDate,
      forecastDate,
      // RULE (contract §Milestone): a gate closes a phase and only an actual
      // date lets the phase move on — done milestones report one, pending
      // ones do not, whether or not they are the gate.
      actualDate: isDone ? forecastDate : null,
      isGate: index === gateIndex,
      sortOrder: index,
    };
  });
}

// ---------------------------------------------------------------- risks

const RISK_DESCRIPTIONS = [
  "Καθυστέρηση παράδοσης υλικών από τον προμηθευτή",
  "Απρόβλεπτες συνθήκες εδάφους κατά την εκσκαφή",
  "Έλλειψη εξειδικευμένου προσωπικού για τις Η/Μ εργασίες",
  "Μεταβολή τιμών πρώτων υλών κατά τη διάρκεια της σύμβασης",
  "Καθυστέρηση στην έκδοση πολεοδομικής άδειας",
];
const RISK_OWNERS = ["Α. Δημητρίου", "Μ. Χριστοδούλου", "Ε. Σάββα", "Κ. Ιωάννου"];
const RISK_STATUSES = ["OPEN", "OPEN", "MITIGATED", "CLOSED"] as const; // weighted toward OPEN

function buildRisks(project: ProjectSummary): ProjectDetail["risks"] {
  const rng = rngFor(project.id, "risks");
  const count = intBetween(rng, 0, 3); // RULE: 0–3 risks per project.
  return Array.from({ length: count }, (_, index) => {
    const status = pick(project.id, "risk-status", index, RISK_STATUSES);
    return {
      id: `${project.id}-RSK-${index + 1}`,
      projectId: project.id,
      descriptionEl: pick(project.id, "risk-description", index, RISK_DESCRIPTIONS),
      likelihood: intBetween(rngFor(project.id, `risk-likelihood-${index}`), 1, 5),
      impact: intBetween(rngFor(project.id, `risk-impact-${index}`), 1, 5),
      ownerId: null,
      ownerName: pick(project.id, "risk-owner", index, RISK_OWNERS),
      mitigationEl: status === "OPEN" ? null : "Εφαρμόστηκε σχέδιο μετριασμού και παρακολουθείται.",
      status,
    };
  });
}

// ---------------------------------------------------------------- issues

const ISSUE_DESCRIPTIONS = [
  "Εκκρεμεί έγκριση τροποποίησης σύμβασης από τον Οργανισμό",
  "Ασυμφωνία σχεδίων Η/Μ με το εγκεκριμένο αρχιτεκτονικό σχέδιο",
  "Καθυστέρηση στην έκδοση πολεοδομικής άδειας",
];
const ISSUE_RAISERS = ["Χ. Νικολάου", "Π. Γεωργίου", "Σ. Λοΐζου"];

function buildIssues(project: ProjectSummary): ProjectDetail["issues"] {
  const rng = rngFor(project.id, "issues");
  const count = intBetween(rng, 0, 2); // RULE: 0–2 issues per project.
  return Array.from({ length: count }, (_, index) => {
    const isOpen = rngFor(project.id, `issue-status-${index}`)() < 0.65;
    const dueOffset = intBetween(rngFor(project.id, `issue-due-${index}`), -20, 45);
    return {
      id: `${project.id}-ISS-${index + 1}`,
      projectId: project.id,
      descriptionEl: pick(project.id, "issue-description", index, ISSUE_DESCRIPTIONS),
      raisedById: `user-${index + 1}`,
      raisedByName: pick(project.id, "issue-raiser", index, ISSUE_RAISERS),
      dueDate: addDays(TODAY, dueOffset),
      status: isOpen ? "OPEN" : "RESOLVED",
    };
  });
}

// ---------------------------------------------------------------- audit

// i18n key suffixes resolved through `screens.s03.audit.*` (contract
// §AuditEntry: "action: i18n key suffix"). Index 0 is reserved for "created"
// so every project's trail opens with the one entry that is always true.
const AUDIT_ACTIONS = ["created", "phaseChanged", "milestoneUpdated", "riskAdded", "issueAdded", "updated"]; // the API's action keys (apps/api/src/projects)
const AUDIT_ACTORS = ["Μ. Ιωάννου", "Α. Παπαδοπούλου", "Ν. Χριστοφή", "Δ. Κωνσταντίνου"];

function buildAudit(project: ProjectSummary): ProjectDetail["audit"] {
  const rng = rngFor(project.id, "audit");
  const count = intBetween(rng, 3, 6); // RULE: 3–6 audit entries per project.
  const entries: ProjectDetail["audit"] = [];
  let daysAgo = 0;
  for (let index = count - 1; index >= 0; index--) {
    // Oldest first while building, so each step's gap only ever adds up —
    // Timeline re-sorts newest-first for display regardless.
    daysAgo += intBetween(rngFor(project.id, `audit-gap-${index}`), 10, 45);
    const action = index === 0 ? "created" : AUDIT_ACTIONS[1 + (hashSeed(`${project.id}:audit-action:${index}`) % (AUDIT_ACTIONS.length - 1))];
    entries.push({
      id: `${project.id}-AUD-${index + 1}`,
      actorName: pick(project.id, "audit-actor", index, AUDIT_ACTORS),
      action,
      at: `${addDays(TODAY, -daysAgo)}T09:00:00.000Z`,
      detail: null,
    });
  }
  return entries.reverse(); // oldest -> newest, matching how it was authored
}

// ---------------------------------------------------------------- sponsor / PM

const SPONSOR_NAMES = [
  "Υπουργείο Υγείας",
  "Ίδρυμα Α. Λεβέντη",
  "Ευρωπαϊκή Τράπεζα Επενδύσεων",
  "ΟΚΥπΥ – Κεντρική Διοίκηση",
];
const PROJECT_MANAGER_NAMES = [
  "Ανδρέας Παπαδόπουλος",
  "Μαρία Ιωάννου",
  "Κώστας Χριστοδούλου",
  "Ελένη Σάββα",
  "Νίκος Γεωργίου",
];

// ---------------------------------------------------------------- assembly

/** Builds the full S03 `ProjectDetail` for one S02 `ProjectSummary` fixture. */
export function buildProjectDetail(project: ProjectSummary): ProjectDetail {
  const unit = orgUnits.find((u) => u.id === project.orgUnitId);
  return ProjectDetail.parse({
    ...project,
    orgUnit: unit
      ? { id: unit.id, nameEl: unit.nameEl, nameEn: unit.nameEn }
      : { id: project.orgUnitId, nameEl: project.orgUnitId, nameEn: project.orgUnitId },
    sponsorName: pick(project.id, "sponsor", 0, SPONSOR_NAMES),
    projectManagerName: pick(project.id, "project-manager", 0, PROJECT_MANAGER_NAMES),
    milestones: buildMilestones(project),
    risks: buildRisks(project),
    issues: buildIssues(project),
    audit: buildAudit(project),
  });
}
