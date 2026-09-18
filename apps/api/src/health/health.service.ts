import { Injectable, Logger } from "@nestjs/common";
import { sql } from "drizzle-orm";
import { DatabaseService } from "../db/client";
import type { Health } from "./health.controller";

@Injectable()
export class HealthService {
  private readonly logger = new Logger(HealthService.name);

  constructor(private readonly db: DatabaseService) {}

  async check(): Promise<Health> {
    try {
      const result = await this.db.unscoped.execute<{ id: string | null }>(
        sql`select max(id) as id from ecapital.schema_migration`,
      );
      return {
        status: "ok",
        db: true,
        lastMigrationId: result.rows[0]?.id ?? null,
        at: new Date().toISOString(),
      };
    } catch (error) {
      this.logger.error(`health check failed: ${error instanceof Error ? error.message : error}`);
      return { status: "degraded", db: false, lastMigrationId: null, at: new Date().toISOString() };
    }
  }
}
