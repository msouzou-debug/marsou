"use client";

import { useTranslations } from "next-intl";
import type { ReactNode } from "react";

export interface WizardStep {
  id: string;
  label: string;
}

/**
 * WizardShell — one step at a time, left step rail on desktop, top progress
 * dots on phone (UI instructions §4 WizardShell, §2 breakpoints).
 *
 * | Prop         | Type                | Notes                                                      |
 * |--------------|---------------------|-------------------------------------------------------------|
 * | steps        | WizardStep[]        | Ordered steps, id + label                                    |
 * | current      | number              | Index of the step shown now (component is fully controlled)  |
 * | children     | ReactNode           | The current step's body                                      |
 * | onBack       | () => void          | Fired when Back is pressed (current > 0)                     |
 * | onNext       | () => void          | Fired when Continue/Submit is pressed and canContinue is true|
 * | canContinue  | boolean             | Disables the forward button when false                       |
 * | onStepChange | (index) => void     | Optional. Fired with the target index just before onBack/     |
 * |              |                     | onNext, so the caller can autosave the step being left        |
 *
 * Autosave itself is the caller's job (UI instructions §4): WizardShell only
 * tells the caller a step boundary was crossed, via onStepChange.
 *
 * RULE: the step body never scrolls on desktop at 1440x900. At that size the
 * shell chrome (56px top bar + step rail header + footer buttons) leaves
 * about 560px for the body — the class below caps it there and hides
 * overflow, so callers must design each step's content to fit within that
 * height rather than relying on a scrollbar.
 *
 * State: default only — WizardShell holds no data of its own to be loading,
 * empty, erroring, offline, or without permission; those apply to the step
 * content the caller renders as children.
 */
export interface WizardShellProps {
  steps: WizardStep[];
  current: number;
  children: ReactNode;
  onBack: () => void;
  onNext: () => void;
  canContinue: boolean;
  onStepChange?: (index: number) => void;
}

export function WizardShell({
  steps,
  current,
  children,
  onBack,
  onNext,
  canContinue,
  onStepChange,
}: WizardShellProps) {
  const t = useTranslations();
  const isLast = current === steps.length - 1;
  const canGoBack = current > 0;

  function handleBack() {
    if (!canGoBack) return;
    onStepChange?.(current - 1);
    onBack();
  }

  function handleNext() {
    if (!canContinue) return;
    onStepChange?.(current + 1);
    onNext();
  }

  return (
    <div className="flex flex-col desktop:flex-row desktop:gap-s-8">
      {/* Phone: top progress dots. Hidden from tablet up, where the rail takes over. */}
      <div
        className="flex items-center gap-s-2 p-s-4 desktop:hidden"
        role="progressbar"
        aria-valuemin={1}
        aria-valuemax={steps.length}
        aria-valuenow={current + 1}
        aria-label={t("components.wizard-shell.stepOf", { current: current + 1, total: steps.length })}
      >
        {steps.map((step, i) => (
          <span
            key={step.id}
            className={`h-s-2 flex-1 rounded-k-chip ${i <= current ? "bg-k-blue" : "bg-k-grey"}`}
          />
        ))}
      </div>

      {/* Desktop/tablet: left step rail. */}
      <nav
        aria-label={t("components.wizard-shell.stepOf", { current: current + 1, total: steps.length })}
        className="hidden desktop:block desktop:w-[220px] desktop:shrink-0"
      >
        <ol className="flex flex-col gap-s-2">
          {steps.map((step, i) => (
            <li
              key={step.id}
              aria-current={i === current ? "step" : undefined}
              className={`rounded-k p-s-3 text-fs-14 ${
                i === current
                  ? "bg-k-blue-bg text-k-blue-deep font-bold"
                  : i < current
                    ? "text-k-text"
                    : "text-k-text-muted"
              }`}
            >
              {step.label}
            </li>
          ))}
        </ol>
      </nav>

      <div className="flex-1">
        {/* RULE: fixed max height on desktop so the step body never scrolls
            at 1440x900 (UI instructions §4). Caller content must fit inside. */}
        <div className="desktop:max-h-[560px] desktop:overflow-hidden">{children}</div>

        <div className="mt-s-6 flex items-center justify-between border-t border-k-grey pt-s-4">
          <button
            type="button"
            onClick={handleBack}
            disabled={!canGoBack}
            className="rounded-k px-s-5 py-s-3 text-fs-14 text-k-blue disabled:text-k-text-muted disabled:cursor-not-allowed"
          >
            {t("common.back")}
          </button>
          <button
            type="button"
            onClick={handleNext}
            disabled={!canContinue}
            className="rounded-k bg-k-blue px-s-5 py-s-3 text-fs-14 font-bold text-k-white shadow-k disabled:bg-k-grey disabled:text-k-text-muted"
          >
            {isLast ? t("buttons.submit") : t("buttons.continue")}
          </button>
        </div>
      </div>
    </div>
  );
}
