"use client";

// Preview-only harness for `VendorPicker`: holds the field's value the way the
// contractor form does, and takes the search it should use from a `mode`, so
// the server-rendered gallery page passes a string rather than a function.
import { useState } from "react";
import { buildEFinanceVendorList } from "@/mocks/efinance";
import { VendorPicker, type VendorPickerProps } from "./VendorPicker";

export type VendorPickerDemoMode = "results" | "pending" | "none" | "failing" | "plain";

const SEARCHES: Record<VendorPickerDemoMode, VendorPickerProps["search"]> = {
  results: async () => buildEFinanceVendorList().items,
  pending: () => new Promise(() => undefined),
  none: async () => [],
  failing: async () => Promise.reject(new Error("502")),
  plain: undefined,
};

export function VendorPickerDemo({ mode }: { mode: VendorPickerDemoMode }) {
  const [value, setValue] = useState<string | null>(null);
  return (
    <div className="max-w-[420px]">
      <label htmlFor="vp-demo" className="text-fs-14 text-k-text">
        Κωδικός SAP
      </label>
      <VendorPicker id="vp-demo" value={value} onChange={setValue} search={SEARCHES[mode]} />
    </div>
  );
}
