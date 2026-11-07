"use client";

import { useState } from "react";
import { ASSET_TYPES } from "@/lib/finance/types";

// "Adds to holding" for an investment in Setup: pick an existing net-worth holding, or create one right here
// ("＋ New holding" → name, prefilled from the item, and a type). Submits holdingId = <id> | "new" | "".
export function HoldingPicker({ holdings, initialId, suggestedName, label = "📈 Adds to holding (Net worth)" }: {
  holdings: { id: number; name: string }[]; initialId?: number | null; suggestedName: string; label?: string;
}) {
  const [val, setVal] = useState(initialId ? String(initialId) : "");
  return (
    <div className="rounded-lg bg-emerald-50 p-2.5">
      <label className="text-xs font-medium text-emerald-800">{label}</label>
      <select name="holdingId" value={val} onChange={(e) => setVal(e.target.value)} className="input mt-1 w-full">
        <option value="">Don&apos;t track in net worth</option>
        {holdings.map((h) => <option key={h.id} value={h.id}>{h.name}</option>)}
        <option value="new">＋ New holding…</option>
      </select>
      {val === "new" && (
        <div className="mt-2 grid grid-cols-2 gap-2">
          <input name="newHoldingName" required defaultValue={suggestedName} placeholder="e.g. Groww MF" className="input w-full py-1.5 text-sm" />
          <select name="newHoldingType" required defaultValue="mutual_fund" className="input w-full py-1.5 text-sm">
            {ASSET_TYPES.filter((t) => t.key !== "bank" && t.key !== "cash").map((t) => <option key={t.key} value={t.key}>{t.icon} {t.label}</option>)}
          </select>
          <p className="col-span-2 text-[11px] text-emerald-700">Created in your Net worth tab when you save — add what you already have in it there (worth today, invested so far).</p>
        </div>
      )}
      {val !== "new" && val !== "" && <p className="mt-1 text-[11px] text-emerald-700">Every time you tick it paid, the amount is added to this holding&apos;s history and value.</p>}
    </div>
  );
}
