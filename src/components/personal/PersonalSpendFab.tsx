"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { PersonalSpendModal } from "@/components/personal/PersonalSpendModal";

type Cat = { id: number; name: string; icon: string | null };
type Card = { id: number; name: string; color: string };

// Add-Spend modal host. Launched from the global PersonalDock (a `?add=1` deep link opens it
// via `autoOpen`); `showButton` renders the legacy draggable FAB when the dock isn't present.
export function PersonalSpendFab({
  periodId,
  categories,
  cards = [],
  remaining,
  autoOpen = false,
  showButton = true,
}: {
  periodId: number;
  categories: Cat[];
  cards?: Card[];
  remaining: number;
  autoOpen?: boolean;
  showButton?: boolean;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [side, setSide] = useState<"left" | "right">("right");
  const [open, setOpen] = useState(false);
  const [dragX, setDragX] = useState<number | null>(null);
  const start = useRef<{ x: number; moved: boolean } | null>(null);

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

  const onDown = (e: React.PointerEvent) => {
    start.current = { x: e.clientX, moved: false };
    setDragX(e.clientX);
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
  };
  const onMove = (e: React.PointerEvent) => {
    if (!start.current) return;
    if (Math.abs(e.clientX - start.current.x) > 6) start.current.moved = true;
    setDragX(e.clientX);
  };
  const onUp = (e: React.PointerEvent) => {
    if (!start.current) return;
    if (start.current.moved) {
      const snap = e.clientX < window.innerWidth / 2 ? "left" : "right";
      setSide(snap);
      try {
        localStorage.setItem("personal-fab-side", snap);
      } catch {
        /* ignore */
      }
    } else {
      setOpen(true);
    }
    start.current = null;
    setDragX(null);
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
          onPointerDown={onDown}
          onPointerMove={onMove}
          onPointerUp={onUp}
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
        remaining={remaining}
        hideTrigger
        controlledOpen={open}
        onOpenChange={handleOpenChange}
      />
    </>
  );
}
