"use client";

import { useRouter, useSearchParams } from "next/navigation";

type HubTab = "networth" | "savings";
const TABS: { key: HubTab; label: string; icon: string }[] = [
  { key: "networth", label: "Net worth", icon: "📊" },
  { key: "savings", label: "Savings", icon: "🐷" },
];

// Sub-navigation for the Finance hub — Net worth and Savings (Cards moved to its own top-level tab).
// URL-driven (?tab=), preserves the month.
export function FinanceHubTabs({ tab }: { tab: HubTab; financeDue?: boolean }) {
  const router = useRouter();
  const params = useSearchParams();
  const pick = (key: HubTab) => {
    const next = new URLSearchParams(params.toString());
    next.set("tab", key);
    router.replace(`/personal/finance?${next.toString()}`, { scroll: false });
  };
  return (
    <div className="flex gap-1 overflow-x-auto rounded-xl border border-slate-200 bg-white p-1">
      {TABS.map((t) => (
        <button
          key={t.key}
          type="button"
          onClick={() => pick(t.key)}
          aria-pressed={tab === t.key}
          className={`relative flex-1 whitespace-nowrap rounded-lg px-3 py-2 text-sm font-medium transition ${
            tab === t.key ? "bg-emerald-600 text-white" : "text-slate-600 hover:bg-slate-100"
          }`}
        >
          <span className="mr-1">{t.icon}</span>{t.label}
        </button>
      ))}
    </div>
  );
}
