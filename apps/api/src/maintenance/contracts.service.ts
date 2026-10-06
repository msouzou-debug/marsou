/**
 * M5 — the maintenance agreement and its SLA catalogue (R32, ADR-0031 §1–2).
 *
 * There is no permission check in this file and there is not meant to be one
 * (ADR-0010). An agreement in a unit the caller may not read does not exist
 * for them (404); a write they may not make is refused by the row policy
 * (`can_manage_maintenance_contract`) and comes back as 403.
 *
 * The catalogue is data. The importer reads the contract's own table — the
 * parsing is a pure file with its own tests (sla-import.ts) — and writes the
 * good rows in the request's one transaction, matched to existing lines by
 * code, so a re-upload of a corrected sheet updates and never duplicates.
 */
import { Injectable } from "@nestjs/common";
import type {
  MaintenanceContract,
  MaintenanceContractWrite,
  SlaImportResult,
  SlaSystem,
  SlaSystemWrite,
} from "@ecapital/shared";
import ExcelJS from "exceljs";
import { and, asc, eq, sql, type SQL } from "drizzle-orm";
import { UUID } from "../common/actor";
import { AppError } from "../common/errors";
import {
  CHECK_VIOLATION,
  INSUFFICIENT_PRIVILEGE,
  UNIQUE_VIOLATION,
  sqlState,
} from "../common/sql-error";
import { currentTx } from "../db/client";
import * as schema from "../db/schema";
import { slaTemplateWorkbook } from "./maintenance-export";
import { money, num, toMaintenanceContract, toSlaSystem } from "./maintenance-rows";
import { type ParsedSlaRow, cellValue, parseSlaSheet, type SheetRowInput } from "./sla-import";

type ContractRow = typeof schema.maintenanceContract.$inferSelect;
type SystemRow = typeof schema.slaSystem.$inferSelect;

export type SystemInput = Omit<SlaSystemWrite, "maintenanceContractId">;

@Injectable()
export class MaintenanceContractsService {
  // ---------------------------------------------------- the agreement --

  async list(orgUnitId: string | null): Promise<MaintenanceContract[]> {
    const tx = currentTx();
    if (!tx) throw AppError.internal();
    const filters: SQL[] = [];
    if (orgUnitId) filters.push(eq(schema.maintenanceContract.orgUnitId, orgUnitId));
    const rows = await tx.db
      .select(contractColumns)
      .from(schema.maintenanceContract)
      .innerJoin(schema.contractor, eq(schema.contractor.id, schema.maintenanceContract.contractorId))
      .where(filters.length ? and(...filters) : undefined)
      .orderBy(asc(schema.maintenanceContract.orgUnitId), asc(schema.maintenanceContract.ref));
    return rows.map((r) => toMaintenanceContract(r.contract, r.contractorName, r.systemsCount));
  }

  async detail(id: string): Promise<MaintenanceContract> {
    const tx = currentTx();
    if (!tx) throw AppError.internal();
    if (!UUID.test(id)) throw AppError.notFound("errors.maintenanceContractNotFound");
    const [row] = await tx.db
      .select(contractColumns)
      .from(schema.maintenanceContract)
      .innerJoin(schema.contractor, eq(schema.contractor.id, schema.maintenanceContract.contractorId))
      .where(eq(schema.maintenanceContract.id, id))
      .limit(1);
    if (!row) throw AppError.notFound("errors.maintenanceContractNotFound");
    return toMaintenanceContract(row.contract, row.contractorName, row.systemsCount);
  }

  async create(input: MaintenanceContractWrite): Promise<MaintenanceContract> {
    const tx = currentTx();
    if (!tx) throw AppError.internal();
    await this.checkUnit(input.orgUnitId);
    await this.checkContractor(input.contractorId);
    await this.checkCapitalContract(input.orgUnitId, input.contractId ?? null);
    try {
      const [row] = await tx.db
        .insert(schema.maintenanceContract)
        .values({
          orgUnitId: input.orgUnitId,
          contractorId: input.contractorId,
          contractId: input.contractId ?? null,
          ref: input.ref.trim(),
          titleEl: input.titleEl.trim(),
          startDate: input.startDate,
          endDate: input.endDate ?? null,
          roundTheClock: input.roundTheClock ?? true,
          normalHoursFrom: input.normalHoursFrom ?? "07:30",
          normalHoursTo: input.normalHoursTo ?? "15:00",
          availabilityHoursYear: input.availabilityHoursYear ?? 8600,
          availabilityPenaltyCriticalPerHour: (input.availabilityPenaltyCriticalPerHour ?? 5).toFixed(2),
          availabilityPenaltyOtherPerHour: (input.availabilityPenaltyOtherPerHour ?? 1).toFixed(2),
          penaltyCapPct: (input.penaltyCapPct ?? 10).toFixed(2),
          contractValue: money(input.contractValue ?? null),
          status: input.status ?? "ACTIVE",
        })
        .returning({ id: schema.maintenanceContract.id });
      if (!row) throw AppError.forbidden("errors.readOnlyAccount");
      return await this.detail(row.id);
    } catch (error) {
      throw writeError(error, "errors.maintenanceContractRefTaken", "errors.maintenanceContractNotValid");
    }
  }

  async update(id: string, patch: Partial<MaintenanceContractWrite>): Promise<MaintenanceContract> {
    const tx = currentTx();
    if (!tx) throw AppError.internal();
    const existing = await this.row(id);
    // The unit does not move: the catalogue, the orders and the scorecard of
    // an agreement all belong to the hospital that signed it.
    if (patch.orgUnitId !== undefined && patch.orgUnitId !== existing.orgUnitId) {
      throw AppError.unprocessable("errors.maintenanceContractUnitFixed");
    }
    if (patch.contractorId !== undefined) await this.checkContractor(patch.contractorId);
    if (patch.contractId !== undefined) {
      await this.checkCapitalContract(existing.orgUnitId, patch.contractId ?? null);
    }

    const values: Record<string, unknown> = { updatedAt: sql`now()` };
    if (patch.contractorId !== undefined) values.contractorId = patch.contractorId;
    if (patch.contractId !== undefined) values.contractId = patch.contractId ?? null;
    if (patch.ref !== undefined) values.ref = patch.ref.trim();
    if (patch.titleEl !== undefined) values.titleEl = patch.titleEl.trim();
    if (patch.startDate !== undefined) values.startDate = patch.startDate;
    if (patch.endDate !== undefined) values.endDate = patch.endDate ?? null;
    if (patch.roundTheClock !== undefined) values.roundTheClock = patch.roundTheClock;
    if (patch.normalHoursFrom !== undefined) values.normalHoursFrom = patch.normalHoursFrom;
    if (patch.normalHoursTo !== undefined) values.normalHoursTo = patch.normalHoursTo;
    if (patch.availabilityHoursYear !== undefined) {
      values.availabilityHoursYear = patch.availabilityHoursYear;
    }
    if (patch.availabilityPenaltyCriticalPerHour !== undefined) {
      values.availabilityPenaltyCriticalPerHour = patch.availabilityPenaltyCriticalPerHour.toFixed(2);
    }
    if (patch.availabilityPenaltyOtherPerHour !== undefined) {
      values.availabilityPenaltyOtherPerHour = patch.availabilityPenaltyOtherPerHour.toFixed(2);
    }
    if (patch.penaltyCapPct !== undefined) values.penaltyCapPct = patch.penaltyCapPct.toFixed(2);
    if (patch.contractValue !== undefined) values.contractValue = money(patch.contractValue ?? null);
    if (patch.status !== undefined) values.status = patch.status;

    try {
      const touched = await tx.db
        .update(schema.maintenanceContract)
        .set(values)
        .where(eq(schema.maintenanceContract.id, id))
        .returning({ id: schema.maintenanceContract.id });
      // The caller can see the row and the policy refused the change: 403.
      if (!touched.length) throw AppError.forbidden("errors.readOnlyAccount");
      return await this.detail(id);
    } catch (error) {
      throw writeError(error, "errors.maintenanceContractRefTaken", "errors.maintenanceContractNotValid");
    }
  }

  // ---------------------------------------------------- the catalogue --

  async systems(contractId: string): Promise<SlaSystem[]> {
    const tx = currentTx();
    if (!tx) throw AppError.internal();
    await this.row(contractId);
    const rows = await tx.db
      .select()
      .from(schema.slaSystem)
      .where(eq(schema.slaSystem.maintenanceContractId, contractId));
    return rows.sort(byCode).map(toSlaSystem);
  }

  async createSystem(contractId: string, input: SystemInput): Promise<SlaSystem> {
    const tx = currentTx();
    if (!tx) throw AppError.internal();
    await this.row(contractId);
    try {
      const [row] = await tx.db
        .insert(schema.slaSystem)
        .values({
          maintenanceContractId: contractId,
          // Filled by the inherit trigger from the agreement.
          orgUnitId: "",
          ...systemValues(input),
        })
        .returning();
      if (!row) throw AppError.forbidden("errors.readOnlyAccount");
      return toSlaSystem(row);
    } catch (error) {
      throw writeError(error, "errors.slaSystemCodeTaken", "errors.slaSystemNotValid");
    }
  }

  async updateSystem(id: string, patch: Partial<SystemInput>): Promise<SlaSystem> {
    const tx = currentTx();
    if (!tx) throw AppError.internal();
    await this.systemRow(id);
    const values: Record<string, unknown> = { updatedAt: sql`now()` };
    if (patch.code !== undefined) values.code = patch.code.trim();
    if (patch.nameEl !== undefined) values.nameEl = patch.nameEl.trim();
    if (patch.band !== undefined) values.band = patch.band;
    if (patch.responseHours !== undefined) values.responseHours = String(patch.responseHours);
    if (patch.restoreHours !== undefined) values.restoreHours = String(patch.restoreHours);
    if (patch.reportHours !== undefined) values.reportHours = String(patch.reportHours);
    if (patch.pmFrequencies !== undefined) values.pmFrequencies = patch.pmFrequencies;
    if (patch.penaltyPmPerDay !== undefined) values.penaltyPmPerDay = money(patch.penaltyPmPerDay ?? null);
    if (patch.penaltyResponsePerHour !== undefined) {
      values.penaltyResponsePerHour = money(patch.penaltyResponsePerHour ?? null);
    }
    if (patch.penaltyRestorePerHour !== undefined) {
      values.penaltyRestorePerHour = money(patch.penaltyRestorePerHour ?? null);
    }
    if (patch.assetClass !== undefined) values.assetClass = patch.assetClass ?? null;
    if (patch.permitSystem !== undefined) values.permitSystem = patch.permitSystem ?? null;
    if (patch.active !== undefined) values.active = patch.active;
    try {
      const touched = await tx.db
        .update(schema.slaSystem)
        .set(values)
        .where(eq(schema.slaSystem.id, id))
        .returning();
      if (!touched.length) throw AppError.forbidden("errors.readOnlyAccount");
      return toSlaSystem(touched[0]);
    } catch (error) {
      throw writeError(error, "errors.slaSystemCodeTaken", "errors.slaSystemNotValid");
    }
  }

  /**
   * R32. Good rows are created or updated by code in this request's one
   * transaction; bad rows come back with their row number and a Greek
   * sentence, and do not stop the good ones. A row identical to what is
   * already stored is `skipped` — re-uploading the same sheet changes nothing
   * and says so.
   */
  async importSystems(contractId: string, bytes: Buffer): Promise<SlaImportResult> {
    const tx = currentTx();
    if (!tx) throw AppError.internal();
    await this.row(contractId);

    const sheetRows = await readFirstSheet(bytes);
    const parsed = parseSlaSheet(sheetRows);

    const existing = await tx.db
      .select()
      .from(schema.slaSystem)
      .where(eq(schema.slaSystem.maintenanceContractId, contractId));
    const byCode = new Map(existing.map((row) => [row.code, row]));

    const result: SlaImportResult = { created: 0, updated: 0, skipped: 0, errors: parsed.errors };
    try {
      for (const line of parsed.rows) {
        const values = systemValues(fromParsed(line));
        const found = byCode.get(line.code);
        if (!found) {
          const [row] = await tx.db
            .insert(schema.slaSystem)
            .values({ maintenanceContractId: contractId, orgUnitId: "", ...values })
            .returning({ id: schema.slaSystem.id });
          if (!row) throw AppError.forbidden("errors.readOnlyAccount");
          result.created += 1;
        } else if (sameSystem(found, line)) {
          result.skipped += 1;
        } else {
          const touched = await tx.db
            .update(schema.slaSystem)
            .set({ ...values, updatedAt: sql`now()` })
            .where(eq(schema.slaSystem.id, found.id))
            .returning({ id: schema.slaSystem.id });
          if (!touched.length) throw AppError.forbidden("errors.readOnlyAccount");
          result.updated += 1;
        }
      }
    } catch (error) {
      throw writeError(error, "errors.slaSystemCodeTaken", "errors.slaSystemNotValid");
    }
    result.errors.sort((a, b) => a.row - b.row);
    return result;
  }

  /** The import format with the agreement's current lines in it. */
  async template(contractId: string): Promise<{ ref: string; file: Buffer }> {
    const contract = await this.row(contractId);
    const systems = await this.systems(contractId);
    const file = await slaTemplateWorkbook(systems);
    return { ref: contract.ref, file };
  }

  // ---------------------------------------------------------- internals --

  async row(id: string): Promise<ContractRow> {
    const tx = currentTx();
    if (!tx) throw AppError.internal();
    if (!UUID.test(id)) throw AppError.notFound("errors.maintenanceContractNotFound");
    const [row] = await tx.db
      .select()
      .from(schema.maintenanceContract)
      .where(eq(schema.maintenanceContract.id, id))
      .limit(1);
    if (!row) throw AppError.notFound("errors.maintenanceContractNotFound");
    return row;
  }

  async systemRow(id: string): Promise<SystemRow> {
    const tx = currentTx();
    if (!tx) throw AppError.internal();
    if (!UUID.test(id)) throw AppError.notFound("errors.slaSystemNotFound");
    const [row] = await tx.db
      .select()
      .from(schema.slaSystem)
      .where(eq(schema.slaSystem.id, id))
      .limit(1);
    if (!row) throw AppError.notFound("errors.slaSystemNotFound");
    return row;
  }

  private async checkUnit(orgUnitId: string): Promise<void> {
    const tx = currentTx();
    if (!tx) throw AppError.internal();
    const rows = await tx.db
      .select({ id: schema.orgUnit.id })
      .from(schema.orgUnit)
      .where(eq(schema.orgUnit.id, orgUnitId))
      .limit(1);
    if (!rows.length) throw AppError.notFound("errors.unitNotFound");
  }

  private async checkContractor(contractorId: string): Promise<void> {
    const tx = currentTx();
    if (!tx) throw AppError.internal();
    if (!UUID.test(contractorId)) throw AppError.notFound("errors.contractorNotFound");
    const rows = await tx.db
      .select({ id: schema.contractor.id })
      .from(schema.contractor)
      .where(eq(schema.contractor.id, contractorId))
      .limit(1);
    if (!rows.length) throw AppError.notFound("errors.contractorNotFound");
  }

  /** The CAP- record, when one is linked, is a contract of the same unit. */
  private async checkCapitalContract(orgUnitId: string, contractId: string | null): Promise<void> {
    const tx = currentTx();
    if (!tx) throw AppError.internal();
    if (!contractId) return;
    if (!UUID.test(contractId)) throw AppError.notFound("errors.contractNotFound");
    const rows = await tx.db
      .select({ id: schema.contract.id })
      .from(schema.contract)
      .where(and(eq(schema.contract.id, contractId), eq(schema.contract.orgUnitId, orgUnitId)))
      .limit(1);
    if (!rows.length) throw AppError.notFound("errors.contractNotFound");
  }
}

// ------------------------------------------------------------- helpers --

const contractColumns = {
  contract: schema.maintenanceContract,
  contractorName: schema.contractor.name,
  systemsCount: sql<number>`(select count(*)::int from ecapital.sla_system s
                               where s.maintenance_contract_id = ${schema.maintenanceContract.id})`,
};

/** «1.2.10» after «1.2.9»: the table's own numbering, compared part by part. */
function byCode(a: { code: string }, b: { code: string }): number {
  const left = a.code.split(".");
  const right = b.code.split(".");
  for (let i = 0; i < Math.max(left.length, right.length); i += 1) {
    const x = left[i] ?? "";
    const y = right[i] ?? "";
    const nx = Number(x);
    const ny = Number(y);
    const diff = Number.isFinite(nx) && Number.isFinite(ny) && x !== "" && y !== "" ? nx - ny : x.localeCompare(y);
    if (diff) return diff;
  }
  return 0;
}

function systemValues(input: SystemInput) {
  return {
    code: input.code.trim(),
    nameEl: input.nameEl.trim(),
    band: input.band,
    responseHours: String(input.responseHours),
    restoreHours: String(input.restoreHours),
    reportHours: String(input.reportHours),
    pmFrequencies: input.pmFrequencies ?? [],
    penaltyPmPerDay: money(input.penaltyPmPerDay ?? null),
    penaltyResponsePerHour: money(input.penaltyResponsePerHour ?? null),
    penaltyRestorePerHour: money(input.penaltyRestorePerHour ?? null),
    assetClass: input.assetClass ?? null,
    permitSystem: input.permitSystem ?? null,
    active: input.active ?? true,
  };
}

/**
 * An imported line carries the contract's columns and nothing else. The two
 * mappings a person set on the screen (asset class, permit system) and the
 * active flag are not in the sheet, so an import never clears them.
 */
function fromParsed(line: ParsedSlaRow): SystemInput {
  return {
    code: line.code,
    nameEl: line.nameEl,
    band: line.band,
    responseHours: line.responseHours,
    restoreHours: line.restoreHours,
    reportHours: line.reportHours,
    pmFrequencies: line.pmFrequencies,
    penaltyPmPerDay: line.penaltyPmPerDay,
    penaltyResponsePerHour: line.penaltyResponsePerHour,
    penaltyRestorePerHour: line.penaltyRestorePerHour,
  };
}

function sameSystem(row: SystemRow, line: ParsedSlaRow): boolean {
  return (
    row.nameEl === line.nameEl &&
    row.band === line.band &&
    Number(row.responseHours) === line.responseHours &&
    Number(row.restoreHours) === line.restoreHours &&
    Number(row.reportHours) === line.reportHours &&
    [...row.pmFrequencies].sort().join(",") === [...line.pmFrequencies].sort().join(",") &&
    num(row.penaltyPmPerDay) === line.penaltyPmPerDay &&
    num(row.penaltyResponsePerHour) === line.penaltyResponsePerHour &&
    num(row.penaltyRestorePerHour) === line.penaltyRestorePerHour
  );
}

/** The first sheet as rows of primitives. A file exceljs cannot open is a 400, not a 500. */
async function readFirstSheet(bytes: Buffer): Promise<SheetRowInput[]> {
  const workbook = new ExcelJS.Workbook();
  try {
    await workbook.xlsx.load(bytes as unknown as ArrayBuffer);
  } catch {
    throw AppError.badRequest("errors.slaImportFileNotValid");
  }
  const sheet = workbook.worksheets[0];
  if (!sheet) throw AppError.badRequest("errors.slaImportFileNotValid");
  const rows: SheetRowInput[] = [];
  sheet.eachRow({ includeEmpty: false }, (row, rowNo) => {
    const values = Array.isArray(row.values) ? row.values.slice(1) : [];
    rows.push({ rowNo, values: values.map(cellValue) });
  });
  return rows;
}

export function writeError(error: unknown, uniqueKey: string, checkKey: string): never {
  if (error instanceof AppError) throw error;
  const code = sqlState(error);
  if (code === INSUFFICIENT_PRIVILEGE) throw AppError.forbidden("errors.readOnlyAccount");
  if (code === UNIQUE_VIOLATION) throw AppError.conflict(uniqueKey);
  if (code === CHECK_VIOLATION) throw AppError.badRequest(checkKey);
  throw error;
}
