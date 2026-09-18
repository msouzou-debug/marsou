"use client";

// S00 — R01

/**
 * SignInForm — the one interactive piece of S00 (UI instructions §5, §6).
 *
 * | Prop         | Type      | Notes                                                          |
 * |--------------|-----------|-----------------------------------------------------------------|
 * | next         | string?   | where to go after signing in; the gate puts the path here       |
 * | showDevAccounts | boolean | render the seeded accounts (NEXT_PUBLIC_DEV_AUTH=1 only)        |
 *
 * States: default, loading (the button, under 300ms of network, so a spinner
 * inside the button rather than a skeleton) and error. Empty, no-permission
 * and offline do not apply — the screen has nothing to list, anybody may open
 * it, and it cannot do its job without the network, which is the error state.
 *
 * The token never comes back here. `signIn` is a server action: it calls the
 * API, puts the token in an httpOnly cookie and redirects, so the browser
 * holds nothing but the email that was typed (ADR-0013).
 */

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { LoaderCircle } from "lucide-react";
import { signIn } from "@/auth/actions";
import type { SignInError } from "@/auth/session";
import { DEV_ACCOUNTS } from "./dev-accounts";

export interface SignInFormProps {
  next?: string;
  showDevAccounts: boolean;
}

export function SignInForm({ next, showDevAccounts }: SignInFormProps) {
  const t = useTranslations("screens.s00");
  const tb = useTranslations("buttons");
  const tHelp = useTranslations("help.roles");
  const [email, setEmail] = useState("");
  const [error, setError] = useState<SignInError | null>(null);
  const [pending, startTransition] = useTransition();

  function submit(address: string) {
    setError(null);
    startTransition(async () => {
      const result = await signIn(address, next);
      if (result?.error) setError(result.error);
    });
  }

  return (
    <>
      <form
        className="mt-s-6 flex flex-col gap-s-4"
        onSubmit={(event) => {
          event.preventDefault();
          submit(email);
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
            className="h-11 rounded-k border border-k-grey bg-k-white px-s-3 text-fs-16 text-k-text"
          />
        </div>

        {error ? (
          // UI instructions §6: what happened and what to do, no code.
          <p role="alert" className="text-fs-14 text-k-red">
            {t(`errors.${error}`)}
          </p>
        ) : null}

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
