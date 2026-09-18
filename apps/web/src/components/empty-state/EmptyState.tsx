"use client";

/**
 * EmptyState — one sentence and one action, no illustration
 * (UI instructions §4 EmptyState).
 *
 * | Prop         | Type         | Notes                                    |
 * |--------------|--------------|-------------------------------------------|
 * | message      | string       | The one sentence explaining the empty case |
 * | actionLabel  | string       | Label for the single action button         |
 * | onAction     | () => void   | Called when the action button is pressed   |
 *
 * State: default only — this component has no data of its own to load,
 * fail, or go offline on, so §6 states beyond "default" do not apply.
 */
export interface EmptyStateProps {
  message: string;
  actionLabel: string;
  onAction: () => void;
}

export function EmptyState({ message, actionLabel, onAction }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center text-center p-s-8">
      <p className="mx-auto max-w-[400px] text-fs-16 text-k-text">{message}</p>
      <button
        type="button"
        onClick={onAction}
        className="mt-s-5 rounded-k bg-k-blue px-s-5 py-s-3 text-fs-14 font-bold text-k-white shadow-k"
      >
        {actionLabel}
      </button>
    </div>
  );
}
