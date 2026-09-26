import { prisma } from "@/lib/prisma";

// Write one ActivityLog row. Shared by family + personal actions so any money movement can be recorded
// in the household's audit trail (surfaced in /activity and, for money-movement entities, the Money Plan
// feed). Family actions have their own auth-based logActivity; this variant takes the member explicitly so
// personal actions (which resolve the member via `me()`) can log without re-deriving the session.
export async function recordActivity(p: {
  householdId: number;
  memberId?: number | null;
  memberName?: string | null;
  entity: string; // income | expense | spend | settlement | piggy | loan | cardbill …
  action: "created" | "updated" | "deleted";
  summary: string;
  periodId?: number | null;
}) {
  await prisma.activityLog.create({
    data: {
      householdId: p.householdId,
      memberId: p.memberId ?? null,
      memberName: p.memberName ?? null,
      action: p.action,
      entity: p.entity,
      summary: p.summary,
      periodId: p.periodId ?? null,
    },
  });
}
