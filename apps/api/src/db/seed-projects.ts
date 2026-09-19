/**
 * The M1 half of the seed: 43 projects with their milestones, risks and
 * issues (R04–R07), so the portfolio, the project list and the project
 * overview all have something in them on first run (CAPEX-01 §15). The 43rd
 * is HQ's (owner decision, 19/09/2026).
 *
 * Run as the migration role, which owns the tables and is therefore not
 * filtered by row-level security — a seed that could only see its own units
 * would be useless. Re-running updates in place and never duplicates: a
 * project is found again by org unit plus title (CAPEX-03 §2 col E calls that
 * the natural key), a milestone by project plus title, a risk and an issue by
 * project plus text.
 *
 * Codes are not in the fixture. They are allocated by
 * ecapital.allocate_project_code, the same function POST /projects uses
 * (ADR-0014), so the seeded register and a register somebody typed are
 * numbered the same way.
 */
import { and, eq, sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import * as schema from "./schema";
import {
  seedGateTitles,
  seedIssueTexts,
  seedOpeningMilestone,
  seedProjects,
  seedRiskTexts,
  seedSlippedProjects,
  seedUndatedProjects,
  seedUsers,
  type SeedProject,
} from "./seed-data";

type Db = NodePgDatabase<typeof schema>;

const PHASES = [
  "IDEA",
  "PREPARATION",
  "APPROVED",
  "TENDERED",
  "AWARDED",
  "IN_PROGRESS",
  "PRACTICAL_COMPLETION",
  "DEFECTS_LIABILITY",
  "CLOSED",
] as const;

/** The year the seeded codes carry. The register starts in 2026 (CAPEX-03). */
const CODE_YEAR = 2026;

export interface ProjectSeedSummary {
  projects: number;
  milestones: number;
  risks: number;
  issues: number;
}

function addDays(isoDate: string, days: number): string {
  const date = new Date(`${isoDate}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

interface PlannedMilestone {
  titleEl: string;
  baselineDate: string;
  forecastDate: string | null;
  actualDate: string | null;
  isGate: boolean;
  sortOrder: number;
}

/**
 * Two to four milestones, one gate for each phase boundary the project has
 * already crossed and one for the boundary it is standing on. The gate it is
 * standing on has no actual date, which is what R04 reads as "the gate is
 * open" and what stops the phase moving on until somebody ticks it.
 */
export function milestonesFor(project: SeedProject, index: number): PlannedMilestone[] {
  const phase = PHASES.indexOf(project.phase);
  const base = project.plannedStart ?? project.plannedFinish ?? "2026-01-01";
  const slip = seedSlippedProjects.find((s) => s.index === index)?.slipDays ?? 0;

  const last = Math.min(phase, seedGateTitles.length - 1);
  const first = Math.max(0, last - 2);

  const milestones: PlannedMilestone[] = [
    {
      titleEl: seedOpeningMilestone,
      baselineDate: addDays(base, -30),
      forecastDate: addDays(base, -30),
      actualDate: addDays(base, -28),
      isGate: false,
      sortOrder: 0,
    },
  ];

  for (let boundary = first; boundary <= last; boundary += 1) {
    const baseline = addDays(base, 60 * (boundary - first + 1));
    const passed = boundary < phase;
    milestones.push({
      titleEl: seedGateTitles[boundary],
      baselineDate: baseline,
      // The open gate of a slipped project is the one carrying the slip; a
      // gate already ticked was met on its baseline date.
      forecastDate: passed ? baseline : addDays(baseline, slip),
      actualDate: passed ? baseline : null,
      isGate: true,
      sortOrder: boundary - first + 1,
    });
  }
  return milestones;
}

export async function seedProjectRegister(db: Db): Promise<ProjectSeedSummary> {
  // Which seeded user runs projects where. The estates head of a unit
  // sponsors its projects and the unit's engineer manages them; a unit with
  // neither leaves both empty, which is honest — those units have no named
  // owner in the system yet.
  const userIds = new Map<string, string>();
  const rows = await db
    .select({ id: schema.appUser.id, subject: schema.appUser.subject })
    .from(schema.appUser);
  for (const row of rows) userIds.set(row.subject, row.id);

  const sponsorOf = new Map<string, string>();
  const managerOf = new Map<string, string>();
  for (const user of seedUsers) {
    const id = userIds.get(user.subject);
    if (!id) continue;
    for (const unit of user.orgUnitIds) {
      if (user.roles.includes("estates_head")) sponsorOf.set(unit, id);
      if (user.roles.includes("project_engineer")) managerOf.set(unit, id);
    }
  }
  const fallbackRaiser = userIds.get("dev-admin");

  const summary: ProjectSeedSummary = { projects: 0, milestones: 0, risks: 0, issues: 0 };

  for (const [index, fixture] of seedProjects.entries()) {
    const undated = seedUndatedProjects.includes(index);
    const project: SeedProject = undated
      ? { ...fixture, plannedStart: null, plannedFinish: null }
      : fixture;

    const existing = await db
      .select({ id: schema.project.id })
      .from(schema.project)
      .where(
        and(
          eq(schema.project.orgUnitId, project.orgUnitId),
          eq(schema.project.titleEl, project.titleEl),
        ),
      )
      .limit(1);

    const values = {
      titleEl: project.titleEl,
      category: project.category,
      phase: project.phase,
      approvedBudget: String(project.approvedBudget),
      fundingSource: project.fundingSource,
      plannedStart: project.plannedStart,
      plannedFinish: project.plannedFinish,
      rag: project.rag,
      ragReason: project.ragReason,
      sapWbs: project.sapWbs,
      tenderReference: project.tenderReference,
      sourceRowRef: project.ref,
      sponsorId: sponsorOf.get(project.orgUnitId) ?? null,
      projectManagerId: managerOf.get(project.orgUnitId) ?? null,
      updatedAt: sql`now()`,
    };

    let projectId: string;
    if (existing.length) {
      projectId = existing[0].id;
      await db.update(schema.project).set(values).where(eq(schema.project.id, projectId));
    } else {
      const [{ code }] = await db
        .select({
          code: sql<string>`ecapital.allocate_project_code(${project.orgUnitId}, ${CODE_YEAR})`,
        })
        .from(sql`(select 1) as one`);
      const [inserted] = await db
        .insert(schema.project)
        .values({ ...values, code, orgUnitId: project.orgUnitId })
        .returning({ id: schema.project.id });
      projectId = inserted.id;
    }
    summary.projects += 1;

    for (const milestone of milestonesFor(project, index)) {
      const found = await db
        .select({ id: schema.milestone.id })
        .from(schema.milestone)
        .where(
          and(
            eq(schema.milestone.projectId, projectId),
            eq(schema.milestone.titleEl, milestone.titleEl),
          ),
        )
        .limit(1);
      if (found.length) {
        await db
          .update(schema.milestone)
          .set({
            forecastDate: milestone.forecastDate,
            actualDate: milestone.actualDate,
            isGate: milestone.isGate,
            sortOrder: milestone.sortOrder,
            updatedAt: sql`now()`,
          })
          .where(eq(schema.milestone.id, found[0].id));
      } else {
        await db.insert(schema.milestone).values({
          projectId,
          orgUnitId: project.orgUnitId,
          ...milestone,
        });
      }
      summary.milestones += 1;
    }

    // 0–3 risks and 0–2 issues, dealt out by position so the fixture is the
    // same on every machine and every run.
    for (let n = 0; n < index % 4; n += 1) {
      const descriptionEl = seedRiskTexts[(index + n) % seedRiskTexts.length];
      const found = await db
        .select({ id: schema.risk.id })
        .from(schema.risk)
        .where(
          and(eq(schema.risk.projectId, projectId), eq(schema.risk.descriptionEl, descriptionEl)),
        )
        .limit(1);
      if (!found.length) {
        await db.insert(schema.risk).values({
          projectId,
          orgUnitId: project.orgUnitId,
          descriptionEl,
          likelihood: ((index + n) % 5) + 1,
          impact: ((index + n * 2) % 5) + 1,
          ownerId: managerOf.get(project.orgUnitId) ?? sponsorOf.get(project.orgUnitId) ?? null,
          mitigationEl: null,
          status: "OPEN",
        });
      }
      summary.risks += 1;
    }

    const raisedBy =
      managerOf.get(project.orgUnitId) ?? sponsorOf.get(project.orgUnitId) ?? fallbackRaiser;
    if (raisedBy) {
      for (let n = 0; n < index % 3; n += 1) {
        const descriptionEl = seedIssueTexts[(index + n) % seedIssueTexts.length];
        const found = await db
          .select({ id: schema.issue.id })
          .from(schema.issue)
          .where(
            and(eq(schema.issue.projectId, projectId), eq(schema.issue.descriptionEl, descriptionEl)),
          )
          .limit(1);
        if (!found.length) {
          await db.insert(schema.issue).values({
            projectId,
            orgUnitId: project.orgUnitId,
            descriptionEl,
            raisedBy,
            dueDate: project.plannedFinish,
            status: "OPEN",
          });
        }
        summary.issues += 1;
      }
    }
  }

  return summary;
}
