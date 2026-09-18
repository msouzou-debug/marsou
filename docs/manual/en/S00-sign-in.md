# Signing in

The sign-in screen identifies you and opens eCapital with the units that belong to you. On the SHSO server you are identified by your Entra ID account; in development you sign in as one of six sample users instead.

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
- **You see fewer units than you expected.** You see only the units you belong to. Ask the system administrator for access.
