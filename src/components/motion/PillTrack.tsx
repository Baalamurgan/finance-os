"use client";

import { useLayoutEffect, useRef, useState, type ReactNode } from "react";

// A highlight that GLIDES between tabs instead of blinking from one to the next. Wrap a row of tabs; mark
// each tab with data-tab and the current one with data-active="true". The highlight:
//   • jumps to a tab the moment it's tapped (before the page even starts loading), and
//   • remembers where it was per `scope`, so when the loading frame / next page mounts its own tab row, the
//     highlight starts where the last one left off and slides on — one continuous motion across pages.
// Until it has measured (server render / no JS) the active tab keeps its own solid background, so the first
// paint never shows an un-highlighted tab.

type Box = { x: number; y: number; w: number; h: number };
const last: Record<string, Box> = {};

const sameBox = (a: Box | null, b: Box | null) => !!a && !!b && a.x === b.x && a.y === b.y && a.w === b.w && a.h === b.h;

export function PillTrack({
  scope,
  className = "",
  pillClassName,
  inset = 0,
  children,
}: {
  scope: string;
  className?: string;
  pillClassName: string;
  inset?: number; // shrink the highlight inside the tab (e.g. the phone bottom bar)
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState<Box | null>(null);
  const [animate, setAnimate] = useState(false);

  const measure = (el: Element | null): Box | null => {
    const host = ref.current;
    if (!host || !(el instanceof HTMLElement)) return null;
    const hr = host.getBoundingClientRect();
    const r = el.getBoundingClientRect();
    if (r.width === 0) return null; // hidden (e.g. the desktop row on a phone)
    return { x: r.left - hr.left + inset, y: r.top - hr.top + inset, w: r.width - inset * 2, h: r.height - inset * 2 };
  };
  const activeEl = () => ref.current?.querySelector('[data-tab][data-active="true"]') ?? null;

  // Mount: start from where the previous row left its highlight, then glide to this row's active tab.
  // (Measuring the DOM before the first paint is exactly what a layout effect is for — setting state here
  // avoids a frame with the highlight in the wrong place.)
  /* eslint-disable react-hooks/set-state-in-effect */
  useLayoutEffect(() => {
    const target = measure(activeEl());
    if (!target) return;
    const from = last[scope];
    last[scope] = target;
    if (from && !sameBox(from, target)) {
      setBox(from);
      const id = requestAnimationFrame(() => requestAnimationFrame(() => { setAnimate(true); setBox(target); }));
      return () => cancelAnimationFrame(id);
    }
    setBox(target);
    const id = requestAnimationFrame(() => setAnimate(true));
    return () => cancelAnimationFrame(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  /* eslint-enable react-hooks/set-state-in-effect */

  // Keep it glued to the active tab through re-renders (active tab changed) and layout changes (resize, fonts).
  useLayoutEffect(() => {
    const host = ref.current;
    if (!host) return;
    const sync = () => {
      const t = measure(activeEl());
      if (t) { last[scope] = t; setBox((b) => (sameBox(b, t) ? b : t)); }
    };
    const ro = new ResizeObserver(sync);
    ro.observe(host);
    return () => ro.disconnect();
  });

  // A tap moves the highlight right away — the "I heard you" moment.
  const onClickCapture = (e: React.MouseEvent) => {
    if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    const tab = (e.target as Element).closest("[data-tab]");
    if (!tab || !ref.current?.contains(tab) || tab.hasAttribute("data-no-pill")) return;
    const t = measure(tab);
    if (t) { last[scope] = t; setAnimate(true); setBox(t); }
  };

  return (
    <div ref={ref} onClickCapture={onClickCapture} data-pill={box ? "on" : undefined} className={`fo-pill-track relative ${className}`}>
      {box && (
        <span
          aria-hidden
          className={`pointer-events-none absolute left-0 top-0 ${pillClassName}`}
          style={{
            width: box.w,
            height: box.h,
            transform: `translate(${box.x}px, ${box.y}px)`,
            transition: animate ? "transform 0.42s cubic-bezier(0.32, 1.25, 0.5, 1), width 0.42s cubic-bezier(0.32, 1.25, 0.5, 1), height 0.3s ease" : "none",
          }}
        />
      )}
      {children}
    </div>
  );
}
