// S10 — ADR-0036. The connector call and how its failures read.
import { ImportBatch } from "@ecapital/shared";
import { ApiError, apiMutate } from "@/data/client";
import type { ConnectorParams } from "./ConnectorCard";

/**
 * POST /cost/imports/sap-connector through the proxy; the answer is the new
 * batch. `dryRun: false` because the API defaults to a trial run, like the
 * upload; «Λήψη» on this card means import.
 */
export function postSapConnector(params: ConnectorParams): Promise<ImportBatch> {
  return apiMutate("/cost/imports/sap-connector", "POST", { ...params, dryRun: false }, ImportBatch);
}

export const COST_SOURCE_NOT_CONFIGURED = "errors.costSourceNotConfigured";

/**
 * RULE (ADR-0036): the connector key not being on the server yet is not the
 * person's fault. The API's own sentence shows as an info notice; every
 * other failure is an error.
 */
export function connectorOutcome(error: unknown): { kind: "notice" | "error"; message: string } {
  if (error instanceof ApiError) {
    return { kind: error.key === COST_SOURCE_NOT_CONFIGURED ? "notice" : "error", message: error.message };
  }
  return { kind: "error", message: String(error) };
}
