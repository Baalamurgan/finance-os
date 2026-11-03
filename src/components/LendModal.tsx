"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useToast } from "@/components/Toast";
import { formatINR } from "@/lib/format";
import { previewLend, lendForBill, type LendPreview } from "@/app/actions";
import { CTA_CLASS, CtaLabel } from "@/components/Cta";

type Source = { memberId: number; name: string; spare: number; isHub: boolean };

function ordinal(day: number) {
  return `${day}${["th", "st", "nd", "rd"][((day % 100) - 20) % 10] ?? ["th", "st", "nd", "rd"][day % 100] ?? "th"}`;
}

// Bridge ONE short bill from any member who holds cash (the treasurer included). The plan decides how the
// lender is paid back and shows it per member BEFORE you choose — when they get it back, how the payer's
// later payout shrinks, and anything it would leave short. Nothing changes until "Confirm".
export function LendModal({
  periodId, billId, label, payerName, shortfall, day, sources, onClose,
}: {
  periodId: number;
  billId: number;
  label: string;
  payerName: string;
  shortfall: number;
  day: number | null;
  sources: Source[];
  onClose: () => void;
}) {
  const router = useRouter();
  const toast = useToast();
  const [pending, start] = useTransition();
  const [amount, setAmount] = useState(String(Math.round(shortfall * 100) / 100));
  const [pick, setPick] = useState<number | null>(null);
  const [previews, setPreviews] = useState<Record<number, LendPreview | "loading">>({});
  const seq = useRef(0);

  const amt = Math.round((Number(amount.replace(/[^0-9.]/g, "")) || 0) * 100) / 100;

  // Preview every lender for the current amount (debounced), so each row shows its own return date.
  useEffect(() => {
    if (!(amt > 0)) return;
    const my = ++seq.current;
    const t = setTimeout(() => {
      setPreviews(Object.fromEntries(sources.map((s) => [s.memberId, "loading" as const])));
      for (const s of sources) {
        const fd = new FormData();
        fd.set("periodId", String(periodId)); fd.set("billId", String(billId)); fd.set("lenderId", String(s.memberId)); fd.set("amount", String(amt));
        previewLend(fd).then((p) => { if (seq.current === my) setPreviews((prev) => ({ ...prev, [s.memberId]: p })); });
      }
    }, 350);
    return () => clearTimeout(t);
  }, [amt, periodId, billId, sources]);

  const chosen = pick != null ? sources.find((s) => s.memberId === pick) : null;
  const pv = pick != null ? previews[pick] : undefined;
  const ready = chosen && pv && pv !== "loading" && pv.ok;
  const overSpare = chosen ? amt > chosen.spare + 0.005 : false;

  const returnText = (p: LendPreview) =>
    p.route === "payout" && p.lenderIsHub ? `no return — it's ${payerName}'s own payout, early`
    : p.returnDay != null ? `gets it back on the ${ordinal(p.returnDay)}`
    : "gets it back at month-end";

  const submit = () => {
    if (!ready || pick == null) return;
    start(async () => {
      const fd = new FormData();
      fd.set("periodId", String(periodId)); fd.set("billId", String(billId)); fd.set("lenderId", String(pick)); fd.set("amount", String(amt));
      const r = await lendForBill(fd);
      if (r.ok) { toast("Bridge added", "success"); onClose(); router.refresh(); }
      else toast(r.error ?? "Couldn't add the bridge", "error");
    });
  };

  const payoutLine = (list: { day: number | null; amount: number }[] | undefined) =>
    !list || list.length === 0 ? "₹0" : list.map((x) => `${formatINR(x.amount)}${x.day != null ? ` on the ${ordinal(x.day)}` : ""}`).join(" + ");

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center sm:p-4" onClick={onClose}>
      <div className="max-h-[90vh] w-full max-w-sm overflow-y-auto rounded-t-2xl bg-white p-4 shadow-xl sm:rounded-2xl" onClick={(e) => e.stopPropagation()} style={{ paddingBottom: "max(1rem, env(safe-area-inset-bottom))" }}>
        <h3 className="text-sm font-semibold text-slate-900">🌉 Bridge “{label}”</h3>
        <p className="mt-1 text-xs text-amber-700">⚠ {payerName} is short {formatINR(shortfall)}{day != null ? ` on the ${ordinal(day)}` : ""}. Someone with cash covers it now; the plan pays them back.</p>

        <label className="mt-3 block text-[11px] font-medium text-slate-500">Amount
          <span className="mt-1 flex items-center rounded-lg border border-slate-300 px-2 focus-within:ring-2 focus-within:ring-sky-100">
            <span className="text-slate-400">₹</span>
            <input value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" className="w-full min-w-0 bg-transparent px-1 py-2 text-right text-base font-semibold tabular-nums outline-none" />
          </span>
        </label>

        <div className="mt-3 text-[11px] font-medium text-slate-500">Who covers it?</div>
        {sources.length === 0 ? (
          <p className="mt-1 rounded-md bg-slate-50 px-2 py-2 text-xs text-slate-500">Nobody holds spare cash before this bill.</p>
        ) : (
          <ul className="mt-1 space-y-1.5">
            {sources.map((s) => {
              const p = previews[s.memberId];
              const active = pick === s.memberId;
              return (
                <li key={s.memberId}>
                  <button type="button" onClick={() => setPick(s.memberId)} className={`w-full rounded-lg border px-2.5 py-2 text-left text-xs ${active ? "border-sky-400 bg-sky-50 ring-2 ring-sky-100" : "border-slate-200 hover:bg-slate-50"}`}>
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-medium text-slate-800">{s.name}{s.isHub ? <span className="ml-1 text-[10px] font-normal text-slate-400">(hub)</span> : null}</span>
                      <span className="shrink-0 text-[10px] tabular-nums text-slate-500">has {formatINR(s.spare)}</span>
                    </div>
                    <div className="mt-0.5 text-[11px]">
                      {p === "loading" || p == null ? <span className="text-slate-400">working out the return…</span>
                        : !p.ok ? <span className="text-red-600">{p.error}</span>
                        : <span className="text-emerald-700">↩ {returnText(p)}</span>}
                    </div>
                  </button>
                </li>
              );
            })}
          </ul>
        )}

        {chosen && pv && pv !== "loading" && pv.ok && (
          <div className="mt-3 space-y-1 rounded-lg bg-slate-50 px-2.5 py-2 text-[11px] text-slate-700">
            <div className="font-semibold text-slate-800">What changes</div>
            <div>• {chosen.name} → {payerName} <b className="tabular-nums">{formatINR(amt)}</b> now{day != null ? ` (the ${ordinal(day)})` : ""}, just before {label}.</div>
            {pv.route === "payout" ? (
              <>
                <div>• {payerName}&apos;s later payout: <span className="tabular-nums">{payoutLine(pv.payoutBefore)}</span> → <b className="tabular-nums">{payoutLine(pv.payoutAfter)}</b> (the total {payerName} gets doesn&apos;t change).</div>
                {!pv.lenderIsHub && <div>• Pool → {chosen.name} <b className="tabular-nums">{formatINR(amt)}</b> {pv.returnDay != null ? `on the ${ordinal(pv.returnDay)}` : "at month-end"} — the earliest the pool can spare it (moves if the plan changes).</div>}
              </>
            ) : (
              <div>• {payerName} → pool, then pool → {chosen.name} <b className="tabular-nums">{formatINR(amt)}</b> on the {pv.returnDay != null ? ordinal(pv.returnDay) : "?"} (when {payerName}&apos;s income lands).</div>
            )}
            <div>• {chosen.name}&apos;s cash: <span className="tabular-nums">{formatINR(pv.lenderBefore ?? 0)}</span> → <b className="tabular-nums">{formatINR(pv.lenderAfter ?? 0)}</b></div>
            <div>• Short bills: {pv.shortBillsBefore} → <b>{pv.shortBillsAfter}</b>{(pv.billShortAfter ?? 0) > 0.005 ? <span className="text-amber-700"> · this bill still short {formatINR(pv.billShortAfter!)}</span> : null}</div>
            {(pv.lenderNewShort?.length ?? 0) > 0 && <div className="font-medium text-red-600">⚠ Leaves {chosen.name} short for {pv.lenderNewShort!.join(", ")}</div>}
            {overSpare && <div className="font-medium text-red-600">⚠ More than {chosen.name} holds right now ({formatINR(chosen.spare)})</div>}
          </div>
        )}

        <div className="mt-4 flex justify-end gap-2">
          <button type="button" onClick={onClose} className="rounded-md px-3 py-2 text-sm text-slate-500 hover:bg-slate-100">Cancel</button>
          <button type="button" onClick={submit} disabled={!ready || pending || !(amt > 0)} className={`${CTA_CLASS.tap} px-4 py-2 text-sm disabled:opacity-40`}>
            <CtaLabel kind="tap">{pending ? "Adding…" : "Confirm"}</CtaLabel>
          </button>
        </div>
      </div>
    </div>
  );
}
