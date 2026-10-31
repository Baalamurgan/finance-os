import { describe, it, expect } from "vitest";
import { diffPlanSteps, orderSteps, type ExistingStep } from "./planSteps";

const income = (id: number, over: Partial<{ source: string; amount: number; dayOfMonth: number | null; accountId: number | null }> = {}) => ({
  id, source: over.source ?? `Income ${id}`, amount: over.amount ?? 1000, dayOfMonth: over.dayOfMonth ?? 1, accountId: over.accountId ?? null,
});
const planItem = (id: number, over: Partial<{ kind: string; label: string; amount: number; dayOfMonth: number | null; fromAccountId: number | null; toAccountId: number | null; note: string | null }> = {}) => ({
  id, kind: over.kind ?? "transfer", label: over.label ?? `Move ${id}`, amount: over.amount ?? 500,
  dayOfMonth: over.dayOfMonth ?? 5, fromAccountId: over.fromAccountId ?? 1, toAccountId: over.toAccountId ?? 2, note: over.note ?? null,
});

describe("diffPlanSteps", () => {
  it("creates a step for each income + plan item when none exist", () => {
    const { toCreate, prunePendingIds } = diffPlanSteps([income(10, { accountId: 7 })], [planItem(20)], []);
    expect(prunePendingIds).toEqual([]);
    expect(toCreate).toHaveLength(2);
    const inc = toCreate.find((s) => s.templateKind === "income")!;
    expect(inc).toMatchObject({ kind: "income", templateId: 10, toAccountId: 7, fromAccountId: null });
    const mv = toCreate.find((s) => s.templateKind === "planitem")!;
    expect(mv).toMatchObject({ kind: "transfer", templateId: 20, fromAccountId: 1, toAccountId: 2 });
  });

  it("does not recreate steps that already exist for a template", () => {
    const existing: ExistingStep[] = [
      { id: 1, templateKind: "income", templateId: 10, status: "done" },
      { id: 2, templateKind: "planitem", templateId: 20, status: "pending" },
    ];
    const { toCreate } = diffPlanSteps([income(10)], [planItem(20)], existing);
    expect(toCreate).toEqual([]);
  });

  it("only creates the missing ones", () => {
    const existing: ExistingStep[] = [{ id: 2, templateKind: "planitem", templateId: 20, status: "pending" }];
    const { toCreate } = diffPlanSteps([income(10)], [planItem(20)], existing);
    expect(toCreate).toHaveLength(1);
    expect(toCreate[0]).toMatchObject({ templateKind: "income", templateId: 10 });
  });

  it("prunes a stale PENDING template-step whose template is gone, keeps done/skipped and one-offs", () => {
    const existing: ExistingStep[] = [
      { id: 1, templateKind: "planitem", templateId: 99, status: "pending" }, // template gone → prune
      { id: 2, templateKind: "planitem", templateId: 98, status: "done" }, // gone but done → keep
      { id: 3, templateKind: "income", templateId: 97, status: "skipped" }, // gone but skipped → keep
      { id: 4, templateKind: null, templateId: null, status: "pending" }, // one-off → never pruned
    ];
    const { toCreate, prunePendingIds } = diffPlanSteps([], [], existing);
    expect(toCreate).toEqual([]);
    expect(prunePendingIds).toEqual([1]);
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
