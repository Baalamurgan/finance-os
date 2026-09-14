import { BALANCE_UP, BALANCE_DOWN, type LedgerTxn } from "./types";

// Derived balance for a debit/prepaid card: the money currently loaded on it.
//   balance = openingBalance + (top-ups + refunds + cashback + adjustments) − (spends + fees + charges)
// Deterministic — every rupee is a value the user entered or a sum of their own ledger lines.
export function computeBalance(openingBalance: number | null | undefined, txns: LedgerTxn[]): number {
  let balance = openingBalance ?? 0;
  for (const t of txns) {
    if (BALANCE_UP.has(t.type)) balance += t.amount;
    else if (BALANCE_DOWN.has(t.type)) balance -= t.amount;
  }
  return Math.round(balance * 100) / 100;
}
