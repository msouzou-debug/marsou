import { Injectable, Logger, type OnModuleInit } from "@nestjs/common";
import {
  AccessLevel,
  AppRole,
  GUARDRAILS,
  MatrixArea,
  ROLE_MATRIX,
  atLeast,
  defaultRoleMatrix,
  effectiveFor,
  levelFor,
  type RoleColumn,
  type RoleMatrix,
  type RolePermissionsResponse,
} from "@ecapital/shared";
import { AppError } from "../common/errors";
import { RESTRICT_VIOLATION, sqlState } from "../common/sql-error";
import { DatabaseService, currentTx, type Db, type RlsContext } from "../db/client";
import * as schema from "../db/schema";

/** How long a loaded matrix is trusted before the next request reads it again. */
export const PERMISSIONS_REFRESH_MS = 30_000;

/**
 * The identity the loader reads the table under. The read policy wants a
 * signed-in actor and nothing more; no role is needed to read the matrix.
 */
const LOADER_CONTEXT: RlsContext = Object.freeze({
  userId: "system:permissions",
  roles: [],
  orgUnitIds: [],
  ip: null,
}) as RlsContext;

/** Who is asking: a request's roles, or one of the server's own timers. */
export interface PermissionSubject {
  roles: readonly string[];
  system?: boolean;
}

/**
 * ADR-0033 — the role matrix, held in memory for the API's own checks.
 *
 * The database asks `ecapital.role_permission` live, through
 * `ecapital.allowed`, on every row it writes. The API's guard and the
 * services ask this copy instead, so a route can turn a caller away with 403
 * before it opens a transaction. The copy is read at start-up, again after
 * every change this process makes, and again by the first request that finds
 * it older than thirty seconds — which is how a change made through a second
 * API process reaches this one.
 *
 * The database stays the authority: a route the copy wrongly lets through is
 * still refused by the row policy underneath it.
 */
@Injectable()
export class PermissionsService implements OnModuleInit {
  private readonly logger = new Logger(PermissionsService.name);
  private matrix: RoleMatrix = defaultRoleMatrix();
  private updatedAt: string | null = null;
  private loadedAt = 0;
  private loading: Promise<void> | null = null;

  constructor(private readonly database: DatabaseService) {}

  async onModuleInit(): Promise<void> {
    await this.refresh();
  }

  /** Re-reads the table when the copy is older than the refresh interval. */
  async fresh(): Promise<void> {
    if (Date.now() - this.loadedAt < PERMISSIONS_REFRESH_MS) return;
    await this.refresh();
  }

  /**
   * Reads the whole table on a connection of its own. Concurrent callers
   * share one read. A failure keeps the copy it had — the defaults, at worst —
   * and is tried again by the next request: refusing every request because
   * the table could not be read once would turn a hiccup into an outage.
   */
  async refresh(): Promise<void> {
    if (!this.loading) {
      this.loading = this.database
        .withRls(LOADER_CONTEXT, (db) => this.read(db))
        .then(() => undefined)
        .catch((error: unknown) => {
          this.logger.warn(`role matrix not read: ${error instanceof Error ? error.message : String(error)}`);
        })
        .finally(() => {
          this.loading = null;
        });
    }
    await this.loading;
  }

  /** The matrix as this process holds it. */
  current(): RoleMatrix {
    return this.matrix;
  }

  /** True when any of the subject's roles holds at least `level` on `area`. */
  allowed(subject: PermissionSubject, area: MatrixArea, level: AccessLevel): boolean {
    if (subject.system) return true;
    return atLeast(levelFor(this.matrix, subject.roles.filter(isAppRole), area), level);
  }

  /** The same question for the request in flight; outside one, nobody. */
  allowedHere(area: MatrixArea, level: AccessLevel): boolean {
    const tx = currentTx();
    if (!tx) return false;
    return this.allowed(tx.context, area, level);
  }

  /** Every area at the highest level any of `roles` holds — `/me.permissions`. */
  effectiveFor(roles: readonly string[]): RoleColumn {
    return effectiveFor(this.matrix, roles.filter(isAppRole));
  }

  /** `GET /admin/roles/permissions`, read inside the caller's own transaction. */
  async response(): Promise<RolePermissionsResponse> {
    const tx = currentTx();
    if (!tx) throw AppError.internal();
    await this.read(tx.db);
    return { matrix: this.matrix, guardrails: [...GUARDRAILS], updatedAt: this.updatedAt };
  }

  /**
   * `PUT /admin/roles/:role` — the whole column, in the caller's transaction,
   * one row per area. Only the rows whose level actually moves are written,
   * so the audit trail lists what changed and nothing else (ADR-0011). The
   * guard trigger decides the guardrails; this turns its refusal into a 422
   * that names the row.
   */
  async writeRole(role: AppRole, column: RoleColumn): Promise<RolePermissionsResponse> {
    const tx = currentTx();
    if (!tx) throw AppError.internal();
    await this.read(tx.db);
    try {
      for (const area of MatrixArea.options) {
        const level = column[area];
        if (this.matrix[area][role] === level) continue;
        await tx.db
          .insert(schema.rolePermission)
          .values({ role, areaKey: area, level })
          .onConflictDoUpdate({
            target: [schema.rolePermission.role, schema.rolePermission.areaKey],
            set: { level },
          });
      }
    } catch (error) {
      // The transaction rolls back; the copy may have been read inside it.
      this.loadedAt = 0;
      throw guardrailError(error, role);
    }
    return this.response();
  }

  /** `POST /admin/roles/reset` — every column back to `ROLE_MATRIX`. */
  async reset(): Promise<RolePermissionsResponse> {
    for (const role of AppRole.options) {
      const column = Object.fromEntries(
        MatrixArea.options.map((area) => [area, ROLE_MATRIX[area][role]]),
      ) as RoleColumn;
      await this.writeRole(role, column);
    }
    return this.response();
  }

  private async read(db: Db): Promise<void> {
    const rows = await db
      .select({
        role: schema.rolePermission.role,
        areaKey: schema.rolePermission.areaKey,
        level: schema.rolePermission.level,
        updatedAt: schema.rolePermission.updatedAt,
      })
      .from(schema.rolePermission);

    // RULE (ADR-0033): no row is NONE. Start from nothing, not from the
    // defaults, so a row deleted by hand takes access away instead of
    // quietly handing back the default.
    const next = Object.fromEntries(
      MatrixArea.options.map((area) => [
        area,
        Object.fromEntries(AppRole.options.map((role) => [role, "NONE"])),
      ]),
    ) as RoleMatrix;
    let latest: Date | null = null;
    for (const row of rows) {
      const area = MatrixArea.safeParse(row.areaKey);
      const role = AppRole.safeParse(row.role);
      const level = AccessLevel.safeParse(row.level);
      if (!area.success || !role.success || !level.success) continue;
      next[area.data][role.data] = level.data;
      if (row.updatedAt && (!latest || row.updatedAt > latest)) latest = row.updatedAt;
    }
    this.matrix = next;
    this.updatedAt = latest ? latest.toISOString() : null;
    this.loadedAt = Date.now();
  }
}

function isAppRole(role: string): role is AppRole {
  return AppRole.safeParse(role).success;
}

/**
 * The trigger's message is `role_permission guardrail: <area>: <rule>`. The
 * area is read back out of it so the sentence can name the row.
 */
function guardrailError(error: unknown, role: AppRole): unknown {
  if (sqlState(error) !== RESTRICT_VIOLATION) return error;
  const message = messageOf(error);
  const match = /role_permission guardrail: (\w+): (\w+)/.exec(message);
  if (!match) return error;
  return AppError.unprocessable("errors.rolePermissionGuardrail", {
    area: `i18n:roleAreas.${match[1]}`,
    role: `i18n:roles.${role}`,
    rule: `i18n:roleGuardrails.${match[2]}`,
  });
}

function messageOf(error: unknown): string {
  let current: unknown = error;
  for (let depth = 0; current && depth < 5; depth += 1) {
    const message = (current as { message?: unknown }).message;
    if (typeof message === "string" && message.includes("role_permission guardrail")) return message;
    current = (current as { cause?: unknown }).cause;
  }
  return "";
}
