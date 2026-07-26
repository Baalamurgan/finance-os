"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { addSpendAction, getSpendKeywords, type AddSpendState } from "@/app/actions";
import { QUICK_ITEMS, suggestCategoryName, type LearnedKeyword } from "@/lib/spendCategorize";

type Cat = { id: number; name: string; misc?: boolean }; // misc = the Personal/Misc bucket

type Mem = { id: number; name: string };

export function AddSpendModal({
  periodId,
  trigger,
  fixedCategory,
  categories,
  isHead,
  members,
  currentMemberId,
  subCategories,
}: {
  periodId: number;
  trigger: "primary" | "card" | "fab";
  fixedCategory?: Cat; // card mode: category locked
  categories?: Cat[]; // picker mode: choose a category
  isHead?: boolean; // head can log on behalf of another member
  members?: Mem[];
  currentMemberId?: number | null;
  subCategories?: { name: string; icon: string }[]; // shown & required for misc spends
}) {
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [categoryId, setCategoryId] = useState<number | null>(fixedCategory?.id ?? null);
  const [justSaved, setJustSaved] = useState(false);
  const [keepAdding, setKeepAdding] = useState(false);
  const [subCategory, setSubCategory] = useState("");
  const [labelText, setLabelText] = useState(""); // controlled so chips/nudge can drive it
  const [learned, setLearned] = useState<LearnedKeyword[]>([]); // household's taught items
  const [dismissedFor, setDismissedFor] = useState<string | null>(null); // hide nudge for this text

  // Misc (Personal/Misc) spends must carry a reporting sub-category (Food, Travel…).
  const selectedCat = fixedCategory ?? categories?.find((c) => c.id === categoryId);
  const isMiscSelected = !!selectedCat?.misc && !!subCategories?.length;
  const needSub = isMiscSelected && !subCategory;

  // ── Smart category help (picker mode only) ───────────────────────────────────
  // Quick-pick chips fill the item + set the right category in one tap; the nudge
  // gently suggests a tracked category when the typed item looks miscategorised.
  const nameToId = new Map((categories ?? []).map((c) => [c.name, c.id]));
  const quickChips = fixedCategory
    ? []
    : QUICK_ITEMS.filter((q) => nameToId.has(q.category)).map((q) => ({ ...q, id: nameToId.get(q.category)! }));
  const suggestName = fixedCategory ? null : suggestCategoryName(labelText, learned);
  const suggestId = suggestName ? nameToId.get(suggestName) ?? null : null;
  const suggestCat = suggestId != null ? categories?.find((c) => c.id === suggestId) : undefined;
  // Deliberate "for someone else" Misc entries are legitimate — never nag those.
  const forSomeoneElse = isMiscSelected && subCategory === "For someone else";
  const showSuggest = !!suggestCat && suggestId !== categoryId && dismissedFor !== labelText && !forSomeoneElse;

  const [state, formAction, pending] = useActionState<AddSpendState, FormData>(
    addSpendAction,
    { ok: false, n: 0 },
  );

  const formRef = useRef<HTMLFormElement>(null);
  const amountRef = useRef<HTMLInputElement>(null);
  const prevN = useRef(0);
  const fetchedKw = useRef(false);

  useEffect(() => setMounted(true), []);

  // Load the household's learned item→category words the first time the modal opens
  // (the code seed already covers the common items, so the nudge works before this).
  useEffect(() => {
    if (open && !fetchedKw.current && !fixedCategory) {
      fetchedKw.current = true;
      getSpendKeywords().then(setLearned).catch(() => {});
    }
  }, [open, fixedCategory]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  // On a successful save: if "keep adding" is on, clear + stay open (rapid
  // grocery logging); otherwise close the modal (the default expectation).
  useEffect(() => {
    if (state.n > prevN.current) {
      prevN.current = state.n;
      if (keepAdding) {
        formRef.current?.reset(); // clears uncontrolled amount; category stays (controlled)
        setSubCategory(""); // controlled — reset for the next item
        setLabelText(""); // controlled — reset the item text + nudge
        setDismissedFor(null);
        setJustSaved(true);
        amountRef.current?.focus();
        const t = setTimeout(() => setJustSaved(false), 2500);
        return () => clearTimeout(t);
      }
      setOpen(false);
    }
  }, [state.n, keepAdding]);

  const openModal = () => {
    setJustSaved(false);
    setOpen(true);
  };

  return (
    <>
      {trigger === "primary" && (
        <button onClick={openModal} className="btn hidden sm:inline-block">
          + Add Spend
        </button>
      )}
      {trigger === "card" && (
        <button
          onClick={openModal}
          className="rounded-md px-2 py-1 text-xs font-medium text-indigo-600 hover:bg-indigo-50"
        >
          + Add spend
        </button>
      )}
      {trigger === "fab" && <Fab onOpen={openModal} />}

      {open &&
        mounted &&
        createPortal(
          <div
            className="fixed inset-0 z-50 flex items-end justify-center overflow-y-auto bg-black/40 sm:items-center sm:p-4"
            onClick={() => setOpen(false)}
          >
            <div
              className="flex max-h-[92vh] w-full max-w-md flex-col rounded-t-3xl bg-white shadow-xl sm:my-auto sm:rounded-2xl"
              onClick={(e) => e.stopPropagation()}
              style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
            >
              <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
                <h2 className="text-xl font-bold text-slate-900">
                  Add spend
                  {fixedCategory && <span className="text-indigo-600"> · {fixedCategory.name}</span>}
                </h2>
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  className="-mr-2 rounded-lg px-3 py-2 text-2xl leading-none text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                  aria-label="Close"
                >
                  ✕
                </button>
              </div>

              <form ref={formRef} action={formAction} className="flex min-h-0 flex-col">
                <div className="space-y-5 overflow-y-auto px-5 py-5">
                  <input type="hidden" name="periodId" value={periodId} />
                  <input type="hidden" name="categoryId" value={categoryId ?? ""} />

                  {/* big amount */}
                  <div>
                    <label className="text-sm font-medium text-slate-600">Amount (₹)</label>
                    <input
                      ref={amountRef}
                      name="amount"
                      type="number"
                      step="1"
                      min="0"
                      inputMode="numeric"
                      autoFocus
                      required
                      placeholder="0"
                      className="mt-1.5 w-full rounded-xl border-2 border-slate-300 px-4 py-3 text-4xl font-bold tabular-nums outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100"
                    />
                  </div>

                  {/* quick-pick common items — one tap fills the item AND the right
                      category, so the frequent staples never land in Misc by mistake */}
                  {quickChips.length > 0 && (
                    <div>
                      <label className="text-sm font-medium text-slate-600">Quick add</label>
                      <div className="mt-1.5 flex flex-wrap gap-2">
                        {quickChips.map((q) => (
                          <button
                            key={q.label}
                            type="button"
                            onClick={() => {
                              setLabelText(q.fill);
                              setCategoryId(q.id);
                              setDismissedFor(null);
                            }}
                            className={`flex items-center gap-1.5 rounded-full border-2 px-3 py-2 text-sm font-medium transition ${
                              categoryId === q.id && labelText === q.fill
                                ? "border-indigo-500 bg-indigo-50 text-indigo-700"
                                : "border-slate-200 text-slate-600 active:border-slate-400"
                            }`}
                          >
                            <span className="text-base leading-none">{q.icon}</span> {q.label}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* category chips (picker mode only) — big tap targets */}
                  {!fixedCategory && categories && (
                    <div>
                      <label className="text-sm font-medium text-slate-600">Category</label>
                      <div className="mt-1.5 grid grid-cols-2 gap-2">
                        {categories.map((cat) => (
                          <button
                            key={cat.id}
                            type="button"
                            onClick={() => setCategoryId(cat.id)}
                            className={`min-h-12 rounded-xl border-2 px-3 py-3 text-base font-medium transition ${
                              categoryId === cat.id
                                ? "border-indigo-500 bg-indigo-50 text-indigo-700"
                                : "border-slate-200 text-slate-600 active:border-slate-400"
                            }`}
                          >
                            {cat.name}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* soft, overridable nudge: the item looks like a tracked category but
                      a different one (usually Misc) is chosen. One tap to move; easy to
                      ignore (petrol for someone else stays in Misc). */}
                  {showSuggest && suggestCat && (
                    <div className="flex items-center gap-2 rounded-xl border-2 border-amber-200 bg-amber-50 px-3 py-2.5">
                      <span className="text-lg leading-none">💡</span>
                      <span className="flex-1 text-sm text-amber-900">
                        Looks like <b>{suggestCat.name}</b>. Move it there?
                      </span>
                      <button
                        type="button"
                        onClick={() => setCategoryId(suggestId)}
                        className="rounded-lg bg-amber-500 px-3 py-1.5 text-sm font-semibold text-white active:bg-amber-600"
                      >
                        Yes
                      </button>
                      <button
                        type="button"
                        onClick={() => setDismissedFor(labelText)}
                        className="rounded-lg px-2 py-1.5 text-sm font-medium text-amber-700/70 hover:text-amber-800"
                      >
                        No
                      </button>
                    </div>
                  )}

                  {/* sub-category — misc spends only (reporting: Food, Travel…) */}
                  {isMiscSelected && (
                    <div>
                      <label className="text-sm font-medium text-slate-600">
                        Kind of spend <span className="text-red-500">*</span>
                      </label>
                      <select
                        name="subCategory"
                        required
                        value={subCategory}
                        onChange={(e) => setSubCategory(e.target.value)}
                        className="mt-1.5 w-full rounded-xl border-2 border-slate-300 px-4 py-3 text-base outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100"
                      >
                        <option value="" disabled>Pick a kind…</option>
                        {subCategories!.map((s) => (
                          <option key={s.name} value={s.name}>{s.icon} {s.name}</option>
                        ))}
                      </select>
                    </div>
                  )}

                  <div>
                    <label className="text-sm font-medium text-slate-600">What was bought</label>
                    <input
                      name="label"
                      required
                      value={labelText}
                      onChange={(e) => setLabelText(e.target.value)}
                      placeholder="e.g. Tomatoes, Chicken, Petrol"
                      className="mt-1.5 w-full rounded-xl border-2 border-slate-300 px-4 py-3 text-lg outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100"
                    />
                  </div>

                  {/* head-only: log a spend on behalf of another family member */}
                  {isHead && members && members.length > 0 && (
                    <div>
                      <label className="text-sm font-medium text-slate-600">Who spent</label>
                      <select
                        name="memberId"
                        defaultValue={currentMemberId ?? ""}
                        className="mt-1.5 w-full rounded-xl border-2 border-slate-300 px-4 py-3 text-base outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100"
                      >
                        {members.map((m) => (
                          <option key={m.id} value={m.id}>{m.name}</option>
                        ))}
                      </select>
                    </div>
                  )}

                  {/* keep-adding toggle: off = Save closes; on = stay open for next item */}
                  <label className="flex items-center gap-3 rounded-xl bg-slate-50 px-4 py-3 text-base text-slate-700">
                    <input
                      type="checkbox"
                      checked={keepAdding}
                      onChange={(e) => setKeepAdding(e.target.checked)}
                      className="h-5 w-5"
                    />
                    ➕ Keep adding more (don&apos;t close after saving)
                  </label>

                  {justSaved && (
                    <p className="rounded-xl bg-green-50 px-4 py-3 text-center text-base font-semibold text-green-700">
                      ✓ Saved! Add the next item.
                    </p>
                  )}
                </div>

                <div className="flex items-center gap-3 border-t border-slate-100 px-5 py-4">
                  <button
                    type="button"
                    onClick={() => setOpen(false)}
                    className="min-h-12 flex-1 rounded-xl border-2 border-slate-200 px-4 py-3 text-base font-medium text-slate-600 active:bg-slate-100"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={!categoryId || needSub || pending}
                    className="min-h-12 flex-1 rounded-xl bg-indigo-600 px-4 py-3 text-base font-semibold text-white shadow-sm active:bg-indigo-800 disabled:opacity-40"
                  >
                    {pending ? "Saving…" : "Save"}
                  </button>
                </div>
              </form>
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}

// Floating Add-Spend button (mobile). Draggable left↔right so it never blocks a
// row's delete control; the chosen side is remembered in localStorage. A plain
// tap (no drag) opens the modal.
function Fab({ onOpen }: { onOpen: () => void }) {
  const [side, setSide] = useState<"left" | "right">("right");
  const [dragX, setDragX] = useState<number | null>(null);
  const startX = useRef<number | null>(null);
  const moved = useRef(false);

  useEffect(() => {
    const s = localStorage.getItem("fab-side");
    if (s === "left" || s === "right") setSide(s);
  }, []);

  const onPointerDown = (e: React.PointerEvent) => {
    moved.current = false;
    startX.current = e.clientX;
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (startX.current == null) return;
    if (Math.abs(e.clientX - startX.current) > 6) {
      moved.current = true;
      setDragX(e.clientX);
    }
  };
  const onPointerUp = (e: React.PointerEvent) => {
    if (startX.current == null) return;
    const x = e.clientX;
    startX.current = null;
    if (moved.current) {
      const newSide = x < window.innerWidth / 2 ? "left" : "right";
      setSide(newSide);
      localStorage.setItem("fab-side", newSide);
      setDragX(null);
    } else {
      onOpen();
    }
  };

  const positional: React.CSSProperties =
    dragX != null
      ? { left: Math.max(8, Math.min(window.innerWidth - 140, dragX - 60)) }
      : side === "left"
        ? { left: 16 }
        : { right: 16 };

  return (
    <button
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      className="fixed z-40 flex touch-none select-none items-center gap-2 rounded-full bg-indigo-600 px-5 py-4 text-base font-semibold text-white shadow-lg shadow-indigo-600/30 active:bg-indigo-800 sm:hidden"
      style={{ bottom: "calc(env(safe-area-inset-bottom) + 4.75rem)", ...positional }}
    >
      <span className="text-xl leading-none">+</span> Add Spend
    </button>
  );
}
