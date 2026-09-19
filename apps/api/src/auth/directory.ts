/**
 * ADR-0018 — the port between "who is this person" and "which directory says
 * so", plus the pure string work that goes with it.
 *
 * The API talks to a `Directory`, not to a library. `LdaptsDirectory`
 * (./ldap.directory.ts) is the one implementation that speaks to the ΟΚΥπΥ
 * Active Directory; the tests substitute a fake one at this boundary. Nothing
 * below opens a socket, so all of it is unit-testable without a server —
 * which matters, because the parts that get a deployment wrong are the UPN we
 * bind with and the filter we search with, not the socket.
 *
 * RULE: a password reaches `authenticate` and goes no further. It is never
 * logged, never stored, never put in an error and never returned.
 */

/** What the directory tells us about somebody who has just proved who they are. */
export interface DirectoryUser {
  /** `objectGUID`, canonical form. Null when the directory did not send one. */
  objectGuid: string | null;
  /** The value of `LDAP_UID_ATTRIBUTE` — `sAMAccountName` on the ΟΚΥπΥ estate. */
  uid: string;
  displayName: string | null;
  mail: string | null;
  /** Group DNs, exactly as the directory spells them. */
  memberOf: string[];
}

export interface Directory {
  /**
   * Bind as this person and read their entry back. Resolves to null when the
   * credentials are wrong — which is not an exceptional condition, it is the
   * daily answer to a mistyped password. Anything else (no route to the
   * server, TLS refused) throws, because that is an operator's problem and
   * must not be reported to the user as "wrong password".
   */
  authenticate(username: string, password: string): Promise<DirectoryUser | null>;
}

/** Injection token, so a test can put a fake directory in the container. */
export const DIRECTORY = Symbol("ecapital.directory");

/**
 * What the user typed, split into the two forms the bind and the search need.
 *
 * ΟΚΥπΥ staff type «apapadopoulos», occasionally «apapadopoulos@ihcis.local»
 * and, out of habit from the old domain logon, sometimes «IHCIS\apapadopoulos».
 * All three mean the same person. The bind uses the UPN (eFinance's own
 * settings do the same: simple bind with the user's UPN), and the search
 * filter uses the bare account name.
 */
export function splitUsername(input: string, domain: string): { upn: string; uid: string } {
  const typed = input.trim();
  const backslash = typed.lastIndexOf("\\");
  const withoutDomainPrefix = backslash === -1 ? typed : typed.slice(backslash + 1);
  const at = withoutDomainPrefix.lastIndexOf("@");
  if (at > 0) {
    return { upn: withoutDomainPrefix, uid: withoutDomainPrefix.slice(0, at) };
  }
  return { upn: `${withoutDomainPrefix}@${domain}`, uid: withoutDomainPrefix };
}

/**
 * RFC 4515 §3. A surname with a parenthesis or a backslash in it would
 * otherwise change the shape of the filter rather than sit inside it.
 */
export function escapeFilterValue(value: string): string {
  return value.replace(/[\\*()\0]/g, (c) => {
    switch (c) {
      case "\\":
        return "\\5c";
      case "*":
        return "\\2a";
      case "(":
        return "\\28";
      case ")":
        return "\\29";
      default:
        return "\\00";
    }
  });
}

/**
 * Active Directory's `objectGUID` is sixteen raw bytes, and its printed form
 * is mixed-endian: the first three groups little-endian, the last two big.
 * Getting that wrong would still produce a stable string, but not the same
 * one any other tool shows for the same account, which makes the subject
 * useless for anybody comparing two systems by hand.
 */
export function formatObjectGuid(bytes: Uint8Array): string | null {
  if (bytes.length !== 16) return null;
  const hex = (i: number) => bytes[i].toString(16).padStart(2, "0");
  const le = (...idx: number[]) => idx.map(hex).join("");
  return [
    le(3, 2, 1, 0),
    le(5, 4),
    le(7, 6),
    le(8, 9),
    le(10, 11, 12, 13, 14, 15),
  ].join("-");
}

/**
 * The `app_user.subject` for somebody who signed in through Active Directory.
 *
 * `objectGUID` is the right key: it survives a rename, a move between OUs and
 * a change of surname, none of which `sAMAccountName` does. When the
 * directory will not give us one — a read that the account is not allowed to
 * make, a directory that is not AD — we fall back to the account name and say
 * so in the subject itself, so nobody later mistakes one for the other.
 */
export function subjectFor(user: DirectoryUser): string {
  return user.objectGuid ?? `ad:${user.uid.toLowerCase()}`;
}
