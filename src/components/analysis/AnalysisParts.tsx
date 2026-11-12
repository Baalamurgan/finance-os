import type { ReactNode } from "react";
import { formatINR, pctLabel } from "@/lib/format";
import { CountUp } from "@/components/motion/CountUp";

// Building blocks shared by the family and personal Analysis tabs. Server-safe (no hooks); the only moving
// parts are CSS entrances (bars fill, the ring draws) and CountUp on the headline figures.

export type Tone = "family" | "personal";
const ACCENT: Record<Tone, { text: string; ring: string; bar: string }> = {
  family: { text: "text-indigo-700", ring: "#4f46e5", bar: "bg-indigo-500" },
  personal: { text: "text-emerald-700", ring: "#10b981", bar: "bg-emerald-500" },
};

/** Signed rupees: "₹1,200" / "-₹1,200". */
export const signedINR = (n: number) => (n < 0 ? `-${formatINR(Math.abs(n))}` : formatINR(n));

/** Signed rate for display ("12%", "<1%", "-8%"). pctLabel is for 0–100 shares only. */
export function rateLabel(pct: number) {
  if (!Number.isFinite(pct) || pct === 0) return "0%";
  if (pct > 0 && pct < 1) return "<1%";
  if (pct < 0 && pct > -1) return "-<1%";
  return `${Math.round(pct)}%`;
}

// ── Card shell ──────────────────────────────────────────────────────────────────────────────────────────
export function Panel({ title, sub, right, children, className = "" }: { title: string; sub?: ReactNode; right?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`rounded-2xl border border-slate-200 bg-white p-4 sm:p-5 ${className}`}>
      <div className="mb-3 flex flex-wrap items-start justify-between gap-x-3 gap-y-1">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-slate-800">{title}</h2>
          {sub && <p className="mt-0.5 text-xs text-slate-400">{sub}</p>}
        </div>
        {right}
      </div>
      {children}
    </section>
  );
}

// ── "▲ 12% vs Oct" ──────────────────────────────────────────────────────────────────────────────────────
/** Change vs an earlier figure. `upIsGood` decides the colour (spending going up is bad). Hidden when there
 *  is nothing to compare with. */
export function Delta({ now, prev, vs, upIsGood }: { now: number; prev: number | null | undefined; vs: string; upIsGood: boolean }) {
  if (prev == null || prev === 0) return null;
  const pct = ((now - prev) / Math.abs(prev)) * 100;
  if (!Number.isFinite(pct)) return null;
  const flat = Math.abs(pct) < 0.5;
  const up = pct > 0;
  const good = flat ? null : up === upIsGood;
  const tone = good == null ? "bg-slate-100 text-slate-500" : good ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-400" : "bg-red-50 text-red-600 dark:bg-red-500/15 dark:text-red-400";
  const shown = Math.abs(pct) >= 1000 ? ">999%" : `${Math.abs(pct) < 1 ? "<1" : Math.round(Math.abs(pct))}%`;
  return (
    <span className={`inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[10px] font-semibold tabular-nums ${tone}`}>
      {flat ? "＝ same" : `${up ? "▲" : "▼"} ${shown}`}
      <span className="font-normal opacity-70">vs {vs}</span>
    </span>
  );
}

// ── Hero: what's left, the savings ring, and the income → spent → left flow bar ─────────────────────────
export function FlowHero({
  tone,
  leftLabel,
  income,
  spent,
  prev,
  vs,
  spentSub,
  idPrefix,
}: {
  tone: Tone;
  leftLabel: string;
  income: number;
  spent: number;
  prev: { income: number; spent: number } | null;
  vs: string;
  spentSub?: string;
  idPrefix: string;
}) {
  const left = income - spent;
  const rate = income > 0 ? (left / income) * 100 : 0;
  const a = ACCENT[tone];
  const spentShare = income > 0 ? Math.min(100, (spent / income) * 100) : spent > 0 ? 100 : 0;
  return (
    <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
      <div className="flex items-center justify-between gap-4 p-4 sm:p-5">
        <div className="min-w-0">
          <p className="text-[11px] font-medium uppercase tracking-wide text-slate-400">{leftLabel}</p>
          <p className={`mt-0.5 text-3xl font-extrabold tracking-tight sm:text-4xl ${left < 0 ? "text-red-600" : a.text}`}>
            <CountUp id={`${idPrefix}-left`} text={signedINR(left)} />
          </p>
          <div className="mt-1.5">
            <Delta now={left} prev={prev ? prev.income - prev.spent : null} vs={vs} upIsGood />
          </div>
        </div>
        <SaveRing pct={rate} color={a.ring} hasIncome={income > 0} />
      </div>

      {/* income → spent | left, as one bar */}
      <div className="px-4 sm:px-5">
        <div className="flex h-2.5 w-full overflow-hidden rounded-full bg-slate-100" role="img" aria-label={`Spent ${pctLabel(spentShare)} of income`}>
          <div className="fo-bar h-full bg-red-500" style={{ width: `${spentShare}%` }} />
          {spentShare < 100 && <div className={`fo-bar h-full ${a.bar}`} style={{ width: `${100 - spentShare}%`, animationDelay: "0.3s" }} />}
        </div>
      </div>

      <div className="grid grid-cols-2 divide-x divide-slate-100 border-t border-slate-100 mt-4">
        <div className="p-4 sm:px-5">
          <p className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-slate-400">
            <span className="h-2 w-2 rounded-full bg-green-600" /> Income
          </p>
          <p className="mt-0.5 text-lg font-bold text-green-700 sm:text-xl"><CountUp id={`${idPrefix}-income`} text={formatINR(income)} /></p>
          <div className="mt-1"><Delta now={income} prev={prev?.income} vs={vs} upIsGood /></div>
        </div>
        <div className="p-4 sm:px-5">
          <p className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-slate-400">
            <span className="h-2 w-2 rounded-full bg-red-500" /> Spent
          </p>
          <p className="mt-0.5 text-lg font-bold text-red-700 sm:text-xl"><CountUp id={`${idPrefix}-spent`} text={formatINR(spent)} /></p>
          <div className="mt-1 flex flex-wrap items-center gap-1.5">
            <Delta now={spent} prev={prev?.spent} vs={vs} upIsGood={false} />
            {spentSub && <span className="text-[10px] text-slate-400">{spentSub}</span>}
          </div>
        </div>
      </div>
    </section>
  );
}

/** Savings rate as a ring that draws itself in. Negative = spent more than came in (red, empty ring). */
function SaveRing({ pct, color, hasIncome }: { pct: number; color: string; hasIncome: boolean }) {
  const r = 30;
  const len = 2 * Math.PI * r;
  const fill = Math.max(0, Math.min(100, pct));
  const off = len * (1 - fill / 100);
  return (
    <div className="relative h-[76px] w-[76px] shrink-0" title="Share of income kept">
      <svg viewBox="0 0 76 76" className="h-full w-full -rotate-90" aria-hidden>
        <circle cx="38" cy="38" r={r} fill="none" strokeWidth="7" className="stroke-slate-100" />
        {fill > 0 && (
          <circle
            cx="38" cy="38" r={r} fill="none" stroke={color} strokeWidth="7" strokeLinecap="round"
            strokeDasharray={len} strokeDashoffset={off}
            className="fo-ring" style={{ ["--fo-ring-len" as string]: `${len}` }}
          />
        )}
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center leading-none">
        <span className={`text-sm font-extrabold tabular-nums ${pct < 0 ? "text-red-600" : "text-slate-800"}`}>{hasIncome ? rateLabel(pct) : "—"}</span>
        <span className="mt-0.5 text-[9px] font-medium uppercase tracking-wide text-slate-400">kept</span>
      </div>
    </div>
  );
}

// ── Highlights: 2–4 quick facts ─────────────────────────────────────────────────────────────────────────
export type Highlight = { icon: string; label: string; value: string; sub?: string; tone?: "good" | "bad" | null };
export function Highlights({ items }: { items: Highlight[] }) {
  if (items.length === 0) return null;
  return (
    <div className="fo-rise grid grid-cols-2 gap-3 lg:grid-cols-4">
      {items.map((h) => (
        <div key={h.label} className="rounded-2xl border border-slate-200 bg-white p-3.5">
          <div className="flex items-center gap-2">
            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-slate-50 text-sm" aria-hidden>{h.icon}</span>
            <span className="text-[11px] font-medium leading-tight text-slate-400">{h.label}</span>
          </div>
          <p className={`mt-2 truncate text-[15px] font-bold ${h.tone === "good" ? "text-emerald-700" : h.tone === "bad" ? "text-red-600" : "text-slate-800"}`} title={h.value}>
            {h.value}
          </p>
          {h.sub && <p className="mt-0.5 truncate text-[11px] text-slate-400" title={h.sub}>{h.sub}</p>}
        </div>
      ))}
    </div>
  );
}

// ── Ranked list with share bars ─────────────────────────────────────────────────────────────────────────
export type ShareRow = { key: string; name: string; amount: number; dot?: string; change?: number | null };
/** Biggest first. `total` is what the % is a share of. `change` = rupees vs the earlier period (shown as a chip). */
export function ShareList({ rows, total, tone, show = 6, barClass, vs }: { rows: ShareRow[]; total: number; tone: Tone; show?: number; barClass?: (r: ShareRow) => string; vs?: string }) {
  const max = Math.max(1, ...rows.map((r) => r.amount));
  const head = rows.slice(0, show);
  const rest = rows.slice(show);
  const item = (r: ShareRow, i: number) => {
    const share = total > 0 ? (r.amount / total) * 100 : 0;
    return (
      <li key={r.key}>
        <div className="flex items-center gap-2 text-sm">
          {r.dot && <span className={`h-2 w-2 shrink-0 rounded-full ${r.dot}`} />}
          <span className="min-w-0 flex-1 truncate text-slate-700">{r.name}</span>
          {r.change != null && Math.round(r.change) !== 0 && (
            <span className={`shrink-0 text-[10px] font-semibold tabular-nums ${r.change > 0 ? "text-red-500" : "text-emerald-600"}`} title={vs ? `vs ${vs}` : undefined}>
              {r.change > 0 ? "▲" : "▼"} {formatINR(Math.abs(r.change))}
            </span>
          )}
          <span className="shrink-0 font-semibold tabular-nums text-slate-800">{formatINR(r.amount)}</span>
          <span className="w-9 shrink-0 text-right text-[11px] tabular-nums text-slate-400">{pctLabel(share)}</span>
        </div>
        <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-slate-100" aria-hidden>
          <div
            className={`fo-bar h-full rounded-full ${barClass ? barClass(r) : ACCENT[tone].bar}`}
            style={{ width: `${Math.max(1.5, (r.amount / max) * 100)}%`, animationDelay: `${100 + Math.min(i, 8) * 45}ms` }}
          />
        </div>
      </li>
    );
  };
  return (
    <>
      <ul className="space-y-3">{head.map(item)}</ul>
      {rest.length > 0 && (
        <details className="group mt-3">
          <summary className="cursor-pointer list-none text-xs font-medium text-slate-500 hover:text-slate-700 [&::-webkit-details-marker]:hidden">
            <span className="group-open:hidden">Show {rest.length} more ▾</span>
            <span className="hidden group-open:inline">Show less ▴</span>
          </summary>
          <ul className="mt-3 space-y-3">{rest.map((r, i) => item(r, i + show))}</ul>
        </details>
      )}
    </>
  );
}

// ── Budgets ─────────────────────────────────────────────────────────────────────────────────────────────
export type BudgetRow = { name: string; planned: number; actual: number };
/** Budgeted categories: overall used bar + one bar per budget (overs first). `dayPct` draws a "today" line
 *  so you can tell whether spending is ahead of the month. */
export function BudgetList({ rows, dayPct }: { rows: BudgetRow[]; dayPct?: number | null }) {
  const totalPlanned = rows.reduce((s, r) => s + r.planned, 0);
  const totalActual = rows.reduce((s, r) => s + r.actual, 0);
  const left = totalPlanned - totalActual;
  const usedPct = totalPlanned > 0 ? (totalActual / totalPlanned) * 100 : 0;
  const over = rows.filter((r) => r.actual > r.planned);
  const sorted = [...rows].sort((a, b) => {
    const ao = a.actual > a.planned, bo = b.actual > b.planned;
    if (ao !== bo) return ao ? -1 : 1;
    if (ao) return b.actual - b.planned - (a.actual - a.planned);
    return b.actual / b.planned - a.actual / a.planned;
  });
  const marker = dayPct != null ? <span className="absolute inset-y-[-3px] w-0.5 rounded-full bg-slate-400/70" style={{ left: `${Math.min(100, dayPct)}%` }} aria-hidden /> : null;

  return (
    <div>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="text-sm text-slate-500">
          <b className="text-lg font-bold text-slate-800">{formatINR(totalActual)}</b> of {formatINR(totalPlanned)}
        </p>
        <span className={`text-xs font-semibold ${left >= 0 ? "text-emerald-600" : "text-red-600"}`}>
          {left >= 0 ? `${formatINR(left)} left` : `${formatINR(-left)} over`}
        </span>
      </div>
      <div className="relative mt-2 h-2.5 rounded-full bg-slate-100">
        <div className="absolute inset-0 overflow-hidden rounded-full">
          <div className={`fo-bar h-full rounded-full ${usedPct > 100 ? "bg-red-500" : "bg-gradient-to-r from-indigo-400 to-indigo-600"}`} style={{ width: `${Math.min(100, usedPct)}%` }} />
        </div>
        {marker}
      </div>
      <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[11px]">
        <span className="text-slate-400">{pctLabel(usedPct)} used{dayPct != null ? ` · ${Math.round(dayPct)}% of the month gone` : ""}</span>
        <span className="ml-auto flex gap-1.5">
          {over.length > 0 && <span className="rounded-full bg-red-50 px-2 py-0.5 font-semibold text-red-600 dark:bg-red-500/15 dark:text-red-400">{over.length} over</span>}
          <span className="rounded-full bg-emerald-50 px-2 py-0.5 font-semibold text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-400">{rows.length - over.length} on track</span>
        </span>
      </div>

      <ul className="mt-4 space-y-3 border-t border-slate-100 pt-4">
        {sorted.map((r, i) => {
          const pct = r.planned > 0 ? (r.actual / r.planned) * 100 : 0;
          const isOver = r.actual > r.planned;
          return (
            <li key={r.name}>
              <div className="flex items-center gap-2 text-sm">
                <span className="min-w-0 flex-1 truncate text-slate-700">{r.name}</span>
                <span className="shrink-0 tabular-nums text-slate-500">
                  <b className="font-semibold text-slate-800">{formatINR(r.actual)}</b> / {formatINR(r.planned)}
                </span>
                <span className={`w-16 shrink-0 text-right text-[11px] font-semibold tabular-nums ${isOver ? "text-red-600" : "text-slate-400"}`}>
                  {isOver ? `+${formatINR(r.actual - r.planned)}` : pctLabel(pct)}
                </span>
              </div>
              <div className="relative mt-1 h-1.5 rounded-full bg-slate-100">
                <div className="absolute inset-0 overflow-hidden rounded-full">
                  <div
                    className={`fo-bar h-full rounded-full ${isOver ? "bg-red-500" : pct >= 85 ? "bg-amber-500" : "bg-indigo-500"}`}
                    style={{ width: `${Math.max(pct > 0 ? 1.5 : 0, Math.min(100, pct))}%`, animationDelay: `${120 + Math.min(i, 8) * 45}ms` }}
                  />
                </div>
                {marker}
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

// ── One bar split into parts, with a legend ─────────────────────────────────────────────────────────────
export function SplitBar({ parts }: { parts: { name: string; value: number; color: string }[] }) {
  const total = parts.reduce((s, p) => s + Math.max(0, p.value), 0);
  if (total <= 0) return <p className="text-sm text-slate-400">Nothing to split yet.</p>;
  return (
    <div>
      <div className="flex h-3 w-full gap-0.5 overflow-hidden rounded-full">
        {parts.filter((p) => p.value > 0).map((p, i) => (
          <div key={p.name} className={`fo-bar h-full first:rounded-l-full last:rounded-r-full ${p.color}`} style={{ width: `${(p.value / total) * 100}%`, animationDelay: `${100 + i * 120}ms` }} />
        ))}
      </div>
      <ul className="mt-3 space-y-1.5">
        {parts.map((p) => (
          <li key={p.name} className="flex items-center gap-2 text-sm">
            <span className={`h-2.5 w-2.5 shrink-0 rounded-sm ${p.color}`} />
            <span className="flex-1 truncate text-slate-600">{p.name}</span>
            <span className="font-semibold tabular-nums text-slate-800">{formatINR(p.value)}</span>
            <span className="w-9 text-right text-[11px] tabular-nums text-slate-400">{pctLabel((p.value / total) * 100)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Small legend for the cash-flow chart (the chart itself has none, to stay clean). */
export function FlowLegend() {
  return (
    <span className="flex items-center gap-3 text-[11px] text-slate-500">
      <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-sm bg-green-600" />Income</span>
      <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-sm bg-red-600" />Spent</span>
    </span>
  );
}
