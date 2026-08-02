"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { AddSpendModal } from "@/components/AddSpendModal";
import { AutoLock } from "@/components/AutoLock";
import { UserMenu } from "@/components/UserMenu";
import { WindDownBanner } from "@/components/WindDownBanner";
import { DueTodayBanner } from "@/components/DueTodayBanner";
import { ProvisionalBanner } from "@/components/ProvisionalBanner";
import { WindDownPopup } from "@/components/WindDownPopup";
import { CardDueHighAlert } from "@/components/personal/CardDueHighAlert";
import { BillDueHighAlert } from "@/components/BillDueHighAlert";
import { RemindersBell } from "@/components/personal/RemindersBell";
import { setViewAs } from "@/app/actions";
import { formatINR } from "@/lib/format";
import { MISC_SUBCATEGORIES } from "@/lib/misc";

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
  previewPeriod,
  provisional,
  canEdit,
  pinEnabled,
  hasBiometric,
  actualIsHead,
  viewingAsMember,
}: {
  active:
    | "sheet"
    | "expenses"
    | "in-hand"
    | "activity"
    | "analysis"
    | "piggy"
    | "notes"
    | "loans"
    | "settlement"
    | "wind-down"
    | "setup"
    | "users";
  householdName: string;
  selYear: number;
  selMonth: number;
  members: { id: number; name: string }[];
  categories: { id: number; name: string; tracked?: boolean; section?: string; sinking?: boolean }[];
  account: { name: string; email: string; image: string | null };
  isHead: boolean;
  piggyBalance: number;
  periodId: number | null;
  periodOpen: boolean;
  currentMemberId?: number | null;
  windDownReminder?: { daysUntil: number; day: number } | null;
  previewPeriod?: { year: number; month: number; label: string } | null;
  provisional?: { workingLabel: string } | null;
  canEdit?: boolean;
  pinEnabled?: boolean;
  hasBiometric?: boolean;
  actualIsHead?: boolean;
  viewingAsMember?: boolean;
}) {
  const router = useRouter();
  const now = new Date();
  const curYear = now.getFullYear();
  const curMonth = now.getMonth() + 1;

  // Add-spend picker: everyday budgeted categories first, sinking funds last (their
  // spend categories are logged against rarely). Stable sort keeps each group's name order.
  const spendCategories = categories
    .filter((c) => c.tracked)
    .sort((a, b) => Number(a.sinking ?? false) - Number(b.sinking ?? false))
    .map((c) => ({ id: c.id, name: c.name, misc: c.section === "Misc" }));

  // Day-to-day tabs live in the nav; the admin-ish ones (Wind Down, Setup, Settings)
  // moved under the avatar menu to declutter the bar.
  const tabs = [
    { key: "sheet", label: "Sheet", href: "/" },
    { key: "expenses", label: "Expenses", href: "/expenses" },
    { key: "in-hand", label: "Money Plan", href: "/in-hand" },
    { key: "settlement", label: "Settlement", href: "/settlement" },
    { key: "activity", label: "Activity", href: "/activity" },
    { key: "analysis", label: "Analysis", href: "/analysis" },
    { key: "piggy", label: "Piggy", href: "/piggy" },
    { key: "notes", label: "Notes", href: "/notes" },
    { key: "loans", label: "Loans & Chits", href: "/loans" },
  ];

  const primaryTabs = tabs.slice(0, 3); // Sheet · Expenses · In Hand
  const moreTabs = tabs.slice(3); // Analysis · Piggy · Loans · Wind Down · …

  const q = `?y=${selYear}&m=${selMonth}`;
  const activeHref = tabs.find((t) => t.key === active)?.href ?? "/";

  const years: number[] = [];
  for (let yr = curYear; yr >= 2000; yr--) years.push(yr);
  // The preview draft can be in next year (Dec → Jan); make that year selectable.
  if (previewPeriod && previewPeriod.year > curYear && !years.includes(previewPeriod.year)) {
    years.unshift(previewPeriod.year);
  }

  // replace (not push) so the phone back button exits the app instead of
  // stepping back through months/tabs — feels native, less confusing for elders.
  const go = (y: number, m: number) => router.replace(`${activeHref}?y=${y}&m=${m}`);

  return (
    <>
    <AutoLock enabled={!!pinEnabled} />
    {/* header + state banners stick together at the top, so the wind-down reminder
        stays visible while scrolling (it's easy to miss otherwise). */}
    <div className="sticky top-0 z-40">
    <header className="border-b border-slate-200 bg-white/90 backdrop-blur">
      <div className="mx-auto flex max-w-7xl flex-nowrap items-center gap-x-2 px-4 py-2.5 sm:flex-wrap sm:gap-x-3 sm:gap-y-2 sm:py-3 sm:px-6">
        <div className="mr-1 min-w-0 sm:mr-2">
          <div className="truncate text-[15px] font-bold text-slate-900 sm:text-base">{householdName}</div>
          <div className="hidden text-[11px] text-slate-400 sm:block">Family Finance OS</div>
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

        <div className="ml-auto flex min-w-0 flex-wrap items-center justify-end gap-1.5 sm:gap-2">
          <span className="hidden rounded-full bg-amber-50 px-3 py-1 text-xs font-medium text-amber-700 sm:inline">
            🐷 {formatINR(piggyBalance)}
          </span>

          {/* month + year pickers */}
          <select
            value={selMonth}
            onChange={(e) => go(selYear, Number(e.target.value))}
            className="rounded-md border border-slate-300 bg-white px-1.5 py-1 text-[13px] shadow-sm sm:px-2 sm:py-1.5 sm:text-sm"
          >
            {MONTHS.map((mname, i) => {
              const mnum = i + 1;
              const future = selYear > curYear || (selYear === curYear && mnum > curMonth);
              // Keep the next-month preview selectable even though it's a "future" month.
              const isPreview = !!previewPeriod && selYear === previewPeriod.year && mnum === previewPeriod.month;
              return (
                <option key={mnum} value={mnum} disabled={future && !isPreview}>
                  {mname}{isPreview ? " · Preview" : ""}
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
            className="rounded-md border border-slate-300 bg-white px-1.5 py-1 text-[13px] shadow-sm sm:px-2 sm:py-1.5 sm:text-sm"
          >
            {years.map((yr) => (
              <option key={yr} value={yr}>
                {yr}
              </option>
            ))}
          </select>

          {/* primary Add-Spend button is desktop-only; mobile uses the thumb-reachable FAB */}
          {periodOpen && periodId && (
            <span className="hidden sm:block">
              <AddSpendModal
                periodId={periodId}
                trigger="primary"
                categories={spendCategories}
                isHead={isHead}
                members={members}
                currentMemberId={currentMemberId}
                subCategories={MISC_SUBCATEGORIES}
              />
            </span>
          )}

          <RemindersBell context="family" />

          {/* identity */}
          <div className="border-l border-slate-200 pl-2">
            <UserMenu
              name={account.name}
              email={account.email}
              image={account.image}
              role={isHead ? "head" : "member"}
              canEdit={!!canEdit}
              navQuery={q}
              activeAdmin={active}
              pinEnabled={pinEnabled}
              hasBiometric={hasBiometric}
              actualIsHead={actualIsHead}
              viewingAsMember={viewingAsMember}
            />
          </div>
        </div>
      </div>
    </header>

    {viewingAsMember && (
      <div className="border-b border-amber-200 bg-amber-100 text-amber-900">
        <div className="mx-auto flex max-w-7xl items-center gap-3 px-4 py-2 text-sm sm:px-6">
          <span className="text-base leading-none">👀</span>
          <span className="flex-1 font-medium">You&apos;re viewing as a member (read-only).</span>
          <form action={setViewAs}>
            <input type="hidden" name="mode" value="head" />
            <button className="whitespace-nowrap rounded-md bg-amber-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-amber-700">
              Exit to head
            </button>
          </form>
        </div>
      </div>
    )}
    {windDownReminder && <WindDownBanner daysUntil={windDownReminder.daysUntil} />}
    <DueTodayBanner />
    {provisional && periodId && <ProvisionalBanner workingLabel={provisional.workingLabel} periodId={periodId} canEdit={!!canEdit} />}
    </div>

    {/* high-alert popups (once/day, post-unlock): wind-down window (family) + a member's
        own credit-card bill due within 3 days (shown in family view too, amount-free). */}
    {windDownReminder && <WindDownPopup daysUntil={windDownReminder.daysUntil} day={windDownReminder.day} q={q} />}
    <CardDueHighAlert context="family" />
    <BillDueHighAlert />

    {/* big thumb-reachable "Add Spend" button on mobile (the easy daily action) */}
    {periodOpen && periodId && (
      <AddSpendModal
        periodId={periodId}
        trigger="fab"
        categories={spendCategories}
        isHead={isHead}
        members={members}
        currentMemberId={currentMemberId}
        subCategories={MISC_SUBCATEGORIES}
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
  "in-hand": "🧭",
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
        <div className="fixed inset-0 z-40 bg-black/30 sm:hidden" onClick={() => setOpen(false)}>
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
        // Floor the inset: Samsung's 3-button nav bar reports safe-area-inset-bottom as 0,
        // so without a minimum the tabs sit flush under it and get clipped. Notch/gesture
        // devices report a larger real inset and keep it.
        style={{ paddingBottom: "max(env(safe-area-inset-bottom), 0.75rem)" }}
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
