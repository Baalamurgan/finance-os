"use client";

import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { exitToFamily } from "@/app/personal/lock/actions";
import { CardDueHighAlert } from "@/components/personal/CardDueHighAlert";
import { RemindersBell } from "@/components/personal/RemindersBell";
import { PersonalDock } from "@/components/personal/PersonalDock";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const TABS = [
  { key: "today", label: "Today", href: "/personal/today", icon: "🌤️" },
  { key: "expenses", label: "Expenses", href: "/personal/expenses", icon: "🧾" },
  { key: "sheet", label: "Sheet", href: "/personal/sheet", icon: "📋" },
  { key: "finance", label: "Finance", href: "/personal/finance", icon: "💳" },
  { key: "analysis", label: "Analysis", href: "/personal/analysis", icon: "📊" },
  { key: "setup", label: "Setup", href: "/personal/setup", icon: "⚙️" },
  { key: "loans", label: "Lending", href: "/personal/loans", icon: "🤝" },
] as const;

const PRIMARY = TABS.slice(0, 4); // Today · Expenses · Sheet · Finance (bottom bar)
const MORE = TABS.slice(4); // Analysis · Setup · Lending (overflow)

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
  const q = `?y=${selYear}&m=${selMonth}`;
  const go = (y: number, m: number) => router.replace(`${activeHref}?y=${y}&m=${m}`);
  const years: number[] = [];
  for (let yr = curYear; yr >= 2000; yr--) years.push(yr);

  return (
    <>
      <CardDueHighAlert context="personal" />
      <header className="sticky top-0 z-40 border-b border-emerald-100 bg-emerald-50/90 backdrop-blur">
        <div className="mx-auto flex max-w-3xl flex-nowrap items-center gap-x-2 px-4 py-2.5 sm:flex-wrap sm:gap-x-3 sm:py-3 sm:px-6">
          <div className="mr-1 min-w-0 sm:mr-2">
            <div className="flex items-center gap-1.5 text-[15px] font-bold text-emerald-900 sm:text-base">
              <span>🔒</span> Personal
            </div>
            <div className="hidden text-[11px] text-emerald-600/70 sm:block">{name}</div>
          </div>

          {/* desktop tabs (mobile uses the bottom bar) */}
          <nav className="hidden items-center gap-1 sm:flex">
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
                {t.key === "finance" && financeDue && <span className="absolute right-1 top-1 h-1.5 w-1.5 rounded-full bg-red-500" />}
              </Link>
            ))}
          </nav>

          <div className="ml-auto flex flex-nowrap items-center gap-1.5 sm:gap-2">
            <select
              value={selMonth}
              onChange={(e) => go(selYear, Number(e.target.value))}
              className="rounded-md border border-emerald-200 bg-white px-1.5 py-1 text-[13px] shadow-sm sm:px-2 sm:py-1.5 sm:text-sm"
            >
              {MONTHS.map((mname, i) => {
                const mnum = i + 1;
                const future = selYear > curYear || (selYear === curYear && mnum > curMonth);
                return <option key={mnum} value={mnum} disabled={future}>{mname}</option>;
              })}
            </select>
            <select
              value={selYear}
              onChange={(e) => { const y = Number(e.target.value); go(y, y === curYear && selMonth > curMonth ? curMonth : selMonth); }}
              className="rounded-md border border-emerald-200 bg-white px-1.5 py-1 text-[13px] shadow-sm sm:px-2 sm:py-1.5 sm:text-sm"
            >
              {years.map((yr) => <option key={yr} value={yr}>{yr}</option>)}
            </select>

            <RemindersBell context="personal" />

            <form action={exitToFamily}>
              <button aria-label="Back to Family" className="grid h-8 w-8 shrink-0 place-items-center rounded-full border border-emerald-200 bg-white text-emerald-800 sm:h-auto sm:w-auto sm:rounded-full sm:px-3 sm:py-1.5 sm:text-xs sm:font-medium">
                <span className="sm:hidden">←</span>
                <span className="hidden sm:inline">← Family</span>
              </button>
            </form>
          </div>
        </div>
      </header>

      <PersonalBottomNav active={active} q={q} financeDue={financeDue} />
      <PersonalDock />
    </>
  );
}

function PersonalBottomNav({ active, q, financeDue }: { active: string; q: string; financeDue: boolean }) {
  const [open, setOpen] = useState(false);
  const moreActive = MORE.some((t) => t.key === active);
  const cell = (activeHere: boolean) =>
    `relative flex flex-1 flex-col items-center justify-center gap-0.5 py-2 text-[11px] font-medium ${activeHere ? "text-emerald-600" : "text-slate-500"}`;

  return (
    <>
      {open && (
        <div className="fixed inset-0 z-40 bg-black/30 sm:hidden" onClick={() => setOpen(false)}>
          <div
            className="absolute inset-x-0 mx-2 overflow-hidden rounded-2xl border border-slate-200 bg-white py-1 shadow-xl"
            style={{ bottom: "calc(env(safe-area-inset-bottom) + 4rem)" }}
            onClick={(e) => e.stopPropagation()}
          >
            {MORE.map((t) => (
              <Link
                key={t.key}
                href={`${t.href}${q}`}
                replace
                onClick={() => setOpen(false)}
                className={`block px-5 py-4 text-base ${active === t.key ? "bg-emerald-50 font-medium text-emerald-700" : "text-slate-700"}`}
              >
                <span className="mr-2">{t.icon}</span> {t.label}
              </Link>
            ))}
          </div>
        </div>
      )}

      <nav
        className="fixed inset-x-0 bottom-0 z-50 flex border-t border-slate-200 bg-white/95 backdrop-blur sm:hidden"
        style={{ paddingBottom: "max(env(safe-area-inset-bottom), 0.5rem)" }}
      >
        {PRIMARY.map((t) => (
          <Link key={t.key} href={`${t.href}${q}`} replace onClick={() => setOpen(false)} className={cell(active === t.key)}>
            <span className="text-xl leading-none">{t.icon}</span>
            {t.label}
            {t.key === "finance" && financeDue && <span className="absolute right-1/4 top-1 h-1.5 w-1.5 rounded-full bg-red-500" />}
          </Link>
        ))}
        <button type="button" onClick={() => setOpen((v) => !v)} className={cell(moreActive || open)}>
          <span className="text-xl leading-none">⋯</span>
          More
        </button>
      </nav>
    </>
  );
}
