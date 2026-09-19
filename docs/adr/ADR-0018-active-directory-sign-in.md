# ADR-0018 — Active Directory sign-in, and what production refuses to start with

**Status:** accepted · 19/09/2026 · supersedes part of [ADR-0009](ADR-0009-entra-oidc-with-dev-stub.md)

## Context

ADR-0009 decided that authentication is Entra ID over OIDC, with a signed local stub for development. That decision was made against R01 and CAPEX-01 §3, and against a mental picture of the ΟΚΥπΥ estate that turns out not to match the one eCapital has to be deployed onto.

The estate, read out of eFinance's own repository notes (`CLAUDE.md`, `DESIGN.md`, `INTEGRATION-eMAP.md`), is one Ubuntu 22.04 server at `10.227.56.22` running eMAP on 5001, eQuality on 5002, DIAS on 5003 and eFinance on 5004. Public hostnames are terminated on a **separate cloudflared box** — `finance.shso.online` → `10.227.56.22:5004`, `map.shso.online` → eMAP — so no application on that server speaks TLS itself; they honour `X-Forwarded-Proto` and `X-Forwarded-Host` instead.

Identity on that estate is **Active Directory, `ihcis.local`**. eFinance authenticates with an LDAP simple bind using the user's UPN (`ldap3` in Python; settings `ad_server`, `ad_port` 389, `ad_use_ssl`, `ad_domain`, `ad_base_dn`, `ad_uid_attribute` = `sAMAccountName`). Roles are held locally, per application; AD only says who somebody is. **Entra ID OIDC is not what the estate uses today.**

So eCapital either binds against the same directory as its two siblings, or it is the one application on that server that asks people for a different password.

## Decision

### One variable names the way in: `AUTH_MODE=dev | ldap | oidc`

- **`dev`** is ADR-0009's stub, unchanged: `POST /auth/dev-token` for a seeded account. Development and tests.
- **`ldap`** is new and is what the ΟΚΥπΥ server runs: `POST /auth/login {username, password}` performs a simple bind as `<sAMAccountName>@<LDAP_DOMAIN>` (or the UPN, if the user typed one) against `LDAP_URL`, reads `displayName`, `mail`, `memberOf` and `objectGUID` from `LDAP_BASE_DN`, maps the groups to roles through `ecapital.role_mapping`, creates or refreshes the `app_user` row, and issues a token.
- **`oidc`** is ADR-0009's production path, kept exactly as built and not used today.

`AUTH_MODE` left unset is derived from `DEV_AUTH`, so every `.env` written before this ADR keeps behaving as it did.

**All three end in the same token.** The `ldap` path signs the same HS256 session token `dev` signs, with `SESSION_SECRET`, for eight hours. The guard, the claims (`sub`, `name`, `email`, `roles[]`, `org_unit_ids[]`), the RLS interceptor and every row policy underneath cannot tell the three apart — which is the whole point of ADR-0009's shape and is why that shape survives this decision intact.

The issuer string in the token still reads `ecapital-dev-auth`. It is the name of the signer, not a claim about the environment, and changing it would invalidate every live session the moment the API restarted after an upgrade.

### The subject is the `objectGUID`

`app_user.subject` is the AD `objectGUID`, printed in its usual mixed-endian form. It survives a rename, a change of surname and a move between OUs, none of which `sAMAccountName` does. Where the directory will not hand one back, the subject is `ad:<samaccountname>` — and says so in the string, so nobody later mistakes one kind of subject for the other.

A new column, `app_user.auth_source` (`dev | ldap | oidc`), records where a row came from, so an operator can tell a seeded development account from a real one without inferring it from the subject.

### `role_mapping.entra_group_id` is renamed to `role_mapping.group_id`

The column held an Entra object id. It now holds either that or an Active Directory group DN. That is the same fact under two spellings — *the directory group that grants this role* — so it is a rename with a comment, not a second column and not a second code path. The comparison is case-insensitive, because a distinguished name is.

A mapping row with a null `org_unit_id` means every unit, as ADR-0009 already said.

**An AD user whose groups match no row gets a token with no roles and no units.** They sign in and see nothing. That is ADR-0009's "safe direction", made concrete: the account exists, the administrator has not given it anything yet, and saying so is more honest than a refusal that looks like a wrong password. A bind failure, by contrast, is a bare 401 `errors.notSignedIn` — the same answer for a wrong password and for an account the directory has never heard of, because telling the two apart tells somebody guessing which half of the guess was right.

**FLAG — not ours to decide.** Which ΟΚΥπΥ AD group grants which eCapital role is an administrator's decision at deployment. The seeded rows are placeholders with fake object ids; nothing in this repository knows the real group names, and nothing in it should. Until those rows exist, every AD account signs in and sees nothing.

### `ldapts`, and why

`ldapts` is TypeScript-first, promise-based, actively released, and its `Client` is the entire API surface needed here — `bind`, `startTLS`, `search`, `unbind`. The alternative, `ldapjs`, is callback-based, has been effectively unmaintained since 2023, and ships its types separately. A dependency that sits on the authentication path is the last place to accept an unmaintained one.

**There is no service account.** The connection binds as the person signing in and searches with that same connection. eCapital therefore holds no credential that can read the directory on its own: one fewer secret on the server, and a search that can see no more than the user can.

### What the tests cover, and what they do not

The tests substitute a fake `Directory` at the port the API owns (`src/auth/directory.ts`). Everything the API does with a directory answer is exercised for real against a real PostgreSQL: the group→role mapping, the `app_user` upsert, the claims, the token, the guard that verifies it and the row policies underneath. The pure string work — UPN construction, filter escaping, `objectGUID` formatting — is unit-tested on its own.

**The LDAP conversation itself is not tested.** Standing up `ldapjs`'s server in-process and pointing `ldapts` at it would test `ldapts` against `ldapjs` and prove nothing about Active Directory, which is what the estate actually runs; AD's behaviour around referrals, `objectCategory`, paged results and `memberOf` is where the real surprises live, and none of them are reproduced by a second Node library.

So this has to be checked by hand, once, at deployment, and the deployment notes must say so:

1. A real user binds and `/me` shows the expected roles and units.
2. A wrong password answers 401 and nothing else.
3. `memberOf` comes back at all — in some AD configurations a restricted account cannot read its own group membership, in which case a service account becomes necessary after all and this ADR needs a successor.
4. The `objectGUID` printed in `app_user.subject` matches what `dsquery`/PowerShell shows for the same account.

## Production hardening (§5)

Four switches, all off by default, all of which the ΟΚΥπΥ server needs on:

- **`BIND_HOST`.** Set it to `127.0.0.1` and the API listens on the loopback only. Behind cloudflared nothing else should be able to reach it; the default stays every interface, which is what a developer wants.
- **`TRUST_PROXY=1`.** Express then reads `X-Forwarded-For` and `audit_log.ip` records the caller rather than the proxy. `clientIp()` no longer reads the header itself: it did, which trusted it on every deployment, including the ones where anybody can reach the port and write whatever address they like into the audit trail. One hop is trusted, not the whole chain a caller can prepend to.
- **The web session cookie carries `Secure` when `NEXT_PUBLIC_APP_ORIGIN` starts with `https`** — not when `NODE_ENV` is production. Behind cloudflared the Next process speaks plain HTTP while the browser is on HTTPS, so `NODE_ENV` answers the wrong question in both directions: `Secure` on a plain-HTTP developer origin means the cookie is silently never stored and nobody can sign in at all.
- **`DEV_AUTH` in production stops the boot**, unless `ALLOW_DEV_AUTH_IN_PRODUCTION=1`, and even then every boot logs an error saying anybody who can reach the API can mint a token for any seeded account. Refusing to start is louder than a warning in a log nobody reads, and it fails at deployment rather than at the first audit.

## Consequences

- eCapital signs people in with the same account as eMAP and eFinance, and nobody carries a second password for it.
- The stub and the OIDC path are both still there and still tested; this adds a third way in, it removes nothing.
- The API now writes to `app_user` on sign-in. That write runs over the migration connection with `app.user_id` set to the new subject, for the same reason `devTokenFor` does: there is no caller yet, and under the policy on `app_user` a session with no identity sees no users — correctly.
- Entra ID remains a real option. Moving to it is `AUTH_MODE=oidc`, four `OIDC_*` variables and replacing group DNs with object ids in `role_mapping` — a configuration change, not a rewrite.
