"use client";

import { useState } from "react";
import { RowActions } from "@/components/RowActions";
import { PersonalFixedModal } from "@/components/personal/PersonalFixedModal";
import { deletePersonalExpense } from "@/app/personal/actions";

type Cat = { id: number; name: string; icon: string | null };
type Card = { id: number; name: string; color: string };

export function PersonalFixedRowActions({
  periodId,
  categories,
  cards = [],
  initial,
}: {
  periodId: number;
  categories: Cat[];
  cards?: Card[];
  initial: { id: number; label: string; categoryId: number | null; amount: number; recurring: boolean; cardAccountId?: number | null };
}) {
  const [editOpen, setEditOpen] = useState(false);
  return (
    <>
      <RowActions id={initial.id} deleteAction={deletePersonalExpense} onEdit={() => setEditOpen(true)} />
      <PersonalFixedModal periodId={periodId} categories={categories} cards={cards} initial={initial} hideTrigger controlledOpen={editOpen} onOpenChange={setEditOpen} />
    </>
  );
}
