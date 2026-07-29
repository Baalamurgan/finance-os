"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { createTask, completeTask, updateTask, deleteTask } from "@/lib/integrations/google/tasks";

async function meMemberId(): Promise<number | null> {
  const session = await auth();
  if (!session?.user) return null;
  if (session.user.memberId) return session.user.memberId;
  const email = session.user.email?.toLowerCase();
  if (!email) return null;
  const m = await prisma.member.findFirst({ where: { email }, select: { id: true } });
  return m?.id ?? null;
}

// One entry point for every to-do change, so the client (and the offline outbox replay) use
// exactly the same path. Google Tasks stays the source of truth; we persist nothing.
export type TaskMutation =
  | { op: "create"; tasklistId: string; title: string; dueISO?: string | null; notes?: string | null }
  | { op: "complete"; tasklistId: string; taskId: string }
  | { op: "update"; tasklistId: string; taskId: string; title?: string; dueISO?: string | null; notes?: string | null }
  | { op: "delete"; tasklistId: string; taskId: string };

export type TaskMutationResult = { ok: boolean; id?: string | null; error?: string };

export async function mutateTask(m: TaskMutation): Promise<TaskMutationResult> {
  const memberId = await meMemberId();
  if (!memberId) return { ok: false, error: "not signed in" };

  try {
    if (m.op === "create") {
      if (!m.title.trim()) return { ok: false, error: "empty" };
      const id = await createTask(memberId, m.tasklistId, { title: m.title.trim(), dueISO: m.dueISO ?? null, notes: m.notes ?? null });
      if (!id) return { ok: false, error: "create failed" };
      revalidatePath("/personal/today");
      return { ok: true, id };
    }
    if (m.op === "complete") {
      const ok = await completeTask(memberId, m.tasklistId, m.taskId);
      if (ok) revalidatePath("/personal/today");
      return { ok };
    }
    if (m.op === "update") {
      const ok = await updateTask(memberId, m.tasklistId, m.taskId, { title: m.title, dueISO: m.dueISO, notes: m.notes });
      if (ok) revalidatePath("/personal/today");
      return { ok };
    }
    const ok = await deleteTask(memberId, m.tasklistId, m.taskId);
    if (ok) revalidatePath("/personal/today");
    return { ok };
  } catch {
    return { ok: false, error: "error" };
  }
}
