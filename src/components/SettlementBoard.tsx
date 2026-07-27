"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { formatINR } from "@/lib/format";
import { markSettled, unsettle, setTreasurer } from "@/app/actions";
import { ConfirmForm } from "@/components/ConfirmForm";

type PaidItem = { label: string; amount: number; category: string; kind: "sheet" | "spend" };
type Row = { id: number; name: string; contributed: number; paid: number; net: number; paidItems: PaidItem[] };
type Transfer = {
  fromId: number; from: string; toId: number; to: string; amount: number;
  settled: boolean; recordId: number | null; settledAt: Date | string | null; amountChanged: boolean;
};

export function SettlementBoard({
  y, m, householdId, periodId, isHead, currentMemberId, members,
  treasurerId, defaultId, treasurerName,
  transfers, rows, settledCount, total, allSettled,
}: {
  y: number; m: number; householdId: number; periodId: number; isHead: boolean;
  currentMemberId?: number | null;
  members: { id: number; name: string }[];
  treasurerId: number | null; defaultId: number | null; treasurerName: string | null;
  transfers: Transfer[]; rows: Row[]; settledCount: number; total: number; allSettled: boolean;
}) {
  // head, or the payer/receiver of a transfer, may mark it paid / undo it
  const canSettle = (t: Transfer) => isHead || currentMemberId === t.fromId || currentMemberId === t.toId;
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [sel, setSel] = useState<number>(treasurerId ?? members[0]?.id ?? 0);
  const isDefault = sel === defaultId;

  const changeHub = (id: number) => {
    setSel(id);
    startTransition(() => router.push(`/settlement?y=${y}&m=${m}&hub=${id}`));
  };
  const saveDefault = () => {
    const fd = new FormData();
    fd.set("householdId", String(householdId));
    fd.set("periodId", String(periodId));
    fd.set("treasurerMemberId", String(sel));
    startTransition(async () => {
      await setTreasurer(fd);
      router.refresh();
    });
  };
  const fmtDate = (d: Date | string) => new Date(d).toLocaleDateString("en-GB", { day: "2-digit", month: "short" });

  return (
    <div className="space-y-6">
      {isHead && (
        <div className="flex flex-wrap items-center gap-2 rounded-xl border border-slate-200 bg-white p-3">
          <label className="text-xs text-slate-500">Hub (treasurer)</label>
          <select
            value={sel}
            onChange={(e) => changeHub(Number(e.target.value))}
            disabled={pending}
            className="input disabled:opacity-50"
          >
            {members.map((mm) => (
              <option key={mm.id} value={mm.id}>{mm.name}</option>
            ))}
          </select>
          <button
            type="button"
            onClick={saveDefault}
            disabled={isDefault || pending}
            className="btn inline-flex items-center gap-2 disabled:opacity-40"
          >
            {pending && <span className="inline-block animate-spin">↻</span>}
            {isDefault ? "Default set" : "Set default"}
          </button>
        </div>
      )}

      {/* who owes whom */}
      <section className="rounded-xl border border-slate-200 bg-white p-5">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-semibold text-slate-700">
            Who owes whom {treasurerName && <span className="text-slate-400">(hub: {treasurerName})</span>}
          </h2>
          {total > 0 &&
            (allSettled ? (
              <span className="rounded-full bg-green-100 px-3 py-1 text-xs font-medium text-green-700">✓ Fully settled</span>
            ) : (
              <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-600">{settledCount} of {total} settled</span>
            ))}
        </div>

        {pending ? (
          <Skeleton rows={3} />
        ) : transfers.length === 0 ? (
          <p className="text-sm text-slate-400">All square — no transfers needed.</p>
        ) : (
          <ul className="space-y-2">
            {transfers.map((t, i) => (
              <li key={i} className={`flex flex-wrap items-center justify-between gap-3 rounded-lg px-4 py-3 ${t.settled ? "bg-green-50" : "bg-slate-50"}`}>
                <span className="text-sm">
                  <b className="text-slate-800">{t.from}</b>
                  <span className="mx-2 text-indigo-500">→</span>
                  <b className="text-slate-800">{t.to}</b>
                </span>
                <div className="flex items-center gap-3">
                  <span className="text-lg font-bold tabular-nums text-indigo-700">{formatINR(t.amount)}</span>
                  {t.settled ? (
                    <span className="flex items-center gap-2">
                      <span className="rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-700">
                        ✓ Settled{t.settledAt ? ` ${fmtDate(t.settledAt)}` : ""}
                      </span>
                      {t.amountChanged && (
                        <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-700">amount changed since</span>
                      )}
                      {canSettle(t) && t.recordId && (
                        <form action={unsettle}>
                          <input type="hidden" name="id" value={t.recordId} />
                          <button className="text-xs text-slate-400 hover:text-red-600">Undo</button>
                        </form>
                      )}
                    </span>
                  ) : (
                    canSettle(t) && (
                      <ConfirmForm action={markSettled} message={`Mark ${t.from} → ${t.to} ${formatINR(t.amount)} as paid?`}>
                        <input type="hidden" name="householdId" value={householdId} />
                        <input type="hidden" name="periodId" value={periodId} />
                        <input type="hidden" name="fromMemberId" value={t.fromId} />
                        <input type="hidden" name="toMemberId" value={t.toId} />
                        <input type="hidden" name="amount" value={t.amount} />
                        <button className="rounded-md bg-indigo-600 px-3 py-1 text-xs font-medium text-white hover:bg-indigo-700">Mark paid</button>
                      </ConfirmForm>
                    )
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* per-member breakdown */}
      <section className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
        {pending ? (
          <div className="p-4"><Skeleton rows={4} /></div>
        ) : (
          <table className="w-full min-w-[480px] text-sm">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 text-left text-slate-500">
                <th className="px-4 py-2">Member</th>
                <th className="px-4 py-2 text-right">Contributed</th>
                <th className="px-4 py-2 text-right">Paid</th>
                <th className="px-4 py-2 text-right">Net</th>
                <th className="px-4 py-2 text-right">Position</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const isTreasurer = treasurerId === r.id;
                return (
                  <tr key={r.id} className="border-b border-slate-100">
                    <td className="px-4 py-2 font-medium text-slate-800">
                      {r.name}
                      {isTreasurer && <span className="ml-2 rounded-full bg-indigo-100 px-2 py-0.5 text-[10px] font-medium text-indigo-700">treasurer</span>}
                    </td>
                    <td className="px-4 py-2 text-right tabular-nums text-slate-600">{formatINR(r.contributed)}</td>
                    <td className="px-4 py-2 text-right">
                      <PaidBreakdown name={r.name} paid={r.paid} items={r.paidItems} y={y} m={m} memberId={r.id} />
                    </td>
                    <td className={`px-4 py-2 text-right tabular-nums font-medium ${r.net > 0 ? "text-green-600" : r.net < 0 ? "text-red-600" : "text-slate-400"}`}>
                      {formatINR(r.net)}
                    </td>
                    <td className="px-4 py-2 text-right text-xs text-slate-500">
                      {isTreasurer ? "—" : r.net > 0 ? `pays ${treasurerName ?? "hub"}` : r.net < 0 ? `gets from ${treasurerName ?? "hub"}` : "settled"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}

function Skeleton({ rows }: { rows: number }) {
  return (
    <div className="animate-pulse space-y-2">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="h-10 rounded-lg bg-slate-100" />
      ))}
    </div>
  );
}

function PaidBreakdown({ name, paid, items, y, m, memberId }: { name: string; paid: number; items: PaidItem[]; y: number; m: number; memberId: number }) {
  const [open, setOpen] = useState(false);
  if (items.length === 0) return <span className="tabular-nums text-slate-400">{formatINR(paid)}</span>;
  return (
    <span
      className="relative inline-block"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="tabular-nums font-medium text-slate-700 underline decoration-dotted underline-offset-2 hover:text-indigo-700"
      >
        {formatINR(paid)}
      </button>
      {open && (
        <div className="absolute right-0 z-30 mt-1 w-64 rounded-xl border border-slate-200 bg-white p-3 text-left shadow-lg">
          <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
            {name} paid for
          </div>
          <ul className="max-h-56 space-y-1 overflow-y-auto">
            {items.map((it, i) => (
              <li key={i} className="flex items-start justify-between gap-2 text-xs">
                <span className="min-w-0">
                  <span className="text-slate-700">{it.label}</span>
                  <span className="ml-1 rounded bg-slate-100 px-1 text-[10px] text-slate-500">{it.category}</span>
                  {it.kind === "spend" && <span className="ml-1 text-[10px] text-amber-600">daily</span>}
                </span>
                <span className="shrink-0 tabular-nums text-slate-700">{formatINR(it.amount)}</span>
              </li>
            ))}
          </ul>
          <div className="mt-2 flex justify-between border-t border-slate-100 pt-1 text-xs font-semibold text-slate-800">
            <span>Total</span>
            <span className="tabular-nums">{formatINR(paid)}</span>
          </div>
          <Link
            href={`/expenses?y=${y}&m=${m}&member=${memberId}`}
            className="mt-2 block rounded-md bg-indigo-50 px-2 py-1.5 text-center text-[11px] font-medium text-indigo-700 hover:bg-indigo-100"
          >
            See {name}&apos;s daily spends (Misc) →
          </Link>
        </div>
      )}
    </span>
  );
}
