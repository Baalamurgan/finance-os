"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { addFamilyCard, updateFamilyCard, deleteFamilyCard, type CardFormState } from "@/app/actions";
import type { FamilyCard } from "@/lib/queries";
import { useToast } from "@/components/Toast";
import { CardColorPicker } from "@/components/CardColorPicker";

type Mem = { id: number; name: string };
const NETWORKS = ["", "visa", "mastercard", "rupay", "amex", "diners"];

// Family Cards section: shared list (reuses each member's FinanceAccounts). Any member can add; a card's
// owner or the head can edit/delete. A card spend is attributed to the owner (chosen here), so the owner
// dropdown is the family member whose cash the card draws.
export function FamilyCardsManager({
  cards,
  members,
  currentMemberId,
  isHead,
}: {
  cards: FamilyCard[];
  members: Mem[];
  currentMemberId: number | null;
  isHead: boolean;
}) {
  const [adding, setAdding] = useState(false);
  const [editId, setEditId] = useState<number | null>(null);
  const canManage = (c: FamilyCard) => isHead || c.memberId === currentMemberId;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-slate-500">
          Cards the family pays with. A spend on a card counts as the <b>card owner&apos;s</b> spend.
        </p>
        {!adding && (
          <button onClick={() => { setAdding(true); setEditId(null); }} className="btn shrink-0">+ Add card</button>
        )}
      </div>

      {adding && (
        <CardForm
          members={members}
          defaultOwnerId={currentMemberId ?? members[0]?.id ?? 0}
          onDone={() => setAdding(false)}
        />
      )}

      {cards.length === 0 && !adding ? (
        <p className="rounded-xl border border-dashed border-slate-200 p-8 text-center text-sm text-slate-400">
          No cards yet. Add a debit or credit card to pick it when logging a spend.
        </p>
      ) : (
        <ul className="space-y-2">
          {cards.map((c) =>
            editId === c.id ? (
              <li key={c.id}>
                <CardForm
                  members={members}
                  card={c}
                  canReassignOwner={isHead}
                  defaultOwnerId={c.memberId}
                  onDone={() => setEditId(null)}
                />
              </li>
            ) : (
              <li key={c.id} className={`flex items-center gap-3 rounded-xl border border-slate-200 bg-white p-3 ${c.active ? "" : "opacity-60"}`}>
                <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg text-white" style={{ backgroundColor: c.color }} aria-hidden>💳</span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5 text-sm font-semibold text-slate-800">
                    <span className="truncate">{c.name}</span>
                    {c.last4 && <span className="text-xs font-normal text-slate-400">XX{c.last4}</span>}
                    {!c.active && <span className="rounded-full bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-500">hidden</span>}
                  </div>
                  <div className="truncate text-xs text-slate-500">
                    {c.member.name} · {c.type === "credit_card" ? "Credit" : c.type === "prepaid_card" ? "Prepaid" : "Debit"}
                    {c.institution ? ` · ${c.institution}` : ""}
                    {c.network ? ` · ${c.network}` : ""}
                  </div>
                </div>
                {canManage(c) && (
                  <div className="flex shrink-0 items-center gap-1">
                    <button onClick={() => { setEditId(c.id); setAdding(false); }} className="rounded-md px-2 py-1 text-xs font-medium text-slate-500 hover:bg-slate-100">Edit</button>
                    <DeleteCardButton id={c.id} name={c.name} />
                  </div>
                )}
              </li>
            ),
          )}
        </ul>
      )}
    </div>
  );
}

function CardForm({
  members,
  card,
  defaultOwnerId,
  canReassignOwner = false,
  onDone,
}: {
  members: Mem[];
  card?: FamilyCard;
  defaultOwnerId: number;
  canReassignOwner?: boolean;
  onDone: () => void;
}) {
  const toast = useToast();
  const editing = !!card;
  const [type, setType] = useState<string>(card?.type ?? "credit_card");
  const [state, formAction, pending] = useActionState<CardFormState, FormData>(addFamilyCard, { ok: false, n: 0 });
  const prevN = useRef(0);

  // Add flow uses useActionState (shows errors, resets). Edit posts updateFamilyCard directly.
  useEffect(() => {
    if (!editing && state.n > prevN.current) {
      prevN.current = state.n;
      if (state.ok) { toast("Card added", "success"); onDone(); }
    }
  }, [state, editing, onDone, toast]);

  const field = "mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100";
  const ownerLocked = editing && !canReassignOwner;

  return (
    <form
      action={editing ? updateFamilyCard : formAction}
      onSubmit={editing ? () => setTimeout(onDone, 0) : undefined}
      className="space-y-3 rounded-xl border border-indigo-200 bg-indigo-50/40 p-4"
    >
      {editing && <input type="hidden" name="id" value={card!.id} />}
      <p className="text-[11px] text-slate-400"><span className="text-red-500">*</span> required</p>
      <div className="grid grid-cols-2 gap-3">
        <label className="col-span-2 block text-sm">
          <span className="font-medium text-slate-600">Card name <span className="text-red-500">*</span></span>
          <input name="name" required defaultValue={card?.name ?? ""} placeholder="e.g. SBI SimplyClick" className={field} />
        </label>

        <label className="block text-sm">
          <span className="font-medium text-slate-600">Type <span className="text-red-500">*</span></span>
          <select name="type" value={type} onChange={(e) => setType(e.target.value)} disabled={editing} className={`${field} ${editing ? "bg-slate-100 text-slate-500" : ""}`}>
            <option value="credit_card">Credit</option>
            <option value="debit_card">Debit</option>
            <option value="prepaid_card">Prepaid / wallet</option>
          </select>
        </label>

        <label className="block text-sm">
          <span className="font-medium text-slate-600">Owner <span className="text-red-500">*</span></span>
          {ownerLocked ? (
            <>
              <input className={`${field} bg-slate-100 text-slate-500`} value={members.find((m) => m.id === defaultOwnerId)?.name ?? ""} disabled />
              <span className="mt-1 block text-[11px] text-slate-400">Only the head can change the owner.</span>
            </>
          ) : (
            <select name="ownerId" defaultValue={defaultOwnerId} className={field}>
              {members.map((m) => (
                <option key={m.id} value={m.id}>{m.name}</option>
              ))}
            </select>
          )}
        </label>

        <label className="block text-sm">
          <span className="font-medium text-slate-600">Bank / issuer</span>
          <input name="institution" defaultValue={card?.institution ?? ""} placeholder="SBI, HDFC…" className={field} />
        </label>

        <label className="block text-sm">
          <span className="font-medium text-slate-600">Network</span>
          <select name="network" defaultValue={card?.network ?? ""} className={field}>
            {NETWORKS.map((n) => (
              <option key={n} value={n}>{n === "" ? "—" : n}</option>
            ))}
          </select>
        </label>

        <label className="block text-sm">
          <span className="font-medium text-slate-600">Last 4 digits</span>
          <input name="last4" inputMode="numeric" maxLength={4} defaultValue={card?.last4 ?? ""} placeholder="1234" className={field} />
        </label>

        {/* Credit-only billing cycle. Statement day + days-until-due let the dashboard date the bill and
            reminders; the credit limit powers the utilisation gauge. Hidden for debit (no bill). */}
        {type === "credit_card" && (
          <div className="col-span-2 grid grid-cols-2 gap-3 rounded-lg border border-indigo-100 bg-white/60 p-3">
            <p className="col-span-2 text-xs font-medium text-slate-500">Billing cycle</p>
            <label className="block text-sm">
              <span className="font-medium text-slate-600">Statement day <span className="text-red-500">*</span></span>
              <input name="statementDay" type="number" inputMode="numeric" min={1} max={28} required defaultValue={card?.credit?.statementDay ?? ""} placeholder="1–28" className={field} />
              <span className="mt-1 block text-[11px] text-slate-400">Day the bill is generated.</span>
            </label>
            <label className="block text-sm">
              <span className="font-medium text-slate-600">Days until due <span className="text-red-500">*</span></span>
              <input name="dueOffsetDays" type="number" inputMode="numeric" min={1} max={60} required defaultValue={card?.credit?.dueOffsetDays ?? ""} placeholder="e.g. 18" className={field} />
              <span className="mt-1 block text-[11px] text-slate-400">Days after the statement.</span>
            </label>
            <label className="col-span-2 block text-sm">
              <span className="font-medium text-slate-600">Credit limit (₹)</span>
              <input name="creditLimit" type="number" inputMode="numeric" min={0} defaultValue={card?.credit?.creditLimit ?? ""} placeholder="optional" className={field} />
            </label>
          </div>
        )}

        {/* Debit/prepaid: the balance already on the card. Top-ups and spends adjust it from here. */}
        {(type === "debit_card" || type === "prepaid_card") && (
          <label className="col-span-2 block text-sm">
            <span className="font-medium text-slate-600">Available balance now (₹)</span>
            <input name="openingBalance" type="number" inputMode="numeric" min={0} defaultValue={card?.openingBalance ?? ""} placeholder="0" className={field} />
            <span className="mt-1 block text-[11px] text-slate-400">Money on the card today. Top up from the owner&apos;s personal view.</span>
          </label>
        )}

        <div className="col-span-2 text-sm">
          <span className="font-medium text-slate-600">Colour</span>
          <CardColorPicker defaultValue={card?.color} />
        </div>
      </div>

      {editing && (
        <label className="flex items-center gap-2 text-sm text-slate-600">
          <input type="checkbox" name="active" defaultChecked={card!.active} className="h-4 w-4 accent-indigo-600" />
          Active (show it in the &ldquo;Paid with&rdquo; picker)
        </label>
      )}

      {!editing && !state.ok && state.error && (
        <p className="rounded-lg bg-red-50 px-3 py-2 text-xs font-medium text-red-700">⚠ {state.error}</p>
      )}

      <div className="flex justify-end gap-2">
        <button type="button" onClick={onDone} className="rounded-md px-3 py-2 text-sm text-slate-500 hover:bg-slate-100">Cancel</button>
        <button type="submit" disabled={pending} className="btn disabled:opacity-40">
          {editing ? "Save" : pending ? "Adding…" : "Add card"}
        </button>
      </div>
    </form>
  );
}

function DeleteCardButton({ id, name }: { id: number; name: string }) {
  return (
    <form
      action={deleteFamilyCard}
      onSubmit={(e) => {
        if (!confirm(`Delete “${name}”? Past spends keep their attribution; they just lose the card tag.`)) e.preventDefault();
      }}
    >
      <input type="hidden" name="id" value={id} />
      <button type="submit" className="rounded-md px-2 py-1 text-xs font-medium text-red-500 hover:bg-red-50">Delete</button>
    </form>
  );
}
