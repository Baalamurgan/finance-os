"use client";

import { useState } from "react";
import { formatINR } from "@/lib/format";
import { toggleIncomeRepeat, toggleExpenseRepeat, toggleHold } from "@/app/actions";

export type IncomeLine = { id: number; name: string; amount: number; member: string | null; repeats: boolean; isNew: boolean };
export type ExpenseLine = {
  id: number; name: string; amount: number; section: string; member: string | null;
  repeats: boolean; isNew: boolean; toggleKind: "expense" | "category"; targetId: number;
};

const SECTIONS = ["Loans", "Chits", "Monthly", "Misc"] as const;
const SECTION_LABEL: Record<string, string> = { Loans: "Loans", Chits: "Chits", Monthly: "Monthly", Misc: "Miscellaneous" };

export function RecurringSetup({
  income,
  expenses,
  readOnly,
}: {
  income: IncomeLine[];
  expenses: ExpenseLine[];
  readOnly: boolean;
}) {
  const [byMember, setByMember] = useState(false);

  const members = Array.from(
    new Set([...income.map((i) => i.member), ...expenses.map((e) => e.member)]),
  ).sort((a, b) => (a ?? "~").localeCompare(b ?? "~"));

  return (
    <section className="rounded-xl border border-slate-200 bg-white">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-4 py-3">
        <div>
          <h2 className="text-sm font-semibold text-slate-900">🔁 Repeats every month</h2>
          <p className="text-xs text-slate-500">
            What copies into next month. Turn a line <b>off</b> to keep it one-off (it won&apos;t copy).
          </p>
        </div>
        <div className="inline-flex rounded-lg border border-slate-200 p-0.5 text-xs font-medium">
          <button onClick={() => setByMember(false)} className={`rounded-md px-2.5 py-1 ${!byMember ? "bg-indigo-600 text-white" : "text-slate-500"}`}>
            By type
          </button>
          <button onClick={() => setByMember(true)} className={`rounded-md px-2.5 py-1 ${byMember ? "bg-indigo-600 text-white" : "text-slate-500"}`}>
            By member
          </button>
        </div>
      </div>

      <div className="divide-y divide-slate-100">
        {byMember ? (
          members.map((m) => {
            const inc = income.filter((i) => i.member === m);
            const exp = expenses.filter((e) => e.member === m);
            if (inc.length === 0 && exp.length === 0) return null;
            const total = inc.reduce((s, i) => s + i.amount, 0) - exp.reduce((s, e) => s + e.amount, 0);
            return (
              <Group key={m ?? "shared"} title={m ?? "Shared / pool"} rightNote={`net ${formatINR(total)}`}>
                {inc.map((i) => (
                  <LineRow key={`i${i.id}`} name={i.name} amount={i.amount} sub="income" positive repeats={i.repeats} isNew={i.isNew} readOnly={readOnly} action={toggleIncomeRepeat} field="id" id={i.id} />
                ))}
                {exp.map((e) => (
                  <LineRow key={`e${e.id}`} name={e.name} amount={e.amount} sub={SECTION_LABEL[e.section]} repeats={e.repeats} isNew={e.isNew} readOnly={readOnly}
                    action={e.toggleKind === "category" ? toggleHold : toggleExpenseRepeat} field={e.toggleKind === "category" ? "categoryId" : "id"} id={e.targetId} />
                ))}
              </Group>
            );
          })
        ) : (
          <>
            <Group title="Income" rightNote={formatINR(income.reduce((s, i) => s + i.amount, 0))}>
              {income.length === 0 ? <Empty /> : income.map((i) => (
                <LineRow key={i.id} name={i.name} amount={i.amount} sub={i.member ?? undefined} positive repeats={i.repeats} isNew={i.isNew} readOnly={readOnly} action={toggleIncomeRepeat} field="id" id={i.id} />
              ))}
            </Group>
            {SECTIONS.map((sec) => {
              const rows = expenses.filter((e) => e.section === sec);
              if (rows.length === 0) return null;
              return (
                <Group key={sec} title={SECTION_LABEL[sec]} rightNote={formatINR(rows.reduce((s, e) => s + e.amount, 0))}>
                  {rows.map((e) => (
                    <LineRow key={e.id} name={e.name} amount={e.amount} sub={e.member ?? undefined} repeats={e.repeats} isNew={e.isNew} readOnly={readOnly}
                      action={e.toggleKind === "category" ? toggleHold : toggleExpenseRepeat} field={e.toggleKind === "category" ? "categoryId" : "id"} id={e.targetId} />
                  ))}
                </Group>
              );
            })}
          </>
        )}
      </div>
    </section>
  );
}

function Group({ title, rightNote, children }: { title: string; rightNote?: string; children: React.ReactNode }) {
  return (
    <details open className="group">
      <summary className="flex cursor-pointer list-none items-center justify-between bg-slate-50/60 px-4 py-2 [&::-webkit-details-marker]:hidden">
        <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500">{title}</span>
        {rightNote && <span className="text-xs font-medium tabular-nums text-slate-500">{rightNote}</span>}
      </summary>
      <div className="divide-y divide-slate-100 px-2">{children}</div>
    </details>
  );
}

function Empty() {
  return <p className="px-2 py-3 text-xs text-slate-400">Nothing here.</p>;
}

function LineRow({
  name, amount, sub, positive, repeats, isNew, readOnly, action, field, id,
}: {
  name: string; amount: number; sub?: string; positive?: boolean; repeats: boolean; isNew: boolean;
  readOnly: boolean; action: (fd: FormData) => void | Promise<void>; field: string; id: number;
}) {
  return (
    <div className={`flex items-center justify-between gap-2 py-2 pl-2 pr-1 text-sm ${repeats ? "" : "opacity-55"}`}>
      <div className="min-w-0">
        <div className="flex items-center gap-1.5">
          <span className="truncate text-slate-800">{name}</span>
          {isNew && (
            <span className="animate-pulse rounded-full bg-emerald-100 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-emerald-600">
              New
            </span>
          )}
        </div>
        {sub && <div className="text-[11px] text-slate-400">{sub}</div>}
      </div>
      <div className="flex shrink-0 items-center gap-3">
        <span className={`tabular-nums ${positive ? "text-green-700" : "text-slate-700"}`}>{formatINR(amount)}</span>
        {readOnly ? (
          <span className="w-14 text-right text-[10px] text-slate-400">{repeats ? "repeats" : "one-off"}</span>
        ) : (
          <form action={action} title={repeats ? "Repeats next month — click to make one-off" : "One-off — click to repeat next month"}>
            <input type="hidden" name={field} value={id} />
            <button
              type="submit"
              aria-pressed={repeats}
              className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${repeats ? "bg-indigo-600" : "bg-slate-300"}`}
            >
              <span className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${repeats ? "translate-x-4" : "translate-x-0.5"}`} />
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
