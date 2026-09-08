// SINGLE SOURCE OF TRUTH for "who may tick a Money-Plan step done/paid/sent".
//
// The client (the MoneyPlan UI, which shows/enables the control) and the server (the actions that
// ENFORCE it) both call this with the same facts, so the two can't drift. That drift is exactly the bug
// class we're closing: the UI showed a treasurer the "✓ sent" button on a pool-funded misc / shared
// bill, but the server authorized differently and silently rejected the tick.
//
// PURE — no prisma, no react — so it's importable on both sides. It answers ONLY the actor-permission
// question. The month-open rule (head may act in any month, everyone else only while it's open) is a
// separate concern layered on by each caller, because the "open" fact is sourced differently on each
// side; `canActInMonth` gives them one shared expression for it too.

export type StepKind =
  | "transfer-in" | "transfer-out" | "bill" | "allowance"
  | "income" | "advance" | "manual" | "pool-handover" | "piggy";

export type PlanActor = {
  memberId: number | null;
  isHead: boolean; // effective head (and unlocked, on the server)
  canEdit: boolean; // head OR manager (and unlocked, on the server)
};

export type StepAuthFacts = {
  kind: StepKind;
  fromId?: number | null;
  toId?: number | null;
  payerId?: number | null; // bill: who pays (already the treasurer for shared/pool bills)
  ownerId?: number | null; // income: whose income it is
  treasurerId?: number | null; // the hub; only consulted for a hub-disbursed line
  // A line the TREASURER disburses even though it's stored against someone else — an allowance, a
  // pool-funded misc (note=__pool__), or a shared/pool bill (memberId null). For these the person it's
  // stored against is NOT the actor; the treasurer is. The UI already places the treasurer as the
  // payer/sender, so the server must accept them here too.
  hubLine?: boolean;
};

// May this actor tick this step's done/paid state? Ignores month-open (see canActInMonth).
export function canActOnStep(s: StepAuthFacts, a: PlanActor): boolean {
  const me = a.memberId;
  const is = (id: number | null | undefined) => me != null && id != null && me === id;
  const party = is(s.fromId) || is(s.toId);
  switch (s.kind) {
    // Settlement transfers & funding advances: head, or either party to the move.
    case "transfer-in":
    case "transfer-out":
    case "advance":
      return a.isHead || party;
    // Head-added ad-hoc moves: head/manager, or either party.
    case "manual":
      return a.canEdit || party;
    // Income received: head/manager, or the income's owner.
    case "income":
      return a.canEdit || is(s.ownerId);
    // Pool hand-over to the treasurer: head/manager, or the holder handing it over.
    case "pool-handover":
      return a.canEdit || is(s.fromId);
    // Piggy hand-over: head/manager only.
    case "piggy":
      return a.canEdit;
    // Assigned bills: head/manager, the payer, or the treasurer for a hub-disbursed line (shared/pool
    // bill — where the payer is already the treasurer — or an allowance / pool-funded misc).
    case "bill":
      return a.canEdit || is(s.payerId) || (!!s.hubLine && is(s.treasurerId));
    // Allowance / pool-funded misc (treasurer → member): head/manager, either party, or the treasurer.
    case "allowance":
      return a.canEdit || party || is(s.treasurerId);
  }
}

// Month gate shared by both sides: the head may act in any month (incl. closed, to correct history);
// everyone else only while the month is still open.
export function canActInMonth(open: boolean, isHead: boolean): boolean {
  return open || isHead;
}
