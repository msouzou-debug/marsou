"use client";

// S24 «Χρήστες» — R01, R02, R42 (ADR-0020)
//
/**
 * UserSheet — the right sheet for pre-registering an account or changing the
 * roles, units and status of one that exists.
 *
 * | Prop        | Type                   | Notes                                                                 |
 * |-------------|------------------------|-----------------------------------------------------------------------|
 * | open        | boolean                |                                                                       |
 * | user        | AdminUser?             | Omit for «Προσθήκη»; pass the row for an edit.                        |
 * | catalogue   | RoleCatalogueEntry[]   | The eight roles and their scope, from `GET /admin/roles`. The screen does not hardcode which roles carry units. |
 * | orgUnits    | OrgUnit[]              | Everything the caller may see, which for an administrator is all of them. |
 * | saving      | boolean                |                                                                       |
 * | apiError    | string?                | The API's own sentence for `errors.selfLockout`, `errors.lastAdmin`, `errors.auditorProtected` and `errors.unitRequired`, shown inline. |
 * | onClose     | () => void             |                                                                       |
 * | onSave      | (values) => void       |                                                                       |
 *
 * Three rules are visible in the markup and marked `// RULE` below: the
 * auditor checkbox is switched off with a title saying where the role does
 * come from, the unit list is switched off when every ticked role reaches all
 * units, and switching an account off asks first.
 *
 * States: default only. The sheet is handed its data; loading, error and
 * empty belong to the screen around it.
 */
import { useState, type FormEvent } from "react";
import { useTranslations } from "next-intl";
import { LoaderCircle, X } from "lucide-react";
import type { AdminUser, AppRole, OrgUnit, RoleCatalogueEntry } from "@ecapital/shared";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { coversAllUnits, needsAUnit, type UserFormValues } from "./schema";

export interface UserSheetProps {
  open: boolean;
  user?: AdminUser;
  catalogue: RoleCatalogueEntry[];
  orgUnits: OrgUnit[];
  saving?: boolean;
  apiError?: string;
  onClose: () => void;
  onSave: (values: UserFormValues) => void;
}

export function UserSheet({
  open,
  user,
  catalogue,
  orgUnits,
  saving = false,
  apiError,
  onClose,
  onSave,
}: UserSheetProps) {
  const t = useTranslations();
  const ts = useTranslations("screens.s24users");
  const tf = useTranslations("screens.s24users.fields");

  const [name, setName] = useState(user?.name ?? "");
  const [username, setUsername] = useState(user?.username ?? "");
  const [email, setEmail] = useState(user?.email ?? "");
  const [roles, setRoles] = useState<AppRole[]>(user?.roles ?? []);
  const [orgUnitIds, setOrgUnitIds] = useState<string[]>(user?.orgUnitIds ?? []);
  const [active, setActive] = useState(user?.active ?? true);
  const [confirming, setConfirming] = useState(false);
  const [unitError, setUnitError] = useState(false);

  if (!open) return null;

  const allUnits = coversAllUnits(catalogue, roles);
  const unitRequired = needsAUnit(catalogue, roles);

  function toggleRole(role: AppRole, checked: boolean) {
    setUnitError(false);
    setRoles((current) => (checked ? [...current, role] : current.filter((r) => r !== role)));
  }

  function values(): UserFormValues {
    return { name, username, email, roles, orgUnitIds, active };
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    if (unitRequired && orgUnitIds.length === 0) {
      setUnitError(true);
      return;
    }
    // RULE (ADR-0020): switching an account off stops somebody working, so
    // it is confirmed by name before it is sent — the one destructive thing
    // this sheet can do.
    if (user && user.active && !active) {
      setConfirming(true);
      return;
    }
    onSave(values());
  }

  return (
    <div
      role="dialog"
      aria-label={user ? ts("titleEdit") : ts("titleNew")}
      className="fixed inset-0 desktop:inset-y-0 desktop:left-auto desktop:right-0 desktop:w-[480px] flex flex-col bg-k-white shadow-k"
    >
      <header className="flex items-start justify-between border-b border-k-grey p-s-5">
        <h2 className="text-fs-20">{user ? ts("titleEdit") : ts("titleNew")}</h2>
        <button
          type="button"
          onClick={onClose}
          aria-label={t("common.close")}
          className="rounded-k p-s-2 text-k-text hover:bg-k-surface"
        >
          <X size={20} strokeWidth={1.5} aria-hidden="true" />
        </button>
      </header>

      <div className="flex-1 overflow-auto p-s-5">
        <form onSubmit={submit} className="flex flex-col gap-s-4">
          {!user && <p className="text-fs-14 text-k-text">{ts("newHint")}</p>}

          <div className="flex flex-col gap-s-1">
            <label htmlFor="us-username" className="text-fs-14 text-k-text">
              {tf("username")}
            </label>
            <input
              id="us-username"
              type="text"
              value={username}
              readOnly={Boolean(user)}
              onChange={(event) => setUsername(event.target.value)}
              className="num h-11 rounded-k border border-k-grey bg-k-white px-s-3 text-fs-16 text-k-ink read-only:bg-k-surface"
            />
          </div>

          <div className="flex flex-col gap-s-1">
            <label htmlFor="us-name" className="text-fs-14 text-k-text">
              {tf("name")}
            </label>
            <input
              id="us-name"
              type="text"
              value={name}
              onChange={(event) => setName(event.target.value)}
              className="h-11 rounded-k border border-k-grey bg-k-white px-s-3 text-fs-16 text-k-ink"
            />
          </div>

          <div className="flex flex-col gap-s-1">
            <label htmlFor="us-email" className="text-fs-14 text-k-text">
              {tf("email")}
            </label>
            <input
              id="us-email"
              type="email"
              value={email}
              readOnly={Boolean(user)}
              onChange={(event) => setEmail(event.target.value)}
              className="h-11 rounded-k border border-k-grey bg-k-white px-s-3 text-fs-16 text-k-ink read-only:bg-k-surface"
            />
          </div>

          {user && (
            <p className="text-fs-14 text-k-text">
              {tf("source")}: {ts(`sources.${user.authSource}`)}
            </p>
          )}

          <fieldset className="flex flex-col gap-s-2">
            <legend className="mb-s-1 text-fs-14 text-k-text">{tf("roles")}</legend>
            {catalogue.map((entry) => {
              // RULE (CAPEX-01 §10, ADR-0020): the auditor "cannot be edited
              // by admin". The checkbox is shown so the role is visible where
              // somebody holds it, and it is switched off with a title saying
              // where it does come from — the server, not this screen.
              const locked = entry.role === "auditor_readonly";
              return (
                <label
                  key={entry.role}
                  className="flex min-h-[44px] items-center gap-s-3 text-fs-16 text-k-ink"
                  title={locked ? ts("auditorLocked") : undefined}
                >
                  <input
                    type="checkbox"
                    checked={roles.includes(entry.role)}
                    disabled={locked}
                    onChange={(event) => toggleRole(entry.role, event.target.checked)}
                  />
                  {t(`roles.${entry.role}`)}
                </label>
              );
            })}
            {roles.includes("auditor_readonly") && (
              <p className="text-fs-14 text-k-text">{ts("auditorLocked")}</p>
            )}
          </fieldset>

          <div className="flex flex-col gap-s-1">
            <label htmlFor="us-units" className="text-fs-14 text-k-text">
              {tf("units")}
            </label>
            {/* RULE (ADR-0020): roles that reach every unit ignore this list,
                so it is switched off rather than left to collect a choice the
                API would throw away. */}
            <select
              id="us-units"
              multiple
              size={6}
              disabled={allUnits}
              value={orgUnitIds}
              onChange={(event) => {
                setUnitError(false);
                setOrgUnitIds(Array.from(event.target.selectedOptions).map((option) => option.value));
              }}
              className="rounded-k border border-k-grey bg-k-white px-s-3 py-s-2 text-fs-16 text-k-ink disabled:bg-k-surface disabled:text-k-text"
            >
              {orgUnits.map((unit) => (
                <option key={unit.id} value={unit.id}>
                  {unit.code} — {unit.nameEl}
                </option>
              ))}
            </select>
            <p className="text-fs-14 text-k-text">
              {allUnits ? ts("unitsAllHint") : ts("unitsHint")}
            </p>
            {unitError && (
              <p role="alert" className="text-fs-14 text-k-red">
                {ts("unitsHint")}
              </p>
            )}
          </div>

          {user && (
            <label className="flex min-h-[44px] items-center gap-s-3 text-fs-16 text-k-ink">
              <input
                type="checkbox"
                checked={active}
                onChange={(event) => setActive(event.target.checked)}
              />
              {tf("active")}
            </label>
          )}

          {apiError && (
            <p role="alert" className="rounded-k border border-k-red bg-k-white p-s-3 text-fs-14 text-k-red">
              {apiError}
            </p>
          )}

          <div className="mt-s-2 flex items-center gap-s-3">
            <button
              type="submit"
              disabled={saving}
              className="flex h-11 items-center justify-center gap-s-2 rounded-k bg-k-blue px-s-5 text-fs-14 font-bold text-k-white shadow-k disabled:opacity-60"
            >
              {saving && <LoaderCircle size={20} strokeWidth={1.5} aria-hidden="true" className="animate-spin" />}
              {t("buttons.save")}
            </button>
            <button
              type="button"
              onClick={onClose}
              disabled={saving}
              className="h-11 rounded-k px-s-5 text-fs-14 text-k-text disabled:opacity-60"
            >
              {t("buttons.cancel")}
            </button>
          </div>
        </form>
      </div>

      <ConfirmDialog
        open={confirming}
        title={ts("deactivateTitle", { name: user?.name ?? "" })}
        consequence={ts("deactivateConsequence")}
        destructiveLabel={ts("deactivateConfirm")}
        onCancel={() => setConfirming(false)}
        onConfirm={() => {
          setConfirming(false);
          onSave(values());
        }}
      />
    </div>
  );
}
