/**
 * The eFinance work that runs on a timer has no caller: no request, no token,
 * no `app.user_id`. It runs inside the same row-level-security transaction a
 * request gets, under one fixed service identity with the administrator's
 * role, so the policies decide what it may touch exactly as they would for a
 * person — and the audit trigger records `system:efinance` as the actor,
 * which is the truth about who made the change (ADR-0029 §6).
 */
import type { RlsContext } from "../db/client";

export const EFINANCE_SYSTEM_CONTEXT: RlsContext = Object.freeze({
  userId: "system:efinance",
  roles: ["admin"],
  orgUnitIds: [],
  ip: null,
  // ADR-0033: code, not a role — the matrix does not apply to it.
  system: true,
}) as RlsContext;

/** The injection token for the one EFinanceClient the process holds. */
export const EFINANCE_CLIENT = Symbol("ecapital.efinance.client");
