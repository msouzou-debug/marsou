import { Logger } from "@nestjs/common";
import { Client, InvalidCredentialsError } from "ldapts";
import type { AppConfig } from "../config";
import {
  type Directory,
  type DirectoryUser,
  escapeFilterValue,
  formatObjectGuid,
  splitUsername,
} from "./directory";

/**
 * ADR-0018 — the ΟΚΥπΥ Active Directory (`ihcis.local`), reached exactly the
 * way eFinance reaches it: a simple bind with the user's UPN, then a read of
 * the account's own entry for `displayName`, `mail` and `memberOf`.
 *
 * There is no service account. The connection binds as the person signing in
 * and searches with that same connection, so eCapital never holds a
 * credential that can read the directory on its own — one fewer secret on the
 * server, and a search that can see no more than the user can.
 *
 * `ldapts` rather than `ldapjs`: ldapjs is callback-based, has been
 * effectively unmaintained since 2023, and its types are a separate package.
 * `ldapts` is TypeScript, promise-based, actively released, and its `Client`
 * is the whole API surface we need. ADR-0018 records the choice.
 */
export class LdaptsDirectory implements Directory {
  private readonly logger = new Logger(LdaptsDirectory.name);

  constructor(private readonly config: AppConfig) {}

  async authenticate(username: string, password: string): Promise<DirectoryUser | null> {
    const url = this.config.LDAP_URL as string;
    const baseDn = this.config.LDAP_BASE_DN as string;
    const domain = this.config.LDAP_DOMAIN as string;
    const uidAttribute = this.config.LDAP_UID_ATTRIBUTE;
    const { upn, uid } = splitUsername(username, domain);

    const client = new Client({ url, timeout: this.config.LDAP_TIMEOUT_MS, strictDN: false });
    try {
      // RULE (ADR-0018): plain ldap:// on the wire inside the ΟΚΥπΥ network is
      // what the estate runs today; StartTLS is one variable away for the day
      // the domain controllers carry a certificate.
      if (this.config.LDAP_START_TLS) await client.startTLS({});

      try {
        // The password crosses this line and goes no further. Nothing below
        // holds it, logs it or puts it in an error.
        await client.bind(upn, password);
      } catch (error) {
        if (error instanceof InvalidCredentialsError) return null;
        throw error;
      }

      const filter = `(&(objectCategory=person)(objectClass=user)(${uidAttribute}=${escapeFilterValue(uid)}))`;
      const { searchEntries } = await client.search(baseDn, {
        scope: "sub",
        filter,
        attributes: ["displayName", "mail", "memberOf", "objectGUID", uidAttribute],
        // objectGUID is binary; everything else is text.
        explicitBufferAttributes: ["objectGUID"],
        sizeLimit: 2,
      });

      const entry = searchEntries[0];
      if (!entry) {
        // The bind worked, so the credentials are right — but we cannot read
        // the account's own entry. That is a directory permission problem,
        // not a wrong password, and saying "wrong password" would send the
        // user round a loop they cannot get out of.
        this.logger.warn(
          `bind succeeded for ${uid} but ${baseDn} returned no entry — check LDAP_BASE_DN and read permissions`,
        );
        throw new Error("directory returned no entry for a user who bound successfully");
      }

      return {
        objectGuid: guidOf(entry.objectGUID),
        uid: single(entry[uidAttribute]) ?? uid,
        displayName: single(entry.displayName),
        mail: single(entry.mail),
        memberOf: many(entry.memberOf),
      };
    } finally {
      await client.unbind().catch(() => undefined);
    }
  }
}

type Attr = string | string[] | Buffer | Buffer[] | undefined;

function single(value: Attr): string | null {
  if (value === undefined) return null;
  const first = Array.isArray(value) ? value[0] : value;
  if (first === undefined) return null;
  const text = typeof first === "string" ? first : first.toString("utf8");
  return text.length ? text : null;
}

function many(value: Attr): string[] {
  if (value === undefined) return [];
  const list = Array.isArray(value) ? value : [value];
  return list.map((v) => (typeof v === "string" ? v : v.toString("utf8"))).filter(Boolean);
}

function guidOf(value: Attr): string | null {
  if (value === undefined) return null;
  const first = Array.isArray(value) ? value[0] : value;
  if (first === undefined || typeof first === "string") return null;
  return formatObjectGuid(new Uint8Array(first));
}
