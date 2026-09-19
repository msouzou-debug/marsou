"use client";

/**
 * Table — the eCapital data table (UI instructions §4, §6, §7).
 *
 * Generic over the row type, built on @tanstack/react-table for sorting,
 * column visibility and row selection. Serves R03 (portfolio drill-through
 * lists) and R13 (the four-ledger cost table on S04).
 *
 * Persistence note: density and column visibility are kept in localStorage
 * under `ecapital.table.<tableId>.density` and
 * `ecapital.table.<tableId>.columns`. This is a placeholder. Both settings
 * move to the user profile (S27) once the profile API exists; the storage
 * keys are read in one place (`storageKey`) so the move is a single change.
 *
 * | Prop                | Type                                              | Default       | Meaning |
 * |---------------------|---------------------------------------------------|---------------|---------|
 * | `tableId`           | `string`                                          | —             | Stable id; namespaces the persisted density and column choice. |
 * | `columns`           | `TableColumn<T>[]`                                | —             | Column definitions, in display order. |
 * | `rows`              | `T[]`                                             | `[]`          | The data. Ignored in every state except `default` and `offline`. |
 * | `getRowId`          | `(row: T) => string`                              | —             | Stable row key; also the id handed to `onSelectionChange`. |
 * | `captionKey`        | `string`                                          | —             | i18n key for the table's accessible name (visually hidden `<caption>`). |
 * | `state`             | `TableState`                                      | `"default"`   | Which of the six states to render (UI §6). |
 * | `density`           | `"dense" \| "comfortable"`                        | `"dense"`     | Initial density when nothing is persisted for this `tableId`. |
 * | `selectable`        | `boolean`                                         | `false`       | Adds the checkbox column. |
 * | `emptyState`        | `{ messageKey, actionLabelKey, onAction? }`       | —             | Required for the `empty` state: one sentence plus one action (UI §6). |
 * | `skeletonRows`      | `number`                                          | `6`           | How many skeleton rows the `loading` state draws. |
 * | `onExport`          | `() => void`                                      | —             | Fired by the export button. |
 * | `onCellEdit`        | `(row: T, columnId: string, value: string) => void` | —           | Fired when `Enter` commits an inline edit. |
 * | `onRowOpen`         | `(row: T) => void`                                | —             | Fired by `Enter` on a focused row. |
 * | `onSelectionChange` | `(ids: string[]) => void`                         | —             | Fired whenever the checkbox selection changes. |
 * | `onRetry`           | `() => void`                                      | —             | Retry button in the `error` state; the button is hidden without it. |
 *
 * `TableColumn<T>`: `id`, `headerKey` (full i18n path), `accessor`, optional
 * `cell` renderer, `numeric`, `editable`, `sortable` (default `true`),
 * `defaultHidden`.
 *
 * Keyboard: `↑`/`↓` move row focus, `Enter` opens the focused row, double-click
 * starts an inline edit on an `editable` cell, `Enter` saves it and `Esc`
 * cancels. Sortable headers are buttons and announce `aria-sort`.
 */

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import {
  flexRender,
  getCoreRowModel,
  getSortedRowModel,
  useReactTable,
  type ColumnDef,
  type RowSelectionState,
  type SortingState,
  type VisibilityState,
} from "@tanstack/react-table";
import { ChevronDown, ChevronUp, ChevronsUpDown, Columns3, FileSpreadsheet } from "lucide-react";

export type Density = "dense" | "comfortable";

export type TableState = "default" | "loading" | "empty" | "error" | "noPermission" | "offline";

export interface TableColumn<T> {
  /** Stable column id; used for persistence and for `onCellEdit`. */
  id: string;
  /** Full i18n key path for the header label, e.g. "components.costBar.spent". */
  headerKey: string;
  /** Sort and edit value for this column. */
  accessor: (row: T) => unknown;
  /** Display renderer. Defaults to the accessor value as text. */
  cell?: (row: T) => ReactNode;
  /** Money, dates, counts and ids: mono, tabular, right-aligned. */
  numeric?: boolean;
  /** Double-click opens an inline editor on this column's cells. */
  editable?: boolean;
  /** Defaults to true. */
  sortable?: boolean;
  /** Start hidden; the user can switch it on in the column chooser. */
  defaultHidden?: boolean;
}

export interface TableEmptyState {
  /** Full i18n key for the one sentence. */
  messageKey: string;
  /** Full i18n key for the one action, from the fixed `buttons.*` set. */
  actionLabelKey: string;
  /** Omit for a caller that may not perform the action (a read-only role) —
   *  the sentence still renders, the button does not. */
  onAction?: () => void;
}

export interface TableProps<T> {
  tableId: string;
  columns: TableColumn<T>[];
  rows?: T[];
  getRowId: (row: T) => string;
  captionKey: string;
  state?: TableState;
  density?: Density;
  selectable?: boolean;
  emptyState?: TableEmptyState;
  skeletonRows?: number;
  onExport?: () => void;
  onCellEdit?: (row: T, columnId: string, value: string) => void;
  onRowOpen?: (row: T) => void;
  onSelectionChange?: (ids: string[]) => void;
  onRetry?: () => void;
}

const SELECT_COLUMN_ID = "__select";

// Row heights come from UI instructions §2: dense 36px for engineer and finance
// screens, comfortable 48px for clinician and executive screens. They are not
// in the spacing scale, so they live here as named constants rather than as
// loose numbers in the markup.
/** One shared empty array, so an empty table never re-renders itself (see the RULE below). */
const NO_ROWS: never[] = [];

const ROW_HEIGHT_PX: Record<Density, number> = { dense: 36, comfortable: 48 };

// Zebra rows: --k-grey at 40% opacity (UI §4).
const ZEBRA = "color-mix(in srgb, var(--k-grey) 40%, transparent)";

function storageKey(tableId: string, part: "density" | "columns"): string {
  return `ecapital.table.${tableId}.${part}`;
}

/** localStorage throws in private mode and is absent during SSR. Never let it break a render. */
function readStored(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeStored(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    /* nothing to do: the setting stays for this session only */
  }
}

function toText(value: unknown): string {
  if (value === null || value === undefined) return "";
  return String(value);
}

export function Table<T>({
  tableId,
  columns,
  rows = [],
  getRowId,
  captionKey,
  state = "default",
  density: initialDensity = "dense",
  selectable = false,
  emptyState,
  skeletonRows = 6,
  onExport,
  onCellEdit,
  onRowOpen,
  onSelectionChange,
  onRetry,
}: TableProps<T>) {
  const t = useTranslations("components.table");
  const tRoot = useTranslations();

  const [density, setDensity] = useState<Density>(initialDensity);
  const [columnVisibility, setColumnVisibility] = useState<VisibilityState>(() =>
    Object.fromEntries(columns.filter((c) => c.defaultHidden).map((c) => [c.id, false])),
  );
  const [sorting, setSorting] = useState<SortingState>([]);
  const [rowSelection, setRowSelection] = useState<RowSelectionState>({});
  const [focusedIndex, setFocusedIndex] = useState(0);
  const [editing, setEditing] = useState<{ rowId: string; columnId: string } | null>(null);
  const [draft, setDraft] = useState("");
  const [hydrated, setHydrated] = useState(false);

  const rowRefs = useRef<Array<HTMLTableRowElement | null>>([]);
  const selectionCallback = useRef(onSelectionChange);
  selectionCallback.current = onSelectionChange;

  const readOnly = state === "offline";
  const showsRows = state === "default" || state === "offline";

  // Hydrate the persisted settings after mount so server and client markup match.
  useEffect(() => {
    const storedDensity = readStored(storageKey(tableId, "density"));
    if (storedDensity === "dense" || storedDensity === "comfortable") setDensity(storedDensity);
    const storedColumns = readStored(storageKey(tableId, "columns"));
    if (storedColumns) {
      try {
        const parsed: unknown = JSON.parse(storedColumns);
        if (parsed && typeof parsed === "object") setColumnVisibility(parsed as VisibilityState);
      } catch {
        /* corrupt entry: fall back to the defaults */
      }
    }
    setHydrated(true);
  }, [tableId]);

  useEffect(() => {
    if (!hydrated) return;
    writeStored(storageKey(tableId, "density"), density);
  }, [density, hydrated, tableId]);

  useEffect(() => {
    if (!hydrated) return;
    writeStored(storageKey(tableId, "columns"), JSON.stringify(columnVisibility));
  }, [columnVisibility, hydrated, tableId]);

  useEffect(() => {
    selectionCallback.current?.(Object.keys(rowSelection).filter((id) => rowSelection[id]));
  }, [rowSelection]);

  const columnsById = useMemo(() => new Map(columns.map((c) => [c.id, c])), [columns]);

  const tanstackColumns = useMemo<Array<ColumnDef<T>>>(() => {
    const defs: Array<ColumnDef<T>> = [];
    if (selectable) {
      defs.push({
        id: SELECT_COLUMN_ID,
        enableSorting: false,
        enableHiding: false,
        header: () => null,
        cell: () => null,
      });
    }
    for (const column of columns) {
      defs.push({
        id: column.id,
        accessorFn: (row) => column.accessor(row),
        enableSorting: column.sortable ?? true,
        header: () => tRoot(column.headerKey),
        cell: (ctx) =>
          column.cell ? column.cell(ctx.row.original) : toText(ctx.getValue()),
      });
    }
    return defs;
  }, [columns, selectable, tRoot]);

  // RULE: the row array handed to TanStack must be referentially stable.
  // A fresh `[]` on every render makes its core row model recompute each
  // time; that recompute queues `resetPageIndex()` through a microtask,
  // which sets state, which renders again, which is a new `[]`… React never
  // throws (nothing is synchronous), the tab stays responsive, but every
  // router transition started from a page with an empty table hangs
  // forever, because the loop never lets it commit. Found on S09 with no
  // certificates and on S08 with no variations (Playwright, 19/09/2026).
  // Callers often write `rows={data ?? []}` or `rows={items.filter(…)}`,
  // which is a fresh array whenever it is empty; map every empty array to
  // the one constant so that case can never start the loop.
  const stableRows = showsRows && rows.length > 0 ? rows : NO_ROWS;
  const table = useReactTable({
    data: stableRows,
    columns: tanstackColumns,
    getRowId: (row) => getRowId(row),
    state: { sorting, columnVisibility, rowSelection },
    onSortingChange: setSorting,
    onColumnVisibilityChange: setColumnVisibility,
    onRowSelectionChange: setRowSelection,
    enableRowSelection: selectable && !readOnly,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
  });

  const visibleRows = table.getRowModel().rows;
  const headerGroups = table.getHeaderGroups();
  const visibleColumnCount = table.getVisibleLeafColumns().length;
  const rowHeight = ROW_HEIGHT_PX[density];

  const moveFocus = useCallback(
    (next: number) => {
      if (visibleRows.length === 0) return;
      const clamped = Math.max(0, Math.min(visibleRows.length - 1, next));
      setFocusedIndex(clamped);
      rowRefs.current[clamped]?.focus();
    },
    [visibleRows.length],
  );

  const startEdit = (rowId: string, columnId: string, current: unknown) => {
    // RULE: offline is read-only. Cached rows still render, but nothing may be
    // edited until the connection is back (UI instructions §6).
    if (readOnly || !columnsById.get(columnId)?.editable) return;
    setEditing({ rowId, columnId });
    setDraft(toText(current));
  };

  const commitEdit = (row: T, columnId: string) => {
    onCellEdit?.(row, columnId, draft);
    setEditing(null);
  };

  // RULE: the export button is always rendered, in the same place, in every
  // state that shows the table header — never hidden because there is nothing
  // to export yet (UI instructions §0.4 and §4). It is disabled while loading
  // and while offline, and the reason sits in the button's `title`.
  const exportDisabledReason =
    state === "loading" ? t("loadingExport") : readOnly ? t("offlineExport") : undefined;

  // No permission replaces the whole component: there is no data to export and
  // §6 forbids a blank page. The back link belongs to the screen, not here.
  if (state === "noPermission") {
    return (
      <div className="rounded-k border border-k-grey bg-k-white p-s-8 text-center">
        <p className="text-fs-16 text-k-ink">{tRoot("states.noPermission.title")}</p>
        <p className="mt-s-2 text-fs-14">{tRoot("states.noPermission.askRole")}</p>
      </div>
    );
  }

  return (
    <div className="rounded-k border border-k-grey bg-k-white">
      <div className="flex flex-wrap items-center justify-between gap-s-3 border-b border-k-grey p-s-3">
        <div className="flex flex-wrap items-center gap-s-4">
          <div className="flex items-center gap-s-2" role="group" aria-label={t("density.label")}>
            <span className="text-fs-12 text-k-text">{t("density.label")}</span>
            {(["dense", "comfortable"] as const).map((option) => (
              <button
                key={option}
                type="button"
                aria-pressed={density === option}
                onClick={() => setDensity(option)}
                className={`rounded-k border px-s-2 py-s-1 text-fs-14 ${
                  density === option
                    ? "border-k-blue-deep text-k-blue-deep"
                    : "border-k-grey text-k-text"
                }`}
              >
                {t(`density.${option}`)}
              </button>
            ))}
          </div>

          <details className="relative">
            <summary className="flex cursor-pointer list-none items-center gap-s-2 rounded-k border border-k-grey px-s-2 py-s-1 text-fs-14 text-k-text">
              <Columns3 size={20} strokeWidth={1.5} aria-hidden="true" />
              {t("columns.label")}
            </summary>
            <div className="absolute z-20 mt-s-1 w-max rounded-k border border-k-grey bg-k-white p-s-3 shadow-k">
              <p className="mb-s-2 text-fs-14">{t("columns.hint")}</p>
              <ul className="grid gap-s-2">
                {table
                  .getAllLeafColumns()
                  .filter((column) => column.id !== SELECT_COLUMN_ID)
                  .map((column) => (
                    <li key={column.id}>
                      <label className="flex items-center gap-s-2 text-fs-14">
                        <input
                          type="checkbox"
                          checked={column.getIsVisible()}
                          onChange={column.getToggleVisibilityHandler()}
                        />
                        {tRoot(columnsById.get(column.id)?.headerKey ?? column.id)}
                      </label>
                    </li>
                  ))}
              </ul>
            </div>
          </details>

          {readOnly && <p className="text-fs-14 text-k-text">{tRoot("states.offline.readOnly")}</p>}
        </div>

        <button
          type="button"
          onClick={onExport}
          disabled={state === "loading" || readOnly}
          title={exportDisabledReason}
          className="flex items-center gap-s-2 rounded-k border border-k-grey px-s-3 py-s-2 text-fs-14 text-k-blue-deep disabled:opacity-50"
        >
          <FileSpreadsheet size={24} strokeWidth={1.5} aria-hidden="true" />
          {tRoot("buttons.exportExcel")}
        </button>
      </div>

      {state === "error" ? (
        <div className="p-s-8 text-center">
          <p className="text-fs-16 text-k-ink">{tRoot("states.error.loadFailed")}</p>
          {onRetry && (
            <button
              type="button"
              onClick={onRetry}
              className="mt-s-4 rounded-k border border-k-grey px-s-3 py-s-2 text-fs-14 text-k-blue-deep"
            >
              {tRoot("common.retry")}
            </button>
          )}
        </div>
      ) : state === "empty" && emptyState ? (
        <div className="mx-auto max-w-[400px] p-s-8 text-center">
          <p className="text-fs-16 text-k-ink">{tRoot(emptyState.messageKey)}</p>
          {/* RULE (`@/auth/roles`'s own convention, ADR-0010): a caller that
              cannot act simply leaves `onAction` unset — this never shows a
              button that could only ever come back 403, rather than showing
              it disabled with no reason. */}
          {emptyState.onAction && (
            <button
              type="button"
              onClick={emptyState.onAction}
              className="mt-s-4 rounded-k bg-k-blue px-s-4 py-s-2 text-fs-14 text-k-white"
            >
              {tRoot(emptyState.actionLabelKey)}
            </button>
          )}
        </div>
      ) : (
        <div className="overflow-auto">
          <table className="w-full border-collapse text-fs-14">
            <caption className="sr-only">{tRoot(captionKey)}</caption>
            <thead className="sticky top-0 z-10 bg-k-white">
              {headerGroups.map((headerGroup) => (
                <tr key={headerGroup.id} style={{ height: rowHeight }}>
                  {headerGroup.headers.map((header) => {
                    const definition = columnsById.get(header.column.id);
                    const sortDirection = header.column.getIsSorted();
                    const canSort = header.column.getCanSort();
                    const label = flexRender(header.column.columnDef.header, header.getContext());
                    return (
                      <th
                        key={header.id}
                        scope="col"
                        aria-sort={
                          canSort
                            ? sortDirection === "asc"
                              ? "ascending"
                              : sortDirection === "desc"
                                ? "descending"
                                : "none"
                            : undefined
                        }
                        // RULE: numeric columns are mono, tabular and right-aligned
                        // in the header as well as the body, so figures line up
                        // under their label (UI instructions §1 and §4).
                        className={`border-b border-k-grey px-s-2 font-bold text-k-blue-deep ${
                          definition?.numeric ? "num" : "text-left"
                        }`}
                      >
                        {header.column.id === SELECT_COLUMN_ID ? (
                          <input
                            type="checkbox"
                            aria-label={t("select.all")}
                            checked={table.getIsAllRowsSelected()}
                            onChange={table.getToggleAllRowsSelectedHandler()}
                            disabled={readOnly}
                          />
                        ) : canSort ? (
                          <button
                            type="button"
                            onClick={header.column.getToggleSortingHandler()}
                            className="inline-flex items-center gap-s-1"
                          >
                            {label}
                            {sortDirection === "asc" ? (
                              <ChevronUp size={20} strokeWidth={1.5} aria-hidden="true" />
                            ) : sortDirection === "desc" ? (
                              <ChevronDown size={20} strokeWidth={1.5} aria-hidden="true" />
                            ) : (
                              <ChevronsUpDown size={20} strokeWidth={1.5} aria-hidden="true" />
                            )}
                          </button>
                        ) : (
                          label
                        )}
                      </th>
                    );
                  })}
                </tr>
              ))}
            </thead>

            {state === "loading" ? (
              // Loading is skeleton rows in the table's own shape: same columns,
              // same row height, no spinner (UI instructions §6).
              <tbody aria-busy="true" aria-label={t("loading")}>
                {Array.from({ length: skeletonRows }, (_, index) => (
                  <tr
                    key={index}
                    style={{ height: rowHeight, backgroundColor: index % 2 === 1 ? ZEBRA : undefined }}
                  >
                    {Array.from({ length: visibleColumnCount }, (_, cellIndex) => (
                      <td key={cellIndex} className="px-s-2">
                        <span
                          aria-hidden="true"
                          className="block h-s-3 rounded-k-chip bg-k-grey"
                        />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            ) : (
              <tbody>
                {visibleRows.map((row, index) => (
                  <tr
                    key={row.id}
                    ref={(element) => {
                      rowRefs.current[index] = element;
                    }}
                    tabIndex={index === focusedIndex ? 0 : -1}
                    aria-selected={selectable ? row.getIsSelected() : undefined}
                    onFocus={() => setFocusedIndex(index)}
                    onKeyDown={(event) => {
                      if (editing) return;
                      if (event.key === "ArrowDown") {
                        event.preventDefault();
                        moveFocus(index + 1);
                      } else if (event.key === "ArrowUp") {
                        event.preventDefault();
                        moveFocus(index - 1);
                      } else if (event.key === "Enter") {
                        event.preventDefault();
                        onRowOpen?.(row.original);
                      }
                    }}
                    style={{ height: rowHeight, backgroundColor: index % 2 === 1 ? ZEBRA : undefined }}
                  >
                    {row.getVisibleCells().map((cell) => {
                      const definition = columnsById.get(cell.column.id);
                      const isEditing =
                        editing?.rowId === row.id && editing.columnId === cell.column.id;
                      return (
                        <td
                          key={cell.id}
                          className={`border-b border-k-grey px-s-2 ${definition?.numeric ? "num whitespace-nowrap" : ""}`}
                          onDoubleClick={() =>
                            startEdit(row.id, cell.column.id, definition?.accessor(row.original))
                          }
                        >
                          {cell.column.id === SELECT_COLUMN_ID ? (
                            <input
                              type="checkbox"
                              aria-label={t("select.row")}
                              checked={row.getIsSelected()}
                              onChange={row.getToggleSelectedHandler()}
                              disabled={readOnly}
                            />
                          ) : isEditing ? (
                            <input
                              // The edit starts on an explicit double-click, so
                              // focus belongs in the editor straight away.
                              autoFocus
                              value={draft}
                              aria-label={t("editCell", {
                                column: tRoot(definition?.headerKey ?? cell.column.id),
                              })}
                              onChange={(event) => setDraft(event.target.value)}
                              onBlur={() => setEditing(null)}
                              onKeyDown={(event) => {
                                event.stopPropagation();
                                if (event.key === "Enter") {
                                  event.preventDefault();
                                  commitEdit(row.original, cell.column.id);
                                } else if (event.key === "Escape") {
                                  // RULE: Esc abandons the edit and restores the
                                  // stored value; only Enter writes (UI §4).
                                  event.preventDefault();
                                  setEditing(null);
                                }
                              }}
                              className="w-full rounded-k border border-k-blue px-s-1 text-fs-14"
                            />
                          ) : (
                            flexRender(cell.column.columnDef.cell, cell.getContext())
                          )}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            )}
          </table>
          {state !== "loading" && onCellEdit && !readOnly && (
            <p className="p-s-3 text-fs-14 text-k-text">{t("editHint")}</p>
          )}
        </div>
      )}
    </div>
  );
}
