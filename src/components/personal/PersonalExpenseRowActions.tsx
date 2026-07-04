"use client";

import { useState } from "react";
import { RowActions } from "@/components/RowActions";
import { PersonalExpenseModal } from "@/components/personal/PersonalExpenseModal";
import { deletePersonalExpense } from "@/app/personal/actions";

type Cat = { id: number; name: string; icon: string | null };

export function PersonalExpenseRowActions({
  periodId,
  categories,
  initial,
}: {
  periodId: number;
  categories: Cat[];
  initial: { id: number; categoryId: number; amount: number; note: string | null; recurring: boolean };
}) {
  const [editOpen, setEditOpen] = useState(false);
  return (
    <>
      <RowActions id={initial.id} deleteAction={deletePersonalExpense} onEdit={() => setEditOpen(true)} />
      <PersonalExpenseModal
        periodId={periodId}
        categories={categories}
        initial={initial}
        hideTrigger
        controlledOpen={editOpen}
        onOpenChange={setEditOpen}
      />
    </>
  );
}
