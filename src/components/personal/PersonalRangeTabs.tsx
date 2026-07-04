"use client";

import { useRouter, useSearchParams } from "next/navigation";

const OPTS: { key: string; label: string }[] = [
  { key: "3", label: "3M" },
  { key: "6", label: "6M" },
  { key: "12", label: "1Y" },
  { key: "all", label: "All" },
];

export function PersonalRangeTabs({ active }: { active: string }) {
  const router = useRouter();
  const params = useSearchParams();

  const go = (key: string) => {
    const q = new URLSearchParams(params.toString());
    q.set("range", key);
    router.replace(`/personal/analysis?${q.toString()}`);
  };

  return (
    <div className="inline-flex rounded-lg border border-slate-200 bg-white p-0.5 text-xs font-medium">
      {OPTS.map((o) => (
        <button
          key={o.key}
          onClick={() => go(o.key)}
          className={`rounded-md px-3 py-1.5 transition ${active === o.key ? "bg-emerald-600 text-white" : "text-slate-500 hover:text-slate-800"}`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
