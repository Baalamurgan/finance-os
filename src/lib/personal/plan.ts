// Pure derivation for the personal Money Plan's recurring moves. Given the member's active plan items
// and this month's ledger, produce display-ready steps with a "done this month" flag — derived by
// matching a ledger entry (a transfer_out on the source, or a savings deposit) of the same amount this
// month, so there's no per-month done flag to store. Kept pure and dependency-free so it's unit-tested
// identically to how the page uses it.

export type PlanItemLite = {
  id: number;
  kind: string; // "transfer" | "save"
  label: string;
  amount: number;
  dayOfMonth: number | null;
  fromAccountId: number | null;
  toAccountId: number | null;
  note?: string | null;
  sortOrder: number;
};

export type RecurringMove = {
  id: number;
  kind: string;
  label: string;
  amount: number;
  dayOfMonth: number | null;
  fromAccountId: number | null;
  toAccountId: number | null;
  fromName: string | null;
  toName: string | null;
  note: string | null;
  done: boolean;
};

const r2 = (n: number) => Math.round(n * 100) / 100;

export function buildRecurringMoves(
  items: PlanItemLite[],
  monthTransfersOut: { accountId: number; amount: number }[], // this month's transfer_out legs
  monthSavingsDeposits: { amount: number }[], // this month's positive PersonalSavings rows
  accountName: (id: number | null) => string | null,
): RecurringMove[] {
  return [...items]
    .sort((a, b) => {
      const da = a.dayOfMonth ?? 99; // undated moves sort after dated ones
      const db = b.dayOfMonth ?? 99;
      return da - db || a.sortOrder - b.sortOrder || a.id - b.id;
    })
    .map((it) => {
      const amt = r2(it.amount);
      let done = false;
      if (it.kind === "transfer") {
        done = monthTransfersOut.some((t) => t.accountId === it.fromAccountId && r2(t.amount) === amt);
      } else if (it.kind === "save") {
        done = monthSavingsDeposits.some((s) => r2(s.amount) === amt);
      }
      return {
        id: it.id,
        kind: it.kind,
        label: it.label,
        amount: amt,
        dayOfMonth: it.dayOfMonth,
        fromAccountId: it.fromAccountId,
        toAccountId: it.toAccountId,
        fromName: accountName(it.fromAccountId),
        toName: accountName(it.toAccountId),
        note: it.note ?? null,
        done,
      };
    });
}
