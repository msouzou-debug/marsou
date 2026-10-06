"use client";

// S24r «Ρόλοι και δικαιώματα» — R01, R42 (CAPEX-01 §10, ADR-0010, ADR-0020)
//
/**
 * RolesMatrix — what each of the eight roles sees and does, area by area.
 *
 * | Prop         | Type                          | Notes                                                        |
 * |--------------|-------------------------------|--------------------------------------------------------------|
 * | state        | "default" \| "noPermission"   | The page decides who may open it; the data is static.        |
 * | noPermission | ReactNode                     | Drawn in the `noPermission` state.                           |
 * | onPrint      | () => void?                   | Defaults to `window.print()`.                                |
 * | highlighted  | AppRole?                      | Initial highlighted column; the header buttons change it.    |
 *
 * The data is `ROLE_MATRIX`, `MATRIX_UNITS` and `ROLE_NOTES` from
 * `@ecapital/shared`, checked against the screens' own role helpers by
 * `src/auth/role-matrix.test.ts`. Nothing is fetched, so loading, empty,
 * error and offline do not arise.
 *
 * Desktop and tablet from 1024px: one table, the roles as columns and the
 * areas as grouped rows. Below 1024px: one card per role. Print: the
 * legend and the table on landscape A4 (`printCss`, shared with S23a).
 *
 * RULE (UI instructions §4): a level is never colour alone — every chip
 * carries an icon of its own and a word, and a border, so the table reads
 * the same in greyscale and on paper.
 */
import { Fragment, useState, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import { Check, Cog, Eye, Pencil, Printer } from "lucide-react";
import {
  MATRIX_GROUPS,
  MATRIX_ROLES,
  MATRIX_UNITS,
  ROLE_MATRIX,
  ROLE_NOTES,
  GENERAL_NOTES,
  type AccessLevel,
  type AppRole,
  type MatrixArea,
} from "@ecapital/shared";
import { PageTitle } from "@/components/app-shell";
import { printCss } from "@/screens/s23-reports/catalogue";

export type RolesMatrixState = "default" | "noPermission";

export interface RolesMatrixProps {
  state: RolesMatrixState;
  noPermission: ReactNode;
  onPrint?: () => void;
  highlighted?: AppRole;
}

const P = "screens.s24roles";

/** The legend's order: the most a role can have first. */
const LEVELS: AccessLevel[] = ["MANAGE", "APPROVE", "WRITE", "READ", "NONE"];

const CHIP: Record<Exclude<AccessLevel, "NONE">, { icon: typeof Check; className: string }> = {
  MANAGE: { icon: Cog, className: "border-k-blue-deep bg-k-blue-deep text-k-white" },
  APPROVE: { icon: Check, className: "border-k-green bg-k-green text-k-ink" },
  WRITE: { icon: Pencil, className: "border-k-blue bg-k-blue-bg text-k-ink" },
  READ: { icon: Eye, className: "border-k-text-muted bg-k-grey text-k-ink" },
};

/** One level as a small chip: icon, word, border, colour. */
export function LevelChip({ level }: { level: AccessLevel }) {
  const t = useTranslations(`${P}.levels`);
  if (level === "NONE") {
    return (
      <span data-level="NONE" className="inline-flex items-center px-s-2 text-fs-14 text-k-text">
        <span aria-hidden="true">{t("NONE.chip")}</span>
        <span className="sr-only">{t("NONE.name")}</span>
      </span>
    );
  }
  const { icon: Icon, className } = CHIP[level];
  return (
    <span
      data-level={level}
      className={`inline-flex items-center gap-s-1 whitespace-nowrap rounded-k-chip border px-s-2 py-[2px] text-fs-12 font-bold ${className}`}
    >
      <Icon size={16} strokeWidth={1.5} aria-hidden="true" />
      {t(`${level}.chip`)}
    </span>
  );
}

export function RolesMatrix({ state, noPermission, onPrint, highlighted: initial }: RolesMatrixProps) {
  const t = useTranslations();
  const [highlighted, setHighlighted] = useState<AppRole | undefined>(initial);

  if (state === "noPermission") return <>{noPermission}</>;

  const print = onPrint ?? (() => window.print());
  const roleName = (role: AppRole) => t(`roles.${role}`);
  const areaName = (area: MatrixArea) => t(`${P}.areas.${area}`);
  const cellClass = (role: AppRole) => (highlighted === role ? "bg-k-blue-bg" : "");

  return (
    <div className="report-sheet report-dense">
      <style>{printCss("landscape")}</style>
      <PageTitle
        eyebrow={t("nav.admin")}
        title={t(`${P}.title`)}
        action={
          <button
            type="button"
            onClick={print}
            className="flex min-h-[44px] items-center gap-s-2 rounded-k border border-k-grey bg-k-white px-s-3 py-s-2 text-fs-14 text-k-blue-deep print:hidden"
          >
            <Printer size={24} strokeWidth={1.5} aria-hidden="true" />
            {t("buttons.printPdf")}
          </button>
        }
      />
      <p className="mb-s-5 max-w-[760px] text-fs-16 text-k-text">{t(`${P}.intro`)}</p>

      {/* The legend: the five chips, one sentence each. */}
      <section aria-labelledby="s24r-legend" className="mb-s-5">
        <h2 id="s24r-legend" className="mb-s-2 text-fs-16 font-bold text-k-ink">
          {t(`${P}.legendTitle`)}
        </h2>
        <ul className="flex flex-col gap-s-2 tablet:flex-row tablet:flex-wrap tablet:gap-x-s-6">
          {LEVELS.map((level) => (
            <li key={level} className="flex items-center gap-s-2 text-fs-14 text-k-ink">
              <span className="inline-flex min-w-[96px]">
                <LevelChip level={level} />
              </span>
              <span>{t(`${P}.levels.${level}.sentence`)}</span>
            </li>
          ))}
        </ul>
      </section>

      {/* Desktop, tablet and paper: the table. */}
      <p role="status" className="mb-s-2 hidden min-h-[21px] text-fs-14 text-k-ink tablet:block print:hidden">
        {highlighted ? t(`${P}.highlightHint`, { role: roleName(highlighted) }) : ""}
      </p>
      <div data-testid="s24r-table" className="hidden overflow-x-auto tablet:block print:block">
        <table className="w-full border-collapse text-fs-14">
          <caption className="sr-only">{t(`${P}.caption`)}</caption>
          <thead>
            <tr className="border-b-2 border-k-ink">
              <th scope="col" className="min-w-[200px] px-s-2 py-s-2 text-left align-bottom text-fs-14 font-bold text-k-ink">
                {t(`${P}.columnArea`)}
              </th>
              {MATRIX_ROLES.map((role) => (
                <th
                  key={role}
                  scope="col"
                  title={roleName(role)}
                  className={`px-s-1 py-s-2 text-center align-bottom ${cellClass(role)}`}
                >
                  {/* A header is a toggle: it highlights its column on the
                      screen and nothing else. */}
                  <button
                    type="button"
                    aria-pressed={highlighted === role}
                    aria-label={roleName(role)}
                    onClick={() => setHighlighted((current) => (current === role ? undefined : role))}
                    className={`min-h-[44px] whitespace-nowrap rounded-k px-s-2 text-fs-14 font-bold hover:underline ${
                      highlighted === role ? "text-k-blue-deep underline" : "text-k-ink"
                    }`}
                  >
                    {t(`${P}.short.${role}`)}
                  </button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            <tr className="border-b border-k-grey">
              <th scope="row" className="px-s-2 py-s-2 text-left font-bold text-k-ink">
                {t(`${P}.unitsRow`)}
              </th>
              {MATRIX_ROLES.map((role) => (
                <td key={role} data-role={role} className={`px-s-1 py-s-2 text-center text-k-ink ${cellClass(role)}`}>
                  {t(`${P}.units.${MATRIX_UNITS[role]}`)}
                </td>
              ))}
            </tr>
            {MATRIX_GROUPS.map(({ group, areas }) => (
              <Fragment key={group}>
                <tr>
                  <th
                    scope="colgroup"
                    colSpan={MATRIX_ROLES.length + 1}
                    className="border-b border-k-ink bg-k-surface px-s-2 pb-s-1 pt-s-4 text-left text-fs-14 font-bold text-k-blue-deep"
                  >
                    {t(`${P}.groups.${group}`)}
                  </th>
                </tr>
                {areas.map((area) => (
                  <tr key={area} className="border-b border-k-grey">
                    <th scope="row" className="px-s-2 py-s-1 text-left font-normal text-k-ink">
                      {areaName(area)}
                    </th>
                    {MATRIX_ROLES.map((role) => (
                      <td key={role} data-role={role} className={`px-s-1 py-s-1 text-center ${cellClass(role)}`}>
                        <LevelChip level={ROLE_MATRIX[area][role]} />
                      </td>
                    ))}
                  </tr>
                ))}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>

      {/* Phone: one card per role, its areas and level as text. */}
      <div data-testid="s24r-cards" className="flex flex-col gap-s-4 tablet:hidden print:hidden">
        {MATRIX_ROLES.map((role) => {
          const none = MATRIX_GROUPS.flatMap(({ areas }) => areas).filter((area) => ROLE_MATRIX[area][role] === "NONE");
          return (
            <article key={role} aria-label={roleName(role)} className="report-card rounded-k border border-k-grey bg-k-white p-s-4">
              <h2 className="text-fs-16 font-bold text-k-ink">{roleName(role)}</h2>
              <p className="mb-s-3 text-fs-14 text-k-text">
                {t(`${P}.unitsRow`)}: {t(`${P}.units.${MATRIX_UNITS[role]}`)}
              </p>
              {MATRIX_GROUPS.map(({ group, areas }) => {
                const shown = areas.filter((area) => ROLE_MATRIX[area][role] !== "NONE");
                if (shown.length === 0) return null;
                return (
                  <section key={group} className="mb-s-3">
                    <h3 className="mb-s-1 text-fs-14 font-bold text-k-blue-deep">{t(`${P}.groups.${group}`)}</h3>
                    <ul className="flex flex-col gap-s-1">
                      {shown.map((area) => (
                        <li key={area} className="flex items-start justify-between gap-s-3 text-fs-14 text-k-ink">
                          <span>{areaName(area)}</span>
                          <LevelChip level={ROLE_MATRIX[area][role]} />
                        </li>
                      ))}
                    </ul>
                  </section>
                );
              })}
              {none.length > 0 && (
                <p data-testid="s24r-none" className="text-fs-14 text-k-text">
                  {t(`${P}.levels.NONE.name`)}: {none.map(areaName).join(", ")}
                </p>
              )}
            </article>
          );
        })}
      </div>

      {/* The notes the cells cannot carry. */}
      <section aria-labelledby="s24r-notes" className="mt-s-6">
        <h2 id="s24r-notes" className="mb-s-3 text-fs-20 text-k-ink">
          {t(`${P}.notesTitle`)}
        </h2>
        <h3 className="text-fs-16 font-bold text-k-ink">{t(`${P}.generalNotesTitle`)}</h3>
        <ul className="mb-s-4 list-disc pl-s-5 text-fs-14 text-k-ink">
          {GENERAL_NOTES.map((key) => (
            <li key={key}>{t(`${P}.notes.${key}`)}</li>
          ))}
        </ul>
        <div className="grid gap-s-4 tablet:grid-cols-2">
          {MATRIX_ROLES.map((role) => (
            <div key={role} data-testid={`s24r-notes-${role}`} className="report-card">
              <h3 className="text-fs-16 font-bold text-k-ink">{roleName(role)}</h3>
              <ul className="list-disc pl-s-5 text-fs-14 text-k-ink">
                {ROLE_NOTES[role].map((key) => (
                  <li key={key}>{t(`${P}.notes.${key}`)}</li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
