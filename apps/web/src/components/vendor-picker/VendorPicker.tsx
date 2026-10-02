"use client";

// S24 — ADR-0029
//
/**
 * VendorPicker — the contractor form's «Κωδικός SAP» field as a search over
 * eFinance's vendors: type a code or a name, pick a row, and the field holds
 * that vendor's code.
 *
 * | Prop       | Type                                              | Notes                                                              |
 * |------------|---------------------------------------------------|---------------------------------------------------------------------|
 * | id         | string                                            | The input's id, for the form's `<label htmlFor>`.                     |
 * | value      | string \| null                                    | The stored `sapVendorId`.                                             |
 * | onChange   | (value: string \| null) => void                   | Fires on every keystroke and on a pick. A blank field is `null`.       |
 * | search     | (q: string) => Promise<EFinanceVendor[]>?         | `GET /efinance/vendors?q=`, twenty at most. Omit it and the field is a plain text input. |
 * | debounceMs | number?                                           | Default 300.                                                         |
 * | invalid    | boolean?                                          | `aria-invalid`.                                                      |
 *
 * RULE (ADR-0029): the plain text input is the fallback, and it is always
 * there. What is typed IS the value; the list only helps fill it. So eFinance
 * not being configured (the API answers an empty list), a search that fails,
 * or a vendor eFinance does not list yet never stops anyone from entering a
 * code by hand.
 *
 * RULE (ADR-0029): a blocked vendor (and an inactive one) is shown but cannot
 * be picked, with the reason beside it — eFinance would refuse to post to it,
 * so eCapital does not offer it. A code typed by hand is not checked here.
 *
 * Keyboard: ↑/↓ move through the pickable rows, Enter picks, Esc closes. The
 * input is a combobox (`aria-expanded`, `aria-controls`, `aria-activedescendant`).
 *
 * State: default only, with its own inline «Αναζήτηση…», no-result and
 * search-failed lines — there is no page-level loading or error for a field.
 */
import { useEffect, useId, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import type { EFinanceVendor } from "@ecapital/shared";

export interface VendorPickerProps {
  id: string;
  value: string | null;
  onChange: (value: string | null) => void;
  search?: (q: string) => Promise<EFinanceVendor[]>;
  debounceMs?: number;
  invalid?: boolean;
}

/** Why a vendor cannot be picked, or null when it can. Blocked wins over inactive. */
export function vendorDisabledReason(vendor: Pick<EFinanceVendor, "blocked" | "active">): "blocked" | "inactive" | null {
  if (vendor.blocked) return "blocked";
  if (!vendor.active) return "inactive";
  return null;
}

type Status = "idle" | "loading" | "done" | "failed";

const MIN_QUERY_LENGTH = 2;

export function VendorPicker({ id, value, onChange, search, debounceMs = 300, invalid }: VendorPickerProps) {
  const t = useTranslations("components.vendor-picker");
  const listId = useId();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<EFinanceVendor[]>([]);
  const [status, setStatus] = useState<Status>("idle");
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [pickedName, setPickedName] = useState<string | null>(null);
  const requestRef = useRef(0);

  // Debounced search. `query` only changes when a person types — never on
  // mount or on a pick — so an existing code does not fire a request. The
  // synchronous state (idle / loading) is set by the keystroke handler below;
  // this effect only waits and then reports what came back.
  useEffect(() => {
    if (!search || query.trim().length < MIN_QUERY_LENGTH) return;
    const request = requestRef.current;
    const timer = window.setTimeout(() => {
      search(query.trim()).then(
        (items) => {
          if (request !== requestRef.current) return;
          setResults(items);
          setStatus("done");
          setActiveIndex(-1);
        },
        () => {
          if (request !== requestRef.current) return;
          setResults([]);
          setStatus("failed");
        },
      );
    }, debounceMs);
    return () => window.clearTimeout(timer);
  }, [query, search, debounceMs]);

  function pick(vendor: EFinanceVendor) {
    if (vendorDisabledReason(vendor)) return;
    requestRef.current += 1;
    onChange(vendor.vendorCode);
    setPickedName(vendor.name);
    setQuery("");
    setResults([]);
    setStatus("idle");
    setOpen(false);
    setActiveIndex(-1);
  }

  function move(step: 1 | -1) {
    if (results.length === 0) return;
    let index = activeIndex;
    for (let i = 0; i < results.length; i += 1) {
      index = (index + step + results.length) % results.length;
      if (!vendorDisabledReason(results[index])) {
        setActiveIndex(index);
        return;
      }
    }
  }

  const showList = Boolean(search) && open && status !== "idle";

  return (
    <div className="relative flex flex-col gap-s-1">
      <input
        id={id}
        type="text"
        role={search ? "combobox" : undefined}
        aria-autocomplete={search ? "list" : undefined}
        aria-expanded={search ? showList : undefined}
        aria-controls={search ? listId : undefined}
        aria-activedescendant={showList && activeIndex >= 0 ? `${listId}-${activeIndex}` : undefined}
        aria-invalid={invalid ? "true" : undefined}
        autoComplete="off"
        value={value ?? ""}
        onChange={(event) => {
          const next = event.target.value;
          onChange(next.trim() === "" ? null : next);
          setPickedName(null);
          // A new keystroke invalidates whatever is in flight or on screen.
          requestRef.current += 1;
          if (search && next.trim().length >= MIN_QUERY_LENGTH) {
            setStatus("loading");
          } else {
            setResults([]);
            setStatus("idle");
          }
          setQuery(next);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onKeyDown={(event) => {
          if (!search) return;
          if (event.key === "ArrowDown") {
            event.preventDefault();
            setOpen(true);
            move(1);
          } else if (event.key === "ArrowUp") {
            event.preventDefault();
            move(-1);
          } else if (event.key === "Enter" && showList && activeIndex >= 0) {
            // Picking must not also submit the form.
            event.preventDefault();
            pick(results[activeIndex]);
          } else if (event.key === "Escape" && showList) {
            event.preventDefault();
            setOpen(false);
          }
        }}
        className="num h-11 rounded-k border border-k-grey bg-k-white px-s-3 text-fs-16 text-k-ink"
      />

      {pickedName && (
        <p className="text-fs-14 text-k-text" data-testid="vendor-picked">
          {t("picked", { name: pickedName })}
        </p>
      )}

      {showList && (
        <ul
          id={listId}
          role="listbox"
          aria-label={t("listLabel")}
          className="absolute left-0 right-0 top-[48px] z-10 max-h-[320px] overflow-auto rounded-k border border-k-grey bg-k-white shadow-k"
        >
          {status === "loading" && <li className="px-s-3 py-s-2 text-fs-14 text-k-text">{t("searching")}</li>}
          {status === "failed" && <li className="px-s-3 py-s-2 text-fs-14 text-k-text">{t("failed")}</li>}
          {status === "done" && results.length === 0 && <li className="px-s-3 py-s-2 text-fs-14 text-k-text">{t("noResults")}</li>}
          {status === "done" &&
            results.map((vendor, index) => {
              const reason = vendorDisabledReason(vendor);
              return (
                <li
                  key={vendor.vendorCode}
                  id={`${listId}-${index}`}
                  role="option"
                  aria-selected={activeIndex === index}
                  aria-disabled={reason ? "true" : undefined}
                  // The input keeps focus: a blur before the click would close the list first.
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => pick(vendor)}
                  className={`flex min-h-[44px] flex-wrap items-baseline gap-x-s-3 px-s-3 py-s-2 text-fs-14 ${
                    reason ? "cursor-not-allowed text-k-text" : "cursor-pointer text-k-ink hover:bg-k-surface"
                  } ${activeIndex === index ? "bg-k-surface" : ""}`}
                >
                  <span className="num font-bold">{vendor.vendorCode}</span>
                  <span>{vendor.name}</span>
                  {vendor.vat && <span className="num text-fs-12 text-k-text">{t("vat", { vat: vendor.vat })}</span>}
                  {reason && <span className="text-fs-12 text-k-red">{t(reason)}</span>}
                </li>
              );
            })}
        </ul>
      )}
    </div>
  );
}
