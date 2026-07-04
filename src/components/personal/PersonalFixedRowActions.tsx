"use client";

import { useState } from "react";
import { RowActions } from "@/components/RowActions";
import { PersonalFixedModal } from "@/components/personal/PersonalFixedModal";
import { deletePersonalExpense } from "@/app/personal/actions";

type Cat = { id: number; name: string; icon: string | null };

export function PersonalFixedRowActions({
  periodId,
  categories,
  initial,
}: {
  periodId: number;
  categories: Cat[];
  initial: { id: number; label: string; categoryId: number | null; amount: number; recurring: boolean };
}) {
  const [editOpen, setEditOpen] = useState(false);
  return (
    <>
      <RowActions id={initial.id} deleteAction={deletePersonalExpense} onEdit={() => setEditOpen(true)} />
      <PersonalFixedModal periodId={periodId} categories={categories} initial={initial} hideTrigger controlledOpen={editOpen} onOpenChange={setEditOpen} />
    </>
  );
}
