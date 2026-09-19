import type { ReactNode } from "react";

// Props:
// | Prop    | Type       | Notes                                          |
// |---------|------------|-------------------------------------------------|
// | eyebrow | ReactNode   | small caps label above the title; a node so a screen can set part of it in mono (ADR-0019: S07's contract reference) |
// | title   | string      | the h1 itself, sentence case                    |
// | action  | ReactNode?  | primary action, top right                       |
// | tabs    | ReactNode?  | optional row beneath the title (UI §2)          |
//
// Takes already-translated strings, not keys — callers resolve their own
// copy with useTranslations / getTranslations first.
export interface PageTitleProps {
  eyebrow: ReactNode;
  title: string;
  action?: ReactNode;
  tabs?: ReactNode;
}

export function PageTitle({ eyebrow, title, action, tabs }: PageTitleProps) {
  return (
    <div className="mb-s-6">
      <div className="flex flex-wrap items-start justify-between gap-s-4">
        <div>
          {/* .eyebrow inherits --k-text, not --k-text-muted: the eyebrow is
              12px and --k-text-muted fails contrast below 14px (UI §1, §7). */}
          <p className="eyebrow">{eyebrow}</p>
          <h1 className="text-fs-24">{title}</h1>
        </div>
        {action ? <div className="shrink-0">{action}</div> : null}
      </div>
      {tabs ? <div className="mt-s-4">{tabs}</div> : null}
    </div>
  );
}
