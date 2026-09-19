/**
 * The warn-and-flag sentences of R31, in both languages at once.
 *
 * The interface never machine-translates content (CAPEX-01 §6.1), so the
 * sentence is authored twice in src/i18n/{el,en}.json and the contract
 * number, the project title and the unit name go in as they were typed. The
 * figures are formatted per language, because «1.234.567 €» and «€1,234,567»
 * are the same number said two ways.
 */
import type { ContractWarning } from "@ecapital/shared";
import type { I18nService, Locale } from "../common/i18n.service";
import { type WarningFact, formatDate, formatEuro, formatPct } from "./contract-rows";

export interface WarningUnit {
  nameEl: string;
  nameEn: string;
}

export function toWarning(
  i18n: I18nService,
  fact: WarningFact,
  unit: WarningUnit,
): ContractWarning {
  return {
    key: fact.key,
    sentenceEl: sentence(i18n, fact, unit, "el"),
    sentenceEn: sentence(i18n, fact, unit, "en"),
    amount: fact.amount,
  };
}

function sentence(
  i18n: I18nService,
  fact: WarningFact,
  unit: WarningUnit,
  locale: Locale,
): string {
  const params: Record<string, string> = {
    contract: fact.facts.contract,
    project: fact.facts.project,
    unit: locale === "el" ? unit.nameEl : unit.nameEn,
  };
  if (fact.amount !== null) params.amount = formatEuro(fact.amount, locale);
  if (fact.facts.pct !== undefined) params.pct = formatPct(fact.facts.pct, locale);
  if (fact.facts.date !== undefined) params.date = formatDate(fact.facts.date);
  if (fact.facts.days !== undefined) params.days = String(fact.facts.days);
  if (fact.facts.count !== undefined) params.count = String(fact.facts.count);
  return i18n.translate(`warnings.${fact.key}`, locale, params);
}
