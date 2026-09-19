import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { seed } from "../src/db/seed";

/**
 * CAPEX-01 §15 and the seed's own promise: `pnpm seed` is safe to run twice.
 * The site log is the part of it most likely to break that, because its RFI
 * dates are relative to the moment it runs — so a second run has to move the
 * clock on the rows that exist rather than write a second set of them.
 */
/**
 * The other suites build their own contracts as they go, so every query below
 * narrows to the seeded register: the seed numbers its contracts ΤΥ/2026/nnn
 * and the test fixtures number theirs ΤΥ/ΔΟΚ/… (see test/contract-support.ts).
 */
const SEEDED = "select id from ecapital.contract where contract_no like 'ΤΥ/2026/%'";

describe("the site log seed", () => {
  let client: Client;

  beforeAll(async () => {
    client = new Client({ connectionString: process.env.MIGRATION_DATABASE_URL as string });
    await client.connect();
  });
  afterAll(async () => {
    await client.end();
  });

  async function counts(): Promise<Record<string, number>> {
    const { rows } = await client.query<{ rfis: string; instructions: string; defects: string }>(
      `select (select count(*) from ecapital.rfi) as rfis,
              (select count(*) from ecapital.site_instruction) as instructions,
              (select count(*) from ecapital.defect) as defects`,
    );
    return {
      rfis: Number(rows[0].rfis),
      instructions: Number(rows[0].instructions),
      defects: Number(rows[0].defects),
    };
  }

  it("puts the fixture the briefs ask for into an empty register", async () => {
    const { rows } = await client.query<{ source: string; risk_band: string; n: string }>(
      `select source, risk_band, count(*) as n from ecapital.defect
        where contract_id in (${SEEDED}) or contract_id is null
        group by source, risk_band order by source, risk_band`,
    );
    const handover = rows.filter((r) => r.source === "HANDOVER");
    expect(handover.reduce((sum, r) => sum + Number(r.n), 0)).toBeGreaterThanOrEqual(12);
    // All four NHS ERIC bands, so the backlog screen has a full table (R35).
    expect(handover.map((r) => r.risk_band).sort()).toEqual([
      "HIGH",
      "LOW",
      "MODERATE",
      "SIGNIFICANT",
    ]);
    expect(
      rows.filter((r) => r.source === "INSPECTION").reduce((sum, r) => sum + Number(r.n), 0),
    ).toBeGreaterThanOrEqual(3);

    // An inspection defect belongs to a unit and to nothing else (ADR-0017).
    const { rows: loose } = await client.query<{ n: string }>(
      `select count(*) as n from ecapital.defect
        where source = 'INSPECTION' and contract_id is null and project_id is null
          and org_unit_id is not null and due_date is null`,
    );
    expect(Number(loose[0].n)).toBeGreaterThanOrEqual(3);

    // Two handover defects have outlived their liability period, and one
    // defect is funded from a real project.
    const { rows: overdue } = await client.query<{ n: string }>(
      `select count(*) as n from ecapital.defect
        where source = 'HANDOVER' and status <> 'CLOSED' and due_date < current_date
          and contract_id in (${SEEDED})`,
    );
    expect(Number(overdue[0].n)).toBe(2);
    const { rows: funded } = await client.query<{ n: string }>(
      `select count(*) as n from ecapital.defect
        where funded and target_project_id is not null and contract_id in (${SEEDED})`,
    );
    expect(Number(funded[0].n)).toBe(1);
  });

  it("gives every seeded contract two or three RFIs, one breached and one red", async () => {
    const { rows } = await client.query<{ n: string }>(
      `select count(*) as n from ecapital.rfi where contract_id in (${SEEDED}) group by contract_id`,
    );
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) expect([2, 3]).toContain(Number(row.n));

    const { rows: states } = await client.query<{ breached: string; red: string }>(
      `select count(*) filter (where status = 'OPEN' and sla_due_at <= now()) as breached,
              count(*) filter (where status = 'OPEN' and sla_due_at > now()
                                 and extract(epoch from (sla_due_at - now()))
                                     <= 0.1 * sla_hours * 3600) as red
         from ecapital.rfi where contract_id in (${SEEDED})`,
    );
    expect(Number(states[0].breached)).toBeGreaterThanOrEqual(1);
    expect(Number(states[0].red)).toBeGreaterThanOrEqual(1);
  });

  it("gives every seeded contract an instruction, some of them one to price", async () => {
    const { rows } = await client.query<{ n: string }>(
      `select count(*) as n from ecapital.site_instruction
        where contract_id in (${SEEDED}) group by contract_id`,
    );
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) expect([1, 2]).toContain(Number(row.n));

    const { rows: unpriced } = await client.query<{ n: string }>(
      `select count(*) as n from ecapital.site_instruction
        where cost_impact_flag and variation_id is null and contract_id in (${SEEDED})`,
    );
    expect(Number(unpriced[0].n)).toBe(3);
  });

  it("writes nothing new on a second run", async () => {
    const before = await counts();
    await seed(process.env.MIGRATION_DATABASE_URL as string);
    expect(await counts()).toEqual(before);
  });
});
