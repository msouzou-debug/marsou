/**
 * The body of `PATCH /contractors/:id`.
 *
 * `packages/shared` publishes `ContractorCreate` and stops there, because the
 * screens only ever create one. A change is every field of a create, each on
 * its own, plus the one field a create cannot set: `blacklisted`.
 *
 * RULE (R08, CAPEX-01 §10): blacklisting a company stops it taking new work
 * across all eleven units, so only an administrator may set it. Everyone else
 * is refused with errors.blacklistAdminOnly.
 */
import { ContractorCreate } from "@ecapital/shared";
import { z } from "zod";

export const ContractorUpdate = ContractorCreate.partial().extend({
  blacklisted: z.boolean().optional(),
});
export type ContractorUpdate = z.infer<typeof ContractorUpdate>;
