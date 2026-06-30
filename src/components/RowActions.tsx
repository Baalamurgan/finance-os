"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

// A compact "⋯" kebab menu for a row, replacing the tiny adjacent edit/delete
// icons (too small + too close on phones). The menu is rendered in a portal so
// it isn't clipped by a parent's overflow-hidden (the Sheet's column sections).
export function RowActions({
  id,
  deleteAction,
  onEdit,
}: {
  id: number;
  deleteAction: (formData: FormData) => void;
  onEdit?: () => void; // when set, an "Edit" item is shown
}) {
  const [open, setOpen] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const close = () => {
    setOpen(false);
    setConfirming(false);
  };

  const openMenu = () => {
    const r = btnRef.current?.getBoundingClientRect();
    if (r) setPos({ top: r.bottom + 4, left: Math.max(8, r.right - 160) });
    setOpen(true);
  };

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (
        menuRef.current?.contains(e.target as Node) ||
        btnRef.current?.contains(e.target as Node)
      )
        return;
      close();
    };
    const onScroll = () => close();
    window.addEventListener("mousedown", onDown);
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onScroll);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onScroll);
    };
  }, [open]);

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        onClick={() => (open ? close() : openMenu())}
        aria-label="Actions"
        className="flex h-9 w-9 items-center justify-center rounded-lg text-lg leading-none text-slate-400 hover:bg-slate-100 hover:text-slate-700"
      >
        ⋯
      </button>

      {open &&
        pos &&
        createPortal(
          <div
            ref={menuRef}
            style={{ position: "fixed", top: pos.top, left: pos.left }}
            className="z-[60] w-40 overflow-hidden rounded-xl border border-slate-200 bg-white py-1 shadow-lg"
          >
            {onEdit && (
              <button
                type="button"
                onClick={() => {
                  onEdit();
                  close();
                }}
                className="block w-full px-4 py-3 text-left text-sm text-slate-700 hover:bg-slate-50"
              >
                Edit
              </button>
            )}

            {!confirming ? (
              <button
                type="button"
                onClick={() => setConfirming(true)}
                className="block w-full px-4 py-3 text-left text-sm font-medium text-red-600 hover:bg-red-50"
              >
                Delete
              </button>
            ) : (
              <form action={deleteAction} className="flex items-center justify-between gap-2 px-4 py-2.5">
                <input type="hidden" name="id" value={id} />
                <span className="text-xs text-slate-500">Delete?</span>
                <span className="flex gap-1.5">
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
                </span>
              </form>
            )}
          </div>,
          document.body,
        )}
    </>
  );
}
