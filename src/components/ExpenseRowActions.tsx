"use client";

import { useState } from "react";
import { RowActions } from "@/components/RowActions";
import { ExpenseModal } from "@/components/ExpenseModal";
import { deleteExpense } from "@/app/actions";

type Cat = { id: number; name: string };
type Mem = { id: number; name: string };

// Kebab menu (Edit / Delete) for a Sheet expense row. The ExpenseModal is a
// persistent sibling controlled by this component, so closing the menu doesn't
// unmount the modal.
export function ExpenseRowActions({
  categories,
  members,
  periodId,
  initial,
  showDueDay = false,
}: {
  categories: Cat[];
  members: Mem[];
  periodId: number;
  initial: {
    id: number;
    label: string;
    amount: number;
    categoryId: number;
    memberId: number | null;
    necessary: boolean;
    dueDay?: number | null;
  };
  showDueDay?: boolean;
}) {
  const [editOpen, setEditOpen] = useState(false);
  return (
    <>
      <RowActions id={initial.id} deleteAction={deleteExpense} onEdit={() => setEditOpen(true)} />
      <ExpenseModal
        categories={categories}
        members={members}
        periodId={periodId}
        initial={initial}
        hideTrigger
        controlledOpen={editOpen}
        onOpenChange={setEditOpen}
        showDueDay={showDueDay}
      />
    </>
  );
}
