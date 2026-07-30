"use client";

import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { exitToFamily } from "@/app/personal/lock/actions";
import { CardDueHighAlert } from "@/components/personal/CardDueHighAlert";
import { RemindersBell } from "@/components/personal/RemindersBell";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const TABS = [
  { key: "today", label: "Today", href: "/personal/today" },
  { key: "expenses", label: "Expenses", href: "/personal/expenses" },
  { key: "sheet", label: "Sheet", href: "/personal/sheet" },
  { key: "analysis", label: "Analysis", href: "/personal/analysis" },
  { key: "finance", label: "Finance", href: "/personal/finance" },
  { key: "setup", label: "Setup", href: "/personal/setup" },
  { key: "loans", label: "Lending", href: "/personal/loans" },
] as const;

export function PersonalNav({
  active,
  name,
  selYear,
  selMonth,
  financeDue = false,
}: {
  active: "today" | "sheet" | "expenses" | "analysis" | "finance" | "setup" | "loans";
  name: string;
  selYear: number;
  selMonth: number;
  financeDue?: boolean; // a card bill is due soon/overdue → red dot on the Finance tab
}) {
  const router = useRouter();
  const now = new Date();
  const curYear = now.getFullYear();
  const curMonth = now.getMonth() + 1;
  const activeHref = TABS.find((t) => t.key === active)?.href ?? "/personal";
  const activeLabel = TABS.find((t) => t.key === active)?.label ?? "Personal";
  const q = `?y=${selYear}&m=${selMonth}`;
  const go = (y: number, m: number) => router.replace(`${activeHref}?y=${y}&m=${m}`);
  const years: number[] = [];
  for (let yr = curYear; yr >= 2000; yr--) years.push(yr);

  const [menuOpen, setMenuOpen] = useState(false); // mobile tab switcher
  const [periodOpen, setPeriodOpen] = useState(false); // mobile month/year picker

  return (
    <>
      <CardDueHighAlert context="personal" />
      <header className="sticky top-0 z-40 border-b border-emerald-100 bg-emerald-50/90 backdrop-blur">
        {/* ── Desktop: one rich row ── */}
        <div className="mx-auto hidden max-w-3xl items-center gap-x-3 px-6 py-3 sm:flex">
          <div className="mr-2">
            <div className="flex items-center gap-1.5 text-base font-bold text-emerald-900">
              <span>🔒</span> Personal
            </div>
            <div className="text-[11px] text-emerald-600/70">{name}</div>
          </div>

          <nav className="flex items-center gap-1">
            {TABS.map((t) => (
              <Link
                key={t.key}
                href={`${t.href}${q}`}
                replace
                className={`relative rounded-md px-3 py-1.5 text-sm font-medium transition ${
                  active === t.key ? "bg-emerald-600 text-white" : "text-emerald-800 hover:bg-emerald-100"
                }`}
              >
                {t.label}
                {t.key === "finance" && financeDue && (
                  <span className="absolute right-1 top-1 h-1.5 w-1.5 rounded-full bg-red-500" />
                )}
              </Link>
            ))}
          </nav>

          <div className="ml-auto flex items-center gap-2">
            <select value={selMonth} onChange={(e) => go(selYear, Number(e.target.value))} className="rounded-md border border-emerald-200 bg-white px-2 py-1.5 text-sm shadow-sm">
              {MONTHS.map((mname, i) => {
                const mnum = i + 1;
                const future = selYear > curYear || (selYear === curYear && mnum > curMonth);
                return <option key={mnum} value={mnum} disabled={future}>{mname}</option>;
              })}
            </select>
            <select value={selYear} onChange={(e) => { const y = Number(e.target.value); go(y, y === curYear && selMonth > curMonth ? curMonth : selMonth); }} className="rounded-md border border-emerald-200 bg-white px-2 py-1.5 text-sm shadow-sm">
              {years.map((yr) => <option key={yr} value={yr}>{yr}</option>)}
            </select>
            <RemindersBell context="personal" />
            <form action={exitToFamily}>
              <button className="rounded-full border border-emerald-200 bg-white px-3 py-1.5 text-xs font-medium text-emerald-800 hover:bg-emerald-100">← Family</button>
            </form>
          </div>
        </div>

        {/* ── Mobile: a single compact bar ── */}
        <div className="relative flex items-center gap-2 px-3 py-2.5 sm:hidden">
          {/* tab switcher: shows the current tab, opens a menu of all tabs */}
          <button
            onClick={() => { setMenuOpen((o) => !o); setPeriodOpen(false); }}
            className="flex items-center gap-1.5 rounded-lg px-1.5 py-1 text-emerald-900"
          >
            <span className="text-sm">🔒</span>
            <span className="text-[15px] font-bold">{activeLabel}</span>
            {financeDue && active !== "finance" && <span className="h-1.5 w-1.5 rounded-full bg-red-500" />}
            <Chevron open={menuOpen} />
          </button>

          <div className="ml-auto flex items-center gap-1.5">
            <button
              onClick={() => { setPeriodOpen((o) => !o); setMenuOpen(false); }}
              className="flex items-center gap-1 rounded-md border border-emerald-200 bg-white px-2 py-1.5 text-xs font-medium text-emerald-800 shadow-sm"
            >
              {MONTHS[selMonth - 1]} ’{String(selYear).slice(2)}
              <Chevron open={periodOpen} />
            </button>
            <RemindersBell context="personal" />
            <form action={exitToFamily}>
              <button aria-label="Back to Family" className="grid h-8 w-8 place-items-center rounded-full border border-emerald-200 bg-white text-emerald-800">←</button>
            </form>
          </div>

          {/* backdrop for either dropdown */}
          {(menuOpen || periodOpen) && (
            <button aria-label="Close menu" className="fixed inset-0 z-10 cursor-default" onClick={() => { setMenuOpen(false); setPeriodOpen(false); }} />
          )}

          {/* tab menu */}
          {menuOpen && (
            <div className="absolute left-3 top-full z-20 mt-1 w-52 overflow-hidden rounded-xl border border-emerald-100 bg-white shadow-xl">
              <p className="px-3 pt-2.5 text-[11px] font-semibold uppercase tracking-wide text-emerald-500">{name}</p>
              <nav className="p-1">
                {TABS.map((t) => (
                  <Link
                    key={t.key}
                    href={`${t.href}${q}`}
                    replace
                    onClick={() => setMenuOpen(false)}
                    className={`flex items-center justify-between rounded-lg px-3 py-2 text-sm font-medium ${active === t.key ? "bg-emerald-600 text-white" : "text-emerald-900 hover:bg-emerald-50"}`}
                  >
                    {t.label}
                    {t.key === "finance" && financeDue && <span className="h-1.5 w-1.5 rounded-full bg-red-500" />}
                  </Link>
                ))}
              </nav>
            </div>
          )}

          {/* period picker */}
          {periodOpen && (
            <div className="absolute right-3 top-full z-20 mt-1 flex gap-2 rounded-xl border border-emerald-100 bg-white p-2 shadow-xl">
              <select value={selMonth} onChange={(e) => { go(selYear, Number(e.target.value)); setPeriodOpen(false); }} className="rounded-md border border-emerald-200 bg-white px-2 py-2 text-sm shadow-sm">
                {MONTHS.map((mname, i) => {
                  const mnum = i + 1;
                  const future = selYear > curYear || (selYear === curYear && mnum > curMonth);
                  return <option key={mnum} value={mnum} disabled={future}>{mname}</option>;
                })}
              </select>
              <select value={selYear} onChange={(e) => { const y = Number(e.target.value); go(y, y === curYear && selMonth > curMonth ? curMonth : selMonth); setPeriodOpen(false); }} className="rounded-md border border-emerald-200 bg-white px-2 py-2 text-sm shadow-sm">
                {years.map((yr) => <option key={yr} value={yr}>{yr}</option>)}
              </select>
            </div>
          )}
        </div>
      </header>
    </>
  );
}

function Chevron({ open }: { open: boolean }) {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" className={`transition ${open ? "rotate-180" : ""}`} aria-hidden>
      <path d="M6 9l6 6 6-6" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
