"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useToast } from "@/components/Toast";
import { formatINR } from "@/lib/format";
import { refundSpendOptions, previewRefund, createRefund, type RefundSpendOption, type RefundPreview, type RefundKind } from "@/app/actions";
import { CTA_CLASS, CtaLabel } from "@/components/Cta";
import { PreviewNextMonthButton } from "@/components/PreviewNextMonthButton";

const KINDS: { kind: RefundKind; label: string; hint: string }[] = [
  { kind: "duplicate", label: "Duplicate entry", hint: "It was logged twice — refund the whole amount." },
  { kind: "amount", label: "Wrong amount", hint: "Type the real amount — the difference is refunded." },
  { kind: "shop", label: "Shop refund", hint: "The shop gave money back — to the card or account it was paid from." },
  { kind: "category", label: "Wrong category", hint: "Logged in the wrong category — move it, no money back." },
];

const day = (iso: string) => new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short" });

// Refund ONE spend (head only, any month): pick the member, then one of their spends, say what went wrong,
// where the budget goes back to and when the money moves. "What changes" lists every number the refund
// touches before Confirm; nothing changes until then. Undo (on the spend) removes all of it.
export function RefundModal({ members, householdId, categories }: { members: { id: number; name: string }[]; householdId: number; categories: { id: number; name: string }[] }) {
  const router = useRouter();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const [memberId, setMemberId] = useState<number | null>(null);
  const [spends, setSpends] = useState<RefundSpendOption[] | null>(null);
  const [spendId, setSpendId] = useState<number | null>(null);
  const [kind, setKind] = useState<RefundKind>("duplicate");
  const [real, setReal] = useState("");
  const [shop, setShop] = useState("");
  const [toCat, setToCat] = useState<number | null>(null);
  const [budgetTo, setBudgetTo] = useState<"category" | "pool">("category");
  const [payWhen, setPayWhen] = useState<"now" | "next">("now");
  const [pv, setPv] = useState<RefundPreview | null>(null);
  const [loading, setLoading] = useState(false);
  const seq = useRef(0);

  const reset = () => { setMemberId(null); setSpends(null); setSpendId(null); setKind("duplicate"); setReal(""); setShop(""); setToCat(null); setBudgetTo("category"); setPayWhen("now"); setPv(null); };
  const close = () => { setOpen(false); reset(); };

  // Member picked → load their spends (every month, newest first).
  useEffect(() => {
    if (memberId == null) return;
    let live = true;
    refundSpendOptions(memberId).then((r) => { if (live) setSpends(r.spends); if (!r.ok && r.error) toast(r.error, "error"); });
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [memberId]);

  const spend = spends?.find((s) => s.id === spendId) ?? null;
  const fd = () => {
    const f = new FormData();
    f.set("spendId", String(spendId ?? 0)); f.set("kind", kind); f.set("realAmount", real.replace(/[^0-9.]/g, ""));
    f.set("shopAmount", shop.replace(/[^0-9.]/g, "")); f.set("toCategoryId", String(toCat ?? ""));
    f.set("budgetTo", budgetTo); f.set("payWhen", payWhen);
    return f;
  };
  const key = JSON.stringify([spendId, kind, real, shop, toCat, budgetTo, payWhen]);

  // Re-preview on every change (debounced) so "What changes" is always the real numbers.
  useEffect(() => {
    if (spendId == null) return;
    const my = ++seq.current;
    const t = setTimeout(() => { setLoading(true); previewRefund(fd()).then((p) => { if (seq.current === my) { setPv(p); setLoading(false); } }); }, 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const canConfirm = !!pv?.ok && !pv.blocked && !loading && !pending;
  const submit = () =>
    start(async () => {
      const r = await createRefund(fd());
      if (!r.ok) { toast(r.error ?? "Couldn't save the refund", "error"); return; }
      toast(kind === "category" ? "Moved to the right category" : `Refund of ${formatINR(pv?.amount ?? 0)} saved`, "success");
      close();
      router.refresh();
    });

  const chip = (on: boolean) => `rounded-lg border px-2.5 py-1.5 text-left text-xs ${on ? "border-rose-300 bg-rose-50 text-rose-800" : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"}`;

  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className={CTA_CLASS.window}>
        <CtaLabel kind="window">↩ Refund</CtaLabel>
      </button>
      {open && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center sm:p-4" onClick={close}>
          <div className="modal-panel max-h-[90vh] w-full max-w-md overflow-y-auto rounded-t-2xl bg-white p-4 shadow-xl sm:rounded-2xl" onClick={(e) => e.stopPropagation()} style={{ paddingBottom: "max(1rem, env(safe-area-inset-bottom))" }}>
            <h2 className="text-base font-bold text-slate-900">↩ Refund a spend</h2>
            <p className="mt-0.5 text-xs text-slate-500">Fixes a spend without editing it — the original stays as it was, and the correction is booked this month.</p>

            <label className="mt-3 block text-[11px] font-semibold uppercase tracking-wide text-slate-400">Member</label>
            <select value={memberId ?? ""} onChange={(e) => { setMemberId(e.target.value ? Number(e.target.value) : null); setSpends(null); setSpendId(null); setPv(null); }} className="mt-1 w-full rounded-md border border-slate-200 px-2 py-2 text-sm">
              <option value="">Choose who spent it…</option>
              {members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
            </select>

            {memberId != null && (
              <>
                <label className="mt-3 block text-[11px] font-semibold uppercase tracking-wide text-slate-400">Spend</label>
                <select value={spendId ?? ""} onChange={(e) => { setSpendId(e.target.value ? Number(e.target.value) : null); setPv(null); }} disabled={spends == null} className="mt-1 w-full rounded-md border border-slate-200 px-2 py-2 text-sm">
                  <option value="">{spends == null ? "Loading…" : spends.length ? "Choose the spend…" : "No spends for this member"}</option>
                  {(spends ?? []).map((s) => (
                    <option key={s.id} value={s.id} disabled={s.refunded}>
                      {day(s.dateISO)} · {s.label} · {formatINR(s.amount)} · {s.category}{s.cardName ? ` · 💳 ${s.cardName}` : ""}{s.refunded ? " (refunded)" : ""}
                    </option>
                  ))}
                </select>
                {spend && <p className="mt-1 text-[11px] text-slate-400">{spend.periodLabel}{spend.periodOpen ? " (this month — not settled yet)" : " (settled)"}</p>}
              </>
            )}

            {spend && (
              <>
                <label className="mt-3 block text-[11px] font-semibold uppercase tracking-wide text-slate-400">What went wrong</label>
                <div className="mt-1 grid grid-cols-2 gap-2">
                  {KINDS.map((k) => (
                    <button key={k.kind} type="button" onClick={() => setKind(k.kind)} className={chip(kind === k.kind)}>
                      <div className="font-semibold">{k.label}</div>
                      <div className="mt-0.5 text-[10px] text-slate-500">{k.hint}</div>
                    </button>
                  ))}
                </div>
                {kind === "amount" && (
                  <div className="mt-2 flex items-center gap-2 text-sm">
                    <span className="text-slate-500">Real amount</span>
                    <input inputMode="decimal" value={real} onChange={(e) => setReal(e.target.value)} placeholder={String(spend.amount)} className="w-28 rounded-md border border-slate-200 px-2 py-1.5 text-right tabular-nums" />
                    {pv?.ok && pv.amount > 0 && <span className="text-xs text-rose-700">refund {formatINR(pv.amount)}</span>}
                  </div>
                )}

                {kind === "shop" && (
                  <div className="mt-2 flex flex-wrap items-center gap-2 text-sm">
                    <span className="text-slate-500">Refunded by the shop</span>
                    <input inputMode="decimal" value={shop} onChange={(e) => setShop(e.target.value)} placeholder={String(spend.amount)} className="w-28 rounded-md border border-slate-200 px-2 py-1.5 text-right tabular-nums" />
                    <span className="text-[11px] text-slate-400">back to {spend.cardName ? `💳 ${spend.cardName} (current statement)` : "the account it was paid from"}</span>
                  </div>
                )}
                {kind === "category" && (
                  <div className="mt-2">
                    <span className="text-xs text-slate-500">It should have been</span>
                    <select value={toCat ?? ""} onChange={(e) => setToCat(e.target.value ? Number(e.target.value) : null)} className="mt-1 w-full rounded-md border border-slate-200 px-2 py-2 text-sm">
                      <option value="">Choose the right category…</option>
                      {categories.filter((c) => c.name !== spend.category).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                    </select>
                    <p className="mt-1 text-[11px] text-slate-400">Swapped this month: {spend.category} gets {formatINR(spend.amount)} back, the new category takes it. The card bill doesn&apos;t change.</p>
                  </div>
                )}

                {kind !== "category" && (<>
                <label className="mt-3 block text-[11px] font-semibold uppercase tracking-wide text-slate-400">Budget goes back to</label>
                <div className="mt-1 grid grid-cols-2 gap-2">
                  <button type="button" onClick={() => setBudgetTo("category")} className={chip(budgetTo === "category")}>
                    <div className="font-semibold">{spend.category}</div>
                    <div className="mt-0.5 text-[10px] text-slate-500">This month&apos;s {spend.category} gets it back to spend.</div>
                  </button>
                  <button type="button" onClick={() => setBudgetTo("pool")} className={chip(budgetTo === "pool")}>
                    <div className="font-semibold">The pool</div>
                    <div className="mt-0.5 text-[10px] text-slate-500">Booked as pool income — no category gets it.</div>
                  </button>
                </div>

                <label className="mt-3 block text-[11px] font-semibold uppercase tracking-wide text-slate-400">The money</label>
                {spend.periodOpen ? (
                  <p className="mt-1 rounded-md bg-slate-50 px-2.5 py-2 text-xs text-slate-600">Not settled yet — {pv?.nextLabel || "next month"}&apos;s settlement nets it automatically. Nothing to send now.</p>
                ) : (
                  <div className="mt-1 grid grid-cols-2 gap-2">
                    <button type="button" onClick={() => setPayWhen("now")} className={chip(payWhen === "now")}>
                      <div className="font-semibold">Send now</div>
                      <div className="mt-0.5 text-[10px] text-slate-500">A Money Plan step today, with the reason on it.</div>
                    </button>
                    <button type="button" onClick={() => setPayWhen("next")} className={chip(payWhen === "next")}>
                      <div className="font-semibold">Next settlement</div>
                      <div className="mt-0.5 text-[10px] text-slate-500">Added to {pv?.nextLabel || "next month"}&apos;s settlement instead.</div>
                    </button>
                  </div>
                )}
                </>)}

                <div className="mt-3 rounded-lg border border-slate-200 bg-slate-50 p-2.5">
                  <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">What changes {loading && <span className="font-normal normal-case text-slate-400">· checking…</span>}</div>
                  {pv && !pv.ok && <p className="mt-1 text-xs text-red-600">{pv.error}</p>}
                  {pv?.ok && (
                    <ul className="mt-1 space-y-1 text-xs text-slate-700">
                      {pv.changes.map((c, i) => <li key={i}>• {c}</li>)}
                    </ul>
                  )}
                  {pv?.blocked && <p className="mt-2 rounded-md bg-red-50 px-2 py-1.5 text-xs font-medium text-red-700">⛔ {pv.blocked}</p>}
                  {pv?.needsPreviewMonth && (
                    <div className="mt-2 rounded-md bg-violet-50 px-2 py-2 text-xs text-violet-800">
                      <p>{pv.needsPreviewMonth.label} isn&apos;t previewed yet{pv.blocked ? "" : " — the refund line will show in its settlement once you open the preview"}.</p>
                      <div className="mt-1.5"><PreviewNextMonthButton householdId={householdId} /></div>
                    </div>
                  )}
                </div>
              </>
            )}

            <div className="mt-4 flex justify-end gap-2">
              <button type="button" onClick={close} className="rounded-md px-3 py-2 text-sm text-slate-500 hover:bg-slate-100">Cancel</button>
              <button type="button" onClick={submit} disabled={!canConfirm} className={`${CTA_CLASS.tap} px-4 py-2 text-sm disabled:opacity-40`}>
                {pending ? "Saving…" : kind === "category" ? "Move it" : pv?.ok && pv.amount > 0 ? `Refund ${formatINR(pv.amount)}` : "Refund"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
