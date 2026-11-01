import { REMOVED_NOTE } from "@/lib/notes";

// Minimal structural shapes so both the Sheet and the Spends tab can share the section logic.
export type SheetCat = {
  section: string;
  tracked: boolean;
  sinking: boolean;
  onHold: boolean;
  miscCard: boolean;
  fundingStyle: string | null;
  billEveryMonths: number | null;
};
export type SheetLine = { category: SheetCat; oneOff: boolean; note: string | null };

// A tracked monthly budget whose unspent leftover rolls into the general Piggy — a
// "sinking-fund-like" envelope. These are grouped apart from flat fixed bills so you can
// see at a glance what's budgeted (and would accrue to Piggy if unused).
export function isPiggyBudget(cat: SheetCat): boolean {
  return (
    cat.section === "Monthly" &&
    cat.tracked &&
    !cat.sinking &&
    cat.fundingStyle == null &&
    (cat.billEveryMonths == null || cat.billEveryMonths <= 1)
  );
}

// A tracked monthly budget (Veg/Fuel/Non-Veg/LPG/Provision/Milk) or a planned-misc spend card
// (G704, Ayudha Pooja, a wedding gift): its money goes out as daily Spends, not a single "mark paid".
// So the Sheet row reads "done" (✓) the instant ANY spend is logged against its category — mirroring
// the Money-Plan step (done = ≥1 spend), by anyone, even ₹1. Unlike a one-off bill, the HEAD keeps the
// ⋯ to adjust the amount even after it's done (the budget may still need tuning); everyone else loses
// the controls, exactly like a paid bill.
export function isBudgetLikeCard(cat: SheetCat): boolean {
  return cat.tracked && !cat.sinking && !cat.onHold && cat.fundingStyle == null && (cat.miscCard || isPiggyBudget(cat));
}

// Which Sheet section an expense line DISPLAYS under (independent of its category's tab):
// every line of a periodic bill — its set-aside/share, the due-month bill, the fund credit —
// sits together under Yearly / periodic bills; tracked leftover→Piggy budgets get their own
// section; everything else follows its category's section.
export function sheetSection(e: SheetLine): string {
  // Any bill-with-a-fund (EB, YouTube, Brio insurance…) — its share, due-month bill and fund credit —
  // sits under Yearly / periodic bills, so a periodic bill is never buried in "Monthly" (even a monthly
  // one, billEveryMonths 1). Plain multi-month bills (no fund) go there too.
  if (e.category.fundingStyle != null) return "Yearly";
  if (e.category.billEveryMonths != null && e.category.billEveryMonths > 1) return "Yearly";
  // Planned-for-THIS-month items live under Misc, so Fixed Monthly stays the stable recurring set
  // (same entries every month unless added to Setup / "repeats monthly"). Two kinds qualify: a misc
  // spend card (a dated, dynamic budget like G704 advance / Ayudha Pooja), and ANY one-off line (a
  // hand-added reward, a pool-funded tax, last month's carried misc). Its money-plan step still opens
  // the add-spend modal on pay — that's a step property, independent of where it shows on the Sheet.
  if (e.category.miscCard) return "Misc";
  // A "removed" tombstone (struck-through) stays in its category's HOME section — a removed Monthly
  // expense shows under Monthly, not pulled into Misc by the one-off rule below.
  if (e.oneOff && e.note !== REMOVED_NOTE) return "Misc";
  // Recurring tracked budgets (Veg/Fuel/Non-Veg/LPG/Provision) get their own Budgeted section.
  if (isPiggyBudget(e.category)) return "PiggyBudget";
  return e.category.section;
}

