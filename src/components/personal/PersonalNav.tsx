"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { exitToFamily } from "@/app/personal/lock/actions";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const TABS = [
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
  active: "sheet" | "expenses" | "analysis" | "finance" | "setup" | "loans";
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
    <header className="sticky top-0 z-40 border-b border-emerald-100 bg-emerald-50/90 backdrop-blur">
      <div className="mx-auto flex max-w-3xl flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3 sm:px-6">
        <div className="mr-2">
          <div className="flex items-center gap-1.5 text-base font-bold text-emerald-900">
            <span>🔒</span> Personal
          </div>
          <div className="text-[11px] text-emerald-600/70">{name}</div>
        </div>

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
              {t.key === "finance" && financeDue && (
                <span className="absolute right-1 top-1 h-1.5 w-1.5 rounded-full bg-red-500" />
              )}
            </Link>
          ))}
        </nav>

        <div className="ml-auto flex items-center gap-2">
          <select
            value={selMonth}
            onChange={(e) => go(selYear, Number(e.target.value))}
            className="rounded-md border border-emerald-200 bg-white px-2 py-1.5 text-sm shadow-sm"
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
              const m = y === curYear && selMonth > curMonth ? curMonth : selMonth;
              go(y, m);
            }}
            className="rounded-md border border-emerald-200 bg-white px-2 py-1.5 text-sm shadow-sm"
          >
            {years.map((yr) => (
              <option key={yr} value={yr}>
                {yr}
              </option>
            ))}
          </select>

          <form action={exitToFamily}>
            <button className="rounded-full border border-emerald-200 bg-white px-3 py-1.5 text-xs font-medium text-emerald-800 hover:bg-emerald-100">
              ← Family
            </button>
          </form>
        </div>
      </div>

      {/* mobile tabs */}
      <nav className="flex gap-1 overflow-x-auto border-t border-emerald-100 px-3 py-2 sm:hidden">
        {TABS.map((t) => (
          <Link
            key={t.key}
            href={`${t.href}${q}`}
            replace
            className={`relative whitespace-nowrap rounded-md px-3 py-1.5 text-center text-sm font-medium ${
              active === t.key ? "bg-emerald-600 text-white" : "text-emerald-800"
            }`}
          >
            {t.label}
            {t.key === "finance" && financeDue && (
              <span className="absolute right-0.5 top-0.5 h-1.5 w-1.5 rounded-full bg-red-500" />
            )}
          </Link>
        ))}
      </nav>
    </header>
  );
}
