"use client";

import { useState } from "react";
import { RowActions } from "@/components/RowActions";
import { IncomeModal } from "@/components/IncomeModal";
import { deleteIncome } from "@/app/actions";

type Mem = { id: number; name: string };

// Kebab (Edit / Delete) for a Sheet income row — head-only (income edit is head-only).
export function IncomeRowActions({
  members,
  periodId,
  initial,
}: {
  members: Mem[];
  periodId: number;
  initial: { id: number; source: string; amount: number; ownerId: number | null; dueDay?: number | null };
}) {
  const [editOpen, setEditOpen] = useState(false);
  return (
    <>
      <RowActions id={initial.id} deleteAction={deleteIncome} onEdit={() => setEditOpen(true)} />
      <IncomeModal
        members={members}
        periodId={periodId}
        initial={initial}
        hideTrigger
        controlledOpen={editOpen}
        onOpenChange={setEditOpen}
      />
    </>
  );
}
