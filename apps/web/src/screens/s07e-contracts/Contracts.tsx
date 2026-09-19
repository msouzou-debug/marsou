"use client";

// S07e — R08
//
/**
 * Contracts — the contract register across every project the caller may see.
 *
 * It exists because of ADR-0019: eFinance points an invoice's `contract_ref`
 * at `/contracts?q=<ref>`, and a clerk who lands there without a reference,
 * or with one that matches nothing, needs somewhere to be. The same screen
 * then doubles as the register a head of estates can search.
 *
 * | Prop         | Type                   | Notes                                                      |
 * |--------------|------------------------|-------------------------------------------------------------|
 * | items        | Contract[]             | Ignored in `noPermission` \| `loading` \| `error`.            |
 * | state        | ContractsScreenState   | Which of the five states to draw.                            |
 * | q            | string?                | The search term, echoed into the field.                      |
 * | onSearch     | (q: string) => void    | Pushes the term into the URL; the screen refetches.          |
 * | onRetry      | () => void?            | Wired to the error state's retry button.                     |
 * | noPermission | ReactNode              | The shell's `NoPermission`.                                  |
 *
 * A list and not a `Table`: the register is read one row at a time, on a
 * phone as often as on a desktop, and the export button CONVENTIONS.md asks
 * of every table belongs to the screens that are meant to be exported (S02's
 * project register). This one is a way through to a contract.
 */
import type { ReactNode } from "react";
import { useState, type FormEvent } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { Search } from "lucide-react";
import type { Contract } from "@ecapital/shared";
import { EmptyState } from "@/components/empty-state";
import { PageTitle } from "@/components/app-shell";
import { formatDate, formatEUR } from "@/lib/format";

export type ContractsScreenState = "default" | "loading" | "empty" | "error" | "noPermission";

export interface ContractsProps {
  items?: Contract[];
  state: ContractsScreenState;
  q?: string;
  onSearch?: (q: string) => void;
  onRetry?: () => void;
  noPermission: ReactNode;
}

export function Contracts({
  items = [],
  state,
  q = "",
  onSearch = () => undefined,
  onRetry,
  noPermission,
}: ContractsProps) {
  const t = useTranslations();
  const [term, setTerm] = useState(q);

  if (state === "noPermission") return <>{noPermission}</>;

  function submit(event: FormEvent) {
    event.preventDefault();
    onSearch(term.trim());
  }

  return (
    <>
      <PageTitle eyebrow={t("screens.s07e.eyebrow")} title={t("screens.s07e.title")} />

      <form onSubmit={submit} className="mb-s-6 flex flex-wrap items-end gap-s-3">
        <div className="flex min-w-[260px] flex-1 flex-col gap-s-2">
          <label htmlFor="contracts-q" className="text-fs-14 text-k-text">
            {t("screens.s07e.searchLabel")}
          </label>
          <input
            id="contracts-q"
            name="q"
            type="search"
            value={term}
            onChange={(event) => setTerm(event.target.value)}
            placeholder={t("screens.s07e.searchPlaceholder")}
            className="h-11 rounded-k border border-k-grey bg-k-white px-s-3 text-fs-16 text-k-text"
          />
        </div>
        <button
          type="submit"
          className="flex h-11 items-center gap-s-2 rounded-k border border-k-grey px-s-4 text-fs-14 font-bold text-k-blue-deep"
        >
          <Search size={20} strokeWidth={1.5} aria-hidden="true" />
          <span>{t("common.search")}</span>
        </button>
      </form>

      {state === "loading" && (
        <ul aria-hidden="true" aria-busy="true" className="grid gap-s-2">
          {[0, 1, 2, 3].map((i) => (
            <li key={i} className="h-[64px] animate-pulse rounded-k bg-k-grey" />
          ))}
        </ul>
      )}

      {state === "error" && (
        <div className="rounded-k border border-k-grey bg-k-white p-s-8 text-center">
          <p className="text-fs-16 text-k-ink">{t("states.error.loadFailed")}</p>
          {onRetry && (
            <button
              type="button"
              onClick={onRetry}
              className="mt-s-4 rounded-k border border-k-grey px-s-3 py-s-2 text-fs-14 text-k-blue-deep"
            >
              {t("common.retry")}
            </button>
          )}
        </div>
      )}

      {state === "empty" && (
        <EmptyState
          message={q ? t("screens.s07e.emptySearch", { q }) : t("screens.s07e.empty")}
          actionLabel={t("screens.s07e.clearSearch")}
          onAction={() => {
            setTerm("");
            onSearch("");
          }}
        />
      )}

      {state === "default" && (
        <ul className="grid gap-s-2" data-testid="contract-list">
          {items.map((contract) => (
            <li
              key={contract.id}
              className="flex flex-wrap items-baseline justify-between gap-s-3 rounded-k border border-k-grey bg-k-white px-s-4 py-s-3"
            >
              <div>
                {/* RULE (ADR-0019): the eCapital reference is what eFinance
                    stores against an invoice, so it is the first thing on the
                    row and it is mono — it is read character by character. */}
                <span className="num text-fs-12 text-k-text">{contract.ref}</span>
                <Link
                  href={`/contracts/${encodeURIComponent(contract.id)}`}
                  className="block text-fs-16 font-bold text-k-blue-deep underline-offset-2 hover:underline"
                >
                  {contract.contractorName}
                </Link>
                <p className="text-fs-14 text-k-text">
                  {contract.contractNo} · {formatDate(contract.awardDate)}
                </p>
              </div>
              <span className="num text-fs-16 text-k-ink">{formatEUR(contract.currentValue)}</span>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
