"use client";

import { useState } from "react";
import { deleteSpend } from "@/app/actions";

// Two-tap delete so a parent can't wipe an entry by accident: the ✕ first asks
// "Delete?" with explicit Yes / No before the server action runs.
export function SpendDeleteButton({ id }: { id: number }) {
  const [confirming, setConfirming] = useState(false);

  if (!confirming) {
    return (
      <button
        type="button"
        onClick={() => setConfirming(true)}
        aria-label="Delete spend"
        className="flex h-9 w-9 items-center justify-center rounded-lg text-base text-slate-300 hover:bg-red-50 hover:text-red-600"
      >
        ✕
      </button>
    );
  }

  return (
    <form action={deleteSpend} className="flex items-center gap-1">
      <input type="hidden" name="id" value={id} />
      <span className="text-xs text-slate-500">Delete?</span>
      <button
        type="submit"
        className="rounded-md bg-red-600 px-2.5 py-1 text-xs font-semibold text-white active:bg-red-700"
      >
        Yes
      </button>
      <button
        type="button"
        onClick={() => setConfirming(false)}
        className="rounded-md border border-slate-300 px-2.5 py-1 text-xs font-medium text-slate-600"
      >
        No
      </button>
    </form>
  );
}
