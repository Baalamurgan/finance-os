"use client";

import { useRef } from "react";
import { setSpendSubCategory } from "@/app/actions";

// A misc spend's reporting sub-category (Food, Travel…). A small select that submits
// on change — reporting only, never touches settlement or budgets. Shows as a subtle
// tag; "Uncategorized" until picked.
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
  const formRef = useRef<HTMLFormElement>(null);
  const icon = options.find((o) => o.name === value)?.icon;

  if (!canEdit) {
    return (
      <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-medium ${value ? "bg-indigo-50 text-indigo-500" : "bg-amber-50 text-amber-600"}`}>
        {value ? `${icon ?? ""} ${value}` : "uncategorized"}
      </span>
    );
  }

  return (
    <form ref={formRef} action={setSpendSubCategory}>
      <input type="hidden" name="id" value={id} />
      <select
        name="subCategory"
        defaultValue={value ?? ""}
        onChange={() => formRef.current?.requestSubmit()}
        aria-label="Kind of spend"
        className={`max-w-[9rem] truncate rounded-full border-0 px-1.5 py-0.5 text-[10px] font-medium outline-none ${value ? "bg-indigo-50 text-indigo-600" : "bg-amber-50 text-amber-700"}`}
      >
        <option value="">uncategorized</option>
        {options.map((o) => (
          <option key={o.name} value={o.name}>{o.icon} {o.name}</option>
        ))}
      </select>
    </form>
  );
}
