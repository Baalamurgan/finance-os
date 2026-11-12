"use client";

import { useState } from "react";

/** Returns a class that replays a one-shot CSS animation each time `value` changes while the component is
 *  mounted (never on first render). Alternates between `${base}-a` / `${base}-b` (identical keyframes under
 *  two names) so the browser restarts the animation without remounting anything. */
export function useChangePulse(value: unknown, base: string): string {
  const [seen, setSeen] = useState(value);
  const [n, setN] = useState(0);
  if (!Object.is(seen, value)) {
    // derived state: adjust during render (React's recommended pattern; no effect, no extra commit)
    setSeen(value);
    setN((x) => x + 1);
  }
  return n === 0 ? "" : `${base}-${n % 2 ? "a" : "b"}`;
}
