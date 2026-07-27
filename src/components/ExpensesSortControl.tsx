"use client";

import { useRouter, useSearchParams } from "next/navigation";

type SortKey = "date" | "amount" | "member";
const OPTIONS: { key: SortKey; label: string; short: string }[] = [
  { key: "date", label: "Date", short: "Date" },
  { key: "amount", label: "Amount", short: "Amt" },
  { key: "member", label: "Member", short: "Who" },
];

// Subtle segmented control that sorts every category's spends. URL-driven (?sort=),
// so it preserves the month + any member filter and works with browser back/forward.
export function ExpensesSortControl({ sort }: { sort: SortKey }) {
  const router = useRouter();
  const params = useSearchParams();

  const pick = (key: SortKey) => {
    const next = new URLSearchParams(params.toString());
    next.set("sort", key);
    router.replace(`/expenses?${next.toString()}`, { scroll: false });
  };

  return (
    <div className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white p-0.5" role="group" aria-label="Sort spends">
      <span className="px-1.5 text-[10px] font-medium uppercase tracking-wide text-slate-400 sm:inline">Sort</span>
      {OPTIONS.map((o) => (
        <button
          key={o.key}
          type="button"
          onClick={() => pick(o.key)}
          aria-pressed={sort === o.key}
          className={`rounded-md px-2 py-1 text-xs font-medium transition ${
            sort === o.key ? "bg-indigo-600 text-white" : "text-slate-600 hover:bg-slate-100"
          }`}
        >
          <span className="hidden sm:inline">{o.label}</span>
          <span className="sm:hidden">{o.short}</span>
        </button>
      ))}
    </div>
  );
}
