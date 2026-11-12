"use client";

import { useRef, useState, type ReactNode } from "react";

// Phone gesture on a list row: swipe left → Delete, swipe right → Edit. It never acts on its own — it
// "taps" the row's own controls, marked data-swipe="left" (opens the usual "Delete? Yes / No" confirm)
// and data-swipe="right" (opens the Edit form). A row without those controls doesn't move. Vertical
// scrolling is untouched (touch-action: pan-y); desktop keeps its buttons.

const TRIGGER = 72;

export function SwipeRow({ children, className = "" }: { children: ReactNode; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const g = useRef<{ x0: number; y0: number; dx: number; horiz: boolean | null; left: HTMLElement | null; right: HTMLElement | null } | null>(null);
  const [dx, setDx] = useState(0);
  const [settling, setSettling] = useState(false);

  const find = (side: "left" | "right") => ref.current?.querySelector<HTMLElement>(`[data-swipe="${side}"]`) ?? null;

  const onStart = (e: React.TouchEvent) => {
    if (e.touches.length !== 1) return;
    const left = find("left"), right = find("right");
    if (!left && !right) return;
    g.current = { x0: e.touches[0].clientX, y0: e.touches[0].clientY, dx: 0, horiz: null, left, right };
    setSettling(false);
  };
  const onMove = (e: React.TouchEvent) => {
    const s = g.current;
    if (!s) return;
    const mx = e.touches[0].clientX - s.x0, my = e.touches[0].clientY - s.y0;
    if (s.horiz == null) {
      if (Math.abs(mx) < 8 && Math.abs(my) < 8) return;
      s.horiz = Math.abs(mx) > Math.abs(my) * 1.3;
    }
    if (!s.horiz) return;
    // only the directions this row has an action for; rubber-band past the trigger point
    let d = mx < 0 ? (s.left ? mx : 0) : (s.right ? mx : 0);
    if (Math.abs(d) > TRIGGER) d = Math.sign(d) * (TRIGGER + (Math.abs(d) - TRIGGER) * 0.3);
    if ((Math.abs(s.dx) < TRIGGER) !== (Math.abs(d) < TRIGGER) && Math.abs(d) >= TRIGGER) navigator.vibrate?.(8);
    s.dx = d;
    setDx(d);
  };
  const onEnd = () => {
    const s = g.current;
    g.current = null;
    if (!s) return;
    setSettling(true);
    setDx(0);
    if (s.dx <= -TRIGGER) s.left?.click();
    else if (s.dx >= TRIGGER) s.right?.click();
  };

  const armed = Math.abs(dx) >= TRIGGER;
  return (
    // fo-reveal: rows ease in as they scroll into view (pure CSS, scroll-driven)
    <div className={`fo-reveal relative overflow-hidden ${className}`}>
      {dx !== 0 && (
        <div className={`absolute inset-0 flex items-center px-4 text-xs font-semibold text-[#fff] ${dx > 0 ? "justify-start bg-indigo-500" : "justify-end bg-red-500"}`} aria-hidden>
          <span className="transition-transform duration-150" style={{ transform: `scale(${armed ? 1.15 : 0.9})` }}>
            {dx > 0 ? "✎ Edit" : "Delete 🗑"}
          </span>
        </div>
      )}
      <div
        ref={ref}
        onTouchStart={onStart}
        onTouchMove={onMove}
        onTouchEnd={onEnd}
        onTouchCancel={onEnd}
        className="relative bg-white [touch-action:pan-y]"
        style={{ transform: dx ? `translateX(${dx}px)` : undefined, transition: settling ? "transform 0.35s cubic-bezier(0.34, 1.56, 0.64, 1)" : "none" }}
      >
        {children}
      </div>
    </div>
  );
}
