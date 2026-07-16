"use client";

import { useOptimistic, useTransition } from "react";
import { setSpendSubCategory } from "@/app/actions";

// A misc spend's reporting sub-category (Food, Travel…). A small select that submits
// on change — reporting only, never touches settlement or budgets. Shows as a subtle
// tag; "Uncategorized" until picked.
//
// Controlled via useOptimistic (NOT an uncontrolled form field): React 19 auto-resets
// uncontrolled inputs to their defaultValue after a form action, which made the pick
// snap back to the old value until a full refresh. A controlled optimistic value shows
// the pick instantly and settles on the revalidated server value.
export function SpendSubCategoryPicker({
  id,
  value,
  options,
  canEdit,
}: {
  id: number;
  value: string | null;
  options: { name: string; icon: string }[];
  canEdit: boolean;
}) {
  const [optimistic, setOptimistic] = useOptimistic(value ?? "");
  const [, startTransition] = useTransition();
  const icon = options.find((o) => o.name === optimistic)?.icon;

  if (!canEdit) {
    return (
      <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-medium ${optimistic ? "bg-indigo-50 text-indigo-500" : "bg-amber-50 text-amber-600"}`}>
        {optimistic ? `${icon ?? ""} ${optimistic}` : "uncategorized"}
      </span>
    );
  }

  return (
    <select
      value={optimistic}
      onChange={(e) => {
        const next = e.target.value;
        startTransition(async () => {
          setOptimistic(next);
          const fd = new FormData();
          fd.set("id", String(id));
          fd.set("subCategory", next);
          await setSpendSubCategory(fd);
        });
      }}
      aria-label="Kind of spend"
      className={`max-w-[9rem] truncate rounded-full border-0 px-1.5 py-0.5 text-[10px] font-medium outline-none ${optimistic ? "bg-indigo-50 text-indigo-600" : "bg-amber-50 text-amber-700"}`}
    >
      <option value="">uncategorized</option>
      {options.map((o) => (
        <option key={o.name} value={o.name}>{o.icon} {o.name}</option>
      ))}
    </select>
  );
}
