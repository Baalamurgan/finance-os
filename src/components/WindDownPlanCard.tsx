"use client";

import { useMemo, useState, useTransition } from "react";
import { saveWindDownChoices } from "@/app/actions";
import { useToast } from "@/components/Toast";
import { formatINR } from "@/lib/format";
import { planWindDown, type CutTarget, type Destination, type PlanRow, type SavedChoice } from "@/lib/windDownPlan";

// Wind-down "where the money goes": every budgeted category (and planned budget card) settles on its own
// unless you COMBINE some — then their leftovers cover their overspends first. A group that ends OVER is
// cut from next month's budgets (split shown, editable, must add up); one that ends with money LEFT sends
// it to Piggy or next month's income. Styled like the card-bill pay window's over (amber) / saved (green).
type G = { id: string; categoryIds: number[]; destination: Destination; cuts: Record<number, string> | null };

const r2 = (n: number) => Math.round(n * 100) / 100;

export function WindDownPlanCard({
  periodId, rows, targets, saved, memberNames, nextLabel, canEdit,
}: {
  periodId: number;
  rows: PlanRow[];
  targets: CutTarget[];
  saved: SavedChoice[];
  memberNames: Record<number, string>;
  nextLabel: string; // "DEC 2026"
  canEdit: boolean;
}) {
  const toast = useToast();
  const [saving, startSave] = useTransition();
  const initial = useMemo<G[]>(() => {
    const used = new Set<number>();
    const gs: G[] = [];
    for (const c of saved) {
      const ids = c.categoryIds.filter((id) => rows.some((r) => r.categoryId === id) && !used.has(id));
      if (!ids.length) continue;
      ids.forEach((id) => used.add(id));
      gs.push({ id: ids.join("-"), categoryIds: ids, destination: c.destination, cuts: c.cuts ? Object.fromEntries(c.cuts.map((x) => [x.categoryId, String(x.amount)])) : null });
    }
    for (const r of rows) if (!used.has(r.categoryId)) gs.push({ id: String(r.categoryId), categoryIds: [r.categoryId], destination: "piggy", cuts: null });
    return gs;
  }, [rows, saved]);
  const [groups, setGroups] = useState<G[]>(initial);
  const [dirty, setDirty] = useState(false);
  const [picking, setPicking] = useState(false);
  const [picked, setPicked] = useState<Set<number>>(new Set());

  const toChoices = (gs: G[]): SavedChoice[] => gs.map((g) => ({
    categoryIds: g.categoryIds,
    destination: g.destination,
    cuts: g.cuts ? Object.entries(g.cuts).map(([k, v]) => ({ categoryId: Number(k), amount: Number(v) || 0 })).filter((c) => c.amount > 0) : null,
  }));
  const plan = useMemo(() => planWindDown(rows, targets, toChoices(groups)), [rows, targets, groups]);
  const planOf = (g: G) => plan.groups.find((p) => p.categoryIds.length === g.categoryIds.length && p.categoryIds.every((id) => g.categoryIds.includes(id)));
  const rowOf = (id: number) => rows.find((r) => r.categoryId === id)!;
  const targetOf = (id: number) => targets.find((t) => t.categoryId === id);
  const mon = nextLabel.split(" ")[0];
  const monCap = mon.charAt(0) + mon.slice(1).toLowerCase();

  const update = (id: string, patch: Partial<G>) => { setGroups((gs) => gs.map((g) => (g.id === id ? { ...g, ...patch } : g))); setDirty(true); };
  const combine = () => {
    const ids = [...picked];
    if (ids.length < 2) return;
    setGroups((gs) => {
      const rest = gs.filter((g) => !g.categoryIds.some((id) => picked.has(id)));
      // categories of a touched group that weren't picked go back to being on their own
      const loose = gs.filter((g) => g.categoryIds.some((id) => picked.has(id))).flatMap((g) => g.categoryIds).filter((id) => !picked.has(id));
      return [{ id: ids.join("-"), categoryIds: ids, destination: "piggy", cuts: null }, ...rest, ...loose.map((id) => ({ id: String(id), categoryIds: [id], destination: "piggy" as Destination, cuts: null }))];
    });
    setPicked(new Set());
    setPicking(false);
    setDirty(true);
  };
  const splitUp = (g: G) => {
    setGroups((gs) => gs.flatMap((x) => (x.id === g.id ? x.categoryIds.map((id) => ({ id: String(id), categoryIds: [id], destination: "piggy" as Destination, cuts: null })) : [x])));
    setDirty(true);
  };

  // A group's edited split must add up to its overspend; a planned card's overspend needs a budget to go on.
  const problems = groups.map((g) => {
    const p = planOf(g);
    if (!p || p.over <= 0.005) return null;
    if (g.cuts) {
      const sum = r2(Object.values(g.cuts).reduce((t, v) => t + (Number(v) || 0), 0));
      if (Math.abs(sum - p.over) > 0.5) return `${formatINR(sum)} of ${formatINR(p.over)} placed`;
      for (const [k, v] of Object.entries(g.cuts)) {
        const t = targetOf(Number(k));
        if (t && (Number(v) || 0) > t.capacity + 0.005) return `${t.name} can take at most ${formatINR(t.capacity)}`;
      }
    } else if (p.needsTarget) return "pick a budget to take it";
    return null;
  });
  const blocked = problems.some(Boolean);

  const save = () => startSave(async () => {
    const res = await saveWindDownChoices({ periodId, groups: toChoices(groups) });
    toast(res.message, res.ok ? "success" : "error");
    if (res.ok) setDirty(false);
  });

  if (rows.length === 0) return null;
  const ordered = [...groups].sort((a, b) => b.categoryIds.length - a.categoryIds.length);

  return (
    <section className="space-y-3 rounded-xl border border-slate-200 bg-white p-4 sm:p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-slate-800">Where the money goes</h2>
          <p className="text-xs text-slate-500">Each budget on its own, or combine some so one&apos;s leftover covers another&apos;s overspend.</p>
        </div>
        {canEdit && (
          picking ? (
            <div className="flex shrink-0 gap-1.5">
              <button type="button" onClick={() => { setPicking(false); setPicked(new Set()); }} className="rounded-lg px-2.5 py-1.5 text-xs font-medium text-slate-500 hover:bg-slate-100">Cancel</button>
              <button type="button" disabled={picked.size < 2} onClick={combine} className="rounded-lg bg-indigo-600 px-2.5 py-1.5 text-xs font-semibold text-white disabled:opacity-40">Combine {picked.size || ""}</button>
            </div>
          ) : (
            <button type="button" onClick={() => setPicking(true)} className="shrink-0 rounded-lg border border-indigo-200 px-2.5 py-1.5 text-xs font-semibold text-indigo-700 hover:bg-indigo-50">＋ Combine</button>
          )
        )}
      </div>
      {picking && <p className="rounded-lg bg-indigo-50 px-3 py-2 text-xs text-indigo-800">Tick two or more budgets to settle together, then tap Combine.</p>}

      <div className="space-y-2.5">
        {ordered.map((g) => {
          const p = planOf(g);
          if (!p) return null;
          const multi = g.categoryIds.length > 1;
          const problem = problems[groups.indexOf(g)];
          const tone = p.over > 0.005 ? "border-amber-200" : p.left > 0.005 ? "border-emerald-200" : "border-slate-200";
          // the cut editor: the group's regular budgets + any other budget the split put a cut on
          const editIds = [...new Set([...g.categoryIds.filter((id) => targetOf(id)), ...Object.keys(g.cuts ?? {}).map(Number), ...p.cuts.map((c) => c.categoryId)])];
          const cutVal = (id: number) => (g.cuts ? g.cuts[id] ?? "" : String(p.cuts.find((c) => c.categoryId === id)?.amount ?? 0));
          const setCut = (id: number, v: string) => {
            const base = g.cuts ?? Object.fromEntries(editIds.map((x) => [x, String(p.cuts.find((c) => c.categoryId === x)?.amount ?? 0)]));
            update(g.id, { cuts: { ...base, [id]: v } });
          };
          const addable = targets.filter((t) => !editIds.includes(t.categoryId));
          return (
            <div key={g.id} className={`rounded-xl border-2 ${tone} bg-white`}>
              <div className="flex items-start gap-2 px-3 pt-2.5">
                {picking && (
                  <input type="checkbox" className="mt-1" checked={g.categoryIds.every((id) => picked.has(id))}
                    onChange={(e) => setPicked((s) => { const n = new Set(s); g.categoryIds.forEach((id) => (e.target.checked ? n.add(id) : n.delete(id))); return n; })} />
                )}
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="min-w-0 truncate text-sm font-semibold text-slate-800">{multi ? "🔗 " : ""}{g.categoryIds.map((id) => rowOf(id).name).join(" + ")}</span>
                    <span className={`shrink-0 text-sm font-bold tabular-nums ${p.over > 0.005 ? "text-amber-700" : p.left > 0.005 ? "text-emerald-700" : "text-slate-500"}`}>
                      {p.over > 0.005 ? `over ${formatINR(p.over)}` : p.left > 0.005 ? `left ${formatINR(p.left)}` : "even"}
                    </span>
                  </div>
                  <div className="text-[11px] text-slate-500">
                    Spent {formatINR(p.spent)} of {formatINR(p.budget)}
                    {multi && p.covered > 0.005 && <> · leftovers covered {formatINR(p.covered)}</>}
                  </div>
                  {multi && (
                    <div className="mt-1 space-y-0.5">
                      {g.categoryIds.map((id) => {
                        const r = rowOf(id);
                        const d = r2(r.budget - r.spent);
                        return (
                          <div key={id} className="flex justify-between gap-2 text-[11px] text-slate-500">
                            <span className="truncate">{r.name}{r.planned ? " · planned" : ""} <span className="text-slate-400">{formatINR(r.spent)} / {formatINR(r.budget)}</span></span>
                            <span className={`shrink-0 tabular-nums ${d < 0 ? "text-amber-700" : "text-emerald-700"}`}>{d < 0 ? `+${formatINR(-d)} over` : `${formatINR(d)} left`}</span>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
                {multi && canEdit && !picking && (
                  <button type="button" onClick={() => splitUp(g)} title="Split up" className="shrink-0 rounded-md px-1.5 text-sm text-slate-400 hover:bg-slate-100">✕</button>
                )}
              </div>

              <div className="space-y-2 p-3 pt-2">
                {p.over > 0.005 && (
                  <div className="rounded-xl border border-amber-200 bg-amber-50/60 p-3">
                    <p className="text-sm font-medium text-slate-700">{formatINR(p.over)} over → cut from {mon} budgets</p>
                    <div className="mt-2 space-y-1.5">
                      {editIds.map((id) => {
                        const t = targetOf(id);
                        if (!t) return null;
                        const val = Number(cutVal(id)) || 0;
                        return (
                          <div key={id} className="flex items-center justify-between gap-2">
                            <span className="min-w-0 text-[13px] text-slate-700">
                              {t.name}
                              <span className="block text-[10px] text-slate-400">{formatINR(t.capacity)} → {formatINR(Math.max(0, r2(t.capacity - val)))}</span>
                            </span>
                            {canEdit ? (
                              <input type="number" inputMode="decimal" step="0.01" min="0" value={cutVal(id)} onChange={(e) => setCut(id, e.target.value)}
                                className="w-28 rounded-lg border-2 border-amber-200 bg-white px-2 py-1 text-right text-sm font-semibold tabular-nums outline-none focus:border-amber-400" />
                            ) : <span className="text-sm font-semibold tabular-nums text-slate-700">{formatINR(val)}</span>}
                          </div>
                        );
                      })}
                    </div>
                    {canEdit && addable.length > 0 && (
                      <select value="" onChange={(e) => e.target.value && setCut(Number(e.target.value), "0")} className="input mt-2 w-full py-1.5 text-sm">
                        <option value="">＋ Put some on another budget…</option>
                        {addable.map((t) => <option key={t.categoryId} value={t.categoryId}>{t.name} ({formatINR(t.capacity)})</option>)}
                      </select>
                    )}
                    {g.cuts && canEdit && <button type="button" onClick={() => update(g.id, { cuts: null })} className="mt-1.5 text-[11px] font-medium text-indigo-600">↺ Back to automatic split</button>}
                    {problem && <p className="mt-1.5 text-[11px] font-semibold text-red-600">⚠ {problem}</p>}
                    {!problem && p.overflow > 0.005 && <p className="mt-1.5 text-[11px] text-amber-800">{formatINR(p.overflow)} can&apos;t fit in any budget → a one-off expense in {mon} (from the pool).</p>}
                  </div>
                )}

                {p.left > 0.005 && (
                  <div className="rounded-xl border border-emerald-200 bg-emerald-50/60 p-3">
                    <p className="text-sm font-medium text-slate-700">{formatINR(p.left)} left goes to</p>
                    <div className="mt-1.5 grid grid-cols-2 gap-1.5">
                      {([["piggy", "🐷 Piggy"], ["income", `➕ ${monCap} income`]] as const).map(([k, l]) => (
                        <button key={k} type="button" disabled={!canEdit} onClick={() => update(g.id, { destination: k })}
                          className={`rounded-lg border-2 px-1.5 py-2 text-[12px] font-medium ${g.destination === k ? "border-emerald-500 bg-white text-emerald-700" : "border-slate-200 bg-white text-slate-500"} disabled:cursor-default`}>{l}</button>
                      ))}
                    </div>
                  </div>
                )}

                {(p.credits.length > 0 || p.holds.length > 0) && (
                  <p className="rounded-lg bg-sky-50 px-2.5 py-1.5 text-[11px] text-sky-900">
                    {monCap} settlement:{" "}
                    {[
                      ...p.credits.map((c) => `${memberNames[c.holderId] ?? "?"} ↩ +${formatINR(c.amount)} (${c.name} overspend)`),
                      ...p.holds.map((h) => `${memberNames[h.holderId] ?? "?"} −${formatINR(h.amount)} (${h.name} leftover)`),
                    ].join(" · ")}
                  </p>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {canEdit && (
        <div className="flex items-center justify-between gap-3 border-t border-slate-100 pt-3">
          <p className="text-[11px] text-slate-400">{dirty ? "Not saved yet." : `The wind-down and ${mon}'s preview follow these choices.`}</p>
          <button type="button" onClick={save} disabled={!dirty || blocked || saving} className="min-h-10 rounded-xl bg-indigo-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-40">
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      )}
    </section>
  );
}
