import { describe, it, expect } from "vitest";
import { diffPlanSteps, orderSteps, cardBillTemplateId, decodeCardBillTemplateId, type ExistingStep } from "./planSteps";

const income = (id: number, over: Partial<{ source: string; amount: number; dayOfMonth: number | null; accountId: number | null }> = {}) => ({
  id, source: over.source ?? `Income ${id}`, amount: over.amount ?? 1000, dayOfMonth: over.dayOfMonth ?? 1, accountId: over.accountId ?? null,
});
const planItem = (id: number, over: Partial<{ kind: string; label: string; amount: number; dayOfMonth: number | null; fromAccountId: number | null; toAccountId: number | null; note: string | null }> = {}) => ({
  id, kind: over.kind ?? "transfer", label: over.label ?? `Move ${id}`, amount: over.amount ?? 500,
  dayOfMonth: over.dayOfMonth ?? 5, fromAccountId: over.fromAccountId ?? 1, toAccountId: over.toAccountId ?? 2, note: over.note ?? null,
});
const bill = (id: number, over: Partial<{ label: string; amount: number; dayOfMonth: number | null; fromAccountId: number | null }> = {}) => ({
  id, label: over.label ?? `Bill ${id}`, amount: over.amount ?? 1500, dayOfMonth: over.dayOfMonth ?? 1, fromAccountId: over.fromAccountId ?? null,
});

describe("diffPlanSteps", () => {
  it("creates a step for each income + plan item when none exist", () => {
    const { toCreate, prunePendingIds } = diffPlanSteps([income(10, { accountId: 7 })], [planItem(20)], [], [], null, []);
    expect(prunePendingIds).toEqual([]);
    expect(toCreate).toHaveLength(2);
    const inc = toCreate.find((s) => s.templateKind === "income")!;
    expect(inc).toMatchObject({ kind: "income", templateId: 10, toAccountId: 7, fromAccountId: null });
    const mv = toCreate.find((s) => s.templateKind === "planitem")!;
    expect(mv).toMatchObject({ kind: "transfer", templateId: 20, fromAccountId: 1, toAccountId: 2 });
  });

  it("creates expense + spend steps from pending recurring bills/spends", () => {
    const { toCreate } = diffPlanSteps([], [], [bill(30, { label: "Rent", fromAccountId: 3 })], [bill(40, { label: "Gym" })], null, []);
    expect(toCreate).toHaveLength(2);
    expect(toCreate.find((s) => s.templateKind === "expense")).toMatchObject({ kind: "expense", templateId: 30, label: "Rent", fromAccountId: 3 });
    expect(toCreate.find((s) => s.templateKind === "spend")).toMatchObject({ kind: "spend", templateId: 40, label: "Gym" });
  });

  it("creates a Salary step from base income when it names an account, skips otherwise", () => {
    const { toCreate } = diffPlanSteps([], [], [], [], { periodId: 5, amount: 50000, accountId: 9 }, []);
    expect(toCreate).toHaveLength(1);
    expect(toCreate[0]).toMatchObject({ kind: "income", templateKind: "baseincome", templateId: 5, toAccountId: 9, label: "Salary" });
    expect(diffPlanSteps([], [], [], [], { periodId: 5, amount: 50000, accountId: null }, []).toCreate).toEqual([]);
    expect(diffPlanSteps([], [], [], [], { periodId: 5, amount: 0, accountId: 9 }, []).toCreate).toEqual([]);
  });

  it("does not recreate steps that already exist for a template", () => {
    const existing: ExistingStep[] = [
      { id: 1, templateKind: "income", templateId: 10, status: "done" },
      { id: 2, templateKind: "planitem", templateId: 20, status: "pending" },
      { id: 3, templateKind: "expense", templateId: 30, status: "pending" },
      { id: 5, templateKind: "baseincome", templateId: 5, status: "done" },
    ];
    const { toCreate } = diffPlanSteps([income(10)], [planItem(20)], [bill(30)], [], { periodId: 5, amount: 50000, accountId: 9 }, existing);
    expect(toCreate).toEqual([]);
  });

  it("only creates the missing ones", () => {
    const existing: ExistingStep[] = [{ id: 2, templateKind: "planitem", templateId: 20, status: "pending" }];
    const { toCreate } = diffPlanSteps([income(10)], [planItem(20)], [], [], null, existing);
    expect(toCreate).toHaveLength(1);
    expect(toCreate[0]).toMatchObject({ templateKind: "income", templateId: 10 });
  });

  it("prunes a stale PENDING template-step whose template is gone, keeps done/skipped and one-offs", () => {
    const existing: ExistingStep[] = [
      { id: 1, templateKind: "planitem", templateId: 99, status: "pending" }, // template gone → prune
      { id: 2, templateKind: "expense", templateId: 98, status: "done" }, // gone but done → keep
      { id: 3, templateKind: "income", templateId: 97, status: "skipped" }, // gone but skipped → keep
      { id: 4, templateKind: null, templateId: null, status: "pending" }, // one-off → never pruned
      { id: 6, templateKind: "baseincome", templateId: 5, status: "pending" }, // base income account cleared → prune
    ];
    const { toCreate, prunePendingIds } = diffPlanSteps([], [], [], [], null, existing);
    expect(toCreate).toEqual([]);
    expect(prunePendingIds.sort()).toEqual([1, 6]);
  });
});

describe("orderSteps", () => {
  it("sorts by day (undated last), then sortOrder, then id", () => {
    const rows = [
      { id: 3, dayOfMonth: null, sortOrder: 0 },
      { id: 1, dayOfMonth: 5, sortOrder: 1 },
      { id: 2, dayOfMonth: 5, sortOrder: 0 },
      { id: 4, dayOfMonth: 1, sortOrder: 9 },
    ];
    expect(orderSteps(rows).map((r) => r.id)).toEqual([4, 2, 1, 3]);
  });
});

describe("orderSteps — manual position", () => {
  const st = (id: number, day: number | null, position: number | null = null, sortOrder = 0) => ({ id, dayOfMonth: day, sortOrder, position });
  it("falls back to day order when nothing has a position", () => {
    expect(orderSteps([st(1, 20), st(2, 5), st(3, null)]).map((s) => s.id)).toEqual([2, 1, 3]);
  });
  it("a manual position beats day order; unpositioned steps follow, by day", () => {
    const out = orderSteps([st(1, 1, 2), st(2, 28, 0), st(3, 5, 1), st(4, 3), st(5, 2)]);
    expect(out.map((s) => s.id)).toEqual([2, 3, 1, 5, 4]);
  });
});

describe("card-bill steps", () => {
  it("packs card + statement date into a stable id that decodes back", () => {
    const end = new Date(2026, 9, 15); // 15 Oct 2026, local midnight
    const id = cardBillTemplateId(7, end);
    const back = decodeCardBillTemplateId(id);
    expect(back.cardId).toBe(7);
    expect(back.cycleEnd.getFullYear()).toBe(2026);
    expect(back.cycleEnd.getMonth()).toBe(9);
    expect(back.cycleEnd.getDate()).toBe(15);
  });
  it("different cycles of one card get different ids", () => {
    expect(cardBillTemplateId(7, new Date(2026, 9, 15))).not.toBe(cardBillTemplateId(7, new Date(2026, 10, 15)));
  });
  it("creates one cardbill step per due cycle, once, and prunes a pending one that is no longer due", () => {
    const cb = { templateId: cardBillTemplateId(7, new Date(2026, 9, 15)), cardId: 7, label: "HDFC bill", amount: 4200, dayOfMonth: 5, dueNote: "due 5 Nov" };
    const first = diffPlanSteps([], [], [], [], null, [], [cb]);
    expect(first.toCreate).toHaveLength(1);
    expect(first.toCreate[0]).toMatchObject({ kind: "cardbill", templateKind: "cardbill", templateId: cb.templateId, amount: 4200, dayOfMonth: 5 });
    const existing: ExistingStep[] = [{ id: 9, templateKind: "cardbill", templateId: cb.templateId, status: "pending" }];
    expect(diffPlanSteps([], [], [], [], null, existing, [cb])).toEqual({ toCreate: [], prunePendingIds: [] });
    expect(diffPlanSteps([], [], [], [], null, existing, []).prunePendingIds).toEqual([9]);
  });
});
