"use client";

import { windDownMonth } from "@/app/actions";

export function WindDownButton({ periodId, label }: { periodId: number; label: string }) {
  return (
    <form
      action={windDownMonth}
      onSubmit={(e) => {
        if (
          !confirm(
            `Wind down ${label}?\n\nUnder-budget leftovers go to Piggy / sinking holds; ` +
              `over-budget amounts and misc spends are added to next month's sheet as expenses; ` +
              `the balance carries forward and ${label} is LOCKED. This can't be undone.`
          )
        ) {
          e.preventDefault();
        }
      }}
    >
      <input type="hidden" name="periodId" value={periodId} />
      <button type="submit" className="btn w-full">
        Wind down &amp; lock {label}
      </button>
    </form>
  );
}
