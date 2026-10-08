import type { INestApplication } from "@nestjs/common";
import {
  AccessLevel,
  AppRole,
  GUARDRAILS,
  MatrixArea,
  Me,
  ROLE_MATRIX,
  RolePermissionsResponse,
  columnOf,
  effectiveFor,
  withinBounds,
  type RoleColumn,
} from "@ecapital/shared";
import { Client } from "pg";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { USERS, bearer, createTestApp, tokenFor } from "./app";

/**
 * ADR-0033 — the role matrix as the rule.
 *
 * The suites share one database (ADR-0012), and every other suite assumes the
 * default matrix. So each test that changes a level puts it back, and
 * `afterAll` resets the whole table straight through SQL whatever happened.
 */
describe("the editable role matrix (ADR-0033)", () => {
  let app: INestApplication;
  let owner: Client;

  const http = () => request(app.getHttpServer());

  async function token(email: string): Promise<string> {
    return tokenFor(app, email);
  }

  async function put(role: AppRole, column: RoleColumn, email: string = USERS.admin) {
    return http().put(`/admin/roles/${role}`).set(bearer(await token(email))).send(column);
  }

  async function setLevel(role: AppRole, area: MatrixArea, level: AccessLevel) {
    const read = await http().get("/admin/roles/permissions").set(bearer(await token(USERS.admin)));
    const column = columnOf(RolePermissionsResponse.parse(read.body).matrix, role);
    const response = await put(role, { ...column, [area]: level });
    expect(response.status).toBe(200);
    return response;
  }

  async function resetDefaults() {
    const response = await http().post("/admin/roles/reset").set(bearer(await token(USERS.admin)));
    expect(response.status).toBe(200);
  }

  beforeAll(async () => {
    app = await createTestApp();
    owner = new Client({ connectionString: process.env.MIGRATION_DATABASE_URL });
    await owner.connect();
  });

  afterAll(async () => {
    // Whatever a failed test left behind, the next suite starts on the defaults.
    for (const area of MatrixArea.options) {
      for (const role of AppRole.options) {
        await owner.query(
          "update ecapital.role_permission set level = $3 where role = $1 and area_key = $2 and level <> $3",
          [role, area, ROLE_MATRIX[area][role]],
        );
      }
    }
    await owner.end();
    await app.close();
  });

  // ------------------------------------------------------------ the table --

  it("lists the same areas in the CHECK constraint as MatrixArea in the shared package", async () => {
    const { rows } = await owner.query<{ def: string }>(
      `select pg_get_constraintdef(oid) as def from pg_constraint
        where conname = 'role_permission_area_known'`,
    );
    const listed = [...rows[0].def.matchAll(/'(\w+)'::text/g)].map((match) => match[1]);
    expect([...listed].sort()).toEqual([...MatrixArea.options].sort());
  });

  it("is seeded from ROLE_MATRIX cell for cell, every role on every area", async () => {
    const { rows } = await owner.query<{ role: AppRole; area_key: MatrixArea; level: AccessLevel }>(
      "select role, area_key, level from ecapital.role_permission",
    );
    expect(rows).toHaveLength(AppRole.options.length * MatrixArea.options.length);
    for (const row of rows) {
      expect({ ...row }).toEqual({ ...row, level: ROLE_MATRIX[row.area_key][row.role] });
    }
  });

  it("names only areas that exist in every allowed() call of migration 0023", async () => {
    const { rows } = await owner.query<{ src: string }>(
      `select string_agg(prosrc, ' ') as src from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'ecapital' and p.proname like 'can_%'`,
    );
    const asked = [...rows[0].src.matchAll(/allowed\('(\w+)', '(\w+)'\)/g)];
    expect(asked.length).toBeGreaterThan(20);
    for (const [, area, level] of asked) {
      expect(MatrixArea.safeParse(area).success, area).toBe(true);
      expect(AccessLevel.safeParse(level).success, level).toBe(true);
    }
  });

  // ------------------------------------------------------- the SQL side --

  describe("ecapital.allowed()", () => {
    async function ask(roles: string, area: string, level: string, system = ""): Promise<boolean> {
      const client = new Client({ connectionString: process.env.DATABASE_URL });
      await client.connect();
      try {
        await client.query("begin");
        await client.query("select set_config('app.user_id', 'test:allowed', true)");
        await client.query("select set_config('app.roles', $1, true)", [roles]);
        await client.query("select set_config('app.system', $1, true)", [system]);
        const { rows } = await client.query<{ ok: boolean }>("select ecapital.allowed($1, $2) as ok", [area, level]);
        await client.query("rollback");
        return rows[0].ok;
      } finally {
        await client.end();
      }
    }

    it("answers from the stored levels, and a higher level includes the lower", async () => {
      expect(await ask("estates_head", "variationDecide", "APPROVE")).toBe(true);
      expect(await ask("estates_head", "variationDecide", "WRITE")).toBe(true);
      expect(await ask("project_engineer", "variationDecide", "APPROVE")).toBe(false);
      expect(await ask("admin", "users", "MANAGE")).toBe(true);
    });

    it("takes any of several roles, and nothing for no role", async () => {
      expect(await ask("technician,finance", "budgetLines", "WRITE")).toBe(true);
      expect(await ask("", "portfolio", "READ")).toBe(false);
    });

    it("refuses an unknown level or area rather than granting", async () => {
      expect(await ask("admin", "variationDecide", "EVERYTHING")).toBe(false);
      expect(await ask("admin", "noSuchArea", "READ")).toBe(false);
    });

    it("lets the server's own timers through, and nobody else on that strength", async () => {
      expect(await ask("admin", "maintenanceAgreement", "MANAGE", "on")).toBe(true);
      expect(await ask("technician", "maintenanceAgreement", "MANAGE", "")).toBe(false);
    });

    it("ranks the five levels NONE 0 to MANAGE 4", async () => {
      const { rows } = await owner.query<{ ranks: number[] }>(
        "select array[ecapital.level_rank('NONE'), ecapital.level_rank('READ'), ecapital.level_rank('WRITE'), ecapital.level_rank('APPROVE'), ecapital.level_rank('MANAGE')] as ranks",
      );
      expect(rows[0].ranks).toEqual([0, 1, 2, 3, 4]);
    });
  });

  it("the guard trigger and levelBounds agree on every cell of the matrix", async () => {
    await owner.query("begin");
    try {
      for (const role of AppRole.options) {
        for (const area of MatrixArea.options) {
          for (const level of AccessLevel.options) {
            await owner.query("savepoint cell");
            let refused = false;
            try {
              await owner.query(
                "update ecapital.role_permission set level = $3 where role = $1 and area_key = $2",
                [role, area, level],
              );
            } catch (error) {
              expect((error as { code?: string }).code).toBe("23001");
              refused = true;
            }
            await owner.query("rollback to savepoint cell");
            expect({ role, area, level, refused }).toEqual({ role, area, level, refused: !withinBounds(role, area, level) });
          }
        }
      }
    } finally {
      await owner.query("rollback");
    }
  });

  it("lets only the administrator write the table, by row policy", async () => {
    const client = new Client({ connectionString: process.env.DATABASE_URL });
    await client.connect();
    try {
      await client.query("begin");
      await client.query("select set_config('app.user_id', 'dev-estates-nicosia', true)");
      await client.query("select set_config('app.roles', 'estates_head', true)");
      const read = await client.query("select count(*)::int as n from ecapital.role_permission");
      expect(read.rows[0].n).toBe(AppRole.options.length * MatrixArea.options.length);
      const touched = await client.query(
        "update ecapital.role_permission set level = 'WRITE' where role = 'technician' and area_key = 'backlog'",
      );
      expect(touched.rowCount).toBe(0);
      await client.query("rollback");
    } finally {
      await client.end();
    }
  });

  // --------------------------------------------------------- the routes --

  it("GET /admin/roles/permissions answers any signed-in user with the matrix and the guardrail keys", async () => {
    for (const email of [USERS.estatesNicosia, USERS.technicianNicosia, USERS.auditor]) {
      const response = await http().get("/admin/roles/permissions").set(bearer(await token(email)));
      expect(response.status).toBe(200);
      const body = RolePermissionsResponse.parse(response.body);
      expect(body.matrix).toEqual(ROLE_MATRIX);
      expect(body.guardrails).toEqual([...GUARDRAILS]);
    }
    const anonymous = await http().get("/admin/roles/permissions");
    expect(anonymous.status).toBe(401);
  });

  it("GET /admin/roles still answers the role catalogue the users screen reads", async () => {
    const response = await http().get("/admin/roles").set(bearer(await token(USERS.admin)));
    expect(response.status).toBe(200);
    expect(response.body).toHaveLength(8);
  });

  it("refuses the writes to anybody but the administrator (403) and a short body (400)", async () => {
    const column = columnOf(ROLE_MATRIX, "technician");
    expect((await put("technician", column, USERS.estatesNicosia)).status).toBe(403);
    const reset = await http().post("/admin/roles/reset").set(bearer(await token(USERS.estatesNicosia)));
    expect(reset.status).toBe(403);

    const short: Partial<RoleColumn> = { ...column };
    delete short.backlog;
    expect((await put("technician", short as RoleColumn)).status).toBe(400);
    const notARole = await http().put("/admin/roles/janitor").set(bearer(await token(USERS.admin))).send(column);
    expect(notARole.status).toBe(400);
    expect(notARole.body.key).toBe("errors.rolePermissionNotValid");
  });

  it("refuses each guardrail with 422 and names the row in the sentence", async () => {
    const cases: Array<[AppRole, MatrixArea, AccessLevel, string]> = [
      ["auditor_readonly", "defects", "WRITE", "Ελλείψεις"],
      ["executive_readonly", "reports", "APPROVE", "Αναφορές"],
      ["admin", "users", "WRITE", "Χρήστες, ρόλοι και εγκριτές διακοπών"],
      ["admin", "backlog", "NONE", "Εκκρεμότητες συντήρησης"],
      ["finance", "auditTrail", "WRITE", "Ίχνος ελέγχου όλων των αλλαγών"],
      ["estates_head", "users", "READ", "Χρήστες, ρόλοι και εγκριτές διακοπών"],
    ];
    for (const [role, area, level, label] of cases) {
      const response = await put(role, { ...columnOf(ROLE_MATRIX, role), [area]: level });
      expect({ role, area, status: response.status }).toEqual({ role, area, status: 422 });
      expect(response.body.key).toBe("errors.rolePermissionGuardrail");
      expect(response.body.message).toContain(`«${label}»`);
    }
    const english = await http()
      .put("/admin/roles/auditor_readonly")
      .set(bearer(await token(USERS.admin)))
      .set("Accept-Language", "en")
      .send({ ...columnOf(ROLE_MATRIX, "auditor_readonly"), defects: "WRITE" });
    expect(english.status).toBe(422);
    expect(english.body.message).toContain("“Defects”");
    expect(english.body.message).toContain("the Auditor and the Executive never go above Read.");

    // Nothing of a refused column was kept.
    const after = await http().get("/admin/roles/permissions").set(bearer(await token(USERS.admin)));
    expect(RolePermissionsResponse.parse(after.body).matrix).toEqual(ROLE_MATRIX);
  });

  it("a change is in force at the next request: finance raises an inspection defect only while the matrix says so", async () => {
    const body = {
      source: "INSPECTION",
      areaId: null,
      orgUnitId: "nicosia-general",
      descriptionEl: `Έλλειψη από την Οικονομική Διεύθυνση ${Date.now()}`,
      estimatedCost: 1200,
      riskBand: "LOW",
    };
    const finance = await token(USERS.finance);
    const before = await http().post("/defects").set(bearer(finance)).send(body);
    expect(before.status).toBe(403);

    await setLevel("finance", "defects", "WRITE");
    const during = await http().post("/defects").set(bearer(finance)).send(body);
    expect(during.status).toBe(201);
    // A handover defect also needs the contract row, which finance still lacks.
    const handover = await http().post("/defects").set(bearer(finance)).send({ ...body, source: "HANDOVER" });
    expect([403, 422]).toContain(handover.status);

    await setLevel("finance", "defects", "READ");
    const after = await http().post("/defects").set(bearer(finance)).send(body);
    expect(after.status).toBe(403);
  });

  it("takes a technician's defects away with one cell, and gives them back", async () => {
    const body = {
      source: "INSPECTION",
      areaId: null,
      orgUnitId: "nicosia-general",
      descriptionEl: `Έλλειψη επιθεώρησης ${Date.now()}`,
      estimatedCost: 300,
      riskBand: "LOW",
    };
    const technician = await token(USERS.technicianNicosia);
    await setLevel("technician", "defects", "READ");
    expect((await http().post("/defects").set(bearer(technician)).send(body)).status).toBe(403);
    await setLevel("technician", "defects", "WRITE");
    expect((await http().post("/defects").set(bearer(technician)).send(body)).status).toBe(201);
  });

  it("a route's @Needs follows the matrix too: the technician keeps the backlog after the change, and not after the reset", async () => {
    const technician = await token(USERS.technicianNicosia);
    const item = () => ({
      orgUnitId: "nicosia-general",
      kind: "REPAIR",
      titleEl: `Εκκρεμότητα τεχνίτη ${Date.now()}`,
      riskBand: "LOW",
    });
    expect((await http().post("/backlog").set(bearer(technician)).send(item())).status).toBe(403);

    await setLevel("technician", "backlog", "WRITE");
    expect((await http().post("/backlog").set(bearer(technician)).send(item())).status).toBe(201);

    await resetDefaults();
    expect((await http().post("/backlog").set(bearer(technician)).send(item())).status).toBe(403);
  });

  it("/me carries the caller's effective levels, and they move with the matrix", async () => {
    const technician = await token(USERS.technicianNicosia);
    const before = Me.parse((await http().get("/me").set(bearer(technician))).body);
    expect(before.permissions).toEqual(effectiveFor(ROLE_MATRIX, ["technician"]));
    expect(Object.keys(before.permissions).sort()).toEqual([...MatrixArea.options].sort());

    await setLevel("technician", "reports", "READ");
    const during = Me.parse((await http().get("/me").set(bearer(technician))).body);
    expect(during.permissions.reports).toBe("READ");
    const reports = await http().get("/reports").set(bearer(technician));
    expect(reports.status).toBe(200);

    await resetDefaults();
    const after = Me.parse((await http().get("/me").set(bearer(technician))).body);
    expect(after.permissions.reports).toBe("NONE");
  });

  it("audits every change and stamps who and when; reset puts every cell back", async () => {
    const { rows: [{ n: before }] } = await owner.query<{ n: number }>(
      "select count(*)::int as n from ecapital.audit_log where entity_type = 'role_permission'",
    );
    const changed = await setLevel("clinical_approver", "backlog", "WRITE");
    const body = RolePermissionsResponse.parse(changed.body);
    expect(body.matrix.backlog.clinical_approver).toBe("WRITE");
    expect(body.updatedAt).not.toBeNull();

    const { rows: audit } = await owner.query<{ entity_id: string; actor_id: string; before: { level: string }; after: { level: string } }>(
      `select entity_id, actor_id, before, after from ecapital.audit_log
        where entity_type = 'role_permission' order by id desc limit 1`,
    );
    expect(audit[0]).toMatchObject({
      entity_id: "clinical_approver:backlog",
      actor_id: "dev-admin",
      before: { level: "READ" },
      after: { level: "WRITE" },
    });
    const { rows: stamped } = await owner.query<{ updated_by: string | null }>(
      "select updated_by from ecapital.role_permission where role = 'clinical_approver' and area_key = 'backlog'",
    );
    expect(stamped[0].updated_by).not.toBeNull();

    await resetDefaults();
    const { rows: [{ n: after }] } = await owner.query<{ n: number }>(
      "select count(*)::int as n from ecapital.audit_log where entity_type = 'role_permission'",
    );
    // One row for the change, one for putting it back; the reset writes only what moved.
    expect(after - before).toBe(2);
    const read = await http().get("/admin/roles/permissions").set(bearer(await token(USERS.admin)));
    expect(RolePermissionsResponse.parse(read.body).matrix).toEqual(ROLE_MATRIX);
  });
});
