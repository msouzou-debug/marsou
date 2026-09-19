# Signing in and what you can see

The sign-in page identifies you through your ΟΚΥπΥ account and shows you only the units you belong to. On the ΟΚΥπΥ server that means your Active Directory account — see the second section below. In development, where there is no directory, you sign in as one of eight sample users instead.

## Steps

1. Start the API with `pnpm --filter @ecapital/api dev`. It listens on port 3001.
2. Ask for a development token for one of the accounts:
   `curl -s localhost:3001/auth/dev-token -H 'content-type: application/json' -d '{"email":"estates.nicosia@ecapital.test"}'`
3. Copy the `token` value out of the reply.
4. Call `GET /me` with it:
   `curl -s localhost:3001/me -H "authorization: Bearer <token>"`. The reply gives your name, your roles and your units.
5. Read your unit's area tree:
   `curl -s localhost:3001/org-units/nicosia-general/areas -H "authorization: Bearer <token>"`.

The eight accounts: `admin@ecapital.test` (administrator, all units), `estates.nicosia@ecapital.test` (head of estates, Nicosia), `engineer.larnaca@ecapital.test` (project engineer, Larnaca), `clinical.nicosia@ecapital.test` (clinical approver, Nicosia), `finance@ecapital.test` (finance, all units), `auditor@ecapital.test` (auditor, all units, read-only), `executive@ecapital.test` (management, all units, read-only), `technician.nicosia@ecapital.test` (technician, Nicosia, field records only).

## What can go wrong

- **The reply says you are not signed in.** The token is missing, expired, or signed with a different key. Get a new one from step 2; development tokens last eight hours.
- **No user has that address.** The sample data has not been loaded. Run `pnpm --filter @ecapital/api migrate`, then `pnpm --filter @ecapital/api seed`.
- **A unit comes back as not found.** You have no access to it. That is the correct answer: you see your own units and nothing else. Sign in as `admin@ecapital.test` to see all twelve.
- **An entry is refused because the account only reads.** The auditor and management accounts cannot change anything. Use an account with write access.
- **A change to the approved budget is refused.** Once a project is approved, only the finance account may change that figure. Sign in as `finance@ecapital.test`, or ask finance to record the change.
- **The API will not start and names an environment variable.** Copy `apps/api/.env.example` to `apps/api/.env` and fill in the variable the message names.

## Signing in with your ΟΚΥπΥ account (Active Directory)

On the ΟΚΥπΥ server you sign in with the same account you use for eMAP and eFinance — your `ihcis.local` network account. The sign-in screen asks for a username and a password, and shows no sample accounts.

1. Type your username the way you type it on your own computer (`apapadopoulos`). The full form, `apapadopoulos@ihcis.local`, works too.
2. Type your password. It is your network password; eCapital keeps no copy of it and cannot change it.
3. Press Sign in. The session lasts eight hours.

Your roles and your units come from the Active Directory groups you belong to. Which group grants which role is set by the system administrator inside eCapital, and does not change with a new release.

## What can go wrong signing in with a ΟΚΥπΥ account

- **"That username or password is not right."** You get the same sentence for an account that does not exist and for a password that is wrong, on purpose. Check you are typing your username and not your email address, and that Caps Lock is off. If your network password has expired or the account is locked, sort that out on your own computer first and then come back.
- **You get in but see nothing.** Your account is not yet in any group that maps to an eCapital role. Nothing is broken: the sign-in worked and the role is missing. Ask the administrator to add your AD group to eCapital's roles.
- **"Signing in with a ΟΚΥπΥ account is not switched on for this server."** The server has not been configured for Active Directory. Ask the administrator to check `AUTH_MODE`, `LDAP_URL`, `LDAP_BASE_DN` and `LDAP_DOMAIN`.
- **"The server did not answer."** eCapital could not reach the directory. That is a network or configuration problem, not your password.
