import { z } from "zod";

// ADR-0019 §4 — where the sibling systems live, so a screen can offer a link
// to them without a base URL compiled into it. Both are null when the
// deployment has not been told about that system, and every consumer must
// treat null as "do not show the link" rather than guessing a default: a
// link to the wrong host is worse than no link.
//
// eMAP is procurement (contracts, tenders, purchase orders); eFinance is the
// invoice and budget system. Neither is modified by eCapital — the traffic is
// one way, a link out, exactly as eFinance links out to eMAP today
// (INTEGRATION-eMAP §3).
export const ConfigLinks = z.object({
  emapUrl: z.string().nullable(),
  efinanceUrl: z.string().nullable(),
});
export type ConfigLinks = z.infer<typeof ConfigLinks>;
