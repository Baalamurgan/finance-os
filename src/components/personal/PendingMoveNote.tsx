import { formatINR } from "@/lib/format";

// Under "In account now": a card-bill share still to move between your accounts (an unticked plan step).
export function PendingMoveNote({ acct }: { acct: { toCome: number; toSend: number; otherName: string | null } | null }) {
  if (!acct || (acct.toCome <= 0.005 && acct.toSend <= 0.005)) return null;
  const other = acct.otherName ?? "the other account";
  return (
    <div className="mt-0.5 text-[10px] text-slate-500">
      {acct.toSend > 0.005 && <span>{formatINR(acct.toSend)} to send to {other}</span>}
      {acct.toSend > 0.005 && acct.toCome > 0.005 && " · "}
      {acct.toCome > 0.005 && <span>{formatINR(acct.toCome)} to come from {other}</span>}
    </div>
  );
}
