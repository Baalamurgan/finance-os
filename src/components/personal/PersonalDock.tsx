"use client";

import Link from "next/link";
import { useState } from "react";
import { usePathname } from "next/navigation";
import { getQuickSpendData } from "@/app/personal/actions";
import { PersonalSpendModal } from "@/components/personal/PersonalSpendModal";
import { useToast } from "@/components/Toast";

type SpendData = NonNullable<Awaited<ReturnType<typeof getQuickSpendData>>>;

// Always-present quick actions for the whole Personal side: Spend on the left, To-do on the right.
// "Spend" opens the add-spend box RIGHT HERE on whatever tab you're on (its data — categories, cards, the
// month's Can spend — is fetched on tap), so adding a spend never navigates away. To-do still opens the
// composer on Today. Hidden on the lock/onboarding screens.
const HIDE_ON = ["/personal/lock", "/personal/onboarding"];

export function PersonalDock() {
  const pathname = usePathname();
  const toast = useToast();
  const [data, setData] = useState<SpendData | null>(null);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  if (HIDE_ON.some((p) => pathname.startsWith(p))) return null;

  const openSpend = async () => {
    if (loading) return;
    setOpen(true);
    if (data) return; // instant on later taps; refreshed in the background below
    setLoading(true);
    try {
      const d = await getQuickSpendData();
      if (!d) { toast("Start a month first", "error"); setOpen(false); return; }
      setData(d);
    } catch {
      toast("Couldn't open — try again", "error");
      setOpen(false);
    } finally {
      setLoading(false);
    }
  };
  // keep the cached data fresh for the next tap (Can spend, new categories/cards)
  const onOpenChange = (v: boolean) => {
    setOpen(v);
    if (!v) void getQuickSpendData().then((d) => d && setData(d)).catch(() => {});
  };

  return (
    <>
      <div
        // Sits above the mobile bottom tab bar (~4.25rem) and at the normal bottom on desktop.
        className="pointer-events-none fixed inset-x-0 bottom-0 z-40 flex items-center justify-between px-4 pb-[calc(env(safe-area-inset-bottom)+4.25rem)] sm:px-6 sm:pb-[calc(env(safe-area-inset-bottom)+1rem)]"
      >
        <button
          type="button"
          onClick={openSpend}
          className="pointer-events-auto flex items-center gap-2 rounded-full bg-emerald-600 px-5 py-3.5 text-sm font-semibold text-white shadow-lg ring-1 ring-emerald-700/20 active:scale-95"
        >
          <span className="text-lg leading-none">₹</span> {loading ? "Opening…" : "Spend"}
        </button>
        <Link
          href="/personal/today?add=1"
          className="pointer-events-auto flex items-center gap-2 rounded-full bg-white px-5 py-3.5 text-sm font-semibold text-emerald-700 shadow-lg ring-1 ring-emerald-200 active:scale-95"
        >
          <span className="text-base leading-none">✓</span> To-do
        </Link>
      </div>
      {data && (
        <PersonalSpendModal
          periodId={data.periodId}
          categories={data.categories}
          cards={data.cards}
          members={data.members}
          pastNames={data.pastNames}
          remaining={data.remaining}
          hideTrigger
          controlledOpen={open}
          onOpenChange={onOpenChange}
        />
      )}
    </>
  );
}
