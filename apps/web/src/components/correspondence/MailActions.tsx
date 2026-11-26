"use client";

/**
 * The two ways a record leaves for the recipient's inbox — eCapital itself
 * sends nothing (owner decision 25/11/2026):
 *
 * - `SaveButtons` (the new form, owner request 26/11/2026): «Αποθήκευση»,
 *   and «Αποθήκευση και αποστολή e-mail», which saves, records today as the
 *   sent day and downloads an Outlook draft (.eml) with the files attached.
 *   Without a recipient e-mail the second is disabled and the reason is
 *   written under it, not only in a tooltip.
 * - `MailtoPanel` (the read view, owner UAT 25/11/2026): «Αποστολή με
 *   e-mail», a `mailto:` link that opens Outlook with the message written;
 *   once opened, the panel reminds the user to record the day it left — one
 *   click sets it to today — and to file the sent message.
 *
 * SaveButtons
 * | Prop          | Type        | Notes                                                      |
 * |---------------|-------------|-------------------------------------------------------------|
 * | saving        | boolean     |                                                             |
 * | canSendMail   | boolean     | Omitted (no contract facts to write the message), only «Αποθήκευση». |
 * | hasRecipient  | boolean     | A recipient e-mail is filled in.                            |
 * | onSaveAndSend | () => void  | The form's validated submit, with «send» set.               |
 * | idPrefix      | string      |                                                             |
 *
 * MailtoPanel
 * | Prop        | Type                  | Notes                                                   |
 * |-------------|-----------------------|----------------------------------------------------------|
 * | href        | string?               | The `mailto:`; undefined when there is no recipient e-mail. |
 * | canMarkSent | boolean               | «Ημερομηνία αποστολής σήμερα» is offered after opening.   |
 * | onMarkSent  | () => Promise<void>   |                                                          |
 * | saving      | boolean               |                                                          |
 * | today       | string                | yyyy-mm-dd, said as dd/mm/yyyy.                          |
 * | idPrefix    | string                |                                                          |
 * | onOpened    | () => void?           | When the link is followed.                               |
 */
import { useState } from "react";
import { useTranslations } from "next-intl";
import { LoaderCircle, Mail } from "lucide-react";
import { formatDate } from "@/lib/format";

export interface SaveButtonsProps {
  idPrefix: string;
  saving: boolean;
  canSendMail: boolean;
  hasRecipient: boolean;
  onSaveAndSend: () => void;
}

export function SaveButtons({ idPrefix, saving, canSendMail, hasRecipient, onSaveAndSend }: SaveButtonsProps) {
  const t = useTranslations("components.correspondence.mail");
  const tb = useTranslations("buttons");
  const hintId = `${idPrefix}-send-hint`;
  return (
    <div className="mt-s-2 grid gap-s-2">
      <div className="flex flex-wrap items-center gap-s-3">
        <button
          type="submit"
          disabled={saving}
          className="flex h-11 w-fit items-center justify-center gap-s-2 rounded-k bg-k-blue px-s-5 text-fs-14 font-bold text-k-white shadow-k disabled:opacity-60"
        >
          {saving && <LoaderCircle size={20} strokeWidth={1.5} aria-hidden="true" className="animate-spin" />}
          {tb("save")}
        </button>
        {canSendMail && (
          <button
            type="button"
            onClick={onSaveAndSend}
            disabled={saving || !hasRecipient}
            aria-describedby={hintId}
            className="flex h-11 w-fit items-center justify-center gap-s-2 rounded-k border border-k-grey px-s-5 text-fs-14 font-bold text-k-blue-deep disabled:text-k-text-muted disabled:opacity-60"
          >
            <Mail size={20} strokeWidth={1.5} aria-hidden="true" />
            {t("saveAndSend")}
          </button>
        )}
      </div>
      {canSendMail && (
        <p id={hintId} className="text-fs-14 text-k-text">
          {hasRecipient ? t("saveAndSendHint") : t("saveAndSendNoRecipient")}
        </p>
      )}
    </div>
  );
}

export interface MailtoPanelProps {
  idPrefix: string;
  href?: string;
  canMarkSent: boolean;
  onMarkSent: () => Promise<boolean>;
  saving: boolean;
  today: string;
  onOpened?: () => void;
}

export function MailtoPanel({ idPrefix, href, canMarkSent, onMarkSent, saving, today, onOpened }: MailtoPanelProps) {
  const t = useTranslations("components.correspondence.mail");
  const [opened, setOpened] = useState(false);
  const hintId = `${idPrefix}-mail-hint`;
  return (
    <div className="mt-s-4 grid gap-s-2">
      {href ? (
        <a
          href={href}
          onClick={() => {
            onOpened?.();
            setOpened(true);
          }}
          aria-describedby={hintId}
          className="flex h-11 w-fit items-center gap-s-2 rounded-k border border-k-grey px-s-5 text-fs-14 font-bold text-k-blue-deep"
        >
          <Mail size={20} strokeWidth={1.5} aria-hidden="true" />
          {t("button")}
        </a>
      ) : (
        <button
          type="button"
          disabled
          aria-describedby={hintId}
          className="flex h-11 w-fit items-center gap-s-2 rounded-k border border-k-grey px-s-5 text-fs-14 font-bold text-k-text-muted"
        >
          <Mail size={20} strokeWidth={1.5} aria-hidden="true" />
          {t("button")}
        </button>
      )}
      <p id={hintId} className="text-fs-14 text-k-text">
        {href ? t("hint") : t("noRecipient")}
      </p>
      {opened && (
        <div role="status" className="grid gap-s-2 rounded-k border border-k-grey bg-k-surface p-s-3 text-fs-14 text-k-ink">
          <p>{t("afterOpen")}</p>
          {canMarkSent && (
            <button
              type="button"
              onClick={() => {
                void onMarkSent().then((saved) => {
                  if (saved) setOpened(false);
                });
              }}
              disabled={saving}
              className="h-11 w-fit rounded-k bg-k-blue px-s-5 text-fs-14 font-bold text-k-white shadow-k disabled:opacity-60"
            >
              {t("setSentToday", { date: formatDate(today) })}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
