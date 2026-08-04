// Month-end CLOSE (wind-down) core, extracted from actions.ts so the Vercel cron can run it
// without a FormData server action or an auth session. windDownPeriod does the ACCOUNTING close:
// carry-forward, Piggy accrual, overspend->next-budget, misc/surplus/leftovers carried, status
// ->closed. It does NOT move real cash (settlement/reimbursement stay in the Money Plan). The
// interactive head/manager path is actions.ts::windDownMonth, which wraps this with canEdit +
// revalidate. The auto path is ensureMonth.ts::autoCloseElapsedMonths (cron).
import { prisma } from "@/lib/prisma";
import { generateMonth } from "@/lib/periodClone";
import { planBillMonth, isLumpDue } from "@/lib/schedule";
import { budgetShortfallReductions } from "@/lib/budgetCarry";
import { CARRY_NOTE, SURPLUS_NOTE, LEFTOVER_NOTE } from "@/lib/notes";

type Tx = Parameters<Parameters<typeof prisma.$transaction>[0]>[0];

async function clonePeriodStructure(
  tx: Tx,
  _sourceId: number,
  targetId: number,
  householdId: number
) {
  // months are now GENERATED from the RecurringItem template (not cloned from the
  // previous month); _sourceId is kept for the callers' signatures.
  await generateMonth(tx, targetId, householdId);
}

export async function applyBudgetShortfall(
  tx: Tx,
  source: { id: number; householdId: number; carryForward: number },
  targetId: number,
) {
  const [inc, exp, budgets, spends, trackedCats] = await Promise.all([
    tx.incomeEntry.aggregate({ where: { periodId: source.id }, _sum: { amount: true } }),
    tx.expenseEntry.aggregate({ where: { periodId: source.id }, _sum: { amount: true } }),
    tx.budget.findMany({ where: { periodId: source.id } }),
    tx.spend.findMany({ where: { periodId: source.id } }),
    tx.category.findMany({ where: { householdId: source.householdId, tracked: true, onHold: false, sinking: false }, select: { id: true, monthlyBudget: true } }),
  ]);
  const spentOf = (c: number) => spends.filter((s) => s.categoryId === c).reduce((t, s) => t + s.amount, 0);
  const budgetOf = (c: number) => budgets.find((b) => b.categoryId === c)?.planned ?? 0;
  const overspendByCat: Record<number, number> = {};
  for (const cat of trackedCats) {
    const b = budgetOf(cat.id);
    if (b <= 0) continue;
    const over = spentOf(cat.id) - b;
    if (over > 0.005) overspendByCat[cat.id] = over;
  }
  const surplus = source.carryForward + (inc._sum.amount ?? 0) - (exp._sum.amount ?? 0);
  const { reductionByCat } = budgetShortfallReductions({ surplus, overspendByCat });
  // Reset every tracked non-sinking target budget to template − reduction (0 for most). Resetting
  // all — not just the overspent ones — clears any stale reduction from a prior run. We update BOTH
  // the Budget.planned row (used by roll-up/in-hand) AND the generated envelope ExpenseEntry
  // (oneOff:false — the editable "Budgeted · leftover → Piggy" line the SHEET actually renders), so
  // the displayed amount drops too. Hand-added one-off lines (oneOff:true) are left untouched.
  for (const cat of trackedCats) {
    if (cat.monthlyBudget == null) continue;
    const reduced = Math.max(0, Math.round((cat.monthlyBudget - (reductionByCat[cat.id] ?? 0)) * 100) / 100);
    await tx.budget.updateMany({ where: { periodId: targetId, categoryId: cat.id }, data: { planned: reduced } });
    await tx.expenseEntry.updateMany({ where: { periodId: targetId, categoryId: cat.id, oneOff: false }, data: { amount: reduced } });
  }
}

export async function windDownPeriod(periodId: number, opts: { leftoversToIncome: boolean }) {
  const leftoversToIncome = opts.leftoversToIncome;
  const period = await prisma.period.findUnique({ where: { id: periodId } });
  if (!period || period.status !== "open") return;
  const householdId = period.householdId;

  const [incomes, expenses, budgets, spends, trackedCats, billFundCats, sinkFunds, setAsideSkips, billPays] = await Promise.all([
    prisma.incomeEntry.findMany({ where: { periodId } }),
    prisma.expenseEntry.findMany({ where: { periodId } }),
    prisma.budget.findMany({ where: { periodId } }),
    prisma.spend.findMany({ where: { periodId } }),
    prisma.category.findMany({ where: { householdId, tracked: true, onHold: false } }),
    prisma.category.findMany({ where: { householdId, onHold: false, NOT: { fundingStyle: null } } }),
    prisma.piggyEntry.groupBy({ by: ["categoryId"], where: { householdId, kind: "sinking" }, _sum: { amount: true } }),
    prisma.setAsideSkip.findMany({ where: { periodId }, select: { categoryId: true } }),
    prisma.billPayment.findMany({ where: { periodId }, select: { categoryId: true, fromSetAside: true } }),
  ]);
  const fundBalance = (catId: number) => sinkFunds.find((f) => f.categoryId === catId)?._sum.amount ?? 0;
  const skippedSetAside = new Set(setAsideSkips.map((s) => s.categoryId));
  const fromSetAsideByCat = new Map(billPays.map((b) => [b.categoryId, b.fromSetAside]));
  const paidThisPeriod = new Set(billPays.map((b) => b.categoryId));
  // What each bill-with-fund category actually set aside this month (the real Sheet lines held) —
  // the fund accrues exactly this, minus any part a due-month bill already consumed from it.
  const setAsideLineByCat = new Map<number, number>();
  for (const e of expenses) {
    if (e.categoryId != null && (e.label.endsWith("(saving)") || e.label.endsWith("(monthly share)"))) {
      setAsideLineByCat.set(e.categoryId, (setAsideLineByCat.get(e.categoryId) ?? 0) + e.amount);
    }
  }

  const income = incomes.reduce((s, i) => s + i.amount, 0);
  const expense = expenses.reduce((s, e) => s + e.amount, 0);

  const budgetOf = (catId: number) =>
    budgets.find((b) => b.categoryId === catId)?.planned ?? 0;
  const spentOf = (catId: number) =>
    spends.filter((s) => s.categoryId === catId).reduce((sum, s) => sum + s.amount, 0);

  // Over-budget on a tracked (non-sinking) envelope isn't captured in the ExpenseEntry
  // total, so it reduces what carries into next month — folded into the carried balance
  // (no separate "over-budget" line; rebuild-safe since it's not a row).
  let overspendTotal = 0;
  for (const cat of trackedCats) {
    if (cat.sinking) continue;
    const b = budgetOf(cat.id);
    if (b <= 0) continue;
    const rem = b - spentOf(cat.id);
    if (rem < 0) overspendTotal += -rem;
  }
  const carryOut = period.carryForward + income - expense - overspendTotal;

  let movedToPiggy = 0;
  let leftoverIncome = 0; // under-budget leftovers routed to next month's income (opt-in)
  // over-budget excess + misc spends are carried into NEXT month as one-off expenses
  const carryToNext: { categoryId: number; amount: number; label: string; memberId?: number | null }[] = [];

  const nextMonth = period.month === 12 ? 1 : period.month + 1;
  const nextYear = period.month === 12 ? period.year + 1 : period.year;
  const nextLabel = `${new Date(nextYear, nextMonth - 1, 1)
    .toLocaleString("en-US", { month: "short" })
    .toUpperCase()} ${nextYear}`;

  await prisma.$transaction(async (tx) => {
    for (const cat of trackedCats) {
      const budget = budgetOf(cat.id);
      const spent = spentOf(cat.id);
      if (cat.sinking && budget > 0) {
        // SINKING: always settle against its own fund. remainder = share − spent;
        // positive accrues, negative DRAWS from the fund (this month's share is
        // applied first, the fund covers the rest of the bill). Fund may go negative.
        await tx.piggyEntry.create({
          data: {
            householdId,
            periodId,
            categoryId: cat.id,
            kind: "sinking",
            amount: budget - spent,
            note: `${period.label} · ${cat.name}`,
          },
        });
      } else if (budget > 0) {
        const remainder = budget - spent;
        if (remainder >= 0) {
          if (leftoversToIncome) {
            // head chose to bring this month's leftovers into next month's spendable
            // income instead of parking them in Piggy (no piggy entry is written).
            leftoverIncome += remainder;
          } else {
            // under budget → save the leftover to the general Piggy
            await tx.piggyEntry.create({
              data: {
                householdId,
                periodId,
                categoryId: cat.id,
                kind: "piggy",
                amount: remainder,
                note: `${period.label} · ${cat.name}`,
              },
            });
            movedToPiggy += remainder;
          }
        } else {
          // over budget → already folded into carryOut above (no separate line)
        }
      } else if (spent > 0) {
        // tracked, no budget = Misc → carry EACH spend as its own line ("JUL · <spend>")
        const mon = period.label.split(" ")[0];
        for (const s of spends.filter((sp) => sp.categoryId === cat.id)) {
          carryToNext.push({
            categoryId: cat.id,
            amount: s.amount,
            label: `${mon} · ${s.label}`,
            memberId: s.memberId, // tag to the spender (display; excluded from settlement)
          });
        }
      }
    }

    // Goal-based "bill with a fund": the set-aside accrues into the fund; at the due month
    // the bill is paid from it. AUTO/fixed → accrue the actual Sheet set-aside line held this
    // month, minus any part a due-month bill already consumed from it (fromSetAside) — so a
    // consumed set-aside doesn't also pile back into the fund (the offset model; fund never
    // goes negative). PAY-IN-FULL ("none") → the due-month bill draws the fund as before.
    for (const cat of billFundCats) {
      if (cat.billAmount == null || cat.billAmount <= 0 || cat.billMonth == null || cat.billEveryMonths == null) continue;
      const consumed = fromSetAsideByCat.get(cat.id) ?? 0;
      let delta = 0;
      if (cat.fundingStyle === "none") {
        const plan = planBillMonth({
          billAmount: cat.billAmount, billMonth: cat.billMonth, everyMonths: cat.billEveryMonths,
          fund: fundBalance(cat.id), fundingStyle: "none", fixedShare: cat.monthlyBudget,
          saveEveryMonths: cat.saveEveryMonths, month: period.month,
        });
        delta = plan.kind === "bill" ? -plan.fromFund : 0;
      } else {
        const line = skippedSetAside.has(cat.id) ? 0 : setAsideLineByCat.get(cat.id) ?? 0;
        // Subscription-style ("skip"): if the bill was DUE this month and never paid, the held
        // share doesn't carry into the fund — release it to general Piggy so a monthly bill's
        // fund can't silently pile up month after month. Otherwise it accrues to the fund as
        // usual (a "carry" bill's unpaid share simply stays in the fund toward the next due).
        const dueUnpaid = isLumpDue(cat.billMonth, cat.billEveryMonths, { month: period.month }) && !paidThisPeriod.has(cat.id);
        if (cat.onUnpaid === "skip" && dueUnpaid && line > 0) {
          await tx.piggyEntry.create({
            data: { householdId, periodId, kind: "piggy", amount: Math.round(line * 100) / 100, note: `${period.label} · ${cat.name} skipped → Piggy` },
          });
          delta = 0;
        } else {
          delta = Math.round((line - consumed) * 100) / 100;
        }
      }
      if (delta !== 0) {
        await tx.piggyEntry.create({
          data: { householdId, periodId, categoryId: cat.id, kind: "sinking", amount: delta, note: `${period.label} · ${cat.name}` },
        });
      }
    }

    await tx.period.update({
      where: { id: periodId },
      data: { status: "closed", closedAt: new Date(), movedToPiggy },
    });

    const next = await tx.period.upsert({
      where: { householdId_year_month: { householdId, year: nextYear, month: nextMonth } },
      // A surplus rides as a positive carried-in balance (→ income line below); a DEFICIT is not a
      // negative opening balance anymore — it's charged to the overspent categories' budgets
      // (applyBudgetShortfall), so carryForward floors at 0.
      create: { householdId, year: nextYear, month: nextMonth, label: nextLabel, carryForward: Math.max(0, carryOut) },
      // if next month already exists as a preview draft, promote it to a real open
      // month (keeping the head's edits — hasStructure below prevents re-cloning)
      update: { carryForward: Math.max(0, carryOut), status: "open" },
    });

    // clone recurring structure into the next month if it's empty
    const hasStructure = await tx.expenseEntry.count({ where: { periodId: next.id } });
    if (hasStructure === 0) await clonePeriodStructure(tx, periodId, next.id, householdId);

    // Overspend carry: shrink next month's overspent-category budgets by the net shortfall the
    // month's surplus couldn't absorb (user-chosen model). Idempotent; supersedes any draft estimate.
    await applyBudgetShortfall(tx, { id: periodId, householdId, carryForward: period.carryForward }, next.id);

    // add the carried over-budget + misc as one-off expenses on next month's sheet
    // (oneOff so they are NOT copied forward again into later months). Replace any
    // estimate a draft already carried (CARRY_NOTE) so they aren't doubled.
    await tx.expenseEntry.deleteMany({ where: { periodId: next.id, note: CARRY_NOTE } });
    for (const c of carryToNext) {
      await tx.expenseEntry.create({
        data: {
          periodId: next.id,
          categoryId: c.categoryId,
          label: c.label,
          amount: c.amount,
          memberId: c.memberId ?? null,
          necessary: true,
          oneOff: true,
          note: CARRY_NOTE,
        },
      });
    }

    // Surplus → next month's INCOME (replaces the "carried in" opening balance).
    // Replace any estimate a draft may already carry. A deficit stays a negative
    // carryForward (a carried-in shortfall), not a negative income line.
    await tx.incomeEntry.deleteMany({ where: { periodId: next.id, note: SURPLUS_NOTE } });
    if (carryOut > 0) {
      await tx.incomeEntry.create({
        data: {
          periodId: next.id,
          source: `Last month surplus (from ${period.label})`,
          amount: Math.round(carryOut * 100) / 100,
          oneOff: true,
          note: SURPLUS_NOTE,
        },
      });
      await tx.period.update({ where: { id: next.id }, data: { carryForward: 0 } });
    }

    // Under-budget leftovers the head chose to bring forward as income (instead of Piggy).
    await tx.incomeEntry.deleteMany({ where: { periodId: next.id, note: LEFTOVER_NOTE } });
    if (leftoverIncome > 0) {
      await tx.incomeEntry.create({
        data: {
          periodId: next.id,
          source: `Last month's leftovers (from ${period.label})`,
          amount: Math.round(leftoverIncome * 100) / 100,
          oneOff: true,
          note: LEFTOVER_NOTE,
        },
      });
    }
  });
}
