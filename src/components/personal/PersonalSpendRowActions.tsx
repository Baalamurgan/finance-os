"use client";

import { useState } from "react";
import { RowActions } from "@/components/RowActions";
import { PersonalSpendModal } from "@/components/personal/PersonalSpendModal";
import { deletePersonalSpend } from "@/app/personal/actions";

type Cat = { id: number; name: string; icon: string | null };

export function PersonalSpendRowActions({
  periodId,
  categories,
  initial,
}: {
  periodId: number;
  categories: Cat[];
  initial: { id: number; categoryId: number; amount: number; note: string | null };
}) {
  const [editOpen, setEditOpen] = useState(false);
  return (
    <>
      <RowActions id={initial.id} deleteAction={deletePersonalSpend} onEdit={() => setEditOpen(true)} />
      <PersonalSpendModal periodId={periodId} categories={categories} initial={initial} hideTrigger controlledOpen={editOpen} onOpenChange={setEditOpen} />
    </>
  );
}
