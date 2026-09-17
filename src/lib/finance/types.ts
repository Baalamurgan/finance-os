// Domain types for the Finance (Wallet) section. Kept dependency-free so both client
// and server code can import them.

export const ACCOUNT_TYPES = ["credit_card", "debit_card", "prepaid_card"] as const; // future: bank | loan | investment
export type AccountType = (typeof ACCOUNT_TYPES)[number];

// Cards that hold a spendable balance (money you have) rather than a credit line (money you owe).
// Debit = bank card; prepaid = meal card / wallet / gift card / FASTag. Both derive a running balance.
export const BALANCE_ACCOUNT_TYPES: ReadonlySet<string> = new Set(["debit_card", "prepaid_card"]);

export const CARD_NETWORKS = ["visa", "mastercard", "rupay", "amex", "diners"] as const;
export type CardNetwork = (typeof CARD_NETWORKS)[number];

// Ledger line types. Sign convention lives in creditDashboard (owed up vs down) for credit cards,
// and in balance.ts (balance up vs down) for debit/prepaid. topup = money loaded onto a balance card.
export const TXN_TYPES = [
  "spend",
  "topup",
  "payment",
  "refund",
  "cashback",
  "reward",
  "fee",
  "interest",
  "charge",
  "adjustment",
] as const;
export type TxnType = (typeof TXN_TYPES)[number];

// Credit cards — types that add to the amount owed vs. reduce it (reward = points only, no rupee effect).
export const OWED_UP: ReadonlySet<string> = new Set(["spend", "fee", "interest", "charge", "adjustment"]);
export const OWED_DOWN: ReadonlySet<string> = new Set(["payment", "refund", "cashback"]);

// Balance cards (debit/prepaid) — types that raise vs lower the available balance. A top-up/refund/
// cashback loads money; a spend/fee/charge draws it down. (adjustment raises — reconcile down with a fee.)
export const BALANCE_UP: ReadonlySet<string> = new Set(["topup", "refund", "cashback", "adjustment"]);
export const BALANCE_DOWN: ReadonlySet<string> = new Set(["spend", "fee", "interest", "charge"]);

export type LedgerTxn = {
  date: Date;
  amount: number; // positive rupees
  type: string;
  rewardPoints?: number | null;
};

export type BillingCycle = {
  start: Date; // first day of the in-progress cycle
  end: Date; // statement date (the cycle closes here)
  statementDate: Date; // == end
  dueDate: Date | null; // statement date + dueOffsetDays (null if not configured)
};

// ── Net worth ────────────────────────────────────────────────────────────────
export type NetWorthCategory = "asset" | "liability";

type TypeMeta = { key: string; label: string; icon: string };

export const ASSET_TYPES: readonly TypeMeta[] = [
  { key: "stock", label: "Stocks", icon: "📈" },
  { key: "mutual_fund", label: "Mutual funds", icon: "📊" },
  { key: "fd", label: "Fixed deposit", icon: "🏦" },
  { key: "rd", label: "Recurring deposit", icon: "🔁" },
  { key: "epf", label: "EPF", icon: "🧾" },
  { key: "ppf", label: "PPF", icon: "🧾" },
  { key: "nps", label: "NPS", icon: "🪙" },
  { key: "gold", label: "Gold", icon: "🥇" },
  { key: "bank", label: "Bank balance", icon: "🏛️" },
  { key: "cash", label: "Cash", icon: "💵" },
  { key: "property", label: "Property / house", icon: "🏠" },
  { key: "land", label: "Land", icon: "🌾" },
  { key: "vehicle", label: "Vehicle", icon: "🚗" },
  { key: "insurance", label: "Insurance (cash value)", icon: "🛡️" },
  { key: "other_asset", label: "Other asset", icon: "📦" },
] as const;

export const LIABILITY_TYPES: readonly TypeMeta[] = [
  { key: "home_loan", label: "Home loan", icon: "🏠" },
  { key: "car_loan", label: "Car / vehicle loan", icon: "🚗" },
  { key: "personal_loan", label: "Personal loan", icon: "💳" },
  { key: "education_loan", label: "Education loan", icon: "🎓" },
  { key: "gold_loan", label: "Gold loan", icon: "🥇" },
  { key: "other_liability", label: "Other liability", icon: "📉" },
] as const;

const TYPE_META: Record<string, TypeMeta> = Object.fromEntries(
  [...ASSET_TYPES, ...LIABILITY_TYPES].map((t) => [t.key, t]),
);
export function netWorthTypeMeta(type: string): TypeMeta {
  return TYPE_META[type] ?? { key: type, label: type, icon: "•" };
}

export type CreditDashboard = {
  outstanding: number; // running balance owed across all txns
  hasLimit: boolean;
  available: number | null; // limit − outstanding (null if no limit set)
  utilPct: number | null; // outstanding / limit * 100 (null if no limit)
  hasCycle: boolean;
  cycle: BillingCycle | null; // null if no statementDay configured
  spentThisCycle: number;
  paymentsThisCycle: number;
  cashbackThisCycle: number;
  pointsThisCycle: number;
  lifetimeCashback: number; // Σ cashback (bill savings + redeemed-points cash) — the card's rewards realised as money
  lifetimeFees: number; // Σ fee/charge/interest — the card's costs
  netRewards: number; // lifetimeCashback − lifetimeFees: + = the card earns you money, − = it costs you (profit/loss)
  lifetimePoints: number;
};
