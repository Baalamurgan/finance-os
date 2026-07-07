// Domain types for the Finance (Wallet) section. Kept dependency-free so both client
// and server code can import them.

export const ACCOUNT_TYPES = ["credit_card", "debit_card"] as const; // future: bank | loan | investment
export type AccountType = (typeof ACCOUNT_TYPES)[number];

export const CARD_NETWORKS = ["visa", "mastercard", "rupay", "amex", "diners"] as const;
export type CardNetwork = (typeof CARD_NETWORKS)[number];

// Ledger line types. Sign convention lives in creditDashboard (owed up vs down).
export const TXN_TYPES = [
  "spend",
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

// Types that add to the amount owed vs. reduce it (reward = points only, no rupee effect).
export const OWED_UP: ReadonlySet<string> = new Set(["spend", "fee", "interest", "charge", "adjustment"]);
export const OWED_DOWN: ReadonlySet<string> = new Set(["payment", "refund", "cashback"]);

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
  lifetimeCashback: number;
  lifetimePoints: number;
};
