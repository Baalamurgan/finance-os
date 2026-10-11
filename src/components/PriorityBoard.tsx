"use client";

import { useEffect, useMemo, useState } from "react";
import { formatINR } from "@/lib/format";
import { rankPayables, type Payable, type PayableTier, type RankedPayable } from "@/lib/priority/rank";

const LS_BAL = "priority:balance";
const LS_OVR = "priority:overrides";

// formatINR rounds to whole rupees; the cost-of-waiting figures are often small (₹11.85), so show
// 2 decimals for non-integer amounts under ₹1,000 and fall back to the whole-rupee format otherwise.
function inr2(x: number): string {
  if (Math.abs(x) >= 1000 || Number.isInteger(x)) return formatINR(x);
  return `₹${x.toFixed(2)}`;
}
function fmtCost(cost: number, recurring: boolean): string {
  if (cost <= 0.005) return "—";
  return `${inr2(cost)}${recurring ? "/mo" : " once"}`;
}

/**
 * Read-only "where should this month's money go" board. You type the balance; the engine
 * ([[rankPayables]]) ranks every loan + penalty bill by its cost of waiting and fills the balance,
 * mandatory first. Nothing is saved to the server — the typed balance and your must-pay overrides
 * live only in this browser.
 */
export function PriorityBoard({ payables, monthLabel }: { payables: Payable[]; monthLabel: string }) {
  const [balanceStr, setBalanceStr] = useState("");
  const [sortBy, setSortBy] = useState<"efficiency" | "cost">("efficiency");
  const [overrides, setOverrides] = useState<Record<string, PayableTier>>({});
  const [ready, setReady] = useState(false);

  useEffect(() => {
    try {
      const b = localStorage.getItem(LS_BAL);
      if (b) setBalanceStr(b);
      const o = localStorage.getItem(LS_OVR);
      if (o) setOverrides(JSON.parse(o) as Record<string, PayableTier>);
    } catch {
      /* private window / blocked storage — start empty */
    }
    setReady(true);
  }, []);
  useEffect(() => {
    if (ready) try { localStorage.setItem(LS_BAL, balanceStr); } catch {}
  }, [balanceStr, ready]);
  useEffect(() => {
    if (ready) try { localStorage.setItem(LS_OVR, JSON.stringify(overrides)); } catch {}
  }, [overrides, ready]);

  const balance = Math.max(0, Number(balanceStr.replace(/[^0-9.]/g, "")) || 0);
  const result = useMemo(
    () => rankPayables({ payables, balance, sortBy, overrides }),
    [payables, balance, sortBy, overrides],
  );

  const flip = (id: string, to: PayableTier) => setOverrides((o) => ({ ...o, [id]: to }));
  const hasOverrides = Object.keys(overrides).length > 0;
  const entered = balance > 0;

  if (payables.length === 0) {
    return (
      <div className="rounded-xl border border-slate-200 bg-white p-6 text-center text-sm text-slate-500">
        No loans or penalty-bearing bills to prioritise for {monthLabel}. Add a loan&rsquo;s interest rate
        in <span className="font-medium">Loans &amp; Chits</span>, or a tax bill&rsquo;s late penalty in
        Setup, and it will show up here.
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-bold text-slate-900">Priority — {monthLabel}</h1>
        <p className="mt-1 text-sm text-slate-500">
          When the month&rsquo;s money can&rsquo;t cover everything, this ranks each payable by what it
          costs to <em>wait</em> — and splits your balance accordingly. It&rsquo;s advice only:
          nothing here is saved or sent anywhere.
        </p>
      </div>

      {/* Controls */}
      <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <label className="block text-sm font-medium text-slate-700">I have this much to deploy this month</label>
        <div className="mt-1.5 flex items-center gap-2">
          <span className="text-lg font-semibold text-slate-400">₹</span>
          <input
            inputMode="decimal"
            value={balanceStr}
            onChange={(e) => setBalanceStr(e.target.value)}
            placeholder="30,000"
            className="w-44 rounded-lg border border-slate-300 px-3 py-2 text-lg font-semibold tabular-nums shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
          />
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-2">
          <span className="text-xs font-medium uppercase tracking-wide text-slate-400">Rank by</span>
          <div className="inline-flex overflow-hidden rounded-lg border border-slate-300">
            <button
              onClick={() => setSortBy("efficiency")}
              className={`px-3 py-1.5 text-sm font-medium transition ${sortBy === "efficiency" ? "bg-indigo-600 text-white" : "bg-white text-slate-600 hover:bg-slate-50"}`}
            >
              Efficiency · ₹saved / ₹100
            </button>
            <button
              onClick={() => setSortBy("cost")}
              className={`border-l border-slate-300 px-3 py-1.5 text-sm font-medium transition ${sortBy === "cost" ? "bg-indigo-600 text-white" : "bg-white text-slate-600 hover:bg-slate-50"}`}
            >
              Cost · ₹/mo
            </button>
          </div>
          {hasOverrides && (
            <button onClick={() => setOverrides({})} className="ml-auto text-xs font-medium text-slate-400 underline hover:text-slate-600">
              reset must-pay overrides
            </button>
          )}
        </div>
        <p className="mt-2 text-[11px] text-slate-400">
          Costs mix monthly (loans, tax penalties) and one-time (incentives you&rsquo;d forfeit) — the
          column shows which, so you can judge the sort.
        </p>
      </div>

      {entered && (
        <>
          {result.shortfall > 0.005 && (
            <div className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800">
              ⚠ Your balance is <span className="font-semibold">{formatINR(result.shortfall)}</span> short of
              the must-pay items alone. Everything below the shortfall can&rsquo;t be covered — consider which
              must-pay items can flip to deferrable, or find more cash.
            </div>
          )}

          {/* Summary */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Stat label="Allocated" value={formatINR(result.spent)} />
            <Stat label="Left over" value={formatINR(result.leftover)} />
            <Stat label="Penalty avoided" value={inr2(result.penaltyAvoided)} tone="good" />
            <Stat label="Deferring costs" value={inr2(result.penaltyIncurred)} tone={result.penaltyIncurred > 0.005 ? "bad" : undefined} />
          </div>
        </>
      )}

      {/* Mandatory tier */}
      {result.mandatory.length > 0 && (
        <Section
          title="Must pay first"
          caption="Essentials & EMIs — paid in listed order before anything optional (default/eviction risk, not a % you can skip)."
        >
          {result.mandatory.map((r) => (
            <PayRow key={r.id} r={r} entered={entered} onFlip={() => flip(r.id, "deferrable")} flipLabel="Make deferrable" />
          ))}
        </Section>
      )}

      {/* Deferrable tier */}
      {result.deferrable.length > 0 && (
        <Section
          title="Prioritise the rest"
          caption={`Ranked by ${sortBy === "efficiency" ? "₹ saved per ₹100 paid" : "₹ cost of waiting"}. The balance fills top-down; loans take partial payments, whole bills are all-or-nothing.`}
        >
          {result.deferrable.map((r) => (
            <PayRow key={r.id} r={r} entered={entered} onFlip={() => flip(r.id, "mandatory")} flipLabel="Mark must-pay" />
          ))}
        </Section>
      )}
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: "good" | "bad" }) {
  const color = tone === "good" ? "text-emerald-600" : tone === "bad" ? "text-rose-600" : "text-slate-900";
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
      <div className="text-[11px] font-medium uppercase tracking-wide text-slate-400">{label}</div>
      <div className={`mt-0.5 text-lg font-bold tabular-nums ${color}`}>{value}</div>
    </div>
  );
}

function Section({ title, caption, children }: { title: string; caption: string; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="text-sm font-bold uppercase tracking-wide text-slate-700">{title}</h2>
      <p className="mb-2 mt-0.5 text-xs text-slate-400">{caption}</p>
      <div className="space-y-2">{children}</div>
    </section>
  );
}

function VerdictBadge({ r, entered }: { r: RankedPayable; entered: boolean }) {
  if (!entered) return null;
  const map = {
    pay: { cls: "bg-emerald-50 text-emerald-700 ring-emerald-200", txt: "PAY" },
    partial: { cls: "bg-amber-50 text-amber-700 ring-amber-200", txt: "PARTIAL" },
    defer: { cls: "bg-slate-100 text-slate-500 ring-slate-200", txt: "DEFER" },
  }[r.verdict];
  return <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold ring-1 ${map.cls}`}>{map.txt}</span>;
}

function PayRow({ r, entered, onFlip, flipLabel }: { r: RankedPayable; entered: boolean; onFlip: () => void; flipLabel: string }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-3 shadow-sm">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            {r.overridden && <span title="tier overridden" className="text-[10px] text-indigo-500">⟳</span>}
            <span className="truncate font-medium text-slate-900">{r.label}</span>
          </div>
          {r.sub && <div className="mt-0.5 text-xs text-slate-500">{r.sub}</div>}
        </div>
        <VerdictBadge r={r} entered={entered} />
      </div>

      <div className="mt-2 grid grid-cols-3 gap-2 text-xs">
        <Cell label="Due / max" value={formatINR(r.amount)} />
        <Cell label="Cost to wait" value={fmtCost(r.costOfWaiting, r.recurring)} />
        <Cell label="₹saved / ₹100" value={r.costOfWaiting > 0.005 ? `₹${r.efficiency.toFixed(2)}` : "—"} />
      </div>

      <div className="mt-2.5 flex items-center justify-between gap-2">
        <div className="text-sm">
          {!entered ? (
            <span className="text-slate-400">enter a balance to see the plan</span>
          ) : r.verdict === "pay" ? (
            <span className="font-semibold text-emerald-700">✓ Pay {formatINR(r.allocated)}</span>
          ) : r.verdict === "partial" ? (
            <span className="font-semibold text-amber-700">
              ◐ Pay {formatINR(r.allocated)} of {formatINR(r.amount)}
              <span className="ml-1 font-normal text-slate-400">· defer {formatINR(r.amount - r.allocated)}{r.deferredCost > 0.005 ? ` (costs ${fmtCost(r.deferredCost, r.recurring)})` : ""}</span>
            </span>
          ) : (
            <span className="text-slate-500">
              ⏸ Defer{r.deferredCost > 0.005 ? <span className="text-rose-600"> · costs {fmtCost(r.deferredCost, r.recurring)}</span> : ""}
            </span>
          )}
        </div>
        <button onClick={onFlip} className="shrink-0 text-[11px] font-medium text-slate-400 underline hover:text-indigo-600">
          {flipLabel}
        </button>
      </div>
    </div>
  );
}

function Cell({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md bg-slate-50 px-2 py-1.5">
      <div className="text-[10px] uppercase tracking-wide text-slate-400">{label}</div>
      <div className="font-semibold tabular-nums text-slate-700">{value}</div>
    </div>
  );
}
