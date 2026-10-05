"use client";

// S24 «Χρήστες» › «Κωδικός eCapital» — ADR-0030
//
/**
 * PasswordEditor — for an existing account, in `local` mode only: the
 * administrator types a password and sends it once. Self-contained, like
 * `ApproverScopesEditor`: it calls `PUT /admin/users/:id/password` on its
 * own, apart from the sheet's Save, so a typo in the roles does not resend a
 * password and a password does not wait on the roles.
 *
 * | Prop        | Type     | Notes                                                  |
 * |-------------|----------|--------------------------------------------------------|
 * | userId      | string   | An existing account only.                              |
 * | hasPassword | boolean? | From the API: a password exists, never what it is.     |
 *
 * RULE (ADR-0030): the password is in component state while typed and is
 * handed to the proxy once. Not kept, not shown back, not put anywhere a
 * later render could read it; the field is cleared the moment the API says
 * yes. `autoComplete="new-password"` keeps the browser from offering the
 * administrator's own.
 */
import { useState, type FormEvent } from "react";
import { useTranslations } from "next-intl";
import { LoaderCircle } from "lucide-react";
import { AdminUser as AdminUserSchema, PASSWORD_MIN_LENGTH } from "@ecapital/shared";
import { ApiError, apiMutate } from "@/data/client";

export interface PasswordEditorProps {
  userId: string;
  hasPassword?: boolean;
}

export function PasswordEditor({ userId, hasPassword }: PasswordEditorProps) {
  const t = useTranslations("screens.s24users.password");
  const [password, setPassword] = useState("");
  const [saving, setSaving] = useState(false);
  const [isSet, setIsSet] = useState(Boolean(hasPassword));
  const [message, setMessage] = useState<{ kind: "ok" | "error"; text: string } | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setMessage(null);
    if (password.length < PASSWORD_MIN_LENGTH) {
      setMessage({ kind: "error", text: t("tooShort") });
      return;
    }
    setSaving(true);
    try {
      await apiMutate(
        `/admin/users/${encodeURIComponent(userId)}/password`,
        "PUT",
        { password },
        AdminUserSchema,
      );
      setPassword("");
      setIsSet(true);
      setMessage({ kind: "ok", text: t("saved") });
    } catch (error) {
      setMessage({ kind: "error", text: error instanceof ApiError ? error.message : String(error) });
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="flex flex-col gap-s-2 border-t border-k-grey pt-s-4" aria-labelledby="us-password-title">
      <h3 id="us-password-title" className="text-fs-16 text-k-ink">
        {t("title")}
      </h3>
      <p className="text-fs-14 text-k-text">{isSet ? t("isSet") : t("notSet")}</p>
      <p className="text-fs-14 text-k-text">{t("hint")}</p>
      <form onSubmit={(event) => void submit(event)} className="flex flex-col gap-s-2">
        <label htmlFor="us-password" className="text-fs-14 text-k-text">
          {t("label")}
        </label>
        <input
          id="us-password"
          type="password"
          autoComplete="new-password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          className="h-11 rounded-k border border-k-grey bg-k-white px-s-3 text-fs-16 text-k-ink"
        />
        {message && (
          <p role={message.kind === "error" ? "alert" : "status"} className={`text-fs-14 ${message.kind === "error" ? "text-k-red" : "text-k-text"}`}>
            {message.text}
          </p>
        )}
        <div>
          <button
            type="submit"
            disabled={saving}
            className="flex h-11 items-center justify-center gap-s-2 rounded-k border border-k-blue px-s-5 text-fs-14 text-k-blue disabled:opacity-60"
          >
            {saving && <LoaderCircle size={20} strokeWidth={1.5} aria-hidden="true" className="animate-spin" />}
            {t("set")}
          </button>
        </div>
      </form>
    </section>
  );
}
