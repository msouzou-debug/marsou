"use client";

import { useState } from "react";
import type { VatRate } from "@ecapital/shared";
import type { PreviewEntry } from "@/preview/types";
import { GrossAmount, VatRateSelect, VatSummary } from "./VatFields";

function Demo() {
  const [net, setNet] = useState("100000");
  const [rate, setRate] = useState<VatRate>("STANDARD_19");
  return (
    <div className="flex max-w-[520px] flex-col gap-s-3">
      <div className="flex items-end gap-s-4">
        <div className="flex flex-col gap-s-1">
          <label htmlFor="vat-demo-net" className="text-fs-14 text-k-text">
            Καθαρό ποσό
          </label>
          <input
            id="vat-demo-net"
            type="number"
            value={net}
            onChange={(event) => setNet(event.target.value)}
            className="num h-11 w-[220px] rounded-k border border-k-grey bg-k-white px-s-3 text-fs-16 text-k-ink"
          />
        </div>
        <VatRateSelect id="vat-demo-rate" value={rate} onChange={(event) => setRate(event.target.value as VatRate)} />
      </div>
      <VatSummary net={net === "" ? null : Number(net)} rate={rate} />
      <p className="text-fs-14 text-k-text">
        Πίνακας: <GrossAmount gross={119_000} net={100_000} vat={19_000} />
      </p>
    </div>
  );
}

const entry: PreviewEntry = {
  id: "vat-fields",
  title: "VatFields",
  states: { default: () => <Demo /> },
  notes:
    "State: default only — the select, the live summary and the table figure show values their " +
    "parent holds (ADR-0038). Nothing loads, so there is no loading, empty, error, no-permission " +
    "or offline state. Type a net and change the rate: «Ποσό ΦΠΑ» and «Σύνολο με ΦΠΑ» follow.",
};

export default entry;
