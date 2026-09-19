# Signing in

The sign-in screen identifies you and opens eCapital with the units that belong to you. On the SHSO server you are identified by your Active Directory account — it asks for a username and a password, the same as eMAP and eFinance. In development you sign in as one of eight sample users, typing only an email address.

The screen shows one form or the other, never both. The steps below describe the development form; for signing in with a ΟΚΥπΥ account see "Signing in and what you can see" (M0-login).

## Steps

1. Open any eCapital page while signed out. The system brings you here and remembers the page you asked for.
2. Type your email address in the field.
3. Press "Sign in". While it works, the button reads "Signing in…".
4. Once you are in, the system takes you to the page you first asked for, or to the portfolio.
5. In development, click one of the sample accounts under the button to fill the field, then press "Sign in".
6. To sign out, press "Sign out" at the top right of any page.

## What can go wrong

- **"Development sign-in is off".** The API is running without `DEV_AUTH=1`, so it issues no development tokens. Start it with `DEV_AUTH=1`, or sign in with your SHSO account.
- **"No account has that address".** Check the address. If you are using a sample account, load the sample data with `pnpm --filter @ecapital/api seed`.
- **"The server did not answer".** The API is not listening on port 3001. Start it with `pnpm --filter @ecapital/api dev` and try again.
- **You land back on sign-in although you had signed in.** Your token expired. Development tokens last eight hours. Sign in again.
- **The screen asks for a username and password instead of an address.** The server is configured for Active Directory. Use your network account; the sample accounts do not exist there.
- **You see fewer units than you expected.** You see only the units you belong to. Ask the system administrator for access.
