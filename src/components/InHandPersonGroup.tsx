"use client";

import { piggyHeldParts } from "@/lib/piggyHeld";
import { Fragment, useState } from "react";
import { useToast } from "@/components/Toast";
import { formatINR } from "@/lib/format";
import type { InHand } from "@/lib/queries";
import { toggleBillPaid, unpayPeriodicBill, unpayMiscBill, unhideStep } from "@/app/actions";
import { PayBillModal } from "@/components/PayBillModal";
import { MiscPayModal } from "@/components/MiscPayModal";
import { PayCardBillModal } from "@/components/PayCardBillModal";
import { InHandCardBlock } from "@/components/InHandCardBlock";
import { CTA_CLASS, CtaLabel } from "@/components/Cta";
import { allocate, type Covered, type IncomingItem, type QueueItem, type Waiting } from "@/lib/inHandCoverage";

export function InHandPersonGroup({
  group,
  cards = [],
  isPreview = false,
  pendingCashMove,
  doneCashMove,
  incomeReceived = false,
  allIncomeReceived = false,
  allowancesKept = [],
  toTreasurerPending = 0,
  routingToForward = 0,
  isTreasurer,
  pool,
  sharedNet,
  monthBalance,
  billsHeldForMembers = 0,
  isPiggyHolder,
  piggy,
  pendingPiggyLump,
  piggyHandedOver = false,
  canToggle,
  periodId,
  generalPiggy,
  currentMemberId,
  open,
  selYear,
  selMonth,
  poolIncoming = [],
  poolDisbursements = [],
  treasurerOwnLeftover = 0,
  owedOthersSettled = 0,
  ownerChargeActive = false,
  queue = [],
  incoming = [],
  spendCategories = [],
}: {
  group: InHand["byPerson"][number];
  // This person's OWN credit cards → the "Paid with" picker on their bills' Pay modals.
  cards?: { id: number; name: string; last4: string | null; color: string }[];
  isPreview?: boolean;
  pendingCashMove: number;
  doneCashMove: number;
  incomeReceived?: boolean;
  // EVERY family income has arrived (the treasurer's pool is only physically there then).
  allIncomeReceived?: boolean;
  // This member's own expense allowances received & kept this month (e.g. Harish's ₹10k monthly + ₹1k reward).
  allowancesKept?: { label: string; amount: number }[];
  toTreasurerPending?: number;
  routingToForward?: number;
  isTreasurer: boolean;
  pool: number;
  sharedNet: number;
  monthBalance: number;
  billsHeldForMembers?: number;
  isPiggyHolder: boolean;
  piggy: number;
  pendingPiggyLump: number;
  piggyHandedOver?: boolean;
  canToggle: boolean;
  periodId: number;
  generalPiggy: number;
  currentMemberId: number | null;
  open: boolean;
  selYear: number;
  selMonth: number;
  poolIncoming?: { fromId: number; fromName: string; amount: number; kind: "leftover" | "piggy"; detail: string | null }[];
  poolDisbursements?: { recipientId: number; recipientName: string; label: string; amount: number }[];
  treasurerOwnLeftover?: number;
  // How much of this member's carried owed-others they've already PAID BACK to the treasurer via a done
  // manual step (capped at the owed-others). Once settled, drop that much from the "owe back" held line —
  // the done manual move already took the cash out of their holding, so netting the line keeps the card
  // reconciled (holding −X and labelled −X cancel in the remainder) and shows the debt as resolved.
  owedOthersSettled?: number;
  // From the owner-charge start month, a non-treasurer's owed-others is collected through the settlement
  // (folded into their "to give treasurer"), so the separate "owe back · held" line is suppressed to avoid
  // double-counting — exactly as it already is for the treasurer.
  ownerChargeActive?: boolean;
  // Coverage inputs (live month): this member's pending bills + sends in Money Plan order, and pending inflows.
  queue?: QueueItem[];
  incoming?: IncomingItem[];
  // Family spend categories — for the card-bill Pay modal (extra charges / cashback booking).
  spendCategories?: { id: number; name: string }[];
}) {
  const piggyToPool = group.pendingPiggyToPool ?? 0; // part of pendingPiggyHeld that was taken as income → goes to the treasurer, not the holder
  const { name, cats, unpaidBills, paidBills, earmarked, earmarkedTotal, sinkingFunds, sinkingHeld, unpaidPeriodic, paidPeriodic, carried, carriedDue, miscSpent, net, pendingPiggyHeld, pendingCardBills, cashSpent, cardSpent, yetToReceive, selfFundsBills } = group;
  // Family/others' spends the member fronted on their OWN CREDIT card. NOT subtracted from the headline —
  // the bank fronts the cash, so no money left their hand (they owe the card AND are owed by the family =
  // net 0); it resolves next month when the reimbursement lands and funds the card bill. Shown on its own
  // line below as context ("fronted on a credit card · owed back"), never as a subtraction. (A prepaid/
  // debit card like Pluxee is the member's OWN money — out at swipe — so it's subtracted like cash, not
  // here.) The rest of cardSpent is their own held budget on a credit card (still in hand until the bill).
  const cardOutOfPocket = group.cardOutOfPocket ?? 0;
  const cardStillHeld = Math.round(((cardSpent ?? 0) - cardOutOfPocket) * 100) / 100;
  // Subtracted total split by PURPOSE (each spanning cash + card): spent against others' budget
  // envelopes vs unbudgeted misc. outOfPocket + misc === the amount knocked off this member's in-hand.
  const outOfPocket = group.outOfPocket ?? 0;
  const misc = group.misc ?? 0;
  // A SETTLED (closed, non-preview) month shows a final, static figure — so its breakdown can be the
  // clean component sum (budgets + sinking + held − out-of-pocket − misc = in hand), instead of the
  // live month's carry-based "holding now" walk (which needs the running carry + realised moves).
  const isSettled = !open && !isPreview;
  const handovers = group.handovers ?? []; // tolerate a stale cached shape (pre-feature) until it refreshes
  // Per-card toggle: include or exclude this member's own misc/out-of-pocket in their total.
  // Default = include (the true position). Excluding shows "budget + bills + savings" only, so
  // someone can see where they'd stand without their discretionary spending counted.
  const [inclMisc, setInclMisc] = useState(true);
  // `net` already subtracts miscSpent; excluding it just adds that back.
  const shownNet = inclMisc ? net : net + miscSpent;
  // The bill's payer (their own group) gets the SAME pay / modal / undo controls as head/manager
  // for an open month — not a reduced view. `canToggle` already covers head/manager on any group.
  const selfPayer = !canToggle && open && group.memberId === currentMemberId;
  const canPay = canToggle || selfPayer;
  // The holder has RECEIVED the general Piggy minus whatever's still pending hand-over from the
  // owners (that lump sits in the owners' `net` until they hand it over). `net` already includes
  // this person's own pendingPiggyHeld, so it isn't re-added here.
  const piggyAmt = isPiggyHolder ? piggy - pendingPiggyLump : 0;
  // Headline = this member's OWN cash (personal): budget left + set-asides + sinking − misc. Role money
  // (the general Piggy for the holder, the family pool for the treasurer) is NOT in the headline — it's
  // shown on its own "General Piggy held" / "Family pool held" line below. (This is what makes the
  // piggy-holder's headline read ₹5,505, not ₹5,505 + the ₹12,936 Piggy.)
  const total = Math.round((shownNet + sinkingHeld) * 100) / 100;
  // Continuous "holding now": the LIVE month OPENS at last month's close (openingCarry) and moves only
  // with REALISED cash — income received + transfers done − bills paid (doneCashMove) − cash actually
  // spent this month (cashSpent). No cash moves at the month boundary, so at the start of the month this
  // equals last month's close; it then evolves as the plan is worked. A CLOSED month (openingCarry null)
  // shows its own settled personal figure. This replaces the old "total − pending projection" that made
  // a fresh month read as a huge negative (the 0-bug).
  // The piggy HOLDER physically holds the general Piggy (minus what owners still owe it), so it IS part
  // of their holding-now — on its own line, never folded into the carry. (piggyAmt is 0 for non-holders.)
  // Last month's FREE budget leftover that swept into the Piggy still sits inside openingCarry. Once the
  // Piggy's been handed over (owners) / forwarded as income (holder — piggyAmt back to 0), that cash has
  // physically left; the Piggy hand-over step is informational (moves no cash in this walk), so without
  // this it lingers as phantom held cash. Drop it from holding-now once it's gone.
  // Use `swept` (Σ of each category's POSITIVE leftover — the REAL amount that went to the Piggy, matching
  // the recorded PiggyEntry sweeps), NOT `free` (the NET, which wrongly nets back an overspent budget that
  // swept nothing). They diverge only when a budget was overspent: Arumugam swept ₹12,465 (Arni 8,075 +
  // G704 2,083 + Non-Veg 2,277 + Vinayagar 30) but net free was just ₹9,242 because Provision/Veg overspent
  // — so the net understated the Piggy outflow by ₹3,223 and overstated his holding by the same. Baala has
  // no overspend, so swept == net == ₹471 (unaffected).
  const sweptToPiggy = group.carryParts?.swept ?? 0;
  const piggyGone = group.openingCarry != null && !isPreview && (isPiggyHolder ? piggyAmt <= 0.005 : piggyHandedOver);
  // Each rupee of last month's free→Piggy leftover is counted/listed ONCE (see piggyHeldParts).
  const piggyParts = piggyHeldParts({ swept: sweptToPiggy, pendingPiggyHeld, isHolder: isPiggyHolder, piggyGone });
  // A MULTI-month bill paid from this month's set-aside (fromSetAside = "no ledger draw") sends real cash
  // to the vendor that the walk never subtracts — it would otherwise linger as phantom "own money" equal
  // to the payment (EB ₹4,000). Subtract it so holding-now reflects the outflow. (Engine already excludes
  // monthly set-asides, which the walk captures on their own.)
  const setAsideConsumedCash = group.setAsideConsumedCash ?? 0;
  const holdingNow =
    group.openingCarry != null && !isPreview
      ? Math.round((group.openingCarry + doneCashMove - (cashSpent ?? 0) + piggyAmt - (group.openingCarry != null && !isPreview && piggyParts.sweptOut ? sweptToPiggy : 0) - setAsideConsumedCash) * 100) / 100
      : total;
  // The live carry-walk month shows the clean "Held for" partition only; preview/closed months (no
  // opening carry) keep the detailed carry/pool/in-transit breakdown below.
  const showV3 = group.openingCarry != null && !isPreview;
  // "Expected by month-end" = the CARRY-FORWARD: what genuinely remains as this member's own money once
  // budgets are spent (or leftover→Piggy) and bills/card-bills are paid — i.e. pool + Piggy + sinking +
  // set-asides + pending hand-overs − misc/out-of-pocket fronted. Budgets, bills & card-bills are EXCLUDED
  // (consumed within the month). This equals next month's OPENING balance, so the ledger is continuous.
  const expectedMisc = inclMisc ? miscSpent : 0;
  // A set-aside / sinking fund with a bill DUE this month gets spent on that bill by month-end — so
  // subtract those periodic fund-bills (they're paid FROM the set-aside/fund).
  const periodicBillsDue = unpaidPeriodic.reduce((s, b) => s + b.bill, 0);
  // Expected = this member's projected OWN money by month-end (personal, like the headline): sinking +
  // set-asides + pending hand-overs − misc − periodic fund-bills due. Role money (general Piggy / family
  // pool) is excluded here too, so "holding now" and "by month-end" are the same kind of number, and this
  // lines up with next month's openingCarry (also personal).
  // Card out-of-pocket is NOT subtracted here — it's no-cash and nets on next month's realized ledger
  // (reimbursement in, card bill out). Leaving it out keeps "expected" equal to next month's opening
  // (personal), which also no longer subtracts it. See the cardOutOfPocket note up top.
  const expected = Math.round((sinkingHeld + earmarkedTotal + pendingPiggyHeld - expectedMisc - periodicBillsDue) * 100) / 100;

  const paidCount = paidBills.length + paidPeriodic.length;
  // Bills whose Money-Plan step the head hid drop out of the pay list into a muted "Hidden" section,
  // so the card and the plan stay in sync. Hiding is view-only — the bill (and the total) is untouched.
  const shownBills = unpaidBills.filter((b) => !b.hidden);
  const shownPeriodic = unpaidPeriodic.filter((b) => !b.hidden);
  const hiddenBills = unpaidBills.filter((b) => b.hidden);
  const hiddenPeriodic = unpaidPeriodic.filter((b) => b.hidden);
  const hiddenCount = hiddenBills.length + hiddenPeriodic.length;
  const toPayCount = shownBills.length + shownPeriodic.length;
  // Reconciling "Where it's allocated" (non-treasurer cards): these lines sum EXACTLY to holdingNow,
  // with no leftover "spare". Salary-funded lines (budgets / set-asides / held bills / to-treasurer /
  // last-month misc) appear only once this member's income has ARRIVED — before that the card shows
  // just the carry. The treasurer keeps the pool-aware list below instead.
  const carryLeftover = Math.round(((group.openingCarry ?? 0) - sinkingHeld) * 100) / 100;
  const heldCardTotal = (pendingCardBills ?? []).filter((b) => !b.done).reduce((s, b) => s + b.familyAmount, 0);
  const heldBillsTotal = selfFundsBills ? Math.round((shownBills.reduce((s, b) => s + b.amount, 0) + heldCardTotal) * 100) / 100 : 0;
  // What's left of holding-now after every known allocation (budgets, set-asides, held bills, to-treasurer,
  // sinking, piggy, carry) — i.e. the unallocated remainder of this month's income. Shown as its own line
  // so the breakdown still sums exactly to holding-now.
  const remainingFromSalary = incomeReceived
    ? Math.round((holdingNow - sinkingHeld - carryLeftover - cats.reduce((s, c) => s + c.remaining, 0) - earmarkedTotal - heldBillsTotal - toTreasurerPending - piggyAmt) * 100) / 100
    : 0;
  const money = (n: number) => (n < 0 ? "−" : "") + formatINR(Math.abs(n));
  const carr = <span className="text-slate-400"> · carried</span>;
  const piggyLink = "truncate text-pink-600 underline decoration-dotted underline-offset-2 hover:text-pink-700";
  // ── Live-month "Held for" with coverage (see lib/inHandCoverage) ─────────────────────────────────────
  // Fixed holdings are always held; pending bills + sends (Money Plan order) are covered only when today's
  // cash fully covers them (misc spends don't count against the plan — they show as their own line).
  const v3 = (() => {
    if (!showV3) return null;
    // "Others' spend on your budget" is a real held line only for a regular member before owner-charge
    // months; for the treasurer it's a pass-through already netted in his settlement moves.
    const carriedOthers = (isTreasurer || ownerChargeActive) ? 0 : Math.max(0, (group.carryParts?.others ?? 0) - owedOthersSettled);
    const carriedFreeHeld = piggyParts.carriedFreeHeld;
    const budgetsTotal = incomeReceived ? cats.reduce((s, c) => s + c.remaining, 0) : 0;
    const earmarkedHeld = incomeReceived ? earmarkedTotal : 0;
    // The family month balance is the pool the treasurer holds only once EVERY income has arrived.
    const monthBal = isTreasurer && allIncomeReceived ? monthBalance : 0;
    const keptTotal = allowancesKept.reduce((s, a) => s + a.amount, 0);
    // Card cash: the statement due now (held when the owner self-funds) + spends for a LATER statement
    // from closed budget months (always held). One block per card.
    // The FAMILY part of a card bill due now is held cash (Held for + Pay) when:
    //  (A) they SEND to the treasurer — the settlement let them keep last month's family spends from their
    //      salary, so it's held once the salary step is ticked (a purely budget-funded bill always is);
    //  (C) they RECEIVE from the pool but no funding piece for this bill is still pending (it arrived, or the
    //      reimbursement was netted elsewhere) — salary ticked = reimbursed.
    // (B) a receiver whose funding piece is still pending → stays in the queue: waits, "arrives <day>".
    const cardKey = (b: { cardId: number; cycleEndISO: string }) => `cardbill-${b.cardId}-${b.cycleEndISO}`;
    // A RECEIVER is repaid last month's card spends by the pool's transfers to them — the cash is theirs
    // once those have arrived (no plain, not-bill-specific transfer to them still pending).
    const poolMoneyArrived = !incoming.some((i) => !i.income && !i.billLinked);
    const cardCashHeld = selfFundsBills ? incomeReceived : poolMoneyArrived;
    const dueCards = (pendingCardBills ?? []).filter((b) => !b.done && (cardCashHeld || (selfFundsBills && b.familyMisc <= 0.005)));
    const heldCardKeys = new Set(dueCards.map(cardKey));
    // Earlier months' OOP on their card (Misc / others' budgets) is held once reimbursed — for a sender, that's
    // when the salary step is ticked (the settlement let them keep it). Receivers: comes via the pool.
    const withOop = cardCashHeld;
    const unbilled = (group.cardUnbilled ?? []).map((u) => withOop ? { ...u, amount: Math.round((u.amount + u.oopAmount) * 100) / 100, items: [...u.items, ...u.oopItems] } : u).filter((u) => u.amount > 0.005);
    // Card cash still on its way (a receiver's repayment not arrived yet) — noted under To receive.
    const cardCashComing = withOop ? [] : (group.cardUnbilled ?? []).filter((u) => u.oopAmount > 0.005).map((u) => ({ name: u.cardName, amount: u.oopAmount, dueISO: u.dueISO }));
    const cardIds = [...new Set([...dueCards.map((b) => b.cardId), ...unbilled.map((u) => u.cardId)])];
    const cardBlocks = cardIds.map((id) => {
      const due = dueCards.filter((b) => b.cardId === id);
      const next = unbilled.filter((u) => u.cardId === id);
      const ref = due[0] ?? next[0];
      return { cardId: id, name: ref.cardName, color: ref.color, due, next, total: due.reduce((s, b) => s + b.familyAmount, 0) + next.reduce((s, u) => s + u.amount, 0) };
    });
    const cardTotal = cardBlocks.reduce((s, c) => s + c.total, 0);
    const fixedTotal = carriedOthers + carriedFreeHeld + sinkingHeld + piggyAmt + pendingPiggyHeld + budgetsTotal + earmarkedHeld + cardTotal + routingToForward + monthBal + keptTotal;
    // Cash spent this month on categories that are NOT this member's own budgets — itemised by category.
    const budgetedNames = new Set(cats.map((c) => c.name));
    const spentLines = (group.cashByCat ?? []).filter((sp) => !budgetedNames.has(sp.name) && sp.amount > 0.005);
    const miscTotal = Math.round(spentLines.reduce((s, sp) => s + sp.amount, 0) * 100) / 100;
    // A held due card bill is already a fixed card block → keep it out of the queue.
    const q = queue.filter((it) => !(it.cardBill && heldCardKeys.has(cardKey(it.cardBill))));
    const { items, unassigned } = allocate(holdingNow + miscTotal, fixedTotal, q, incoming);
    const coveredBills = items.filter((i) => i.covered && i.type === "bill");
    const coveredSends = items.filter((i) => i.covered && i.type === "send");
    const waitingSends = items.filter((i): i is Waiting => !i.covered && i.type === "send");
    // To send: the treasurer sees every pending send (covered ones are one aggregated Held-for line);
    // others see only the waiting ones (their covered sends are itemised in Held for).
    // Every list sorts by date (undated last; stable, so same-day items keep Money Plan order).
    const byDate = <T extends { day: number | null }>(a: T, b: T) => (a.day ?? 99) - (b.day ?? 99);
    const sendsToList = (isTreasurer ? items.filter((i) => i.type === "send") : waitingSends).sort(byDate);
    const incomingByDate = [...incoming].sort(byDate);
    // Unassigned cash. Negative = paid ahead from own pocket; name when it comes back (the next inflow that
    // isn't earmarked for a bill). Kept short — the laptop card truncates long labels.
    const back = incoming.find((i) => !i.billLinked && !i.income) ?? incoming.find((i) => !i.income) ?? null;
    const waiting = items.filter((i) => !i.covered).length;
    // The next waiting item (earliest by date) — named in the hover for the "saving toward" lines.
    const nextWaiting = items.filter((i) => !i.covered).sort((a, b) => (a.day ?? 99) - (b.day ?? 99))[0] ?? null;
    const remLabel = isTreasurer
      ? unassigned < -0.005 ? "↩ Paid out ahead · nets out" : waiting > 0 ? (items.some((i) => !i.covered && i.type === "send") ? "⏳ Saving toward waiting sends" : "⏳ Saving toward waiting bills") : "Family money in your hands"
      : unassigned < -0.005
        ? back ? `↩ Paid ahead · back ${back.day != null ? ord(back.day) + " " : ""}${formatINR(back.amount)}` : "↩ Paid ahead · owed back"
        : waiting > 0 ? "⏳ Saving toward waiting bills" : "Your own money";
    const remTitle = unassigned > 0.005 && waiting > 0
      ? `Cash in hand not yet enough for the next waiting ${nextWaiting?.type === "send" ? "send" : "bill"}${nextWaiting ? ` (${nextWaiting.type === "send" ? `${nextWaiting.toName ?? "?"}` : nextWaiting.label} ${formatINR(nextWaiting.amount)}${nextWaiting.day != null ? ` · ${ord(nextWaiting.day)}` : ""})` : ""} — it goes toward it as the rest arrives.`
      : unassigned < -0.005 && back
      ? `You paid ${formatINR(Math.abs(unassigned))} more than you've received so far. ${back.fromName ?? "The pool"} sends ${formatINR(back.amount)}${back.day != null ? ` on the ${ord(back.day)}` : ""}.`
      : undefined;
    // One bills list: queue bills (covered / waiting) + fund bills due this month, by day (undated last).
    type BillRow = { kind: "queue"; day: number | null; it: Covered | Waiting } | { kind: "fund"; day: number | null; b: (typeof shownPeriodic)[number] };
    const billRows: BillRow[] = [
      ...items.filter((i) => i.type === "bill").map((it): BillRow => ({ kind: "queue", day: it.day, it })),
      ...shownPeriodic.map((b): BillRow => ({ kind: "fund", day: b.due?.day ?? null, b })),
    ].sort(byDate);
    return { incomingByDate, cardCashComing, carriedOthers, carriedFreeHeld, monthBal, cardBlocks, spentLines, coveredBillsTotal: coveredBills.reduce((s, x) => s + x.amount, 0), coveredSends, coveredSendsTotal: coveredSends.reduce((s, x) => s + x.amount, 0), billRows, sendsToList, unassigned, remLabel, remTitle };
  })();
  // Live headline, projected + full breakdown on tap. Default collapsed to keep the wall of cards
  // scannable; expanding reveals where the money will land and the bills still to pay.
  const [expanded, setExpanded] = useState(false);
  return (
    <div className="rounded-xl border border-slate-200 p-3">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
        title={expanded ? "Hide the breakdown" : "Show where it lands + bills to pay"}
        className="flex w-full items-baseline justify-between gap-2 text-left"
      >
        <span className="text-sm font-semibold text-slate-800">
          {name}
          {isTreasurer && <span className="ml-1 text-[10px] font-normal text-indigo-500">treasurer</span>}
          {isPiggyHolder && <span className="ml-1 text-[10px] font-normal text-pink-500">piggy</span>}
        </span>
        <span className="flex items-baseline gap-1.5">
          {/* In a PREVIEW month, "holding now" is fake (you don't hold a future month's cash) — so lead
              with the meaningful projection, Expected by month-end. In the live month, lead with holding-now. */}
          <span className={`text-right text-sm font-bold tabular-nums ${(isPreview ? expected : holdingNow) < 0 ? "text-red-600" : "text-emerald-700"}`}>
            {formatINR(isPreview ? expected : holdingNow)}
            <span className="ml-1 text-[10px] font-normal text-slate-400">{isPreview ? "expected" : holdingNow < 0 ? "to reclaim" : "holding now"}</span>
          </span>
          <span className={`text-[10px] text-slate-300 transition-transform ${expanded ? "rotate-180" : ""}`}>▾</span>
        </span>
      </button>
      {/* Real-world match: the member's family bank account (e.g. SBI) vs what In-Hand says they hold. */}
      {group.familyAccount && !isPreview && open && (() => {
        const diff = Math.round((group.familyAccount.balance - holdingNow) * 100) / 100;
        const ok = Math.abs(diff) < 1;
        return (
          <div className={`mt-1.5 flex flex-wrap items-center justify-between gap-x-2 rounded-md px-2 py-1 text-[11px] ${ok ? "bg-emerald-50 text-emerald-800" : "bg-amber-50 text-amber-800"}`}>
            <span>🏦 {group.familyAccount.name} <b className="tabular-nums">{formatINR(group.familyAccount.balance)}</b></span>
            <span>{ok ? "✓ matches In-Hand" : `${formatINR(Math.abs(diff))} ${diff > 0 ? "more" : "less"} than In-Hand — check opening balance / unrecorded moves`}</span>
          </div>
        );
      })()}
      {/* Collapsed hint: the two things worth seeing at a glance without expanding. */}
      {!expanded && (Math.abs(pendingCashMove) > 0.005 || toPayCount > 0) && (
        <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[10px] text-slate-400">
          {isPreview
            ? <span>holding now <span className="text-slate-300">· projected</span> {formatINR(holdingNow)}</span>
            : Math.abs(expected - holdingNow) > 0.005 && <span>→ {formatINR(expected)} by month-end</span>}
          {toPayCount > 0 && <span className="text-amber-500">· {toPayCount} bill{toPayCount > 1 ? "s" : ""} to pay</span>}
        </div>
      )}
      {expanded && (
      <>
      {/* Live carry-walk month: the clean "Held for" partition — every rupee of holding-now labelled by
          what it's held FOR, reconciling by construction. The step-by-step cash-in/out lives in each
          Money-Plan step modal; preview/closed months keep the detailed breakdown below. */}
      {showV3 && v3 && (
              <div className="mb-2 mt-2">
                <div className="mb-1 text-[10px] font-medium uppercase tracking-wide text-slate-400">Held for <span className="font-normal normal-case text-slate-300">— every rupee</span></div>
                <ul className="space-y-0.5 text-[11px]">
                  {allowancesKept.map((a, i) => (
                    <li key={`v3al${i}`} className="flex items-center justify-between gap-2"><span className="truncate text-emerald-700">{a.label} <span className="text-slate-400">· your expense money</span></span><span className="shrink-0 tabular-nums text-emerald-700">+ {formatINR(a.amount)}</span></li>
                  ))}
                  {v3.cardBlocks.map((cb) => (
                    <InHandCardBlock key={`v3cb${cb.cardId}`} cardId={cb.cardId} name={cb.name} color={cb.color} due={cb.due} next={cb.next} canPay={canPay} categories={spendCategories} />
                  ))}
                  {v3.carriedOthers > 0.005 && <li className="flex items-center justify-between gap-2"><span className="truncate text-slate-500">Others&apos; spend on your budget · owe back{carr}</span><span className="shrink-0 tabular-nums text-slate-600">{formatINR(v3.carriedOthers)}</span></li>}
                  {v3.carriedFreeHeld > 0.005 && <li className="flex items-center justify-between gap-2"><a href="/piggy" title="This goes to the Piggy — open the Piggy tab" className={piggyLink}>🐷 Free → Piggy{carr} ↗</a><span className="shrink-0 tabular-nums text-pink-700">{formatINR(v3.carriedFreeHeld)}</span></li>}
                  {sinkingFunds.map((f) => <li key={`v3cs${f.name}`} className="flex items-center justify-between gap-2"><span className="truncate text-indigo-600">🏦 Sinking for {f.name}</span><span className="shrink-0 tabular-nums text-indigo-700">{formatINR(f.amount)}</span></li>)}
                  {isPiggyHolder && Math.abs(piggyAmt) > 0.005 && <li className="flex items-center justify-between gap-2"><a href="/piggy" title="Open the Piggy tab" className={piggyLink}>🐷 General Piggy <span className="text-slate-400">· role money ↗</span></a><span className="shrink-0 tabular-nums text-pink-700">{formatINR(piggyAmt)}</span></li>}
                  {pendingPiggyHeld - piggyToPool > 0.005 && <li className="flex items-center justify-between gap-2"><a href="/piggy" title="Open the Piggy tab" className={piggyLink}>🐷 Piggy to hand over <span className="text-slate-400">· held ↗</span></a><span className="shrink-0 tabular-nums text-pink-700">{formatINR(pendingPiggyHeld - piggyToPool)}</span></li>}
                  {piggyToPool > 0.005 && <li className="flex items-center justify-between gap-2"><a href="/piggy" title="Taken from the Piggy as this month's income" className={piggyLink}>🐷 Piggy used as income <span className="text-slate-400">· → treasurer ↗</span></a><span className="shrink-0 tabular-nums text-pink-700">{formatINR(piggyToPool)}</span></li>}
                  {incomeReceived && cats.map((cat) => (
                    <Fragment key={`v3hb${cat.id}`}>
                      <li className="flex items-center justify-between gap-2"><span className="truncate text-slate-500">{cat.name}</span><span className="shrink-0 tabular-nums text-slate-400">spent {formatINR(cat.spent)}/{formatINR(cat.allocation)} · <b className={cat.remaining < 0 ? "text-red-600" : "text-slate-600"}>{formatINR(cat.remaining)}</b></span></li>
                      <CatBreakdown onCard={cat.onCard} othersSpent={cat.othersSpent ?? 0} remaining={cat.remaining} />
                    </Fragment>
                  ))}
                  {incomeReceived && earmarked.map((e) => (
                    <li key={`v3he${e.id}`} className="flex items-center justify-between gap-2"><span className="truncate text-teal-600">Set aside for {e.name} <span className="text-slate-400">· its bill</span></span><span className="shrink-0 tabular-nums text-teal-700">{formatINR(e.amount)}</span></li>
                  ))}
                  {/* Bills the cash in hand covers right now — one summed line; each is listed (with Pay) in Bills below. */}
                  {v3.coveredBillsTotal > 0.005 && (
                    <li className="flex items-center justify-between gap-2"><span className="truncate text-amber-700" title="Bills your cash in hand fully covers right now — each one has a Pay button in Bills below.">🧾 Bills ready to pay <span className="text-slate-400">· see Bills</span></span><span className="shrink-0 tabular-nums text-amber-800">{formatINR(v3.coveredBillsTotal)}</span></li>
                  )}
                  {isTreasurer
                    ? v3.coveredSendsTotal > 0.005 && <li className="flex items-center justify-between gap-2"><span className="truncate text-violet-600">📤 Set aside to send <span className="text-slate-400">· see To send</span></span><span className="shrink-0 tabular-nums text-violet-700">{formatINR(v3.coveredSendsTotal)}</span></li>
                    : v3.coveredSends.map((x) => (
                        <li key={`v3qs${x.key}`} className="flex items-center justify-between gap-2"><span className="truncate text-violet-600">📤 To {x.toName ?? "send"}{x.day != null && <span className="text-slate-400"> · {ord(x.day)}</span>}</span><span className="shrink-0 tabular-nums text-violet-700">{formatINR(x.amount)}</span></li>
                      ))}
                  {routingToForward > 0.005 && (
                    <li className="flex items-center justify-between gap-2"><span className="truncate text-amber-600">➡️ To forward <span className="text-slate-400">· routing through you</span></span><span className="shrink-0 tabular-nums text-amber-700">{formatINR(routingToForward)}</span></li>
                  )}
                  {isTreasurer && Math.abs(v3.monthBal) > 0.005 && (
                    <li className="flex items-center justify-between gap-2"><span className="truncate text-emerald-600">Family month balance <span className="text-slate-400">· pool</span></span><span className="shrink-0 tabular-nums text-emerald-700">{formatINR(v3.monthBal)}</span></li>
                  )}
                  {Math.abs(v3.unassigned) > 0.005 && (
                    <li className="flex items-center justify-between gap-2"><span className="truncate text-slate-500" title={v3.remTitle}>{v3.remLabel}</span><span className={`shrink-0 tabular-nums ${v3.unassigned < 0 ? "text-rose-500" : "text-slate-600"}`}>{v3.unassigned < 0 ? "− " : ""}{formatINR(Math.abs(v3.unassigned))}</span></li>
                  )}
                  {v3.spentLines.map((sp, i) => (
                    <li key={`v3sp${i}`} className="flex items-center justify-between gap-2"><span className="truncate text-amber-600">{sp.name} <span className="text-slate-400">· spent</span></span><span className="shrink-0 tabular-nums text-amber-600">− {formatINR(sp.amount)}</span></li>
                  ))}
                  <li className="flex items-center justify-between gap-2 border-t border-slate-300 pt-0.5 font-semibold text-slate-800"><span>= {holdingNow < 0 ? "To reclaim" : "Holding now"}</span><span className={`shrink-0 tabular-nums ${holdingNow < 0 ? "text-red-600" : "text-emerald-700"}`}>{money(holdingNow)}</span></li>
                  {cardOutOfPocket > 0.005 && (
                    <li className="flex items-center justify-between gap-2 text-[10px] text-slate-400"><span className="truncate">💳 Fronted on a credit card <span className="italic">· owed back · offsets the bill · not subtracted</span></span><span className="shrink-0 tabular-nums italic">{formatINR(cardOutOfPocket)}</span></li>
                  )}
                </ul>
                {/* ALL of this month's bills in one list, by day: covered by cash in hand (Pay), paid from their
                    fund (Pay), or waiting for money (no Pay — unless its day has come: red "short", Pay anyway). */}
                {v3.billRows.length > 0 && (
                  <FlowSection tone="amber" icon="🧾" title="Bills" hint="this month, by date" total={v3.billRows.reduce((t, r) => t + (r.kind === "fund" ? r.b.bill : r.it.amount), 0)}>
                    {v3.billRows.map((r) => {
                      if (r.kind === "fund") {
                        const b = r.b;
                        return (
                          <FlowRow key={`v3fb${b.categoryId}`} dot="bg-teal-400" amount={formatINR(b.bill)} action={canPay && <PayBillModal categoryId={b.categoryId} periodId={periodId} name={b.name} bill={b.bill} fund={b.fund} saved={b.saved} setAside={b.setAside} generalPiggy={generalPiggy} cards={cards} />}
                            date={b.due && <Tag tone="slate">due {ord(b.due.day)}</Tag>} meta={<><Tag tone="teal">from fund {formatINR(b.fund)}</Tag>{b.afterWindDown && <Tag tone="slate">after {b.afterWindDown}</Tag>}</>}>
                            <span className="text-slate-700">{b.name}</span>
                          </FlowRow>
                        );
                      }
                      const b = r.it;
                      if (b.covered) {
                        return (
                          <FlowRow key={`v3cb${b.key}`} dot="bg-emerald-500" amount={formatINR(b.amount)} action={canPay && <QueuePay it={b} generalPiggy={generalPiggy} pendingCardBills={pendingCardBills ?? []} categories={spendCategories} />}
                            date={b.day != null && <Tag tone="slate">due {ord(b.day)}</Tag>} meta={<Tag tone="emerald">✓ in hand</Tag>}>
                            <span className="text-slate-700">{b.label}</span>
                          </FlowRow>
                        );
                      }
                      return (
                        <FlowRow key={`v3wb${b.key}`} dot={b.dueNow ? "bg-red-500" : "bg-slate-300"} danger={b.dueNow} title={waitTitle(b)} amount={formatINR(b.amount)} action={b.dueNow && canPay && <QueuePay it={b} generalPiggy={generalPiggy} pendingCardBills={pendingCardBills ?? []} categories={spendCategories} />}
                          date={b.day != null && <Tag tone={b.dueNow ? "red" : "slate"}>due {ord(b.day)}</Tag>} meta={waitMeta(b)}>
                          <span className={b.dueNow ? "text-red-700" : "text-slate-600"}>{b.label}</span>
                        </FlowRow>
                      );
                    })}
                  </FlowSection>
                )}
                {incoming.length > 0 && (
                  <FlowSection tone="emerald" icon="📥" title="To receive" hint="not in hand yet" total={incoming.reduce((t, r) => t + r.amount, 0)} sign="+">
                    {v3.incomingByDate.map((r) => (
                      <FlowRow key={`rc${r.key}`} dot="bg-emerald-400" amount={`+ ${formatINR(r.amount)}`} amountTone="text-emerald-700"
                        date={r.day != null && <Tag tone="slate">{ord(r.day)}</Tag>} meta={r.income ? <Tag tone="emerald">income</Tag> : r.label && r.label !== "Transfer" ? <Tag tone="slate">{r.label}</Tag> : undefined}>
                        <span className="text-slate-700">{r.income ? r.label : `from ${r.fromName ?? "?"}`}</span>
                      </FlowRow>
                    ))}
                    {v3.cardCashComing.map((c) => (
                      <li key={`rcc${c.name}`} className="pl-4 text-[10px] text-emerald-700/70">↳ incl. {formatINR(c.amount)} for 💳 {c.name}{c.dueISO ? ` · due ${new Date(c.dueISO).toLocaleDateString("en-IN", { day: "numeric", month: "short", timeZone: "Asia/Kolkata" })}` : ""}</li>
                    ))}
                  </FlowSection>
                )}
                {v3.sendsToList.length > 0 && (
                  <FlowSection tone="rose" icon="📤" title="To send" hint="still owed out" total={v3.sendsToList.reduce((t, x) => t + x.amount, 0)} sign="−">
                    {v3.sendsToList.map((x) => (
                      <FlowRow key={`sd${x.key}`} dot={x.covered ? "bg-emerald-500" : x.dueNow ? "bg-red-500" : "bg-slate-300"} title={x.covered ? undefined : waitTitle(x)} amount={`− ${formatINR(x.amount)}`} amountTone="text-rose-700"
                        date={x.day != null && <Tag tone="slate">{ord(x.day)}</Tag>} meta={x.covered ? <Tag tone="emerald">✓ in hand</Tag> : waitMeta(x)}>
                        <span className="text-slate-700">to {x.toName ?? "?"}</span>
                      </FlowRow>
                    ))}
                  </FlowSection>
                )}
              </div>
          )}
      {!showV3 && <div className="mb-1 mt-2 text-[10px] font-medium uppercase tracking-wide text-slate-400">Where it&apos;s allocated <span className="font-normal normal-case text-slate-300">(old)</span></div>}
      <ul className="mt-1 space-y-1">
        {/* NON-TREASURER, LIVE/PREVIEW month: carry-based breakdown that sums EXACTLY to "Holding now".
            Salary-funded lines show only once income has arrived; before that it's just the carry.
            (A SETTLED month uses the clean component breakdown added just below instead.) */}
        {!isTreasurer && !isSettled && !showV3 && (
          <>
            {group.openingCarry != null ? (
              // The live month OPENS at last month's close — show the FULL carried figure (exactly that
              // month's closing in-hand, which the ↗ link opens), NOT carry-minus-sinking. The sinking it
              // already includes is called out beneath (an "incl.", not a separate summed line) so the
              // number ties to last month to the rupee instead of reading as the lower net (−8,060).
              (Math.abs(group.openingCarry) > 0.005 || sinkingHeld > 0.005) && (
                <li className="text-xs">
                  <div className="flex items-center justify-between gap-2">
                    <a href={`/in-hand?y=${selMonth === 1 ? selYear - 1 : selYear}&m=${selMonth === 1 ? 12 : selMonth - 1}`} title="See last month's closing in-hand — where this carry comes from" className="truncate text-slate-500 underline decoration-dotted underline-offset-2 hover:text-slate-700">Carried from last month ↗</a>
                    <span className="shrink-0 tabular-nums text-slate-600">{money(group.openingCarry)}</span>
                  </div>
                  {sinkingHeld > 0.005 && (
                    <div className="pl-3 text-[10px] text-indigo-400">🏦 incl. {formatINR(sinkingHeld)} held in sinking funds</div>
                  )}
                </li>
              )
            ) : (
              // First tracked month (no prior close): sinking on its own line + the category-remaining carry.
              <>
                {sinkingHeld > 0.005 && (
                  <li className="flex items-center justify-between gap-2 text-xs"><span className="truncate text-indigo-600">🏦 Sinking held</span><span className="shrink-0 tabular-nums text-indigo-700">{money(sinkingHeld)}</span></li>
                )}
                {Math.abs(carryLeftover) > 0.005 && (
                  <li className="flex items-center justify-between gap-2 text-xs"><span className="truncate text-slate-500">Carried (category remaining)</span><span className="shrink-0 tabular-nums text-slate-600">{money(carryLeftover)}</span></li>
                )}
              </>
            )}
            {isPiggyHolder && Math.abs(piggyAmt) > 0.005 && (
              <li className="flex items-center justify-between gap-2 text-xs"><span className="truncate text-pink-600">🐷 General Piggy held <span className="text-[10px] text-slate-400">excl. sinking</span></span><span className="shrink-0 tabular-nums font-medium text-pink-700">{money(piggyAmt)}</span></li>
            )}
            {incomeReceived ? (
              <>
                {cats.map((cat) => (
                  <Fragment key={`ac${cat.id}`}>
                    <li className="flex items-center justify-between gap-2 text-xs"><span className="truncate text-slate-500">{cat.name}</span><span className="shrink-0 tabular-nums text-slate-400">spent {formatINR(cat.spent)}/{formatINR(cat.allocation)} · <b className={cat.remaining < 0 ? "text-red-600" : "text-slate-600"}>{formatINR(cat.remaining)}</b></span></li>
                    <CatBreakdown onCard={cat.onCard} othersSpent={cat.othersSpent ?? 0} remaining={cat.remaining} />
                  </Fragment>
                ))}
                {earmarked.map((e) => (
                  <li key={`ae${e.id}`} className="flex items-center justify-between gap-2 text-xs"><span className="truncate text-teal-600">Set aside · {e.name}</span><span className="shrink-0 tabular-nums text-teal-700">{money(e.amount)}</span></li>
                ))}
                {selfFundsBills && shownBills.map((b) => (
                  <li key={`ab${b.id}`} className="flex items-center justify-between gap-2 text-xs"><span className="truncate text-slate-500">Held for {b.name}</span><span className="shrink-0 tabular-nums text-slate-600">{money(b.amount)}</span></li>
                ))}
                {selfFundsBills && (pendingCardBills ?? []).filter((b) => !b.done).map((b) => (
                  <li key={`acb${b.cardId}-${b.cycleEndISO}`} className="flex items-center justify-between gap-2 text-xs"><span className="truncate" style={{ color: b.color }}>💳 Held for {b.cardName} bill</span><span className="shrink-0 tabular-nums" style={{ color: b.color }}>{money(b.familyAmount)}</span></li>
                ))}
                {toTreasurerPending > 0.005 && (
                  <li className="flex items-center justify-between gap-2 text-xs"><span className="truncate text-violet-600">➡️ To treasurer <span className="text-[10px] text-slate-400">settle up</span></span><span className="shrink-0 tabular-nums font-medium text-violet-700">{money(toTreasurerPending)}</span></li>
                )}
                {remainingFromSalary > 0.005 && (
                  <li className="flex items-center justify-between gap-2 text-xs"><span className="truncate text-slate-500">Remaining from salary <span className="text-[10px] text-slate-400">spare</span></span><span className="shrink-0 tabular-nums text-slate-600">{money(remainingFromSalary)}</span></li>
                )}
              </>
            ) : (
              <li className="pt-0.5 text-[10px] italic leading-tight text-slate-400">Your budgets, bills &amp; treasurer hand-over appear here once your income arrives.</li>
            )}
            <li className="mt-0.5 flex items-center justify-between gap-2 border-t border-slate-200 pt-1 text-xs font-semibold text-slate-800"><span>= {holdingNow < 0 ? "To reclaim" : "Holding now"}</span><span className={`tabular-nums ${holdingNow < 0 ? "text-red-600" : "text-emerald-700"}`}>{money(holdingNow)}</span></li>
          </>
        )}
        {/* NON-TREASURER, SETTLED (closed) month: clean component breakdown that sums EXACTLY to the final
            figure — budgets + sinking + held − out-of-pocket − misc = in hand. No carry artifact, no
            double-counted set-asides, subtractions shown in line. Piggy (role money) sits below the total. */}
        {!isTreasurer && isSettled && (
          <>
            {cats.map((cat) => (
              <Fragment key={`sc${cat.id}`}>
                <li className="flex items-center justify-between gap-2 text-xs">
                  <span className="truncate text-slate-500">{cat.name}</span>
                  <span className="shrink-0 tabular-nums text-slate-400">spent {formatINR(cat.spent)}/{formatINR(cat.allocation)} · <b className={cat.remaining < 0 ? "text-red-600" : "text-slate-600"}>{formatINR(cat.remaining)}</b></span>
                </li>
                <CatBreakdown onCard={cat.onCard} othersSpent={cat.othersSpent ?? 0} remaining={cat.remaining} />
              </Fragment>
            ))}
            {sinkingHeld > 0.005 && (
              <li className="flex items-center justify-between gap-2 text-xs"><span className="truncate text-indigo-600">🏦 Sinking / set-asides held</span><span className="shrink-0 tabular-nums text-indigo-700">{money(sinkingHeld)}</span></li>
            )}
            {pendingPiggyHeld - piggyToPool > 0.005 && (
              <li className="flex items-center justify-between gap-2 text-xs"><span className="truncate text-pink-600">🐷 Last month&apos;s Piggy held</span><span className="shrink-0 tabular-nums text-pink-700">{money(pendingPiggyHeld - piggyToPool)}</span></li>
            )}
            {piggyToPool > 0.005 && (
              <li className="flex items-center justify-between gap-2 text-xs"><span className="truncate text-pink-600">🐷 Piggy used as income <span className="text-[10px] text-slate-400">→ treasurer</span></span><span className="shrink-0 tabular-nums text-pink-700">{money(piggyToPool)}</span></li>
            )}
            {selfFundsBills && shownBills.map((b) => (
              <li key={`shb${b.id}`} className="flex items-center justify-between gap-2 text-xs"><span className="truncate text-slate-500">Held for {b.name}</span><span className="shrink-0 tabular-nums text-slate-600">{money(b.amount)}</span></li>
            ))}
            {selfFundsBills && (pendingCardBills ?? []).filter((b) => !b.done).map((b) => (
              <li key={`shcb${b.cardId}-${b.cycleEndISO}`} className="flex items-center justify-between gap-2 text-xs"><span className="truncate" style={{ color: b.color }}>💳 Held for {b.cardName} bill</span><span className="shrink-0 tabular-nums" style={{ color: b.color }}>{money(b.familyAmount)}</span></li>
            ))}
            {outOfPocket > 0.005 && (
              <li className="flex items-center justify-between gap-2 text-xs"><span className="truncate text-amber-600">👛 Out-of-pocket <span className="text-[10px] text-slate-400">· on others&apos; budgets · back at settlement</span></span><span className="shrink-0 tabular-nums text-amber-600">− {formatINR(outOfPocket)}</span></li>
            )}
            {misc > 0.005 && (
              <li className="flex items-center justify-between gap-2 text-xs"><span className="truncate text-amber-600">🛒 Misc <span className="text-[10px] text-slate-400">· unbudgeted · back at settlement</span></span><span className="shrink-0 tabular-nums text-amber-600">− {formatINR(misc)}</span></li>
            )}
            <li className="mt-0.5 flex items-center justify-between gap-2 border-t border-slate-200 pt-1 text-xs font-semibold text-slate-800"><span>= {holdingNow < 0 ? "To reclaim" : "In hand"}</span><span className={`tabular-nums ${holdingNow < 0 ? "text-red-600" : "text-emerald-700"}`}>{money(holdingNow)}</span></li>
            {cardOutOfPocket > 0.005 && (
              <li className="flex items-center justify-between gap-2 text-[11px] text-slate-400"><span className="truncate">💳 Fronted on a credit card <span className="italic">· owed back · offsets the bill · not in the total</span></span><span className="shrink-0 tabular-nums italic">{formatINR(cardOutOfPocket)}</span></li>
            )}
            {isPiggyHolder && Math.abs(piggyAmt) > 0.005 && (
              <li className="flex items-center justify-between gap-2 text-xs"><span className="truncate text-pink-600">🐷 General Piggy held <span className="text-[10px] text-slate-400">role money · not in the total</span></span><span className="shrink-0 tabular-nums font-medium text-pink-700">{money(piggyAmt)}</span></li>
            )}
          </>
        )}
        {/* Pinned to the TOP: things owed from an earlier month that were never paid. A pure
            nag — already settled in their own month, so greyed and NOT part of this month's total.
            Regular bills just toggle ✓ paid; a periodic fund-bill can be paid now (drawn from its
            fund, in this open month) via the pay modal. */}
        {(carried.length > 0 || carriedDue.length > 0) && (
          <>
            <li>
              <div className="flex items-center justify-between gap-2">
                <span className="text-[10px] font-semibold uppercase tracking-wide text-rose-600">⏰ Overdue — not paid</span>
                <span className="text-[9px] text-slate-400">reminder only · not in your total</span>
              </div>
            </li>
            {carried.map((c) => (
              <li key={`cb${c.id}`} className="flex items-center justify-between gap-2 text-xs">
                <span className="truncate text-slate-400">
                  {c.name} <span className="text-[10px] text-rose-400">carried from {c.from}</span>
                </span>
                <span className="flex shrink-0 items-center gap-1.5">
                  <span className="tabular-nums text-slate-400">{formatINR(c.amount)}</span>
                  {canPay && <PaidToggle id={c.id} title="Mark this carried-over bill paid" label="✓ paid" />}
                </span>
              </li>
            ))}
            {carriedDue.map((b) => (
              <li key={`cd${b.categoryId}-${b.periodId}`} className="flex items-center justify-between gap-2 text-xs">
                <span className="truncate text-slate-400">
                  {b.name} <span className="text-[10px] text-rose-400">bill overdue from {b.fromMonth}</span>
                  <span className="text-[10px] text-slate-400"> · fund {formatINR(b.fund)}</span>
                </span>
                <span className="flex shrink-0 items-center gap-1.5">
                  <span className="tabular-nums text-slate-400">{formatINR(b.bill)}</span>
                  {canPay ? (
                    <PayBillModal categoryId={b.categoryId} periodId={b.periodId} spendPeriodId={periodId} carriedFrom={b.fromMonth} name={b.name} bill={b.bill} fund={b.fund} generalPiggy={generalPiggy} cards={cards} />
                  ) : (
                    <span className="rounded-full bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-400">to pay</span>
                  )}
                </span>
              </li>
            ))}
            <li className="pb-0.5"><div className="border-b border-dashed border-rose-100" /></li>
          </>
        )}
        {/* Preview & closed months only: the detailed carry / pool / in-transit view. The live month's
            clean "Held for" block above replaces all of this; only the actionable bill lists remain. */}
        {!showV3 && (<>
        {isTreasurer && (
        <>
        {cats.map((cat) => (
          <li key={cat.id} className="flex items-center justify-between gap-2 text-xs">
            <span className="truncate text-slate-500">{cat.name}</span>
            <span className="shrink-0 tabular-nums text-slate-400">
              spent {formatINR(cat.spent)}/{formatINR(cat.allocation)} ·{" "}
              <b className={cat.remaining < 0 ? "text-red-600" : "text-slate-600"}>{formatINR(cat.remaining)}</b>
            </span>
          </li>
        ))}
        {/* Savings this person is holding toward a periodic bill (moves to the fund at wind-down) */}
        {earmarked.map((e) => (
          <li key={`sv${e.id}`} className="flex items-center justify-between gap-2 text-xs">
            <span className="truncate text-teal-600">
              Set aside · {e.name} <span className="text-[10px] text-slate-400">held for the bill</span>
            </span>
            <span className="shrink-0 tabular-nums text-teal-700">{formatINR(e.amount)}</span>
          </li>
        ))}
        {/* Accrued sinking-fund holds this person is the saver of — held separately from the Piggy. */}
        {sinkingFunds.map((f) => (
          <li key={`sf${f.name}`} className="flex items-center justify-between gap-2 text-xs">
            <span className="truncate text-indigo-600">
              🏦 Sinking · {f.name} <span className="text-[10px] text-slate-400">fund held</span>
              {f.afterWindDown && f.projected > 0 && (
                <span className="text-[10px] text-violet-400"> · +{formatINR(f.projected)} after {f.afterWindDown} winds down</span>
              )}
            </span>
            <span className="shrink-0 tabular-nums font-medium text-indigo-700">{formatINR(f.amount)}</span>
          </li>
        ))}
        {miscSpent > 0 && (
          <li className="flex items-center justify-between gap-2 text-xs">
            <span className={`flex min-w-0 items-center gap-1.5 ${inclMisc ? "text-amber-600" : "text-slate-400"}`}>
              {group.memberId != null ? (
                <a
                  href={`/expenses?y=${selYear}&m=${selMonth}&member=${group.memberId}`}
                  title={`See ${name}'s misc & out-of-pocket spends`}
                  className={`truncate underline decoration-dotted underline-offset-2 hover:text-amber-700 ${inclMisc ? "" : "line-through"}`}
                >
                  Miscellaneous &amp; out-of-pocket
                </a>
              ) : (
                <span className={`truncate ${inclMisc ? "" : "line-through"}`}>Miscellaneous &amp; out-of-pocket</span>
              )}
              <button
                type="button"
                onClick={() => setInclMisc((v) => !v)}
                title={inclMisc ? "Exclude misc from this total" : "Include misc in this total"}
                className={`shrink-0 rounded-full border px-1.5 py-0.5 text-[9px] font-medium ${inclMisc ? "border-amber-200 text-amber-500 hover:bg-amber-50" : "border-slate-200 text-slate-400 hover:bg-slate-50"}`}
              >
                {inclMisc ? "counted" : "excluded"}
              </button>
            </span>
            <span className={`shrink-0 tabular-nums ${inclMisc ? "text-red-600" : "text-slate-300 line-through"}`}>− {formatINR(miscSpent)}</span>
          </li>
        )}
        </>
        )}
        {/* LIVE/PREVIEW month only — card/cash context below the holding-now walk. (A SETTLED month shows
            the out-of-pocket/misc split inside its clean breakdown above, so these would duplicate it.)
            Out-of-pocket (cash AND prepaid/debit cards like Pluxee) is already subtracted from the total
            above — the member's own money is out at swipe; it comes back at the next settlement. */}
        {!isTreasurer && !isSettled && miscSpent > 0.005 && (
          <li className="flex items-center justify-between gap-2 text-[11px] text-amber-600">
            <span className="truncate">💵 Out-of-pocket &amp; misc <span className="italic text-slate-400">· cash &amp; prepaid · subtracted · back at settlement</span></span>
            <span className="shrink-0 tabular-nums">− {formatINR(miscSpent)}</span>
          </li>
        )}
        {/* Credit-card out-of-pocket: family money the member fronted on their CREDIT card. NOT subtracted
            (the bank fronts it — no cash left their hand) — it's owed back at settlement AND offsets the
            card bill next month, so it nets there, never here. (A prepaid/debit card like Pluxee is the
            member's own money, so it's in the subtracted line above, not here.) The next block is their
            OWN held budget on a credit card (e.g. FUEL) — cash still in hand until the bill. */}
        {!isSettled && cardOutOfPocket > 0.005 && (
          <li className="flex items-center justify-between gap-2 text-[11px] text-slate-400">
            <span className="truncate">💳 Fronted on a credit card <span className="italic">· owed back · offsets the bill · not subtracted</span></span>
            <span className="shrink-0 tabular-nums italic">{formatINR(cardOutOfPocket)}</span>
          </li>
        )}
        {!isSettled && cardStillHeld > 0.005 && (
          <li className="flex items-center justify-between gap-2 text-[11px] text-slate-400">
            <span className="truncate">💳 On cards · own budget <span className="italic">· still in hand · settles next month</span></span>
            <span className="shrink-0 tabular-nums italic">{formatINR(cardStillHeld)}</span>
          </li>
        )}
        {isTreasurer && (
          <>
            <li className="flex items-center justify-between gap-2 border-t border-dashed border-slate-100 pt-1 text-xs">
              <span className="truncate font-medium text-indigo-600">Family pool held</span>
              <span className="shrink-0 tabular-nums font-semibold text-indigo-700">{formatINR(pool)}</span>
            </li>
            <li className="flex items-center justify-between gap-2 pl-3 text-xs">
              <span className="truncate text-slate-500" title="Net of everyone's shared-expense settlement — what the family jointly owns this month">
                <span className="mr-1 text-slate-300">↳</span>Shared settlement
              </span>
              <span className="shrink-0 tabular-nums text-slate-500">{formatINR(sharedNet)}</span>
            </li>
            <li className="flex items-center justify-between gap-2 pl-3 text-xs">
              <span className="truncate text-slate-500" title="Unspent balance carried in this month's pool">
                <span className="mr-1 text-slate-300">↳</span>Month balance
              </span>
              <span className="shrink-0 tabular-nums text-slate-500">{formatINR(monthBalance)}</span>
            </li>
            {treasurerOwnLeftover > 0.005 && (
              <li className="flex items-center justify-between gap-2 pl-6 text-[10px] text-slate-400" title="Your own budget leftover from last month that was routed to this month's income — already at the hub, so no hand-over. Shown for provenance; it's already part of Month balance above.">
                incl. your own last-month leftover
                <span className="shrink-0 tabular-nums">{formatINR(treasurerOwnLeftover)}</span>
              </li>
            )}
            {billsHeldForMembers > 0.005 && (
              <li className="flex items-center justify-between gap-2 pl-3 text-xs">
                <span className="truncate text-slate-500" title="Cash the treasurer holds to pay out members' pool-funded bills (they've yet to receive it)">
                  <span className="mr-1 text-slate-300">↳</span>Bills to disburse
                </span>
                <span className="shrink-0 tabular-nums text-slate-500">{formatINR(billsHeldForMembers)}</span>
              </li>
            )}
            {/* Pool money you're HOLDING now to hand out this month — allowances + pool-funded misc.
                The month-end pool above is net of these (the expense is booked), so each rides here as
                a positive add-back: it's the cash in your holding-now that sits ABOVE month-end, and
                leaves as its plan step is ticked. Rendered as a plain in-hand row, not a callout. */}
            {poolDisbursements.map((d, i) => (
              <li key={`disb${d.recipientId}-${i}`} className="flex items-center justify-between gap-2 text-xs">
                <span className="truncate text-violet-600" title="Held in your pool now for this member's pool-funded expense — leaves at month-end when you send it">
                  📤 Held for {d.recipientName} <span className="text-[10px] text-slate-400">{d.label} · sends this month</span>
                </span>
                <span className="shrink-0 tabular-nums font-medium text-violet-700">{formatINR(d.amount)}</span>
              </li>
            ))}
          </>
        )}
        {isTreasurer && isPiggyHolder && piggyAmt !== 0 && (
          <li className="flex items-center justify-between gap-2 text-xs">
            <span className="truncate text-pink-600">🐷 General Piggy held <span className="text-[10px] text-slate-400">excl. sinking</span></span>
            <span className="shrink-0 tabular-nums font-medium text-pink-700">{formatINR(piggyAmt)}</span>
          </li>
        )}
        {/* Two-step pool misc received but not yet paid to the vendor: the member is holding this cash now
            (leg 1 done, leg 2 pending). It's why their holding-now sits above their net; leaves when they
            tick the "→ vendor" step in the Money Plan. */}
        {(group.poolHeld ?? 0) > 0.005 && (
          <li className="flex items-center justify-between gap-2 text-xs">
            <span className="truncate text-violet-600" title={`Received from the pool — pay: ${(group.poolHeldVendors ?? []).join(", ")}`}>
              📥 Held from pool <span className="text-[10px] text-slate-400">to pay the vendor</span>
            </span>
            <span className="shrink-0 tabular-nums font-medium text-violet-700">{formatINR(group.poolHeld ?? 0)}</span>
          </li>
        )}
        {/* Owner still holding last month's Piggy leftover, to hand to the holder (this IS in their total). */}
        {pendingPiggyHeld - piggyToPool > 0.005 && (
          <li className="flex items-center justify-between gap-2 text-xs">
            <span className="truncate text-amber-600">🐷 holding for Piggy <span className="text-[10px] text-slate-400">hand to the holder</span></span>
            <span className="shrink-0 tabular-nums font-medium text-amber-700">{formatINR(pendingPiggyHeld - piggyToPool)}</span>
          </li>
        )}
        {piggyToPool > 0.005 && (
          <li className="flex items-center justify-between gap-2 text-xs">
            <span className="truncate text-amber-600">🐷 Piggy taken as income <span className="text-[10px] text-slate-400">hand to the treasurer</span></span>
            <span className="shrink-0 tabular-nums font-medium text-amber-700">{formatINR(piggyToPool)}</span>
          </li>
        )}
        {/* Prior-month cash this member still HOLDS that became this month's pool income — their budget
            leftover routed to income and/or the general Piggy taken as income. In their holding-now total
            now; leaves once they hand it to the treasurer (the combined Money-Plan step). */}
        {handovers.length > 0 && (
          <>
            <li className="pt-2">
              <div className="border-t border-dashed border-amber-100" />
              <div className="mt-1.5 flex items-center justify-between gap-2">
                <span className="text-[10px] font-semibold uppercase tracking-wide text-amber-600">Holding to hand to the treasurer</span>
                <span className="text-[9px] text-slate-400">in your total now · leaves at month-end</span>
              </div>
            </li>
            {handovers.map((h) => (
              <li key={`ho${h.id}`} className="flex items-center justify-between gap-2 text-xs">
                <span className="truncate text-amber-600">
                  {h.kind === "piggy" ? "🐷 From Piggy" : "Last month’s leftover"}
                  {h.detail && <span className="text-[10px] text-slate-400"> · {h.detail}</span>}
                </span>
                <span className="shrink-0 tabular-nums font-medium text-amber-700">{formatINR(h.amount)}</span>
              </li>
            ))}
          </>
        )}
        {/* Treasurer: pool income still HELD by others until they hand it over — NOT in the treasurer's
            holding-now yet (it's why holding-now sits below the projected pool). */}
        {isTreasurer && poolIncoming.length > 0 && (
          <>
            <li className="pt-2">
              <div className="border-t border-dashed border-amber-100" />
              <div className="mt-1.5 flex items-center justify-between gap-2">
                <span className="text-[10px] font-semibold uppercase tracking-wide text-amber-600">To collect from holders</span>
                <span className="text-[9px] text-slate-400">not in your holding-now yet</span>
              </div>
            </li>
            {[...new Map(poolIncoming.map((p) => [p.fromId, p.fromName])).entries()].map(([fromId, fromName]) => {
              const amt = poolIncoming.filter((p) => p.fromId === fromId).reduce((s, p) => s + p.amount, 0);
              return (
                <li key={`inc${fromId}`} className="flex items-center justify-between gap-2 text-xs">
                  <span className="truncate text-amber-600">📥 from {fromName} <span className="text-[10px] text-slate-400">last month’s leftover / Piggy</span></span>
                  <span className="shrink-0 tabular-nums font-medium text-amber-700">{formatINR(amt)}</span>
                </li>
              );
            })}
          </>
        )}
        {/* Piggy holder still waiting on the owners' leftover (NOT in their total). */}
        {isPiggyHolder && pendingPiggyLump > 0.005 && (
          <>
            <li className="pt-2">
              <div className="border-t border-slate-200" />
              <div className="mt-1.5 flex items-center justify-between gap-2">
                <span className="text-[10px] font-semibold uppercase tracking-wide text-amber-600">Pending hand-over</span>
                <span className="text-[9px] text-slate-400">reminder · not in your in-hand yet</span>
              </div>
            </li>
            <li className="flex items-center justify-between gap-2 text-xs">
              <span className="truncate text-amber-600">🐷 yet to receive <span className="text-[10px] text-slate-400">last month’s leftovers, still with owners</span></span>
              <span className="shrink-0 tabular-nums font-medium text-amber-700">{formatINR(pendingPiggyLump)}</span>
            </li>
          </>
        )}
        </>)}

        {/* Bills to pay THIS month — assigned bills (loans / EMIs / interest / fixed) AND periodic
            fund bills. A SELF-FUNDER (net contributor) holds this cash from their own salary, so it's
            IN their in-hand total; a pool-funded receiver still awaits it (`yetToReceive`), and periodic
            fund bills are drawn from the fund (neither). */}
        {!showV3 && (shownBills.length > 0 || shownPeriodic.length > 0) && (
          <>
            <li className="pt-2">
              <div className="border-t border-slate-200" />
              <div className="mt-1.5 flex items-center justify-between gap-2">
                <span className="text-[10px] font-semibold uppercase tracking-wide text-teal-600">
                  {showV3 ? "Fund bills due" : "Bills to pay this month"}
                </span>
                <span className="text-[9px] text-slate-400">
                  {showV3
                    ? "paid from the fund · not your in-hand"
                    : selfFundsBills && shownBills.length > 0
                    ? "you hold this cash · included in your in-hand"
                    : yetToReceive > 0.005
                    ? `yet to receive ${formatINR(yetToReceive)} from the pool · not in your in-hand`
                    : "reminder · paid from the fund, not your in-hand"}
                </span>
              </div>
            </li>
            {!showV3 && shownBills.map((b) => {
              const st = b.due?.status;
              return (
                <li key={`ub${b.id}`} className={`flex items-center justify-between gap-2 rounded-md text-xs ${st === "overdue" ? "bg-red-50 px-1.5 py-0.5" : st === "soon" ? "bg-amber-50 px-1.5 py-0.5" : ""}`}>
                  <span className={`truncate ${st === "overdue" ? "text-red-700" : "text-slate-500"}`}>
                    {b.name} <span className="text-[10px] text-indigo-400">bill</span>
                    {b.due && <DueChip due={b.due} />}
                  </span>
                  <span className="flex shrink-0 items-center gap-1.5">
                    <span className={`tabular-nums ${st === "overdue" ? "font-medium text-red-700" : "text-slate-600"}`}>{formatINR(b.amount)}</span>
                    {!b.due && <span className="rounded-full bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-400">to pay</span>}
                    {canPay && (b.misc
                      ? <MiscPayModal id={b.id} name={b.name} estimate={b.amount} generalPiggy={generalPiggy} />
                      : <PaidToggle id={b.id} title="Mark this bill paid" label="✓ paid" />)}
                  </span>
                </li>
              );
            })}
            {shownPeriodic.map((b) => (
              <li key={`pb${b.categoryId}`} className="flex items-center justify-between gap-2 text-xs">
                <span className="truncate text-slate-500">
                  {b.name} <span className="text-[10px] text-teal-500">bill due</span>
                  {b.due && <DueChip due={b.due} />}
                  <span className="text-[10px] text-slate-400">
                    {" "}· fund {formatINR(b.fund)}
                    {b.afterWindDown && <span className="text-violet-400"> (after {b.afterWindDown} winds down)</span>}
                  </span>
                </span>
                <span className="flex shrink-0 items-center gap-1.5">
                  <span className="tabular-nums text-slate-500">{formatINR(b.bill)}</span>
                  {canPay ? (
                    <PayBillModal categoryId={b.categoryId} periodId={periodId} name={b.name} bill={b.bill} fund={b.fund} saved={b.saved} setAside={b.setAside} generalPiggy={generalPiggy} cards={cards} />
                  ) : (
                    <span className="rounded-full bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-400">to pay</span>
                  )}
                </span>
              </li>
            ))}
          </>
        )}

        {/* Family credit-card bills now due — the owner has HELD this cash since the swipe (a credit
            spend doesn't leave hand until the bill), so it sits in their in-hand and pays down when the
            card bill is settled. Its own ruled section, like the bills above — it's a bill to pay too. */}
        {!showV3 && (pendingCardBills ?? []).some((b) => !b.done) && (
          <>
            <li className="pt-2">
              <div className="border-t border-slate-200" />
              <div className="mt-1.5 flex items-center justify-between gap-2">
                <span className="text-[10px] font-semibold uppercase tracking-wide text-fuchsia-600">Card bills to pay</span>
                <span className="text-[9px] text-slate-400">held to pay this bill · not spare, not for Piggy</span>
              </div>
            </li>
            {(pendingCardBills ?? []).filter((b) => !b.done).map((b) => (
              <li key={`cardbill${b.cardId}-${b.cycleEndISO}`} className="flex items-center justify-between gap-2 text-xs">
                <span className="truncate" style={{ color: b.color }}>
                  💳 {b.cardName} <span className="text-[10px] opacity-70">card bill</span>
                  <span className="text-[10px] text-slate-400"> · due {new Date(b.dueISO).toLocaleDateString("en-IN", { day: "numeric", month: "short" })}</span>
                </span>
                <span className="shrink-0 tabular-nums font-medium" style={{ color: b.color }}>{formatINR(b.familyAmount)}</span>
              </li>
            ))}
          </>
        )}
        {/* Bills whose Money-Plan step the head hid — mirrored here as a muted section with un-hide,
            so hiding a step declutters the pay list too. Underlying bill/total is unchanged. */}
        {canToggle && hiddenCount > 0 && (
          <li className="pt-2">
            <details>
              <summary className="cursor-pointer list-none text-[10px] font-semibold uppercase tracking-wide text-slate-400 [&::-webkit-details-marker]:hidden">
                ▸ Hidden ({hiddenCount}) <span className="font-normal normal-case text-slate-400">— removed from the plan &amp; pay list</span>
              </summary>
              <ul className="mt-1 space-y-1">
                {hiddenBills.map((b) => (
                  <li key={`hb${b.id}`} className="flex items-center justify-between gap-2 text-xs">
                    <span className="truncate text-slate-400 line-through">{b.name} <span className="text-[10px] no-underline">bill</span></span>
                    <span className="flex shrink-0 items-center gap-1.5">
                      <span className="tabular-nums text-slate-400 line-through">{formatINR(b.amount)}</span>
                      <form action={unhideStep}><input type="hidden" name="periodId" value={periodId} /><input type="hidden" name="stepKey" value={`bill-${b.id}`} /><button type="submit" title="Bring this bill back into the plan &amp; pay list" className="rounded-full border border-slate-200 px-1.5 py-0.5 text-[10px] font-medium text-emerald-600 hover:bg-emerald-50">un-hide</button></form>
                    </span>
                  </li>
                ))}
                {hiddenPeriodic.map((b) => (
                  <li key={`hp${b.categoryId}`} className="flex items-center justify-between gap-2 text-xs">
                    <span className="truncate text-slate-400 line-through">{b.name} <span className="text-[10px] no-underline">bill due · fund {formatINR(b.fund)}</span></span>
                    <span className="flex shrink-0 items-center gap-1.5">
                      <span className="tabular-nums text-slate-400 line-through">{formatINR(b.bill)}</span>
                      <form action={unhideStep}><input type="hidden" name="periodId" value={periodId} /><input type="hidden" name="stepKey" value={`fund-${b.categoryId}`} /><button type="submit" title="Bring this bill back into the plan &amp; pay list" className="rounded-full border border-slate-200 px-1.5 py-0.5 text-[10px] font-medium text-emerald-600 hover:bg-emerald-50">un-hide</button></form>
                    </span>
                  </li>
                ))}
              </ul>
            </details>
          </li>
        )}
      </ul>
      {paidCount > 0 && (
        <details className="mt-2">
          <summary className="cursor-pointer list-none text-[11px] text-slate-400 [&::-webkit-details-marker]:hidden">
            ✓ Paid this month ({paidCount})
          </summary>
          <ul className="mt-1 space-y-1">
            {paidBills.map((b) => (
              <li key={b.id} className="flex items-center justify-between gap-2 text-xs text-slate-400">
                <span className="truncate line-through">{b.name}</span>
                <span className="flex shrink-0 items-center gap-1.5">
                  <span className="tabular-nums">{formatINR(b.amount)}</span>
                  {canPay && (b.misc
                    ? <form action={unpayMiscBill}><input type="hidden" name="id" value={b.id} /><button type="submit" title="Undo payment (reverses the Piggy reconciliation)" className={CTA_CLASS.undo}>Undo</button></form>
                    : <PaidToggle id={b.id} title="Mark unpaid" label="undo" />)}
                </span>
              </li>
            ))}
            {paidPeriodic.map((b) => (
              <li key={`pb${b.categoryId}`} className="flex items-center justify-between gap-2 text-xs text-slate-400">
                <span className="truncate line-through">{b.name}</span>
                <span className="flex shrink-0 items-center gap-1.5">
                  <span className="tabular-nums">{formatINR(b.bill)}</span>
                  {canPay && (
                    <form action={unpayPeriodicBill}>
                      <input type="hidden" name="categoryId" value={b.categoryId} />
                      <input type="hidden" name="periodId" value={periodId} />
                      <button type="submit" title="Undo payment" className={CTA_CLASS.undo}>Undo</button>
                    </form>
                  )}
                </span>
              </li>
            ))}
          </ul>
        </details>
      )}
      {shownNet < 0 && (
        <p className="mt-2 text-[11px] leading-tight text-amber-600">
          This amount will be settled at next month&apos;s settlement.
        </p>
      )}
      </>
      )}
    </div>
  );
}

const ord = (n: number) => {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return `${n}${s[(v - 20) % 10] ?? s[v] ?? s[0]}`;
};

// Breaks a budgeted category's `remaining` into its real parts (like "Family pool held" ↳ sub-lines),
// so the figure reads honestly: card-held (swiped, cash kept until the card bill) + others' spend
// (someone else bought on this category, owed back to them) + genuinely-free leftover (→ Piggy at
// wind-down). Renders nothing when there's no card-held or others'-spend (a plain cash category).
function CatBreakdown({ onCard, othersSpent, remaining }: { onCard: number; othersSpent: number; remaining: number }) {
  if (onCard <= 0.005 && othersSpent <= 0.005) return null;
  const free = Math.round((remaining - onCard - othersSpent) * 100) / 100;
  const sub = (label: string, amt: number, tone: string) => (
    <li className="flex items-center justify-between gap-2 pl-4 text-[10px]">
      <span className={`truncate ${tone}`}><span className="mr-1 text-slate-300">↳</span>{label}</span>
      <span className={`shrink-0 tabular-nums ${tone}`}>{formatINR(amt)}</span>
    </li>
  );
  return (
    <>
      {onCard > 0.005 && sub("held for the card bill · due next month", onCard, "text-fuchsia-500")}
      {othersSpent > 0.005 && sub("others' spend · owed back to them", othersSpent, "text-slate-400")}
      {Math.abs(free) > 0.005 && sub(free < 0 ? "over budget" : "free → Piggy", free, "text-slate-400")}
    </>
  );
}

// Due-date pill: red overdue · amber due-soon (≤2d) · slate for a set-but-chill date.
function DueChip({ due }: { due: { day: number; days: number; status: "overdue" | "soon" | "normal" } }) {
  if (due.status === "overdue") {
    const by = Math.abs(due.days);
    return <span className="ml-1 rounded-full bg-red-100 px-1.5 py-0.5 text-[10px] font-semibold text-red-700">overdue {by > 0 ? `${by}d` : ""} · was {ord(due.day)}</span>;
  }
  if (due.status === "soon" && due.days === 0) {
    return <span className="ml-1 rounded-full bg-red-100 px-1.5 py-0.5 text-[10px] font-semibold text-red-700">due today</span>;
  }
  if (due.status === "soon") {
    const when = due.days === 1 ? "tomorrow" : `in ${due.days}d`;
    return <span className="ml-1 rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold text-amber-700">due {when}</span>;
  }
  return <span className="ml-1 rounded-full bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-400">due {ord(due.day)}</span>;
}

function PaidToggle({ id, title, label }: { id: number; title: string; label: string }) {
  const undo = /undo/i.test(label);
  return (
    <form action={toggleBillPaid}>
      <input type="hidden" name="id" value={id} />
      <button type="submit" title={title} className={CTA_CLASS[undo ? "undo" : "tap"]}>
        <CtaLabel kind={undo ? "undo" : "tap"}>{undo ? undefined : "Pay"}</CtaLabel>
      </button>
    </form>
  );
}

// When the money for a waiting item comes — as chips ("₹767 · 5th", "₹1,679 · 20th"), plus "needs ₹X more"
// if even every planned inflow falls short. Chips wrap onto the row's second line (never truncated).
function WaitChips({ w }: { w: Waiting }) {
  if (w.arrivals.length === 0 && w.stillShort <= 0.005) return null;
  return (
    <>
      {w.arrivals.map((a, i) => (
        <Tag key={i} tone="slate">{formatINR(a.amount)} · {a.day != null ? ord(a.day) : "later"}{a.fromName ? ` · ${a.fromName}` : ""}</Tag>
      ))}
      {w.stillShort > 0.005 && <Tag tone="amber">needs {formatINR(w.stillShort)} more</Tag>}
      {w.arrivals.length === 0 && w.stillShort <= 0.005 && <Tag tone="slate">nothing incoming yet</Tag>}
    </>
  );
}
// Line-2 chips for a waiting row; undefined when there's nothing beyond the date (keeps it one line).
function waitMeta(w: Waiting): React.ReactNode | undefined {
  const inHand = Math.max(0, Math.round((w.amount - w.short) * 100) / 100);
  const has = w.dueNow || inHand > 0.005 || w.arrivals.length > 0 || w.stillShort > 0.005;
  if (!has) return <Tag tone="slate">nothing incoming yet</Tag>;
  return (
    <>
      {w.dueNow && <Tag tone="red">short {formatINR(w.short)}</Tag>}
      {!w.dueNow && inHand > 0.005 && <Tag tone="slate">{formatINR(inHand)} in hand</Tag>}
      <WaitChips w={w} />
    </>
  );
}
function waitTitle(w: Waiting): string {
  const parts = [`${formatINR(w.amount)} — ${formatINR(Math.max(0, w.amount - w.short))} free in hand now.`];
  for (const a of w.arrivals) parts.push(`${a.fromName ? `${a.fromName} sends` : a.label + ":"} ${formatINR(a.amount)}${a.day != null ? ` on the ${ord(a.day)}` : ""}.`);
  if (w.stillShort > 0.005) parts.push(`Still ${formatINR(w.stillShort)} short after everything planned to come in.`);
  return parts.join(" ");
}

// The Pay control for a queued bill — same actions as elsewhere (no new behaviour): a plain bill toggles
// paid, a misc bill opens the misc pay modal, a pool vendor leg ticks its vendor payment, a card bill
// opens the card-bill pay modal.
function QueuePay({ it, generalPiggy, pendingCardBills, categories }: { it: QueueItem; generalPiggy: number; pendingCardBills: InHand["byPerson"][number]["pendingCardBills"]; categories: { id: number; name: string }[] }) {
  if (it.cardBill) {
    const b = pendingCardBills.find((x) => x.cardId === it.cardBill!.cardId && x.cycleEndISO === it.cardBill!.cycleEndISO);
    if (!b) return null;
    return <PayCardBillModal cardId={b.cardId} cardName={b.cardName} color={b.color} cycleEndISO={b.cycleEndISO} dueISO={b.dueISO} familyBudgeted={b.familyBudgeted} familyBudgetedByMonth={b.familyBudgetedByMonth} familyMisc={b.familyMisc} personalAmount={b.personalAmount} annualFee={b.annualFee} categories={categories} />;
  }
  if (it.billId == null) return null;
  if (it.misc) return <MiscPayModal id={it.billId} name={it.label} estimate={it.amount} generalPiggy={generalPiggy} />;
  // Plain bill / pool vendor leg → ONE TAP (solid "✓ Pay") with an Undo toast.
  return <OneTapPay billId={it.billId} vendorLeg={!!it.poolVendorLeg} label={it.label} />;
}

// One-tap Pay: marks the bill paid immediately (the same toggle as before), then offers Undo for a few
// seconds — so a mis-tap is one tap to fix, without a confirm popup slowing every real payment.
function OneTapPay({ billId, vendorLeg, label }: { billId: number; vendorLeg: boolean; label: string }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const fd = () => { const f = new FormData(); f.set("id", String(billId)); if (vendorLeg) f.set("leg", "vendor"); return f; };
  const pay = async () => {
    setBusy(true);
    try {
      await toggleBillPaid(fd());
      toast(`${label} marked paid`, "success", { label: "Undo", onClick: () => { void toggleBillPaid(fd()).then(() => toast(`${label} back to unpaid`, "success")); } });
    } catch {
      toast("Couldn't mark it paid", "error");
    } finally {
      setBusy(false);
    }
  };
  return (
    <button type="button" onClick={pay} disabled={busy} title={vendorLeg ? "Mark the vendor paid — one tap (Undo follows)" : "Mark this bill paid — one tap (Undo follows)"} className={CTA_CLASS.tap}>
      <CtaLabel kind="tap">Pay</CtaLabel>
    </button>
  );
}

// ── Visual building blocks for the Bills / To receive / To send sections ─────────────────────────────
// Each section is its own tinted card (coloured rail + header chip + count/total), each row a bullet whose
// colour is its status — so the three lists read apart from each other and from the Held-for ledger above.
const TONE = {
  amber: { box: "border-amber-300 bg-amber-50/60", chip: "bg-amber-100 text-amber-800", total: "text-amber-800" },
  emerald: { box: "border-emerald-300 bg-emerald-50/60", chip: "bg-emerald-100 text-emerald-800", total: "text-emerald-700" },
  rose: { box: "border-rose-300 bg-rose-50/60", chip: "bg-rose-100 text-rose-800", total: "text-rose-700" },
} as const;

function FlowSection({ tone, icon, title, hint, total, sign = "", children }: { tone: keyof typeof TONE; icon: string; title: string; hint?: string; total: number; sign?: string; children: React.ReactNode }) {
  const t = TONE[tone];
  const count = Array.isArray(children) ? children.flat().filter(Boolean).length : 1;
  return (
    // Native <details open>: shown by default, one tap on the header folds it to a single summary line
    // (title + count + total stay visible). The chevron points down when open, right when folded.
    <details open className={`group/fs mt-2.5 rounded-lg border-l-4 px-2.5 py-2 ${t.box}`}>
      <summary className="flex cursor-pointer list-none items-center justify-between gap-2 rounded-md outline-none focus-visible:ring-2 focus-visible:ring-slate-300 [&::-webkit-details-marker]:hidden" title="Show / hide">
        <span className="flex min-w-0 items-center gap-1.5">
          <svg viewBox="0 0 20 20" className="h-3 w-3 shrink-0 -rotate-90 text-slate-400 transition-transform duration-150 group-open/fs:rotate-0" aria-hidden>
            <path fill="currentColor" d="M5.3 7.3a1 1 0 0 1 1.4 0L10 10.6l3.3-3.3a1 1 0 1 1 1.4 1.4l-4 4a1 1 0 0 1-1.4 0l-4-4a1 1 0 0 1 0-1.4z" />
          </svg>
          <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${t.chip}`}>{icon} {title}</span>
          {hint && <span className="truncate text-[10px] text-slate-400">{hint}</span>}
        </span>
        <span className={`shrink-0 text-[10px] font-semibold tabular-nums ${t.total}`}>{count} · {sign ? `${sign} ` : ""}{formatINR(Math.round(total * 100) / 100)}</span>
      </summary>
      <ul className="mt-1.5 space-y-1 text-[11px]">{children}</ul>
    </details>
  );
}

// Two lines: the name + amount (+ Pay) on top — the name may wrap, never truncate — and a wrapping line of
// chips (date, status, arrivals) underneath. Larger text so it reads easily at any age.
// `date`: a lone date chip stays on the name line; it only moves down when other chips need line 2.
function FlowRow({ dot, amount, amountTone, action, danger, title, date, meta, children }: { dot: string; amount: string; amountTone?: string; action?: React.ReactNode; danger?: boolean; title?: string; date?: React.ReactNode; meta?: React.ReactNode; children: React.ReactNode }) {
  return (
    <li className={`${danger ? "-mx-1 rounded-md bg-red-100/70 px-1 py-1" : "py-0.5"}`} title={title}>
      <div className="flex items-start justify-between gap-2">
        <span className="flex min-w-0 items-start gap-1.5">
          <span className={`mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full ${dot}`} aria-hidden />
          <span className="break-words text-[12.5px] leading-snug">{children}{date && !meta && <span className="ml-1.5 inline-block align-middle">{date}</span>}</span>
        </span>
        <span className="flex shrink-0 items-center gap-1.5">
          <span className={`text-[12.5px] tabular-nums font-semibold ${amountTone ?? (danger ? "text-red-700" : "text-slate-800")}`}>{amount}</span>
          {action}
        </span>
      </div>
      {meta && <div className="mt-0.5 flex flex-wrap gap-1 pl-3">{date}{meta}</div>}
    </li>
  );
}

const TAG = { emerald: "bg-emerald-100 text-emerald-700", teal: "bg-teal-100 text-teal-700", slate: "bg-white text-slate-600 ring-1 ring-slate-200", red: "bg-red-100 text-red-700 font-semibold", amber: "bg-amber-100 text-amber-800" } as const;
function Tag({ tone, children }: { tone: keyof typeof TAG; children: React.ReactNode }) {
  return <span className={`whitespace-nowrap rounded-full px-1.5 py-px text-[10.5px] ${TAG[tone]}`}>{children}</span>;
}
