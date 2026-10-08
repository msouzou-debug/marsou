"use client";

// S24r «Ρόλοι και δικαιώματα» — R01, R42 (CAPEX-01 §10, ADR-0010, ADR-0020, ADR-0033)
//
/**
 * RolesMatrix — what each of the eight roles sees and does, area by area,
 * and, for the administrator, the place to change it (ADR-0033).
 *
 * | Prop         | Type                                              | Notes                                                        |
 * |--------------|---------------------------------------------------|--------------------------------------------------------------|
 * | state        | "default" \| "noPermission"                       | The page decides who may open it.                            |
 * | noPermission | ReactNode                                         | Drawn in the `noPermission` state.                           |
 * | onPrint      | () => void?                                       | Defaults to `window.print()`.                                |
 * | highlighted  | AppRole?                                          | Initial highlighted column; the header buttons change it.    |
 * | matrix       | RoleMatrix?                                       | The stored matrix; `ROLE_MATRIX` (the defaults) if left out. |
 * | updatedAt    | string \| null?                                   | The last change, shown under the intro when there is one.    |
 * | editable     | boolean?                                          | The administrator: each free cell's chip opens a list.       |
 * | onSave       | (role, column) => Promise<RoleMatrix>?            | `PUT /admin/roles/:role`, once per changed role.             |
 * | onReset      | () => Promise<RoleMatrix>?                        | `POST /admin/roles/reset`, after the ConfirmDialog.          |
 *
 * The data is the matrix the page loaded, `MATRIX_UNITS` and `ROLE_NOTES`
 * from `@ecapital/shared`. States: default and noPermission. The matrix
 * arrives with the page, so loading, empty, error and offline do not arise
 * for the table; a refused save shows the API's own sentence above the bar.
 *
 * Desktop and tablet from 1024px: one table, the roles as columns and the
 * areas as grouped rows; that is where the administrator edits. Below 1024px:
 * one card per role, read only. Print: the legend and the table on
 * landscape A4 (`printCss`, shared with S23a), chips and not lists.
 *
 * RULE (UI instructions §4): a level is never colour alone — every chip
 * carries an icon of its own and a word, and a border, so the table reads
 * the same in greyscale and on paper.
 *
 * RULE (ADR-0033): a cell offers only the levels its guardrails allow
 * (`allowedLevels`, the same rule as the database trigger). A cell with one
 * level left is shown locked, with a lock and the reason as its tooltip.
 *
 * Editing keeps the chips: for the administrator a free cell's chip is a
 * button (`aria-haspopup="listbox"`) that opens a small list of the allowed
 * levels under it, so the eight columns keep their width and their colours.
 * Keyboard: Enter, Space or ↓ opens, ↑/↓ move, Enter picks, Esc closes; a
 * click outside closes. One list is open at a time. A changed cell keeps a
 * 2px blue ring until it is saved or thrown away.
 */
import { Fragment, useCallback, useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import { Check, Cog, Eye, Lock, Pencil, Printer, RotateCcw } from "lucide-react";
import {
  MATRIX_GROUPS,
  MATRIX_ROLES,
  MATRIX_UNITS,
  ROLE_MATRIX,
  ROLE_NOTES,
  GENERAL_NOTES,
  GUARDRAILS,
  allowedLevels,
  columnOf,
  levelBounds,
  type AccessLevel,
  type AppRole,
  type MatrixArea,
  type RoleColumn,
  type RoleMatrix,
} from "@ecapital/shared";
import { PageTitle } from "@/components/app-shell";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { formatDateTime } from "@/lib/format";
import { printCss } from "@/screens/s23-reports/catalogue";

export type RolesMatrixState = "default" | "noPermission";

export interface RolesMatrixProps {
  state: RolesMatrixState;
  noPermission: ReactNode;
  onPrint?: () => void;
  highlighted?: AppRole;
  matrix?: RoleMatrix;
  updatedAt?: string | null;
  editable?: boolean;
  onSave?: (role: AppRole, column: RoleColumn) => Promise<RoleMatrix>;
  onReset?: () => Promise<RoleMatrix>;
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

interface LevelPickerProps {
  /** «{area}, {role}», the button's and the list's name. */
  label: string;
  level: AccessLevel;
  options: AccessLevel[];
  changed: boolean;
  open: boolean;
  disabled: boolean;
  /** The right-hand columns open the list towards the left. */
  alignEnd: boolean;
  /** The bottom rows open the list upwards, inside the table's box. */
  upward: boolean;
  onOpen: () => void;
  onClose: () => void;
  onPick: (level: AccessLevel) => void;
}

/**
 * One editable cell: the chip as a button, and under it, while open, the
 * levels the guardrails allow as a listbox (`aria-activedescendant`).
 */
function LevelPicker({
  label,
  level,
  options,
  changed,
  open,
  disabled,
  alignEnd,
  upward,
  onOpen,
  onClose,
  onPick,
}: LevelPickerProps) {
  const t = useTranslations(`${P}.levels`);
  const id = useId();
  const listId = `${id}-list`;
  const rootRef = useRef<HTMLSpanElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const [active, setActive] = useState(0);

  // The list takes the focus when it opens.
  useEffect(() => {
    if (open) listRef.current?.focus();
  }, [open]);

  // A click anywhere outside the cell closes it.
  useEffect(() => {
    if (!open) return;
    function outside(event: MouseEvent) {
      if (!rootRef.current?.contains(event.target as Node)) onClose();
    }
    document.addEventListener("mousedown", outside);
    return () => document.removeEventListener("mousedown", outside);
  }, [open, onClose]);

  function openList() {
    setActive(Math.max(0, options.indexOf(level)));
    onOpen();
  }

  function closeList() {
    onClose();
    buttonRef.current?.focus();
  }

  function pick(option: AccessLevel) {
    onPick(option);
    closeList();
  }

  function onListKey(event: KeyboardEvent<HTMLUListElement>) {
    switch (event.key) {
      case "ArrowDown":
        event.preventDefault();
        setActive((a) => Math.min(options.length - 1, a + 1));
        break;
      case "ArrowUp":
        event.preventDefault();
        setActive((a) => Math.max(0, a - 1));
        break;
      case "Home":
        event.preventDefault();
        setActive(0);
        break;
      case "End":
        event.preventDefault();
        setActive(options.length - 1);
        break;
      case "Enter":
      case " ":
        event.preventDefault();
        pick(options[active]);
        break;
      case "Escape":
        event.preventDefault();
        closeList();
        break;
      case "Tab":
        onClose();
        break;
    }
  }

  return (
    <span ref={rootRef} className="relative inline-flex">
      <button
        ref={buttonRef}
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-label={label}
        aria-describedby={`${id}-value`}
        data-changed={changed ? "true" : undefined}
        disabled={disabled}
        onClick={() => (open ? onClose() : openList())}
        onKeyDown={(event) => {
          if (!open && (event.key === "ArrowDown" || event.key === "ArrowUp")) {
            event.preventDefault();
            openList();
          }
        }}
        className="inline-flex min-h-[44px] min-w-[44px] cursor-pointer items-center justify-center rounded-k hover:bg-k-surface disabled:cursor-not-allowed"
      >
        <span
          id={`${id}-value`}
          className={`inline-flex rounded-k-chip ${changed ? "outline-2 outline-offset-2 outline-k-blue outline-solid" : ""}`}
        >
          <LevelChip level={level} />
        </span>
      </button>
      {open && (
        <ul
          ref={listRef}
          id={listId}
          role="listbox"
          tabIndex={-1}
          aria-label={label}
          aria-activedescendant={`${listId}-${active}`}
          onKeyDown={onListKey}
          onBlur={(event) => {
            if (!rootRef.current?.contains(event.relatedTarget as Node | null)) onClose();
          }}
          className={`absolute z-20 w-[260px] rounded-k border border-k-grey bg-k-white py-s-1 text-left shadow-k print:hidden ${
            alignEnd ? "right-0" : "left-0"
          } ${upward ? "bottom-full mb-s-1" : "top-full mt-s-1"}`}
        >
          {options.map((option, index) => (
            <li
              key={option}
              id={`${listId}-${index}`}
              role="option"
              aria-selected={option === level}
              aria-labelledby={`${listId}-${index}-name`}
              aria-describedby={`${listId}-${index}-sentence`}
              // The list keeps the focus: a blur before the click would close it first.
              onMouseDown={(event) => event.preventDefault()}
              onMouseEnter={() => setActive(index)}
              onClick={() => pick(option)}
              className={`flex min-h-[44px] cursor-pointer gap-s-2 px-s-3 py-s-2 ${index === active ? "bg-k-surface" : ""}`}
            >
              <span className="inline-flex w-[16px] shrink-0 pt-[2px] text-k-blue-deep">
                {option === level && <Check size={16} strokeWidth={1.5} aria-hidden="true" />}
              </span>
              <span className="flex flex-col">
                <span id={`${listId}-${index}-name`} className="text-fs-14 font-bold text-k-ink">
                  {option === "NONE" ? t("NONE.name") : t(`${option}.chip`)}
                </span>
                <span id={`${listId}-${index}-sentence`} className="text-fs-12 text-k-text">
                  {t(`${option}.sentence`)}
                </span>
              </span>
            </li>
          ))}
        </ul>
      )}
    </span>
  );
}

/** The last rows open their list upwards so it stays inside the table's box. */
const UPWARD_AREAS = new Set<MatrixArea>(MATRIX_GROUPS.flatMap(({ areas }) => areas).slice(-5));
/** The last columns open their list towards the left. */
const END_ROLES = new Set<AppRole>(MATRIX_ROLES.slice(-3));

/** Role → the cells changed in the draft and not yet saved. */
type Draft = Partial<Record<AppRole, Partial<RoleColumn>>>;

function draftCount(draft: Draft): number {
  return Object.values(draft).reduce((sum, cells) => sum + Object.keys(cells ?? {}).length, 0);
}

export function RolesMatrix({
  state,
  noPermission,
  onPrint,
  highlighted: initial,
  matrix: loaded = ROLE_MATRIX,
  updatedAt = null,
  editable = false,
  onSave,
  onReset,
}: RolesMatrixProps) {
  const t = useTranslations();
  const [highlighted, setHighlighted] = useState<AppRole | undefined>(initial);
  // The matrix as last saved: the page's, until a save or a reset answers.
  const [saved, setSaved] = useState<RoleMatrix>(loaded);
  const [lastChange, setLastChange] = useState<string | null>(updatedAt);
  const [draft, setDraft] = useState<Draft>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);
  const [notice, setNotice] = useState<string | undefined>(undefined);
  const [confirmReset, setConfirmReset] = useState(false);
  // The one cell whose list is open, as `${area}:${role}`.
  const [openCell, setOpenCell] = useState<string | null>(null);
  const closeCell = useCallback(() => setOpenCell(null), []);

  if (state === "noPermission") return <>{noPermission}</>;

  const print = onPrint ?? (() => window.print());
  const roleName = (role: AppRole) => t(`roles.${role}`);
  const areaName = (area: MatrixArea) => t(`${P}.areas.${area}`);
  const cellClass = (role: AppRole) => (highlighted === role ? "bg-k-blue-bg" : "");
  const levelOf = (area: MatrixArea, role: AppRole): AccessLevel => draft[role]?.[area] ?? saved[area][role];
  const changes = draftCount(draft);
  const canEdit = editable && Boolean(onSave);

  function change(role: AppRole, area: MatrixArea, level: AccessLevel) {
    setNotice(undefined);
    setError(undefined);
    setDraft((current) => {
      const cells = { ...(current[role] ?? {}) };
      if (level === saved[area][role]) delete cells[area];
      else cells[area] = level;
      const next = { ...current, [role]: cells };
      if (Object.keys(cells).length === 0) delete next[role];
      return next;
    });
  }

  async function save() {
    if (!onSave) return;
    setBusy(true);
    setError(undefined);
    let current = saved;
    try {
      // One PUT per role column that moved; each carries the whole column.
      for (const role of MATRIX_ROLES) {
        const cells = draft[role];
        if (!cells || Object.keys(cells).length === 0) continue;
        current = await onSave(role, { ...columnOf(current, role), ...cells });
        setSaved(current);
        setDraft((d) => {
          const next = { ...d };
          delete next[role];
          return next;
        });
      }
      setLastChange(new Date().toISOString());
      setNotice(t(`${P}.saved`));
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
    } finally {
      setBusy(false);
    }
  }

  async function reset() {
    setConfirmReset(false);
    if (!onReset) return;
    setBusy(true);
    setError(undefined);
    try {
      setSaved(await onReset());
      setDraft({});
      setLastChange(new Date().toISOString());
      setNotice(t(`${P}.resetDone`));
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
    } finally {
      setBusy(false);
    }
  }

  /** The reason a cell is narrowed, for its tooltip; empty when it is free. */
  const guardrailText = (role: AppRole, area: MatrixArea) =>
    levelBounds(role, area)
      .guardrails.map((key) => t(`${P}.guardrails.${key}`))
      .join(" ");

  function editableCell(area: MatrixArea, role: AppRole) {
    const options = allowedLevels(role, area);
    const level = levelOf(area, role);
    const reason = guardrailText(role, area);
    const changed = draft[role]?.[area] !== undefined;
    if (options.length === 1) {
      return (
        <span data-locked="true" title={reason} className="inline-flex items-center gap-s-1">
          <LevelChip level={level} />
          <Lock size={16} strokeWidth={1.5} aria-hidden="true" className="text-k-text" />
          <span className="sr-only">
            {t(`${P}.lockedLabel`)}: {reason}
          </span>
        </span>
      );
    }
    const key = `${area}:${role}`;
    return (
      <span className="inline-flex items-center gap-s-1">
        {/* RULE (ADR-0033): only the levels the guardrails allow are offered. */}
        <LevelPicker
          label={t(`${P}.cellLabel`, { area: areaName(area), role: roleName(role) })}
          level={level}
          options={options}
          changed={changed}
          open={openCell === key}
          disabled={busy}
          alignEnd={END_ROLES.has(role)}
          upward={UPWARD_AREAS.has(area)}
          onOpen={() => setOpenCell(key)}
          onClose={closeCell}
          onPick={(picked) => change(role, area, picked)}
        />
        {reason && (
          <span title={reason} className="inline-flex print:hidden">
            <Lock size={16} strokeWidth={1.5} aria-hidden="true" className="text-k-text" />
            <span className="sr-only">
              {t(`${P}.lockedLabel`)}: {reason}
            </span>
          </span>
        )}
      </span>
    );
  }

  return (
    <div className="report-sheet report-dense">
      <style>{printCss("landscape")}</style>
      <PageTitle
        eyebrow={t("nav.admin")}
        title={t(`${P}.title`)}
        action={
          <div className="flex flex-wrap items-center gap-s-2 print:hidden">
            {canEdit && onReset && (
              <button
                type="button"
                onClick={() => setConfirmReset(true)}
                disabled={busy}
                className="flex min-h-[44px] items-center gap-s-2 rounded-k border border-k-grey bg-k-white px-s-3 py-s-2 text-fs-14 text-k-blue-deep disabled:text-k-text-muted"
              >
                <RotateCcw size={24} strokeWidth={1.5} aria-hidden="true" />
                {t(`${P}.resetDefaults`)}
              </button>
            )}
            <button
              type="button"
              onClick={print}
              className="flex min-h-[44px] items-center gap-s-2 rounded-k border border-k-grey bg-k-white px-s-3 py-s-2 text-fs-14 text-k-blue-deep"
            >
              <Printer size={24} strokeWidth={1.5} aria-hidden="true" />
              {t("buttons.printPdf")}
            </button>
          </div>
        }
      />
      <p className="mb-s-2 max-w-[760px] text-fs-16 text-k-text">{t(`${P}.intro`)}</p>
      {canEdit && <p className="mb-s-2 max-w-[760px] text-fs-16 text-k-text print:hidden">{t(`${P}.editIntro`)}</p>}
      {lastChange && (
        <p className="mb-s-5 text-fs-14 text-k-text">{t(`${P}.lastChange`, { date: formatDateTime(lastChange) })}</p>
      )}
      {!lastChange && <div className="mb-s-3" />}

      {notice && (
        <p
          role="status"
          data-testid="s24r-notice"
          className="mb-s-4 flex items-center gap-s-2 rounded-k border border-k-green bg-k-white px-s-3 py-s-2 text-fs-14 text-k-ink print:hidden"
        >
          <Check size={20} strokeWidth={1.5} aria-hidden="true" />
          {notice}
        </p>
      )}

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
                        {canEdit ? editableCell(area, role) : <LevelChip level={levelOf(area, role)} />}
                      </td>
                    ))}
                  </tr>
                ))}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>

      {/* The administrator's changes, one bar for all of them. */}
      {canEdit && (changes > 0 || error) && (
        <div
          data-testid="s24r-savebar"
          className="sticky bottom-0 z-10 mt-s-3 flex flex-wrap items-center justify-between gap-s-3 rounded-k border border-k-grey bg-k-white p-s-3 shadow-k print:hidden"
        >
          <div className="text-fs-14 text-k-ink">
            {error ? (
              <p role="alert" className="text-k-red">
                {error}
              </p>
            ) : (
              <p>{t(`${P}.unsaved`, { count: changes })}</p>
            )}
          </div>
          <div className="flex gap-s-2">
            <button
              type="button"
              onClick={() => {
                setDraft({});
                setError(undefined);
              }}
              disabled={busy}
              className="min-h-[44px] rounded-k border border-k-grey px-s-4 text-fs-14 text-k-text"
            >
              {t("buttons.cancel")}
            </button>
            <button
              type="button"
              onClick={() => void save()}
              disabled={busy || changes === 0}
              className="min-h-[44px] rounded-k bg-k-blue px-s-4 text-fs-14 font-bold text-k-white disabled:bg-k-grey disabled:text-k-text-muted"
            >
              {t("buttons.save")}
            </button>
          </div>
        </div>
      )}

      {/* Phone: one card per role, its areas and level as text. */}
      <div data-testid="s24r-cards" className="flex flex-col gap-s-4 tablet:hidden print:hidden">
        {MATRIX_ROLES.map((role) => {
          const none = MATRIX_GROUPS.flatMap(({ areas }) => areas).filter((area) => levelOf(area, role) === "NONE");
          return (
            <article key={role} aria-label={roleName(role)} className="report-card rounded-k border border-k-grey bg-k-white p-s-4">
              <h2 className="text-fs-16 font-bold text-k-ink">{roleName(role)}</h2>
              <p className="mb-s-3 text-fs-14 text-k-text">
                {t(`${P}.unitsRow`)}: {t(`${P}.units.${MATRIX_UNITS[role]}`)}
              </p>
              {MATRIX_GROUPS.map(({ group, areas }) => {
                const shown = areas.filter((area) => levelOf(area, role) !== "NONE");
                if (shown.length === 0) return null;
                return (
                  <section key={group} className="mb-s-3">
                    <h3 className="mb-s-1 text-fs-14 font-bold text-k-blue-deep">{t(`${P}.groups.${group}`)}</h3>
                    <ul className="flex flex-col gap-s-1">
                      {shown.map((area) => (
                        <li key={area} className="flex items-start justify-between gap-s-3 text-fs-14 text-k-ink">
                          <span>{areaName(area)}</span>
                          <LevelChip level={levelOf(area, role)} />
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

      {/* ADR-0033: what the administrator cannot change, said where it is changed. */}
      <section aria-labelledby="s24r-guardrails" data-testid="s24r-guardrails" className="mt-s-6">
        <h2 id="s24r-guardrails" className="mb-s-3 text-fs-20 text-k-ink">
          {t(`${P}.guardrailsTitle`)}
        </h2>
        <ul className="list-disc pl-s-5 text-fs-14 text-k-ink">
          {GUARDRAILS.map((key) => (
            <li key={key}>{t(`${P}.guardrails.${key}`)}</li>
          ))}
          <li>{t(`${P}.fixedRules`)}</li>
        </ul>
      </section>

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

      {canEdit && onReset && (
        <ConfirmDialog
          open={confirmReset}
          title={t(`${P}.resetTitle`)}
          consequence={t(`${P}.resetConsequence`)}
          destructiveLabel={t(`${P}.resetDefaults`)}
          onCancel={() => setConfirmReset(false)}
          onConfirm={() => void reset()}
        />
      )}
    </div>
  );
}
