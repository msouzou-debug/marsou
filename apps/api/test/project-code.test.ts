import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PHASE_ORDER, isNextPhase, toAuditEntry } from "../src/projects/project-rows";
import { milestonesFor } from "../src/db/seed-projects";
import { seedProjects } from "../src/db/seed-data";

/**
 * ADR-0014 — the code allocator, tested where it lives. The interesting case
 * is not one caller; it is two, at the same instant, asking the same unit for
 * a number in the same year. Two transactions held open at once is the only
 * honest way to write that test, which is why it talks to the database
 * directly rather than through the API.
 */
describe("ecapital.allocate_project_code", () => {
  let a: Client;
  let b: Client;

  beforeAll(async () => {
    const url = process.env.MIGRATION_DATABASE_URL as string;
    a = new Client({ connectionString: url });
    b = new Client({ connectionString: url });
    await a.connect();
    await b.connect();
  });
  afterAll(async () => {
    await a.end();
    await b.end();
  });

  async function allocate(client: Client, unit: string, year: number): Promise<string> {
    const { rows } = await client.query<{ code: string }>(
      "select ecapital.allocate_project_code($1, $2) as code",
      [unit, year],
    );
    return rows[0].code;
  }

  it("numbers per unit and per year", async () => {
    const first = await allocate(a, "famagusta-general", 2031);
    const second = await allocate(a, "famagusta-general", 2031);
    const otherYear = await allocate(a, "famagusta-general", 2032);
    const otherUnit = await allocate(a, "paphos-general", 2031);

    expect(first).toBe("FAM-2031-001");
    expect(second).toBe("FAM-2031-002");
    expect(otherYear).toBe("FAM-2032-001");
    expect(otherUnit).toBe("PAF-2031-001");
  });

  it("gives two transactions racing for the same unit two different codes", async () => {
    // Both transactions ask before either commits. The advisory lock makes
    // the second one wait; without it they would both read the same counter
    // and both be told they were number one.
    await a.query("begin");
    await b.query("begin");

    const first = await allocate(a, "troodos", 2033);
    const pending = allocate(b, "troodos", 2033);
    await a.query("commit");
    const second = await pending;
    await b.query("commit");

    expect(first).toBe("TRD-2033-001");
    expect(second).toBe("TRD-2033-002");
  });

  it("refuses a unit that does not exist rather than inventing a prefix", async () => {
    await expect(allocate(a, "no-such-unit", 2033)).rejects.toThrow(/no such org unit/);
  });
});

/** R04, as arithmetic on the enum: worth a test that needs no database. */
describe("the phase order", () => {
  it("has the nine phases with PREPARATION second", () => {
    expect(PHASE_ORDER).toEqual([
      "IDEA",
      "PREPARATION",
      "APPROVED",
      "TENDERED",
      "AWARDED",
      "IN_PROGRESS",
      "PRACTICAL_COMPLETION",
      "DEFECTS_LIABILITY",
      "CLOSED",
    ]);
  });

  it("calls one step forward next, and nothing else", () => {
    expect(isNextPhase("IDEA", "PREPARATION")).toBe(true);
    expect(isNextPhase("IDEA", "APPROVED")).toBe(false);
    expect(isNextPhase("PREPARATION", "IDEA")).toBe(false);
    expect(isNextPhase("CLOSED", "CLOSED")).toBe(false);
  });
});

describe("the audit line", () => {
  const at = new Date("2026-09-18T10:00:00Z");

  it("reads a phase change as the move and the reason that was given", () => {
    const entry = toAuditEntry({
      id: 7,
      actorId: "dev-admin",
      actorName: "Μαρία Κωνσταντίνου",
      entityType: "project",
      action: "UPDATE",
      before: { phase: "IDEA" },
      after: { phase: "PREPARATION", phase_reason_el: "Εγκρίθηκε η μελέτη" },
      at,
    });
    expect(entry.action).toBe("phaseChanged");
    expect(entry.detail).toBe("IDEA → PREPARATION: Εγκρίθηκε η μελέτη");
    expect(entry.actorName).toBe("Μαρία Κωνσταντίνου");
  });

  it("reads an ordinary change as the fields that changed, in the contract's spelling", () => {
    const entry = toAuditEntry({
      id: 8,
      actorId: "dev-estates-nicosia",
      actorName: null,
      entityType: "project",
      action: "UPDATE",
      before: { approved_budget: "1.00", title_el: "Α", updated_at: "x" },
      after: { approved_budget: "2.00", title_el: "Β", updated_at: "y" },
      at,
    });
    expect(entry.action).toBe("updated");
    expect(entry.detail).toBe("approvedBudget, titleEl");
    // No name in the directory: the subject itself, never a blank line.
    expect(entry.actorName).toBe("dev-estates-nicosia");
  });
});

/**
 * CAPEX-01 §15: the seed has to put something on every screen. These are the
 * two facts the portfolio's exceptions list depends on.
 */
describe("the seeded milestones", () => {
  it("leaves the gate of the phase a project is in open, and ticks the ones behind it", () => {
    const inProgress = seedProjects.findIndex((p) => p.phase === "IN_PROGRESS");
    const milestones = milestonesFor(seedProjects[inProgress], inProgress);
    const gates = milestones.filter((m) => m.isGate);
    expect(milestones.length).toBeGreaterThanOrEqual(2);
    expect(milestones.length).toBeLessThanOrEqual(4);
    expect(gates.at(-1)?.actualDate).toBeNull();
    expect(gates.slice(0, -1).every((g) => g.actualDate !== null)).toBe(true);
  });

  it("slips the open gate of the three projects chosen for it", () => {
    const milestones = milestonesFor(seedProjects[16], 16);
    const open = milestones.filter((m) => m.isGate).at(-1);
    const slip =
      (Date.parse(`${open?.forecastDate}T00:00:00Z`) -
        Date.parse(`${open?.baselineDate}T00:00:00Z`)) /
      86_400_000;
    expect(slip).toBe(120);
  });
});
