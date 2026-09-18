import { Inject, Injectable, Logger } from "@nestjs/common";
import { TokenClaims } from "@ecapital/shared";
import { Client } from "pg";
import { CONFIG, type AppConfig } from "../config";
import { AppError } from "../common/errors";
import {
  type Verifier,
  createDevVerifier,
  createOidcVerifier,
  signDevToken,
} from "./tokens";

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);
  private readonly verifier: Verifier;

  constructor(@Inject(CONFIG) private readonly config: AppConfig) {
    this.verifier = config.DEV_AUTH
      ? createDevVerifier(config.DEV_AUTH_SECRET)
      : createOidcVerifier(config);
    if (config.DEV_AUTH) {
      this.logger.warn("DEV_AUTH is on: tokens are signed locally, not by Entra ID");
    }
  }

  async claimsFromBearer(header: string | undefined): Promise<TokenClaims> {
    const token = header?.match(/^Bearer\s+(.+)$/i)?.[1];
    if (!token) throw AppError.unauthorized();
    try {
      return await this.verifier.verify(token);
    } catch {
      // The reason a token failed is a gift to whoever is guessing at them.
      throw AppError.unauthorized();
    }
  }

  /**
   * Development only: mint a token for a seeded user, so somebody can open
   * the app without an Entra ID tenant.
   *
   * It reads the user over the migration connection, not the application
   * pool. There is no caller yet, so there is nothing to set app.user_id to,
   * and under the policy on app_user a session with no identity sees no
   * users — correctly. In production this route does not exist at all.
   */
  async devTokenFor(email: string): Promise<{ token: string; claims: TokenClaims }> {
    if (!this.config.DEV_AUTH) throw AppError.notFound("errors.routeNotFound");

    const client = new Client({ connectionString: this.config.migrationDatabaseUrl });
    await client.connect();
    try {
      const { rows } = await client.query<{ id: string; subject: string; name: string }>(
        "select id, subject, name from ecapital.app_user where email = $1 and is_active limit 1",
        [email],
      );
      const user = rows[0];
      if (!user) throw AppError.notFound("errors.userNotFound", { email });

      const roles = await client.query<{ role: string }>(
        "select role from ecapital.app_user_role where app_user_id = $1 order by role",
        [user.id],
      );
      const units = await client.query<{ org_unit_id: string }>(
        "select org_unit_id from ecapital.app_user_org_unit where app_user_id = $1 order by org_unit_id",
        [user.id],
      );

      const claims = TokenClaims.parse({
        sub: user.subject,
        name: user.name,
        email,
        roles: roles.rows.map((r) => r.role),
        org_unit_ids: units.rows.map((u) => u.org_unit_id),
      });
      return { token: await signDevToken(claims, this.config.DEV_AUTH_SECRET), claims };
    } finally {
      await client.end();
    }
  }
}
