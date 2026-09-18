import type { Exception, OrgUnit, PortfolioResponse, Rag, UnitRow } from "@ecapital/shared";
import { formatEUR } from "@/lib/format";
import { orgUnits } from "./org-units";
import { computeRag, projects } from "./projects";

// S01 Χαρτοφυλάκιο — UI instructions §5. Builds the whole portfolio
// response from the project fixtures: KPI strip, the unit table
// (R03: portfolio dashboard with drill-through) and the "Χρειάζονται
// προσοχή" exceptions list (max eight).

/** % of the calendar year that has elapsed at `asOf`, UTC calendar year. */
function yearElapsedPct(asOf: Date): number {
  const year = asOf.getUTCFullYear();
  const start = Date.UTC(year, 0, 1);
  const end = Date.UTC(year + 1, 0, 1);
  return ((asOf.getTime() - start) / (end - start)) * 100;
}

// Deterministic hash -> a multiplier in [0.6, 1.4]. Used to give the
// sparkline months an organic-looking pace instead of a dead-straight
// ramp, without Math.random (which would make the fixture non-reproducible).
function seededWeight(key: string): number {
  let h = 0;
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) >>> 0;
  return 0.6 + ((h % 1000) / 1000) * 0.8;
}

/** 12 cumulative monthly points, deterministically paced, summing to `total`. */
function monthlyCumulative(total: number, seedPrefix: string): number[] {
  if (total <= 0) return Array(12).fill(0);
  const weights = Array.from({ length: 12 }, (_, i) => seededWeight(`${seedPrefix}-${i}`));
  const weightSum = weights.reduce((a, b) => a + b, 0);
  let acc = 0;
  const out: number[] = [];
  for (let i = 0; i < 12; i++) {
    acc += (total * weights[i]) / weightSum;
    out.push(Math.round(acc));
  }
  out[11] = Math.round(total); // fix rounding drift so the last point ties to the total
  return out;
}

type ReasonKind = ReturnType<typeof computeRag>["reasonKind"];

function reasonSentences(
  kind: ReasonKind,
  approvedBudget: number,
  committed: number,
  forecast: number,
): { el: string; en: string } {
  if (kind === "OVERCOMMITTED") {
    const over = formatEUR(committed - approvedBudget);
    return {
      el: `Οι δεσμεύσεις υπερβαίνουν τον εγκεκριμένο προϋπολογισμό κατά ${over}`,
      en: `Commitments exceed the approved budget by ${over}`,
    };
  }
  if (kind === "FORECAST_OVER") {
    const over = formatEUR(forecast - approvedBudget);
    return {
      el: `Η πρόβλεψη τελικού κόστους υπερβαίνει τον εγκεκριμένο προϋπολογισμό κατά ${over}`,
      en: `The forecast final cost exceeds the approved budget by ${over}`,
    };
  }
  return {
    el: "Οι δαπάνες υστερούν σημαντικά έναντι του χρονοδιαγράμματος του έργου",
    en: "Spending is running well behind the project's schedule",
  };
}

function buildUnitRow(orgUnit: OrgUnit, asOf: Date): UnitRow {
  const unitProjects = projects.filter((p) => p.orgUnitId === orgUnit.id);
  const approved = unitProjects.reduce((sum, p) => sum + p.ledgers.approved, 0);
  const spent = unitProjects.reduce((sum, p) => sum + p.ledgers.spent, 0);
  const rag = { green: 0, amber: 0, red: 0 };
  for (const p of unitProjects) {
    if (p.rag === "GREEN") rag.green++;
    else if (p.rag === "AMBER") rag.amber++;
    else rag.red++;
  }
  void asOf; // the sparkline's shape is fixed per unit; asOf only drives the KPI comparator
  return {
    orgUnit,
    projectCount: unitProjects.length,
    approved,
    spent,
    sparkline: {
      plan: monthlyCumulative(approved, `${orgUnit.id}-plan`),
      spend: monthlyCumulative(spent, `${orgUnit.id}-spend`),
    },
    rag,
  };
}

function buildExceptions(): Exception[] {
  const flagged = projects
    .filter((p): p is typeof p & { rag: Exclude<Rag, "GREEN"> } => p.rag !== "GREEN")
    .map((p) => {
      const unit = orgUnits.find((u) => u.id === p.orgUnitId);
      if (!unit) throw new Error(`Project ${p.id} references unknown org unit ${p.orgUnitId}`);
      const { reasonKind } = computeRag(
        p.ledgers.approved,
        p.ledgers.committed,
        p.ledgers.spent,
        p.ledgers.forecast,
        p.plannedStart,
        p.plannedFinish,
      );
      const sentences = reasonSentences(reasonKind, p.ledgers.approved, p.ledgers.committed, p.ledgers.forecast);
      const overage = Math.max(p.ledgers.committed - p.ledgers.approved, p.ledgers.forecast - p.ledgers.approved, 0);
      const exception: Exception = {
        id: `EXC-${p.id}`,
        projectId: p.id,
        orgUnitId: p.orgUnitId,
        sentenceEl: `${sentences.el} — ${p.titleEl}, ${unit.nameEl}`,
        sentenceEn: `${sentences.en} — ${p.titleEl}, ${unit.nameEn}`,
        severity: p.rag === "RED" ? "red" : "amber",
        href: `/projects/${p.id}`,
      };
      return { exception, severityWeight: p.rag === "RED" ? 2 : 1, overage };
    });

  // Red before amber, then by the size of the overage, so the most
  // material exceptions survive the eight-item cap (UI instructions §5).
  flagged.sort((a, b) => b.severityWeight - a.severityWeight || b.overage - a.overage);
  return flagged.slice(0, 8).map((f) => f.exception);
}

export function buildPortfolio(asOf: Date): PortfolioResponse {
  const kpis = projects.reduce(
    (acc, p) => ({
      approved: acc.approved + p.ledgers.approved,
      committed: acc.committed + p.ledgers.committed,
      spent: acc.spent + p.ledgers.spent,
      forecast: acc.forecast + p.ledgers.forecast,
    }),
    { approved: 0, committed: 0, spent: 0, forecast: 0 },
  );

  return {
    kpis: { ...kpis, yearElapsedPct: yearElapsedPct(asOf) },
    units: orgUnits
      .map((u) => buildUnitRow(u, asOf))
      .sort((a, b) => b.approved - a.approved), // UI instructions §5: default sort, approved budget descending
    exceptions: buildExceptions(),
    asOf: asOf.toISOString(),
  };
}
