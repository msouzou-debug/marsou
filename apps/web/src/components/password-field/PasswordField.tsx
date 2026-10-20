"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Eye, EyeOff } from "lucide-react";

/**
 * PasswordField — a password input with an eye button that shows what was
 * typed (owner request, 20/10/2026).
 *
 * | Prop         | Type                     | Notes                                               |
 * |--------------|--------------------------|-----------------------------------------------------|
 * | id           | string                   | Pairs the input with its `<label htmlFor>`.         |
 * | name         | string?                  | Form field name.                                    |
 * | autoComplete | string                   | `current-password` on sign-in, `new-password` else. |
 * | value        | string                   | Controlled value.                                   |
 * | onChange     | (value: string) => void  | Called with the new text.                           |
 * | className    | string                   | The input's own classes; the wrapper adds the pad.  |
 *
 * RULE: the eye never changes what is submitted. It only flips the input's
 * `type` between `password` and `text`, on the page, for the person typing.
 * It starts hidden on every mount and is not remembered.
 *
 * Hidden by default, so the browser's own treatment (no autocorrect, masked
 * echo, password-manager fill) is what a screen reader and a password
 * manager meet first.
 */
export interface PasswordFieldProps {
  id: string;
  name?: string;
  autoComplete: "current-password" | "new-password";
  value: string;
  onChange: (value: string) => void;
  className: string;
}

export function PasswordField({ id, name, autoComplete, value, onChange, className }: PasswordFieldProps) {
  const t = useTranslations("components.passwordField");
  const [shown, setShown] = useState(false);
  return (
    <div className="relative flex">
      <input
        id={id}
        name={name}
        type={shown ? "text" : "password"}
        autoComplete={autoComplete}
        autoCapitalize="none"
        spellCheck={false}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className={`${className} w-full pr-11`}
      />
      <button
        type="button"
        aria-label={shown ? t("hide") : t("show")}
        aria-pressed={shown}
        aria-controls={id}
        onClick={() => setShown((s) => !s)}
        className="absolute inset-y-0 right-0 flex w-11 items-center justify-center text-k-text"
      >
        {shown ? <EyeOff className="h-5 w-5" aria-hidden="true" /> : <Eye className="h-5 w-5" aria-hidden="true" />}
      </button>
    </div>
  );
}
