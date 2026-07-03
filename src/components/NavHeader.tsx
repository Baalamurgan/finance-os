"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { AddSpendModal } from "@/components/AddSpendModal";
import { UserMenu } from "@/components/UserMenu";
import { WindDownBanner } from "@/components/WindDownBanner";
import { AppLockWatcher } from "@/components/AppLockWatcher";
import { formatINR } from "@/lib/format";

const MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

export function NavHeader({
  active,
  householdName,
  selYear,
  selMonth,
  members,
  categories,
  account,
  isHead,
  piggyBalance,
  periodId,
  periodOpen,
  currentMemberId,
  windDownReminder,
  canEdit,
  pinEnabled,
  hasBiometric,
}: {
  active:
    | "sheet"
    | "expenses"
    | "analysis"
    | "piggy"
    | "loans"
    | "settlement"
    | "wind-down"
    | "setup"
    | "users";
  householdName: string;
  selYear: number;
  selMonth: number;
  members: { id: number; name: string }[];
  categories: { id: number; name: string; tracked?: boolean }[];
  account: { name: string; email: string; image: string | null };
  isHead: boolean;
  piggyBalance: number;
  periodId: number | null;
  periodOpen: boolean;
  currentMemberId?: number | null;
  windDownReminder?: { daysUntil: number; day: number } | null;
  canEdit?: boolean;
  pinEnabled?: boolean;
  hasBiometric?: boolean;
}) {
  const router = useRouter();
  const now = new Date();
  const curYear = now.getFullYear();
  const curMonth = now.getMonth() + 1;

  const tabs = [
    { key: "sheet", label: "Sheet", href: "/" },
    { key: "expenses", label: "Expenses", href: "/expenses" },
    { key: "settlement", label: "Settlement", href: "/settlement" },
    { key: "analysis", label: "Analysis", href: "/analysis" },
    { key: "piggy", label: "Piggy", href: "/piggy" },
    { key: "loans", label: "Loans & Chits", href: "/loans" },
    { key: "wind-down", label: "Wind Down", href: "/wind-down" },
    // Setup is head-editable / manager view-only; Manage Users stays head-only.
    ...(isHead
      ? [
          { key: "setup", label: "Setup", href: "/setup" },
          { key: "users", label: "Manage Users", href: "/users" },
        ]
      : canEdit
        ? [{ key: "setup", label: "Setup", href: "/setup" }]
        : []),
  ];

  const primaryTabs = tabs.slice(0, 3); // Sheet · Expenses · Settlement
  const moreTabs = tabs.slice(3); // Analysis · Piggy · Loans · Wind Down · …

  const q = `?y=${selYear}&m=${selMonth}`;
  const activeHref = tabs.find((t) => t.key === active)?.href ?? "/";

  const years: number[] = [];
  for (let yr = curYear; yr >= 2000; yr--) years.push(yr);

  // replace (not push) so the phone back button exits the app instead of
  // stepping back through months/tabs — feels native, less confusing for elders.
  const go = (y: number, m: number) => router.replace(`${activeHref}?y=${y}&m=${m}`);

  return (
    <>
    <header className="sticky top-0 z-40 border-b border-slate-200 bg-white/90 backdrop-blur">
      <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3 sm:px-6">
        <div className="mr-2">
          <div className="text-base font-bold text-slate-900">{householdName}</div>
          <div className="text-[11px] text-slate-400">Family Finance OS</div>
        </div>

        {/* desktop tabs (mobile uses the bottom bar) */}
        <nav className="hidden flex-wrap items-center gap-1 sm:flex">
          {primaryTabs.map((t) => (
            <Link
              key={t.key}
              href={`${t.href}${q}`}
              replace
              className={`rounded-md px-3 py-1.5 text-sm font-medium transition ${
                active === t.key
                  ? "bg-indigo-600 text-white"
                  : "text-slate-600 hover:bg-slate-100"
              }`}
            >
              {t.label}
            </Link>
          ))}
          <MoreMenu items={moreTabs} q={q} active={active} />
        </nav>

        <div className="ml-auto flex flex-wrap items-center gap-2">
          <span className="hidden rounded-full bg-amber-50 px-3 py-1 text-xs font-medium text-amber-700 sm:inline">
            🐷 {formatINR(piggyBalance)}
          </span>

          {/* month + year pickers */}
          <select
            value={selMonth}
            onChange={(e) => go(selYear, Number(e.target.value))}
            className="rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm shadow-sm"
          >
            {MONTHS.map((mname, i) => {
              const mnum = i + 1;
              const future = selYear > curYear || (selYear === curYear && mnum > curMonth);
              return (
                <option key={mnum} value={mnum} disabled={future}>
                  {mname}
                </option>
              );
            })}
          </select>
          <select
            value={selYear}
            onChange={(e) => {
              const y = Number(e.target.value);
              // if switching to current year and selected month is in the future, clamp
              const m = y === curYear && selMonth > curMonth ? curMonth : selMonth;
              go(y, m);
            }}
            className="rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm shadow-sm"
          >
            {years.map((yr) => (
              <option key={yr} value={yr}>
                {yr}
              </option>
            ))}
          </select>

          {periodOpen && periodId && (
            <AddSpendModal
              periodId={periodId}
              trigger="primary"
              categories={categories.filter((c) => c.tracked)}
              isHead={isHead}
              members={members}
              currentMemberId={currentMemberId}
            />
          )}

          {/* identity */}
          <div className="border-l border-slate-200 pl-2">
            <UserMenu
              name={account.name}
              email={account.email}
              image={account.image}
              role={isHead ? "head" : "member"}
              pinEnabled={pinEnabled}
              hasBiometric={hasBiometric}
            />
          </div>
        </div>
      </div>
    </header>

    {pinEnabled && <AppLockWatcher />}
    {windDownReminder && <WindDownBanner daysUntil={windDownReminder.daysUntil} />}

    {/* big thumb-reachable "Add Spend" button on mobile (the easy daily action) */}
    {periodOpen && periodId && (
      <AddSpendModal
        periodId={periodId}
        trigger="fab"
        categories={categories.filter((c) => c.tracked)}
        isHead={isHead}
        members={members}
        currentMemberId={currentMemberId}
      />
    )}

    {/* mobile bottom tab bar — rendered OUTSIDE the backdrop-blur header so that
        position:fixed resolves against the viewport, not the header box */}
    <BottomNav primaryTabs={primaryTabs} moreTabs={moreTabs} q={q} active={active} />
    </>
  );
}

// Simple, instantly-recognizable icons for the bottom bar (kind to older eyes).
const TAB_ICON: Record<string, string> = {
  sheet: "📋",
  expenses: "🧾",
  settlement: "🤝",
  analysis: "📊",
};

function BottomNav({
  primaryTabs,
  moreTabs,
  q,
  active,
}: {
  primaryTabs: { key: string; label: string; href: string }[];
  moreTabs: { key: string; label: string; href: string }[];
  q: string;
  active: string;
}) {
  const [open, setOpen] = useState(false);
  const moreActive = moreTabs.some((t) => t.key === active);
  const cell = (activeHere: boolean) =>
    `flex flex-1 flex-col items-center justify-center gap-0.5 py-2.5 text-xs font-medium ${
      activeHere ? "text-indigo-600" : "text-slate-500"
    }`;

  return (
    <>
      {/* tap-away + slide-up sheet for "More" */}
      {open && (
        <div className="fixed inset-0 z-40 bg-slate-900/30 sm:hidden" onClick={() => setOpen(false)}>
          <div
            className="absolute inset-x-0 mx-2 overflow-hidden rounded-2xl border border-slate-200 bg-white py-1 shadow-xl"
            style={{ bottom: "calc(env(safe-area-inset-bottom) + 4.5rem)" }}
            onClick={(e) => e.stopPropagation()}
          >
            {moreTabs.map((t) => (
              <Link
                key={t.key}
                href={`${t.href}${q}`}
                replace
                onClick={() => setOpen(false)}
                className={`block px-5 py-4 text-base ${
                  active === t.key ? "bg-indigo-50 font-medium text-indigo-700" : "text-slate-700"
                }`}
              >
                {t.label}
              </Link>
            ))}
          </div>
        </div>
      )}

      <nav
        className="fixed inset-x-0 bottom-0 z-50 flex border-t border-slate-200 bg-white/95 backdrop-blur sm:hidden"
        style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
      >
        {primaryTabs.map((t) => (
          <Link key={t.key} href={`${t.href}${q}`} replace className={cell(active === t.key)} onClick={() => setOpen(false)}>
            <span className="text-xl leading-none">{TAB_ICON[t.key] ?? "•"}</span>
            {t.label}
          </Link>
        ))}
        {moreTabs.length > 0 && (
          <button type="button" onClick={() => setOpen((v) => !v)} className={cell(moreActive || open)}>
            <span className="text-xl leading-none">⋯</span>
            More
          </button>
        )}
      </nav>
    </>
  );
}

function MoreMenu({
  items,
  q,
  active,
}: {
  items: { key: string; label: string; href: string }[];
  q: string;
  active: string;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const activeHere = items.some((t) => t.key === active);

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener("mousedown", onClick);
    return () => window.removeEventListener("mousedown", onClick);
  }, [open]);

  if (items.length === 0) return null;

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((v) => !v)}
        className={`flex items-center gap-1 rounded-md px-3 py-1.5 text-sm font-medium transition ${
          activeHere ? "bg-indigo-600 text-white" : "text-slate-600 hover:bg-slate-100"
        }`}
      >
        More
        <svg width="12" height="12" viewBox="0 0 20 20">
          <path fill="currentColor" d="M5 7l5 5 5-5z" />
        </svg>
      </button>
      {open && (
        <div className="absolute left-0 z-50 mt-1 w-44 overflow-hidden rounded-lg border border-slate-200 bg-white py-1 shadow-lg">
          {items.map((t) => (
            <Link
              key={t.key}
              href={`${t.href}${q}`}
              replace
              onClick={() => setOpen(false)}
              className={`block px-3 py-2 text-sm ${
                active === t.key
                  ? "bg-indigo-50 font-medium text-indigo-700"
                  : "text-slate-600 hover:bg-slate-50"
              }`}
            >
              {t.label}
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
