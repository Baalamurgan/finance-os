"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { setTreasurer } from "@/app/actions";

// Settlement hub picker. Changing it updates the `?hub=` query so the resolved
// settlement (and the link) is shareable instantly; "Set default" persists it
// to the month via setTreasurer so it's remembered without the query param.
export function HubSelect({
  members,
  value,
  y,
  m,
  householdId,
  periodId,
  label,
}: {
  members: { id: number; name: string }[];
  value: number | null;
  y: number;
  m: number;
  householdId: number;
  periodId: number;
  label: string;
}) {
  const router = useRouter();
  const [sel, setSel] = useState<number>(value ?? members[0]?.id ?? 0);

  return (
    <div className="flex flex-wrap items-center gap-2">
      <label className="text-xs text-slate-500">Hub for {label}</label>
      <select
        value={sel}
        onChange={(e) => {
          const id = Number(e.target.value);
          setSel(id);
          router.push(`/settlement?y=${y}&m=${m}&hub=${id}`);
        }}
        className="input"
      >
        {members.map((mm) => (
          <option key={mm.id} value={mm.id}>
            {mm.name}
          </option>
        ))}
      </select>
      <form action={setTreasurer}>
        <input type="hidden" name="householdId" value={householdId} />
        <input type="hidden" name="periodId" value={periodId} />
        <input type="hidden" name="treasurerMemberId" value={sel} />
        <button className="btn">Set default</button>
      </form>
    </div>
  );
}
