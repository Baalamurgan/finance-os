// Shared helpers for the motion components.

let hydrated = false;
let flipQueued = false;

/** Call from a layout effect when a component mounts. false while the first page load hydrates (show final
 *  values straight away, no flash of the server-rendered value), true for anything mounted after that (a
 *  client navigation, a month switch, a refresh) — those are the moments worth animating. */
export function mountedLive(): boolean {
  const live = hydrated;
  if (!hydrated && !flipQueued) {
    flipQueued = true;
    setTimeout(() => { hydrated = true; }, 0);
  }
  return live;
}

export function reducedMotion(): boolean {
  return typeof window !== "undefined" && !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
}
