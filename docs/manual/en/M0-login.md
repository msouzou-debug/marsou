# Signing in and what you can see

The sign-in page identifies you through your ΟΚΥπΥ account and shows you only the units you belong to. In development, where there is no Entra ID tenant, you sign in as one of seven sample users instead.

## Steps

1. Start the API with `pnpm --filter @ecapital/api dev`. It listens on port 3001.
2. Ask for a development token for one of the accounts:
   `curl -s localhost:3001/auth/dev-token -H 'content-type: application/json' -d '{"email":"estates.nicosia@ecapital.test"}'`
3. Copy the `token` value out of the reply.
4. Call `GET /me` with it:
   `curl -s localhost:3001/me -H "authorization: Bearer <token>"`. The reply gives your name, your roles and your units.
5. Read your unit's area tree:
   `curl -s localhost:3001/org-units/nicosia-general/areas -H "authorization: Bearer <token>"`.

The seven accounts: `admin@ecapital.test` (administrator, all units), `estates.nicosia@ecapital.test` (head of estates, Nicosia), `engineer.larnaca@ecapital.test` (project engineer, Larnaca), `clinical.nicosia@ecapital.test` (clinical approver, Nicosia), `finance@ecapital.test` (finance, all units), `auditor@ecapital.test` (auditor, all units, read-only), `executive@ecapital.test` (management, all units, read-only).

## What can go wrong

- **The reply says you are not signed in.** The token is missing, expired, or signed with a different key. Get a new one from step 2; development tokens last eight hours.
- **No user has that address.** The sample data has not been loaded. Run `pnpm --filter @ecapital/api migrate`, then `pnpm --filter @ecapital/api seed`.
- **A unit comes back as not found.** You have no access to it. That is the correct answer: you see your own units and nothing else. Sign in as `admin@ecapital.test` to see all eleven.
- **An entry is refused because the account only reads.** The auditor and management accounts cannot change anything. Use an account with write access.
- **A change to the approved budget is refused.** Once a project is approved, only the finance account may change that figure. Sign in as `finance@ecapital.test`, or ask finance to record the change.
- **The API will not start and names an environment variable.** Copy `apps/api/.env.example` to `apps/api/.env` and fill in the variable the message names.
