"use client";

import { useState } from "react";
import { formatINR } from "@/lib/format";
import { PersonalSpendRowActions } from "@/components/personal/PersonalSpendRowActions";

type Cat = { id: number; name: string; icon: string | null };
type Card = { id: number; name: string; color: string };
type Spend = { id: number; categoryId: number; amount: number; note: string | null; date: string; cardAccountId: number | null };

export function PersonalSpendsView({
  spends,
  categories,
  cards = [],
  periodId,
}: {
  spends: Spend[];
  categories: Cat[];
  cards?: Card[];
  periodId: number;
}) {
  const [mode, setMode] = useState<"category" | "date" | "amount">("category");
  const catMap = new Map(categories.map((c) => [c.id, c]));
  const cardMap = new Map(cards.map((c) => [c.id, c]));
  const dateStr = (d: string) => new Date(d).toLocaleDateString("en-GB", { day: "2-digit", month: "short" });

  if (spends.length === 0) {
    return (
      <p className="rounded-xl border border-dashed border-slate-200 bg-white p-8 text-center text-sm text-slate-400">
        No spends yet this month. Tap the <b>＋ Spend</b> button.
      </p>
    );
  }

  const Row = ({ s, showCat }: { s: Spend; showCat?: boolean }) => {
    const cat = catMap.get(s.categoryId);
    const card = s.cardAccountId != null ? cardMap.get(s.cardAccountId) : undefined;
    return (
      <div className="flex items-center justify-between py-2.5 text-sm">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5">
            <span className="truncate text-slate-700">{s.note || cat?.name}</span>
            {card && (
              <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-500" title={`On ${card.name} — deferred until you pay the bill`}>
                <span className="h-1.5 w-1.5 rounded-full" style={{ background: card.color }} />💳 {card.name}
              </span>
            )}
          </div>
          <div className="text-xs text-slate-400">
            {showCat && cat ? `${cat.icon ?? ""} ${cat.name} · ` : ""}
            {dateStr(s.date)}
          </div>
        </div>
        <div className="flex items-center gap-2 pl-2">
          <span className={`tabular-nums ${card ? "text-slate-400" : "text-slate-700"}`}>{formatINR(s.amount)}</span>
          <PersonalSpendRowActions periodId={periodId} categories={categories} cards={cards} initial={{ id: s.id, categoryId: s.categoryId, amount: s.amount, note: s.note, cardAccountId: s.cardAccountId }} />
        </div>
      </div>
    );
  };

  let body: React.ReactNode;
  if (mode === "category") {
    const groups = new Map<number, Spend[]>();
    for (const s of spends) groups.set(s.categoryId, [...(groups.get(s.categoryId) ?? []), s]);
    const sorted = [...groups.entries()]
      .map(([id, items]) => ({ cat: catMap.get(id), items, total: items.reduce((t, x) => t + x.amount, 0) }))
      .filter((g) => g.cat)
      .sort((a, b) => b.total - a.total);
    body = (
      <div className="space-y-3">
        {sorted.map((g) => (
          <details key={g.cat!.id} open className="rounded-xl border border-slate-200 bg-white">
            <summary className="flex cursor-pointer list-none items-center justify-between px-4 py-3 [&::-webkit-details-marker]:hidden">
              <span className="font-medium text-slate-800">
                {g.cat!.icon} {g.cat!.name} <span className="ml-2 text-xs text-slate-400">({g.items.length})</span>
              </span>
              <span className="font-bold tabular-nums text-slate-700">{formatINR(g.total)}</span>
            </summary>
            <div className="divide-y divide-slate-100 border-t border-slate-100 px-4">
              {g.items.map((s) => (
                <Row key={s.id} s={s} />
              ))}
            </div>
          </details>
        ))}
      </div>
    );
  } else {
    const list = [...spends].sort((a, b) =>
      mode === "date" ? new Date(b.date).getTime() - new Date(a.date).getTime() : b.amount - a.amount,
    );
    body = (
      <div className="divide-y divide-slate-100 rounded-xl border border-slate-200 bg-white px-4">
        {list.map((s) => (
          <Row key={s.id} s={s} showCat />
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="inline-flex rounded-lg border border-slate-200 bg-white p-0.5 text-xs font-medium">
        {(["category", "date", "amount"] as const).map((m) => (
          <button
            key={m}
            onClick={() => setMode(m)}
            className={`rounded-md px-3 py-1.5 capitalize transition ${mode === m ? "bg-emerald-600 text-white" : "text-slate-500 hover:text-slate-800"}`}
          >
            {m === "amount" ? "Largest" : m}
          </button>
        ))}
      </div>
      {body}
    </div>
  );
}
