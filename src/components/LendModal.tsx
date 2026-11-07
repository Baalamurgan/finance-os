"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useToast } from "@/components/Toast";
import { formatINR } from "@/lib/format";
import { previewLend, lendForBill, type LendPreview, type LendShare } from "@/app/actions";
import { CTA_CLASS, CtaLabel } from "@/components/Cta";

function ordinal(day: number) {
  return `${day}${["th", "st", "nd", "rd"][((day % 100) - 20) % 10] ?? ["th", "st", "nd", "rd"][day % 100] ?? "th"}`;
}
const r2 = (n: number) => Math.round(n * 100) / 100;

// Bridge ONE short bill from anyone holding cash (the treasurer included), split across several people if
// needed. It opens with the plan's best mix pre-filled (no-return money first, then the earliest returns);
// tick / untick and edit each share. Every row says how that person is paid back. Confirm only works when
// the shares add up exactly to the shortfall. Nothing changes until then.
export function LendModal({
  periodId, billId, label, payerName, shortfall, day, onClose,
}: {
  periodId: number;
  billId: number;
  label: string;
  payerName: string;
  shortfall: number;
  day: number | null;
  onClose: () => void;
}) {
  const router = useRouter();
  const toast = useToast();
  const [pending, start] = useTransition();
  const [candidates, setCandidates] = useState<LendShare[] | null>(null);
  const [amounts, setAmounts] = useState<Record<number, string>>({}); // ticked lenders → typed share
  const [pv, setPv] = useState<LendPreview | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const seq = useRef(0);
  const target = r2(pv?.shortfall ?? shortfall);

  // Open: the plan's suggested mix + each person's "if they covered it alone" return.
  useEffect(() => {
    const fd = new FormData();
    fd.set("periodId", String(periodId)); fd.set("billId", String(billId));
    previewLend(fd).then((p) => {
      setLoading(false);
      if (!p.ok && !p.candidates) { setErr(p.error ?? "Couldn't work out a bridge"); return; }
      setCandidates(p.candidates ?? []);
      setAmounts(Object.fromEntries((p.shares ?? []).map((s) => [s.lenderId, String(s.amount)])));
      setPv(p);
    });
  }, [periodId, billId]);

  const mix = Object.entries(amounts).map(([id, v]) => ({ lenderId: Number(id), amount: r2(Number(v.replace(/[^0-9.]/g, "")) || 0) }));
  const sum = r2(mix.reduce((t, m) => t + m.amount, 0));
  const diff = r2(target - sum);
  const mixKey = JSON.stringify(mix);

  // Re-preview the combined effect whenever the mix changes (debounced).
  const first = useRef(true);
  useEffect(() => {
    if (candidates == null) return;
    if (first.current) { first.current = false; return; } // the opening preview already covers the suggested mix
    const my = ++seq.current;
    setLoading(true);
    const t = setTimeout(() => {
      const fd = new FormData();
      fd.set("periodId", String(periodId)); fd.set("billId", String(billId));
      fd.set("mix", JSON.stringify(mix.filter((m) => m.amount > 0)));
      previewLend(fd).then((p) => { if (seq.current === my) { setPv(p); setLoading(false); } });
    }, 400);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mixKey, candidates]);

  const toggle = (c: LendShare) =>
    setAmounts((a) => {
      if (a[c.lenderId] != null) { const n = { ...a }; delete n[c.lenderId]; return n; }
      const covered = Object.values(a).reduce((t, v) => t + (Number(v) || 0), 0);
      return { ...a, [c.lenderId]: String(r2(Math.max(0, Math.min(c.spare, target - covered)))) };
    });

  const shareOf = (id: number) => (pv?.ok ? pv.shares?.find((s) => s.lenderId === id) : undefined);
  const howBack = (s: LendShare) => {
    if (s.kind === "hub") return `no return — ${payerName}'s own payout, early`;
    if (s.kind === "income") return `gets it back on the ${s.returnDay != null ? ordinal(s.returnDay) : "?"} (when ${payerName}'s income lands)`;
    const back = s.returnDay != null ? `back on the ${ordinal(s.returnDay)}` : "back at month-end";
    if (s.kind === "pool") return s.loanPart > 0.005 ? `${formatINR(s.poolPart)} from their pool payment (${poolShrink(s)}) · ${formatINR(s.loanPart)} ${back}` : `no return — ${poolShrink(s)}`;
    return `gets it ${back}`;
  };
  // "Lakshmi → Arumugam on the 8th: ₹1,00,000 → ₹90,577" — the pending payment to the pool it comes out of.
  const poolShrink = (s: LendShare) => {
    const part = s.poolPart > 0.005 ? s.poolPart : Math.min(s.amount, s.poolCap);
    return `${s.name} → pool${s.poolDay != null ? ` on the ${ordinal(s.poolDay)}` : ""}: ${formatINR(s.owesPool)} → ${formatINR(r2(s.owesPool - part))}`;
  };
  const over = (c: LendShare) => (amounts[c.lenderId] != null && (Number(amounts[c.lenderId]) || 0) > c.spare + 0.005);
  // Any lender left short for one of their own bills blocks Confirm (the server refuses it too).
  const hurts = (pv?.ok ? pv.shares ?? [] : []).some((x) => (x.shortBills?.length ?? 0) > 0);
  const canConfirm = !loading && !pending && pv?.ok && Math.abs(diff) <= 0.005 && sum > 0 && !(candidates ?? []).some(over) && !hurts;

  const submit = () => {
    if (!canConfirm) return;
    start(async () => {
      const fd = new FormData();
      fd.set("periodId", String(periodId)); fd.set("billId", String(billId));
      fd.set("mix", JSON.stringify(mix.filter((m) => m.amount > 0)));
      const r = await lendForBill(fd);
      if (r.ok) { toast("Bridge added", "success"); onClose(); router.refresh(); }
      else toast(r.error ?? "Couldn't add the bridge", "error");
    });
  };

  const payoutLine = (list: { day: number | null; amount: number }[] | undefined) =>
    !list || list.length === 0 ? "₹0" : list.map((x) => `${formatINR(x.amount)}${x.day != null ? ` (${ordinal(x.day)})` : ""}`).join(" + ");

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center sm:p-4" onClick={onClose}>
      <div className="modal-panel max-h-[90vh] w-full max-w-sm overflow-y-auto rounded-t-2xl bg-white p-4 shadow-xl sm:rounded-2xl" onClick={(e) => e.stopPropagation()} style={{ paddingBottom: "max(1rem, env(safe-area-inset-bottom))" }}>
        <h3 className="text-sm font-semibold text-slate-900">🌉 Bridge “{label}”</h3>
        <p className="mt-1 text-xs text-amber-700">⚠ {payerName} is short <b>{formatINR(target)}</b>{day != null ? ` on the ${ordinal(day)}` : ""}. Pick who covers it — the plan has filled in the best mix.</p>

        {err ? (
          <p className="mt-3 rounded-md bg-red-50 px-2 py-2 text-xs text-red-700">{err}</p>
        ) : candidates == null ? (
          <p className="mt-3 text-xs text-slate-400">Working out the best mix…</p>
        ) : candidates.length === 0 ? (
          <p className="mt-3 rounded-md bg-slate-50 px-2 py-2 text-xs text-slate-500">Nobody holds spare cash before this bill.</p>
        ) : (
          <ul className="mt-3 space-y-1.5">
            {candidates.map((c) => {
              const on = amounts[c.lenderId] != null;
              const sh = on ? shareOf(c.lenderId) : undefined;
              return (
                <li key={c.lenderId} className={`rounded-lg border px-2.5 py-2 text-xs ${on ? "border-sky-300 bg-sky-50/60" : "border-slate-200"}`}>
                  <div className="flex items-center gap-2">
                    <input type="checkbox" checked={on} onChange={() => toggle(c)} className="h-4 w-4 shrink-0 accent-sky-600" aria-label={`${c.name} covers part`} />
                    <button type="button" onClick={() => toggle(c)} className="min-w-0 flex-1 text-left">
                      <span className="font-medium text-slate-800">{c.name}</span>
                      {c.isHub && <span className="ml-1 text-[10px] text-slate-400">(hub)</span>}
                      <span className="block text-[10px] tabular-nums text-slate-500">
                        {c.isHub
                          ? <>can spare <b className="font-semibold text-slate-700">{formatINR(c.spare)}</b></>
                          : <>holds <b className="font-semibold text-slate-700">{formatINR(c.holds)}</b>{c.poolCap > 0.5 && <> · {formatINR(c.poolCap)} needs no return</>}</>}
                      </span>
                    </button>
                    {on && (
                      <span className={`flex w-28 shrink-0 items-center rounded-md border bg-white px-1.5 ${over(c) ? "border-red-400" : "border-slate-300"}`}>
                        <span className="text-slate-400">₹</span>
                        <input value={amounts[c.lenderId]} onChange={(e) => setAmounts((a) => ({ ...a, [c.lenderId]: e.target.value }))} inputMode="decimal" className="w-full min-w-0 bg-transparent px-1 py-1 text-right font-semibold tabular-nums outline-none" />
                      </span>
                    )}
                  </div>
                  <div className={`mt-1 pl-6 text-[11px] ${over(c) ? "text-red-600" : "text-emerald-700"}`}>
                    {over(c) ? `⚠ ${c.name} ${c.isHub ? "can spare" : "holds"} only ${formatINR(c.spare)}` : `↩ ${howBack(sh ?? { ...c, amount: Number(amounts[c.lenderId]) || Math.min(c.spare, target) })}`}
                  </div>
                  {/* the lender's own bills: short (blocks Confirm) or due the same day the pool returns it */}
                  {(sh?.shortBills ?? []).map((b) => (
                    <div key={`s${b.vendor}${b.day}`} className="mt-0.5 pl-6 text-[11px] font-medium text-red-600">
                      ⚠ {c.name}&apos;s {b.vendor}{b.day != null ? ` on the ${ordinal(b.day)}` : ""} would be short {formatINR(b.short)}{sh?.returnDay != null ? ` — the pool can only return it on the ${ordinal(sh.returnDay)}` : ""}. Lower this share.
                    </div>
                  ))}
                  {(sh?.sameDayBills ?? []).map((b) => (
                    <div key={`d${b.vendor}${b.day}`} className="mt-0.5 pl-6 text-[11px] text-amber-700">
                      ⏱ Back on the {b.day != null ? ordinal(b.day) : "same day"} — same day as their {b.vendor} ({formatINR(b.amount)}) · the pool returns it first, before they pay.
                    </div>
                  ))}
                </li>
              );
            })}
          </ul>
        )}

        {candidates && candidates.length > 0 && (
          <div className={`mt-2 flex items-center justify-between rounded-md px-2.5 py-1.5 text-[11px] font-medium ${Math.abs(diff) <= 0.005 ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-800"}`}>
            <span>Covered <b className="tabular-nums">{formatINR(sum)}</b> of {formatINR(target)}</span>
            <span className="tabular-nums">{Math.abs(diff) <= 0.005 ? "✓ matches" : diff > 0 ? `${formatINR(diff)} still short` : `${formatINR(-diff)} too much`}</span>
          </div>
        )}

        {pv && !pv.ok && candidates && <p className="mt-2 rounded-md bg-red-50 px-2 py-1.5 text-[11px] text-red-700">{pv.error}</p>}
        {pv?.ok && sum > 0 && (
          <div className={`mt-3 space-y-1 rounded-lg bg-slate-50 px-2.5 py-2 text-[11px] text-slate-700 ${loading ? "opacity-50" : ""}`}>
            <div className="font-semibold text-slate-800">What changes</div>
            {(pv.shares ?? []).map((s) => (
              <div key={s.lenderId}>• {s.name} → {payerName} <b className="tabular-nums">{formatINR(s.amount)}</b>{day != null ? ` on the ${ordinal(day)}` : ""}, before {label}.</div>
            ))}
            {(pv.shares ?? []).some((s) => s.kind !== "income") && (
              <div>• {payerName}&apos;s later payout: <span className="tabular-nums">{payoutLine(pv.payoutBefore)}</span> → <b className="tabular-nums">{payoutLine(pv.payoutAfter)}</b> — the total {payerName} gets doesn&apos;t change.</div>
            )}
            {(pv.shares ?? []).filter((s) => s.kind === "pool").map((s) => (
              <div key={`p${s.lenderId}`}>• {s.name} → pool{s.poolDay != null ? ` on the ${ordinal(s.poolDay)}` : ""}: <span className="tabular-nums">{formatINR(s.owesPool)}</span> → <b className="tabular-nums">{formatINR(r2(s.owesPool - s.poolPart))}</b> — {formatINR(s.poolPart)} of it goes to {payerName} now instead. No return.</div>
            ))}
            {(pv.shares ?? []).filter((s) => s.kind === "loan" || (s.kind === "pool" && s.loanPart > 0.005)).map((s) => (
              <div key={`l${s.lenderId}`}>• Pool → {s.name} <b className="tabular-nums">{formatINR(s.kind === "pool" ? s.loanPart : s.amount)}</b> {s.returnDay != null ? `on the ${ordinal(s.returnDay)}` : "at month-end"} — earliest the pool can spare it (moves if the plan changes).{(s.sameDayBills?.length ?? 0) > 0 ? ` Same day as their ${s.sameDayBills!.map((b) => b.vendor).join(", ")} — returned before they pay.` : ""}</div>
            ))}
            <div>• Short bills: {pv.shortBillsBefore} → <b>{pv.shortBillsAfter}</b>{(pv.billShortAfter ?? 0) > 0.005 ? <span className="text-amber-700"> · this bill still short {formatINR(pv.billShortAfter!)}</span> : null}</div>
            {(pv.newShort?.length ?? 0) > 0 && <div className="font-medium text-red-600">⚠ Leaves short: {pv.newShort!.join(", ")}</div>}
          </div>
        )}

        <div className="mt-4 flex justify-end gap-2">
          <button type="button" onClick={onClose} className="rounded-md px-3 py-2 text-sm text-slate-500 hover:bg-slate-100">Cancel</button>
          <button type="button" onClick={submit} disabled={!canConfirm} title={Math.abs(diff) > 0.005 ? `Shares must add up to ${formatINR(target)}` : undefined} className={`${CTA_CLASS.tap} px-4 py-2 text-sm disabled:opacity-40`}>
            <CtaLabel kind="tap">{pending ? "Adding…" : "Confirm"}</CtaLabel>
          </button>
        </div>
      </div>
    </div>
  );
}
