"use client";

import { windDownMonth } from "@/app/actions";

export function WindDownButton({ periodId, label }: { periodId: number; label: string }) {
  return (
    <form
      action={windDownMonth}
      onSubmit={(e) => {
        if (
          !confirm(
            `Wind down ${label}?\n\nThis moves each category's leftover to Piggy / sinking holds, ` +
              `carries the balance forward, pre-fills next month, and LOCKS ${label}. ` +
              `This can't be undone.`
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
