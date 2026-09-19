import type { CloseoutChecklist as CloseoutChecklistValue } from "@ecapital/shared";

export const EMPTY_CLOSEOUT: CloseoutChecklistValue = {
  barriersRemoved: false,
  areaCleaned: false,
  airBalanceRestored: false,
  systemsTestedAndReturned: false,
  fireSystemsReenabled: false,
  noteEl: null,
  clinicalAcceptanceById: null,
  clinicalAcceptanceByName: null,
  clinicalAcceptanceAt: null,
};
