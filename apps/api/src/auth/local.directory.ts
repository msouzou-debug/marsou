import { Logger } from "@nestjs/common";
import { Client } from "pg";
import type { AppConfig } from "../config";
import type { Directory, DirectoryUser } from "./directory";
import { DUMMY_HASH, verifyPassword } from "./password";

/**
 * ADR-0030 — `AUTH_MODE=local`: a username and a password that eCapital
 * holds itself, at the same `Directory` port the Active Directory bind
 * uses (ADR-0018). Everything after `authenticate` — the app_user upsert,
 * the roles an administrator assigned, the token — is the ldap path,
 * untouched.
 *
 * Why it exists: the ΟΚΥπΥ directory is not reachable from the server
 * (runbook §1, blocked on IT), and people need to try the screens with
 * their own roles before it is. The mode is switched on by the operator
 * and switched off again the day `ldap` works; an account made here is
 * adopted by its directory account on the first bind, by username, exactly
 * like a pre-registered one (ADR-0020).
 *
 * The name typed is matched against `username` and, for the seeded
 * accounts that have none, against the address. Either way the row's own
 * subject is handed back as the stable id, so signing in never moves a
 * subject and never splits an account in two.
 *
 * RULE: a wrong password, an unknown name, an account with no password set
 * and a locked account all answer null — the same 401 — and take about the
 * same time (the dummy hash). Nothing here says which one it was.
 *
 * RULE: five wrong passwords in a row lock the name for fifteen minutes.
 * In memory, per process: enough to turn a guessing script into a very
 * slow one, and gone on restart, which is the right size for a mode that
 * exists for a few weeks on one server.
 */
export class LocalDirectory implements Directory {
  private readonly logger = new Logger(LocalDirectory.name);
  private readonly failures = new Map<string, { count: number; until: number }>();

  static readonly MAX_FAILURES = 5;
  static readonly LOCK_MS = 15 * 60 * 1000;

  constructor(private readonly config: AppConfig) {}

  async authenticate(username: string, password: string): Promise<DirectoryUser | null> {
    const typed = username.trim().toLowerCase();
    if (!typed || !password) return null;

    const lock = this.failures.get(typed);
    if (lock && lock.count >= LocalDirectory.MAX_FAILURES) {
      if (Date.now() < lock.until) {
        this.logger.warn(`local sign-in for ${typed} refused: locked after repeated failures`);
        return null;
      }
      this.failures.delete(typed);
    }

    const client = new Client({ connectionString: this.config.migrationDatabaseUrl });
    await client.connect();
    let row:
      | { subject: string; username: string | null; name: string; email: string; is_active: boolean; password_hash: string | null }
      | undefined;
    try {
      const { rows } = await client.query<NonNullable<typeof row>>(
        `select u.subject, u.username, u.name, u.email, u.is_active, p.password_hash
           from ecapital.app_user u
           left join ecapital.app_user_password p on p.app_user_id = u.id
          where lower(u.username) = $1 or lower(u.email) = $1
          order by (lower(u.username) = $1) desc
          limit 1`,
        [typed],
      );
      row = rows[0];
    } finally {
      await client.end();
    }

    // The comparison runs whether or not there is anything to compare
    // against, so an unknown name costs the caller as much as a wrong password.
    const ok = verifyPassword(password, row?.password_hash ?? DUMMY_HASH) && Boolean(row?.password_hash);
    if (!ok || !row) {
      this.noteFailure(typed);
      return null;
    }
    // A deactivated account is refused at the door, with the password
    // proved; auth.service turns this into 401 errors.accountDeactivated
    // when the row is reached, so hand it over as the directory would.
    this.failures.delete(typed);
    return {
      objectGuid: row.subject,
      uid: row.username ?? row.email,
      displayName: row.name,
      mail: row.email,
      memberOf: [],
    };
  }

  /** Forget the failures of one name, or of all: an operator unlocking somebody, or a test. */
  reset(username?: string): void {
    if (username === undefined) this.failures.clear();
    else this.failures.delete(username.trim().toLowerCase());
  }

  private noteFailure(name: string): void {
    const current = this.failures.get(name) ?? { count: 0, until: 0 };
    const count = current.count + 1;
    this.failures.set(name, {
      count,
      until: count >= LocalDirectory.MAX_FAILURES ? Date.now() + LocalDirectory.LOCK_MS : 0,
    });
    if (count === LocalDirectory.MAX_FAILURES) {
      this.logger.warn(`local sign-in for ${name} locked for fifteen minutes after ${count} failures`);
    }
  }
}
