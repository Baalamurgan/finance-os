"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

// Always-present quick actions for the whole Personal side: Spend on the left, To-do on the
// right. Both are deep links — Spend opens the spend sheet on the Expenses page (?add=1), To-do
// opens the composer on Today (?add=1) — so no page needs to preload their data. Hidden on the
// lock/onboarding screens where there's nothing to add yet.
const HIDE_ON = ["/personal/lock", "/personal/onboarding"];

export function PersonalDock() {
  const pathname = usePathname();
  if (HIDE_ON.some((p) => pathname.startsWith(p))) return null;

  return (
    <div
      className="pointer-events-none fixed inset-x-0 bottom-0 z-40 flex items-center justify-between px-4 sm:px-6"
      style={{ paddingBottom: "max(env(safe-area-inset-bottom), 1rem)" }}
    >
      <Link
        href="/personal/expenses?add=1"
        className="pointer-events-auto flex items-center gap-2 rounded-full bg-emerald-600 px-5 py-3.5 text-sm font-semibold text-white shadow-lg ring-1 ring-emerald-700/20 active:scale-95"
      >
        <span className="text-lg leading-none">₹</span> Spend
      </Link>
      <Link
        href="/personal/today?add=1"
        className="pointer-events-auto flex items-center gap-2 rounded-full bg-white px-5 py-3.5 text-sm font-semibold text-emerald-700 shadow-lg ring-1 ring-emerald-200 active:scale-95"
      >
        <span className="text-base leading-none">✓</span> To-do
      </Link>
    </div>
  );
}
