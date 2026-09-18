import { AsyncLocalStorage } from "node:async_hooks";
import { Inject, Injectable, OnModuleDestroy } from "@nestjs/common";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool, type PoolClient } from "pg";
import { CONFIG, type AppConfig } from "../config";
import * as schema from "./schema";

export type Db = NodePgDatabase<typeof schema>;

/**
 * What every request carries into the database session. The RLS interceptor
 * puts these on the connection with SET LOCAL before the handler runs, and
 * the policies read them back through current_setting (ADR-0010).
 */
export interface RlsContext {
  userId: string;
  roles: string[];
  orgUnitIds: string[];
  ip: string | null;
}

interface TxScope {
  db: Db;
  context: RlsContext;
}

const scope = new AsyncLocalStorage<TxScope>();

/** The transaction-scoped handle, or undefined outside a request. */
export function currentTx(): TxScope | undefined {
  return scope.getStore();
}

@Injectable()
export class DatabaseService implements OnModuleDestroy {
  readonly pool: Pool;
  /** Pool-level handle with no RLS settings. Health checks only. */
  readonly unscoped: Db;

  constructor(@Inject(CONFIG) config: AppConfig) {
    this.pool = new Pool({
      connectionString: config.DATABASE_URL,
      max: config.DATABASE_POOL_MAX,
      application_name: "ecapital-api",
    });
    this.unscoped = drizzle(this.pool, { schema });
  }

  async onModuleDestroy(): Promise<void> {
    await this.pool.end();
  }

  /**
   * Run `work` inside one transaction whose session carries the caller's
   * identity. SET LOCAL means the settings die with the transaction, so a
   * pooled connection can never be handed on still wearing someone else's
   * org units.
   */
  async withRls<T>(context: RlsContext, work: (db: Db) => Promise<T>): Promise<T> {
    const client: PoolClient = await this.pool.connect();
    try {
      await client.query("begin");
      await client.query("select set_config('app.user_id', $1, true)", [context.userId]);
      await client.query("select set_config('app.roles', $1, true)", [context.roles.join(",")]);
      await client.query("select set_config('app.org_unit_ids', $1, true)", [
        context.orgUnitIds.join(","),
      ]);
      await client.query("select set_config('app.ip', $1, true)", [context.ip ?? ""]);

      const db = drizzle(client, { schema });
      const result = await scope.run({ db, context }, () => work(db));
      await client.query("commit");
      return result;
    } catch (error) {
      await client.query("rollback").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }
}
