"use client";

// S05 — R06
//
/**
 * MilestoneTimeline — the horizontal strip beneath the milestones table
 * (build brief: "a simple horizontal timeline, inline SVG, no chart
 * library"). One row per milestone, in the same order as the table; months
 * on the axis; every marker's meaning is also spelled out in an aria-label,
 * never left to colour or x-position alone.
 *
 * | Prop       | Type        | Notes                                          |
 * |------------|-------------|---------------------------------------------------|
 * | milestones | Milestone[] | Already sorted by `sortOrder`.                       |
 * | today      | Date?       | Injectable "now" for tests and the preview.          |
 */
import { useLocale, useTranslations } from "next-intl";
import type { Milestone } from "@ecapital/shared";
import { formatDate } from "@/lib/format";
import type { Locale } from "@/i18n/config";

export interface MilestoneTimelineProps {
  milestones: Milestone[];
  today?: Date;
}

const ROW_HEIGHT = 32;
const HEADER_HEIGHT = 28;
const LABEL_WIDTH = 200;
const PLOT_WIDTH = 520;
const RIGHT_PADDING = 16;
const DAY_MS = 86_400_000;
// A month's worth of breathing room on each side, so the first and last
// markers are never drawn flush against the plot's own edge.
const EDGE_PADDING_DAYS = 15;

function toTime(iso: string): number {
  return new Date(`${iso}T00:00:00Z`).getTime();
}

function monthStarts(minTime: number, maxTime: number): number[] {
  const ticks: number[] = [];
  const cursor = new Date(minTime);
  cursor.setUTCDate(1);
  cursor.setUTCHours(0, 0, 0, 0);
  while (cursor.getTime() <= maxTime) {
    ticks.push(cursor.getTime());
    cursor.setUTCMonth(cursor.getUTCMonth() + 1);
  }
  return ticks;
}

// A chart label, not a data value — long titles are abbreviated here the
// same way the S06 Μέτρα column truncates (that column's own header comment
// notes it as a deliberate exception to the no-ellipsis rule); the full
// title is still on the table row above and in this row's own aria-label
// and <title> tooltip.
function shortLabel(titleEl: string): string {
  return titleEl.length > 26 ? `${titleEl.slice(0, 25)}…` : titleEl;
}

export function MilestoneTimeline({ milestones, today = new Date() }: MilestoneTimelineProps) {
  const t = useTranslations();
  const locale = useLocale() as Locale;

  if (milestones.length === 0) return null;

  const todayTime = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
  const knownDates = milestones.flatMap((m) =>
    [m.baselineDate, m.forecastDate, m.actualDate].filter((d): d is string => d !== null),
  );
  const times = [...knownDates.map(toTime), todayTime];
  const minTime = Math.min(...times) - EDGE_PADDING_DAYS * DAY_MS;
  const maxTime = Math.max(...times) + EDGE_PADDING_DAYS * DAY_MS;
  const span = Math.max(DAY_MS, maxTime - minTime);
  const xOf = (time: number) => LABEL_WIDTH + ((time - minTime) / span) * PLOT_WIDTH;

  const ticks = monthStarts(minTime, maxTime);
  const monthFormat = new Intl.DateTimeFormat(locale === "en" ? "en-GB" : "el-GR", {
    month: "short",
    year: "2-digit",
    timeZone: "UTC",
  });

  const width = LABEL_WIDTH + PLOT_WIDTH + RIGHT_PADDING;
  const height = HEADER_HEIGHT + milestones.length * ROW_HEIGHT + 8;
  const todayLabel = t("screens.s05.timelineToday", { date: formatDate(today) });

  return (
    <div className="mt-s-4 overflow-auto rounded-k border border-k-grey bg-k-white p-s-3">
      <svg role="img" aria-label={t("screens.s05.timelineCaption")} viewBox={`0 0 ${width} ${height}`} width="100%" style={{ minWidth: width }}>
        {ticks.map((tick) => (
          <g key={tick}>
            <line x1={xOf(tick)} y1={HEADER_HEIGHT} x2={xOf(tick)} y2={height} stroke="var(--k-grey)" strokeWidth={1} />
            <text x={xOf(tick) + 4} y={16} fontSize={11} fill="var(--k-text)">
              {monthFormat.format(tick)}
            </text>
          </g>
        ))}

        <line
          x1={xOf(todayTime)}
          y1={HEADER_HEIGHT}
          x2={xOf(todayTime)}
          y2={height}
          stroke="var(--k-ink)"
          strokeWidth={2}
        >
          <title>{todayLabel}</title>
        </line>

        {milestones.map((milestone, index) => {
          const y = HEADER_HEIGHT + index * ROW_HEIGHT + ROW_HEIGHT / 2;
          const rowLabel = t("screens.s05.timelineRow", {
            title: milestone.titleEl,
            baseline: formatDate(milestone.baselineDate),
            forecast: milestone.forecastDate ? formatDate(milestone.forecastDate) : t("common.notAvailable"),
            actual: milestone.actualDate ? formatDate(milestone.actualDate) : t("common.notAvailable"),
          });
          return (
            <g key={milestone.id} role="img" aria-label={rowLabel}>
              <text x={4} y={y + 4} fontSize={12} fill="var(--k-ink)">
                {shortLabel(milestone.titleEl)}
                <title>{milestone.titleEl}</title>
              </text>
              <line x1={LABEL_WIDTH} y1={y} x2={LABEL_WIDTH + PLOT_WIDTH} y2={y} stroke="var(--k-grey)" strokeWidth={1} aria-hidden="true" />
              {/* Βάση: a small grey square — never editable, so it never
                  looks like the other two round markers (RULE: shape, not
                  only colour, carries the difference). */}
              <rect
                x={xOf(toTime(milestone.baselineDate)) - 4}
                y={y - 4}
                width={8}
                height={8}
                fill="var(--k-grey)"
                stroke="var(--k-ink)"
                strokeWidth={1}
                aria-hidden="true"
              />
              {milestone.forecastDate && (
                <circle cx={xOf(toTime(milestone.forecastDate))} cy={y} r={5} fill="var(--k-blue-deep)" aria-hidden="true" />
              )}
              {milestone.actualDate && (
                <circle cx={xOf(toTime(milestone.actualDate))} cy={y} r={5} fill="var(--k-green)" aria-hidden="true" />
              )}
            </g>
          );
        })}
      </svg>
    </div>
  );
}
