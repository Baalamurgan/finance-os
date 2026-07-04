"use client";

import { useState } from "react";
import { RowActions } from "@/components/RowActions";
import { PersonalFixedModal } from "@/components/personal/PersonalFixedModal";
import { deletePersonalExpense } from "@/app/personal/actions";

export function PersonalFixedRowActions({
  periodId,
  initial,
}: {
  periodId: number;
  initial: { id: number; label: string; amount: number; recurring: boolean };
}) {
  const [editOpen, setEditOpen] = useState(false);
  return (
    <>
      <RowActions id={initial.id} deleteAction={deletePersonalExpense} onEdit={() => setEditOpen(true)} />
      <PersonalFixedModal periodId={periodId} initial={initial} hideTrigger controlledOpen={editOpen} onOpenChange={setEditOpen} />
    </>
  );
}
