import { prisma } from "@/lib/prisma";
import { Prisma } from "@prisma/client";

// ── Personal Setup templates ─────────────────────────────────────────────────────────────────────────
// Setup's recurring income / bills / spends live in PersonalTemplate — APART from any month. A new month (or
// a preview) copies the active templates into its own rows (linked by templateId). From then on the two are
// independent: editing a template only shapes months created later (the current month can opt in with
// "Apply to this month"), and editing a month's row never touches Setup.

export type TemplateKind = "income" | "expense" | "spend";
export type TemplateRow = {
  id: number; kind: string; label: string; amount: number; dayOfMonth: number;
  categoryId: number | null; cardAccountId: number | null; payAccountId: number | null; accountId: number | null; note: string | null;
};

// A template's day → a real date in (year, month), clamped to that month's length. `month` is 1-based.
export function templateDate(year: number, month: number, day: number): Date {
  return new Date(year, month - 1, Math.min(Math.max(1, day), new Date(year, month, 0).getDate()));
}

// One-time switch-over: build the member's templates from their latest real month's recurring lines (the
// way Setup used to be stored). A line edited for that month only in the Money Plan kept its ORIGINAL Setup
// values on the step's snapshot — those win, so a month-only edit doesn't become the template. Every month's
// recurring rows are linked to their template by kind + name. Idempotent (marked on the member).
export async function ensureTemplates(memberId: number): Promise<void> {
  const member = await prisma.member.findUnique({ where: { id: memberId }, select: { personalTemplatesAt: true } });
  if (!member || member.personalTemplatesAt) return;
  const latest = await prisma.personalPeriod.findFirst({ where: { memberId, status: { not: "draft" } }, orderBy: [{ year: "desc" }, { month: "desc" }], select: { id: true } });
  await prisma.$transaction(async (tx) => {
    const again = await tx.member.findUnique({ where: { id: memberId }, select: { personalTemplatesAt: true } });
    if (again?.personalTemplatesAt) return; // another request won the race
    if (latest) {
      const [incomes, expenses, spends, steps] = await Promise.all([
        tx.personalIncome.findMany({ where: { periodId: latest.id, recurring: true }, orderBy: { id: "asc" } }),
        tx.personalExpense.findMany({ where: { periodId: latest.id, recurring: true }, orderBy: { id: "asc" } }),
        tx.personalSpend.findMany({ where: { periodId: latest.id, recurring: true }, orderBy: { id: "asc" } }),
        tx.personalPlanStep.findMany({ where: { periodId: latest.id, templateKind: { in: ["income", "expense", "spend"] }, snapshot: { not: Prisma.DbNull } }, select: { templateKind: true, templateId: true, snapshot: true } }),
      ]);
      const snap = new Map<string, Record<string, unknown>>();
      for (const s of steps) if (s.snapshot && typeof s.snapshot === "object" && !Array.isArray(s.snapshot)) snap.set(`${s.templateKind}:${s.templateId}`, s.snapshot as Record<string, unknown>);
      const num = (v: unknown, d: number) => (typeof v === "number" ? v : d);
      const str = (v: unknown, d: string | null) => (typeof v === "string" ? v : d);
      const idOr = (v: unknown, d: number | null) => (typeof v === "number" ? v : v === null ? null : d);
      let order = 0;
      const make = async (kind: TemplateKind, rowId: number, data: Omit<Prisma.PersonalTemplateUncheckedCreateInput, "memberId" | "kind" | "sortOrder">) => {
        const t = await tx.personalTemplate.create({ data: { memberId, kind, sortOrder: order++, ...data } });
        if (kind === "income") await tx.personalIncome.update({ where: { id: rowId }, data: { templateId: t.id } });
        else if (kind === "expense") await tx.personalExpense.update({ where: { id: rowId }, data: { templateId: t.id } });
        else await tx.personalSpend.update({ where: { id: rowId }, data: { templateId: t.id } });
        return t;
      };
      const made: { kind: TemplateKind; id: number; label: string }[] = [];
      for (const r of incomes) {
        const o = snap.get(`income:${r.id}`) ?? {};
        const t = await make("income", r.id, { label: str(o.source, r.source) ?? r.source, amount: num(o.amount, r.amount), dayOfMonth: r.date.getDate(), accountId: idOr(o.accountId, r.accountId) });
        made.push({ kind: "income", id: t.id, label: t.label });
      }
      for (const r of expenses) {
        const o = snap.get(`expense:${r.id}`) ?? {};
        const t = await make("expense", r.id, { label: str(o.label, r.label) ?? r.label, amount: num(o.amount, r.amount), dayOfMonth: r.date.getDate(), categoryId: r.categoryId, cardAccountId: idOr(o.cardAccountId, r.cardAccountId), payAccountId: idOr(o.payAccountId, r.payAccountId), note: r.note });
        made.push({ kind: "expense", id: t.id, label: t.label });
      }
      for (const r of spends) {
        const o = snap.get(`spend:${r.id}`) ?? {};
        const t = await make("spend", r.id, { label: str(o.note, r.note) ?? r.note ?? "", amount: num(o.amount, r.amount), dayOfMonth: r.date.getDate(), categoryId: r.categoryId, cardAccountId: idOr(o.cardAccountId, r.cardAccountId), payAccountId: idOr(o.payAccountId, r.payAccountId) });
        made.push({ kind: "spend", id: t.id, label: t.label });
      }
      // Link the other months' recurring rows (a draft preview, older months) to the same template by name.
      const find = (kind: TemplateKind, label: string | null) => made.find((m) => m.kind === kind && m.label === (label ?? ""))?.id;
      const others = { where: { memberId, recurring: true, templateId: null, periodId: { not: latest.id } } };
      for (const r of await tx.personalIncome.findMany(others)) { const t = find("income", r.source); if (t) await tx.personalIncome.update({ where: { id: r.id }, data: { templateId: t } }); }
      for (const r of await tx.personalExpense.findMany(others)) { const t = find("expense", r.label); if (t) await tx.personalExpense.update({ where: { id: r.id }, data: { templateId: t } }); }
      for (const r of await tx.personalSpend.findMany(others)) { const t = find("spend", r.note); if (t) await tx.personalSpend.update({ where: { id: r.id }, data: { templateId: t } }); }
    }
    await tx.member.update({ where: { id: memberId }, data: { personalTemplatesAt: new Date() } });
  });
}

// Copy the member's ACTIVE templates into a new month's rows (each on its own day, linked by templateId).
// Bills + spends start pending (planned: paid by ticking them in the plan / Spends tab). Runs in a transaction.
export async function seedFromTemplates(tx: Prisma.TransactionClient, memberId: number, to: { id: number; year: number; month: number }) {
  const templates = await tx.personalTemplate.findMany({ where: { memberId, active: true }, orderBy: [{ sortOrder: "asc" }, { id: "asc" }] });
  for (const t of templates) {
    const date = templateDate(to.year, to.month, t.dayOfMonth);
    if (t.kind === "income") {
      await tx.personalIncome.create({ data: { memberId, periodId: to.id, source: t.label, amount: t.amount, date, recurring: true, accountId: t.accountId, templateId: t.id } });
    } else if (t.kind === "expense" && t.categoryId != null) {
      await tx.personalExpense.create({ data: { memberId, periodId: to.id, label: t.label, categoryId: t.categoryId, amount: t.amount, note: t.note, date, recurring: true, pending: true, cardAccountId: t.cardAccountId, payAccountId: t.payAccountId, templateId: t.id, holdingId: t.holdingId } });
    } else if (t.kind === "spend" && t.categoryId != null) {
      await tx.personalSpend.create({ data: { memberId, periodId: to.id, categoryId: t.categoryId, amount: t.amount, note: t.label, date, recurring: true, pending: true, cardAccountId: t.cardAccountId, payAccountId: t.payAccountId, templateId: t.id, holdingId: t.holdingId } });
    }
  }
}

// This month's copy of each template (if any) and whether it's already been paid/received — for Setup's
// "This month: …" note and the Apply button.
export type MonthCopy = { rowId: number; label: string; amount: number; day: number; payId: number | null; done: boolean };
export async function monthCopies(periodId: number): Promise<Map<number, MonthCopy>> {
  const [incomes, expenses, spends, steps] = await Promise.all([
    prisma.personalIncome.findMany({ where: { periodId, templateId: { not: null } } }),
    prisma.personalExpense.findMany({ where: { periodId, templateId: { not: null } } }),
    prisma.personalSpend.findMany({ where: { periodId, templateId: { not: null } } }),
    prisma.personalPlanStep.findMany({ where: { periodId, templateKind: { in: ["income", "expense"] }, status: "done" }, select: { templateKind: true, templateId: true } }),
  ]);
  const done = new Set(steps.map((s) => `${s.templateKind}:${s.templateId}`));
  const out = new Map<number, MonthCopy>();
  for (const r of incomes) out.set(r.templateId!, { rowId: r.id, label: r.source, amount: r.amount, day: r.date.getDate(), payId: r.accountId, done: done.has(`income:${r.id}`) });
  for (const r of expenses) out.set(r.templateId!, { rowId: r.id, label: r.label, amount: r.amount, day: r.date.getDate(), payId: r.cardAccountId ?? r.payAccountId, done: !r.pending });
  for (const r of spends) out.set(r.templateId!, { rowId: r.id, label: r.note ?? "", amount: r.amount, day: r.date.getDate(), payId: r.cardAccountId ?? r.payAccountId, done: !r.pending });
  return out;
}
