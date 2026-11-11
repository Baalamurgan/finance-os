// Tab lists shared by the real nav bars (NavHeader / PersonalNav) and their loading skeletons, so the
// frame drawn while a page loads is the same frame the page arrives with.

export const FAMILY_TABS = [
  { key: "sheet", label: "Sheet", href: "/" },
  { key: "expenses", label: "Spends", href: "/expenses" },
  { key: "in-hand", label: "Money Plan", href: "/in-hand" },
  { key: "transactions", label: "Transactions", href: "/transactions" },
  { key: "settlement", label: "Settlement", href: "/settlement" },
  { key: "activity", label: "Changes", href: "/activity" },
  { key: "analysis", label: "Analysis", href: "/analysis" },
  { key: "piggy", label: "Piggy", href: "/piggy" },
  { key: "notes", label: "Notes", href: "/notes" },
  { key: "loans", label: "Loans & Chits", href: "/loans" },
  { key: "priority", label: "Priority", href: "/priority" },
] as const;
export const FAMILY_PRIMARY = FAMILY_TABS.slice(0, 3); // Sheet · Spends · Money Plan
export const FAMILY_MORE = FAMILY_TABS.slice(3);

// Simple, instantly-recognizable icons for the bottom bar (kind to older eyes).
export const FAMILY_TAB_ICON: Record<string, string> = {
  sheet: "📋",
  expenses: "🧾",
  "in-hand": "🧭",
  transactions: "📒",
  settlement: "🤝",
  analysis: "📊",
};

// Personal: three everyday tabs up front; everything else under "⋯ More" (same on phone and desktop).
export const PERSONAL_PRIMARY = [
  { key: "expenses", label: "Spends", href: "/personal/expenses", icon: "🧾" },
  { key: "sheet", label: "Sheet", href: "/personal/sheet", icon: "📋" },
  { key: "plan", label: "Money plan", href: "/personal/plan", icon: "💸" },
] as const;
export const PERSONAL_MORE = [
  { key: "loans", label: "Lending", href: "/personal/loans", icon: "🤝" },
  { key: "cards", label: "Accounts", href: "/personal/cards", icon: "🏦" },
  { key: "networth", label: "Net worth", href: "/personal/networth", icon: "💎" },
  { key: "analysis", label: "Analysis", href: "/personal/analysis", icon: "📊" },
  { key: "today", label: "Today", href: "/personal/today", icon: "🌤️" },
  { key: "setup", label: "Setup", href: "/personal/setup", icon: "⚙️" },
] as const;

/** Which tab a pathname belongs to (the longest matching href wins; "/" only matches itself). */
export function tabKeyFor(pathname: string, tabs: readonly { key: string; href: string }[]): string | null {
  let best: { key: string; len: number } | null = null;
  for (const t of tabs) {
    const hit = t.href === "/" ? pathname === "/" : pathname === t.href || pathname.startsWith(`${t.href}/`);
    if (hit && (!best || t.href.length > best.len)) best = { key: t.key, len: t.href.length };
  }
  return best?.key ?? null;
}
