"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { PersonalSpendModal } from "@/components/personal/PersonalSpendModal";

type Cat = { id: number; name: string; icon: string | null };
type Card = {
  id: number; name: string; color: string; type?: string; ownerName?: string; mine?: boolean;
  statementDay?: number | null; dueOffsetDays?: number | null;
};
type Member = { id: number; name: string };

// Add-Spend modal host. Launched from the global PersonalDock (a `?add=1` deep link opens it
// via `autoOpen`); `showButton` renders the legacy draggable FAB when the dock isn't present.
export function PersonalSpendFab({
  periodId,
  categories,
  cards = [],
  members = [],
  pastNames = [],
  remaining,
  autoOpen = false,
  showButton = true,
}: {
  periodId: number;
  categories: Cat[];
  cards?: Card[];
  members?: Member[];
  pastNames?: string[];
  remaining: number;
  autoOpen?: boolean;
  showButton?: boolean;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [side, setSide] = useState<"left" | "right">("right");
  const [open, setOpen] = useState(false);
  const [dragX, setDragX] = useState<number | null>(null);
  const start = useRef<{ x: number; y: number; moved: boolean } | null>(null);

  useEffect(() => {
    const s = localStorage.getItem("personal-fab-side");
    if (s === "left" || s === "right") setSide(s);
  }, []);

  // Deep-link open: /personal/expenses?add=1 (from the dock) opens the sheet.
  useEffect(() => {
    if (autoOpen) setOpen(true);
  }, [autoOpen]);

  // Strip the ?add flag once closed so re-tapping the dock re-triggers cleanly.
  const handleOpenChange = (v: boolean) => {
    setOpen(v);
    if (!v && autoOpen) router.replace(pathname);
  };

  // Tap = open via a real click (also works for a tap the instant the page loads); only a deliberate
  // sideways drag (≥ 24px, mostly horizontal) moves the button — a tap's natural wobble no longer
  // swallows it (the "needs two taps" bug).
  const justDragged = useRef(false);
  const onDown = (e: React.PointerEvent) => {
    start.current = { x: e.clientX, y: e.clientY, moved: false };
  };
  const onMove = (e: React.PointerEvent) => {
    const s0 = start.current;
    if (!s0) return;
    const dx = e.clientX - s0.x, dy = e.clientY - s0.y;
    if (!s0.moved && Math.abs(dx) >= 24 && Math.abs(dx) > Math.abs(dy) * 1.5) {
      s0.moved = true;
      (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
    }
    if (s0.moved) setDragX(e.clientX);
  };
  const onUp = (e: React.PointerEvent) => {
    const s0 = start.current;
    start.current = null;
    if (!s0?.moved) return;
    const snap = e.clientX < window.innerWidth / 2 ? "left" : "right";
    setSide(snap);
    try {
      localStorage.setItem("personal-fab-side", snap);
    } catch {
      /* ignore */
    }
    setDragX(null);
    justDragged.current = true; // the click after a drag must not open
    window.setTimeout(() => { justDragged.current = false; }, 0);
  };

  const pos: React.CSSProperties =
    dragX != null
      ? { left: Math.max(8, Math.min(dragX - 44, (typeof window !== "undefined" ? window.innerWidth : 400) - 96)), right: "auto" }
      : side === "left"
        ? { left: 16 }
        : { right: 16 };

  return (
    <>
      {showButton && (
        <button
          type="button"
          onClick={() => { if (!justDragged.current) setOpen(true); }}
          onPointerDown={onDown}
          onPointerMove={onMove}
          onPointerUp={onUp}
          onPointerCancel={() => { start.current = null; setDragX(null); }}
          style={{ ...pos, bottom: "calc(env(safe-area-inset-bottom) + 1.25rem)" }}
          className="fixed z-40 flex h-14 touch-none select-none items-center gap-1.5 rounded-full bg-emerald-600 px-5 text-sm font-semibold text-white shadow-lg ring-1 ring-emerald-700/20 active:scale-95"
        >
          <span className="text-lg leading-none">＋</span> Spend
        </button>
      )}
      <PersonalSpendModal
        periodId={periodId}
        categories={categories}
        cards={cards}
        members={members}
        pastNames={pastNames}
        remaining={remaining}
        hideTrigger
        controlledOpen={open}
        onOpenChange={handleOpenChange}
      />
    </>
  );
}
