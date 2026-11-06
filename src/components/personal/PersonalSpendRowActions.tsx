"use client";

import { useState } from "react";
import { RowActions } from "@/components/RowActions";
import { PersonalSpendModal } from "@/components/personal/PersonalSpendModal";
import { deletePersonalSpend } from "@/app/personal/actions";
import type { SpendCard, SpendInitial } from "@/components/personal/PersonalSpendModal";
import type { Member } from "@/components/personal/PersonalSplitModal";

type Cat = { id: number; name: string; icon: string | null };

export function PersonalSpendRowActions({
  periodId,
  categories,
  cards = [],
  members = [],
  pastNames = [],
  initial,
}: {
  periodId: number;
  categories: Cat[];
  cards?: SpendCard[];
  members?: Member[];
  pastNames?: string[];
  initial: SpendInitial;
}) {
  const [editOpen, setEditOpen] = useState(false);
  return (
    <>
      <RowActions id={initial.id} deleteAction={deletePersonalSpend} onEdit={() => setEditOpen(true)} />
      {/* mounted only while open → every edit starts from the latest saved spend + split (no stale state) */}
      {editOpen && <PersonalSpendModal periodId={periodId} categories={categories} cards={cards} members={members} pastNames={pastNames} initial={initial} hideTrigger controlledOpen={editOpen} onOpenChange={setEditOpen} />}
    </>
  );
}
