"use client";

// S00 — R01, R43

/**
 * SignInForm — the one interactive piece of S00 (UI instructions §5, §6).
 *
 * | Prop            | Type      | Notes                                                           |
 * |-----------------|-----------|------------------------------------------------------------------|
 * | next            | string?   | where to go after signing in; the gate puts the path here        |
 * | mode            | AuthMode  | which way in this deployment uses (ADR-0018): `dev`, `ldap`, `oidc` |
 * | showDevAccounts | boolean   | render the seeded accounts (`dev` mode with NEXT_PUBLIC_DEV_AUTH=1) |
 *
 * States: default, loading (the button, under 300ms of network, so a spinner
 * inside the button rather than a skeleton) and error. Empty, no-permission
 * and offline do not apply — the screen has nothing to list, anybody may open
 * it, and it cannot do its job without the network, which is the error state.
 *
 * The token never comes back here. `signIn` is a server action: it calls the
 * API, puts the token in an httpOnly cookie and redirects, so the browser
 * holds nothing but what was typed into the fields (ADR-0013).
 *
 * RULE (ADR-0018): in `ldap` mode the password is in component state for as
 * long as the form is on screen and is handed to the server action once. It
 * is never written to storage, never put in the URL and never logged; the
 * field is `type="password"` with `autoComplete="current-password"` so the
 * browser treats it as one.
 */

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { LoaderCircle } from "lucide-react";
import type { AuthMode } from "@ecapital/shared";
import { signIn } from "@/auth/actions";
import type { SignInError } from "@/auth/session";
import { DEV_ACCOUNTS } from "./dev-accounts";

export interface SignInFormProps {
  next?: string;
  mode: AuthMode;
  showDevAccounts: boolean;
}

const FIELD =
  "h-11 rounded-k border border-k-grey bg-k-white px-s-3 text-fs-16 text-k-text";

export function SignInForm({ next, mode, showDevAccounts }: SignInFormProps) {
  const t = useTranslations("screens.s00");
  const tb = useTranslations("buttons");
  const tHelp = useTranslations("help.roles");
  const [email, setEmail] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<SignInError | null>(null);
  const [pending, startTransition] = useTransition();

  function run(action: () => Promise<{ error: SignInError } | undefined>) {
    setError(null);
    startTransition(async () => {
      const result = await action();
      if (result?.error) setError(result.error);
    });
  }

  const problem = error ? (
    // UI instructions §6: what happened and what to do, no code.
    <p role="alert" className="text-fs-14 text-k-red">
      {t(`errors.${error}`)}
    </p>
  ) : null;

  const button = (
    <button
      type="submit"
      disabled={pending}
      className="flex h-11 items-center justify-center gap-s-2 rounded-k bg-k-blue px-s-4 text-fs-16 text-k-white disabled:opacity-60"
    >
      {pending ? (
        <LoaderCircle size={24} strokeWidth={1.5} aria-hidden="true" className="animate-spin" />
      ) : null}
      <span>{pending ? t("signingIn") : tb("signIn")}</span>
    </button>
  );

  // ------------------------------------------------------------ ldap --
  if (mode === "ldap") {
    return (
      <form
        className="mt-s-6 flex flex-col gap-s-4"
        onSubmit={(event) => {
          event.preventDefault();
          run(() => signIn(username, next, password));
        }}
      >
        <p className="text-fs-14 text-k-text">{t("ldapHint")}</p>

        <div className="flex flex-col gap-s-2">
          <label htmlFor="sign-in-username" className="text-fs-14 text-k-text">
            {t("usernameLabel")}
          </label>
          <input
            id="sign-in-username"
            name="username"
            type="text"
            autoComplete="username"
            autoCapitalize="none"
            spellCheck={false}
            placeholder={t("usernamePlaceholder")}
            value={username}
            onChange={(event) => setUsername(event.target.value)}
            className={FIELD}
          />
        </div>

        <div className="flex flex-col gap-s-2">
          <label htmlFor="sign-in-password" className="text-fs-14 text-k-text">
            {t("passwordLabel")}
          </label>
          <input
            id="sign-in-password"
            name="password"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            className={FIELD}
          />
        </div>

        {problem}
        {button}
      </form>
    );
  }

  // ------------------------------------------------------------ oidc --
  if (mode === "oidc") {
    return (
      <div className="mt-s-6 flex flex-col gap-s-4">
        <p className="text-fs-14 text-k-text">{t("oidcHint")}</p>
        <button
          type="button"
          // TODO (ADR-0009): wire this to the Entra ID authorisation redirect
          // and its callback route when a tenant exists to redirect to. The
          // ΟΚΥπΥ estate signs in against Active Directory today (ADR-0018),
          // so nothing on the server runs this path and there is nothing to
          // point it at yet. Disabled rather than dead: a button that looks
          // live and does nothing is worse than one that says it is not ready.
          disabled
          className="flex h-11 items-center justify-center rounded-k bg-k-blue px-s-4 text-fs-16 text-k-white disabled:opacity-60"
        >
          {t("oidcButton")}
        </button>
      </div>
    );
  }

  // ------------------------------------------------------------- dev --
  return (
    <>
      <form
        className="mt-s-6 flex flex-col gap-s-4"
        onSubmit={(event) => {
          event.preventDefault();
          run(() => signIn(email, next));
        }}
      >
        <div className="flex flex-col gap-s-2">
          <label htmlFor="sign-in-email" className="text-fs-14 text-k-text">
            {t("emailLabel")}
          </label>
          <input
            id="sign-in-email"
            name="email"
            type="email"
            autoComplete="username"
            inputMode="email"
            placeholder={t("emailPlaceholder")}
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            className={FIELD}
          />
        </div>

        {problem}
        {button}
      </form>

      {showDevAccounts ? (
        <section className="mt-s-8 border-t border-k-grey pt-s-4">
          <h2 className="text-fs-14 text-k-text">{t("devTitle")}</h2>
          <p className="mt-s-1 text-fs-14 text-k-text-muted">{t("devHint")}</p>
          <ul className="mt-s-3 flex flex-col gap-s-2">
            {DEV_ACCOUNTS.map((account) => (
              <li key={account.email} className="flex flex-wrap items-baseline gap-s-2">
                <button
                  type="button"
                  onClick={() => {
                    setEmail(account.email);
                    setError(null);
                  }}
                  className="text-fs-14 text-k-blue underline-offset-2 hover:underline"
                >
                  {account.email}
                </button>
                <span className="text-fs-14 text-k-text-muted">{tHelp(account.roleKey)}</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </>
  );
}
