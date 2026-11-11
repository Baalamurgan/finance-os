"use client";

import { useSyncExternalStore } from "react";
import { usePathname } from "next/navigation";
import {
  FAMILY_MORE, FAMILY_PRIMARY, FAMILY_TABS, FAMILY_TAB_ICON,
  PERSONAL_MORE, PERSONAL_PRIMARY, tabKeyFor,
} from "@/components/navTabs";
import { useNavSkeleton } from "@/components/NavProgress";

// The loading frame for a tab switch: the SAME header and bottom bar the page has (tapped tab already
// lit), with shimmering cards where the content will land. The family header's name / Piggy / month come
// from what the real header last showed (kept on this device), so nothing on the frame jumps.

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const KEY = "fo:chrome:family";

type FamilyChrome = { name: string; piggy: string; month: number; year: number; initial: string; image: string | null };

let cachedRaw: string | null = null;
let cached: FamilyChrome | null = null;
function readChrome(): FamilyChrome | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw !== cachedRaw) { cachedRaw = raw; cached = raw ? (JSON.parse(raw) as FamilyChrome) : null; }
  } catch { /* storage blocked → plain frame */ }
  return cached;
}
const noop = () => () => {};

/** Called by the real NavHeader whenever what it shows changes. */
export function rememberFamilyChrome(c: FamilyChrome) {
  try { localStorage.setItem(KEY, JSON.stringify(c)); } catch { /* ignore */ }
}

// Screens without the app frame (sign-in, welcome, lock, onboarding) get a calm blank page instead.
const BARE = ["/signin", "/welcome", "/lock", "/personal/lock", "/personal/onboarding"];
const isBare = (p: string) => BARE.some((b) => p === b || p.startsWith(`${b}/`));
function Bare() {
  return (
    <div role="status" aria-label="Loading" className="grid min-h-[60vh] place-items-center">
      <span className="h-2.5 w-2.5 animate-ping rounded-full bg-indigo-400/70" />
    </div>
  );
}

function Bones() {
  return (
    <div className="mx-auto max-w-3xl space-y-4 p-4 sm:p-6" aria-hidden>
      <div className="shimmer-block h-7 w-44 rounded-lg dark:!bg-slate-800" />
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        {[0, 1, 2].map((i) => (
          <div key={i} className="shimmer-block h-24 rounded-2xl dark:!bg-slate-800/70" style={{ animationDelay: `${i * 80}ms` }} />
        ))}
      </div>
      <div className="shimmer-block h-40 rounded-2xl dark:!bg-slate-800/70" />
      <div className="shimmer-block h-56 rounded-2xl dark:!bg-slate-800/70" />
    </div>
  );
}

export function FamilyLoadingFrame() {
  useNavSkeleton();
  const pathname = usePathname();
  const chrome = useSyncExternalStore(noop, readChrome, () => null);
  const active = tabKeyFor(pathname, FAMILY_TABS);
  const moreActive = FAMILY_MORE.some((t) => t.key === active);
  if (isBare(pathname)) return <Bare />;
  const cell = (on: boolean) => `flex flex-1 flex-col items-center justify-center gap-0.5 py-2.5 text-xs font-medium ${on ? "text-indigo-600" : "text-slate-500"}`;
  const pill = "rounded-md border border-slate-300 bg-white px-1.5 py-1 text-[13px] text-slate-700 shadow-sm sm:px-2 sm:py-1.5 sm:text-sm";

  return (
    <div role="status" aria-label="Loading">
      <div className="sticky top-0 z-40">
        <header className="border-b border-slate-200 bg-white/90 backdrop-blur">
          <div className="mx-auto flex max-w-7xl flex-nowrap items-center gap-x-2 px-4 py-2.5 sm:gap-x-3 sm:px-6 sm:py-3">
            <div className="mr-1 min-w-0 sm:mr-2">
              {chrome ? (
                <div className="truncate text-[15px] font-bold text-slate-900 sm:text-base">{chrome.name}</div>
              ) : (
                <div className="h-5 w-28 rounded bg-slate-200 dark:bg-slate-800" />
              )}
              <div className="hidden text-[11px] text-slate-400 sm:block">Family Finance OS</div>
            </div>
            <nav className="hidden items-center gap-1 sm:flex">
              {FAMILY_PRIMARY.map((t) => (
                <span key={t.key} className={`rounded-md px-3 py-1.5 text-sm font-medium ${active === t.key ? "bg-indigo-600 text-white" : "text-slate-600"}`}>{t.label}</span>
              ))}
              <span className={`rounded-md px-3 py-1.5 text-sm font-medium ${moreActive ? "bg-indigo-600 text-white" : "text-slate-600"}`}>More ▾</span>
            </nav>
            <div className="ml-auto flex shrink-0 items-center gap-1.5 sm:gap-2">
              {chrome && <span className="hidden rounded-full bg-amber-50 px-3 py-1 text-xs font-medium text-amber-700 sm:inline">🐷 {chrome.piggy}</span>}
              {chrome && (
                <>
                  <span className={pill}>{MONTHS[chrome.month - 1]}</span>
                  <span className={pill}>{chrome.year}</span>
                </>
              )}
              <div className="border-l border-slate-200 pl-2">
                <Avatar initial={chrome?.initial} image={chrome?.image ?? null} />
              </div>
            </div>
          </div>
        </header>
      </div>
      <Bones />
      <nav className="fixed inset-x-0 bottom-0 z-50 flex border-t border-slate-200 bg-white/95 backdrop-blur sm:hidden" style={{ paddingBottom: "max(env(safe-area-inset-bottom), 0.75rem)" }}>
        {FAMILY_PRIMARY.map((t) => (
          <span key={t.key} className={cell(active === t.key)}>
            <span className="text-xl leading-none">{FAMILY_TAB_ICON[t.key] ?? "•"}</span>
            {t.label}
          </span>
        ))}
        <span className={cell(moreActive)}><span className="text-xl leading-none">⋯</span>More</span>
      </nav>
    </div>
  );
}

export function PersonalLoadingFrame() {
  useNavSkeleton();
  const pathname = usePathname();
  const tabs = [...PERSONAL_PRIMARY, ...PERSONAL_MORE];
  const active = tabKeyFor(pathname, tabs);
  const current = PERSONAL_MORE.find((t) => t.key === active);
  const chrome = useSyncExternalStore(noop, readChrome, () => null);
  if (isBare(pathname)) return <Bare />;
  const cell = (on: boolean) => `relative flex flex-1 flex-col items-center justify-center gap-0.5 py-2 text-[11px] font-medium ${on ? "text-emerald-600" : "text-slate-500"}`;

  return (
    <div role="status" aria-label="Loading">
      <header className="sticky top-0 z-40 border-b border-emerald-100 bg-emerald-50/90 backdrop-blur">
        <div className="mx-auto flex max-w-3xl flex-nowrap items-center gap-x-2 px-4 py-2.5 sm:gap-x-3 sm:px-6 sm:py-3">
          <div className="mr-1 min-w-0 sm:mr-2">
            <div className="flex items-center gap-1.5 text-[15px] font-bold text-emerald-900 sm:text-base"><span>🔒</span> Personal</div>
          </div>
          <nav className="hidden items-center gap-1 sm:flex">
            {PERSONAL_PRIMARY.map((t) => (
              <span key={t.key} className={`rounded-md px-3 py-1.5 text-sm font-medium ${active === t.key ? "bg-emerald-600 text-white" : "text-emerald-800"}`}>{t.label}</span>
            ))}
            <span className={`rounded-md px-3 py-1.5 text-sm font-medium ${current ? "bg-emerald-600 text-white" : "text-emerald-800"}`}>{current ? `${current.label} ▾` : "⋯ More"}</span>
          </nav>
          <div className="ml-auto flex items-center gap-2">
            <div className="h-7 w-24 rounded-md bg-emerald-100/80 dark:bg-slate-800" />
            <div className="border-l border-emerald-200 pl-2"><Avatar tone="personal" initial={chrome?.initial} image={chrome?.image ?? null} /></div>
          </div>
        </div>
      </header>
      <Bones />
      <nav className="fixed inset-x-0 bottom-0 z-50 flex border-t border-slate-200 bg-white/95 backdrop-blur sm:hidden" style={{ paddingBottom: "max(env(safe-area-inset-bottom), 0.5rem)" }}>
        {PERSONAL_PRIMARY.map((t) => (
          <span key={t.key} className={cell(active === t.key)}>
            <span className="text-xl leading-none">{t.icon}</span>
            {t.label}
          </span>
        ))}
        <span className={cell(!!current)}><span className="text-xl leading-none">⋯</span>More</span>
      </nav>
    </div>
  );
}

function Avatar({ initial, image, tone = "family" }: { initial?: string; image?: string | null; tone?: "family" | "personal" }) {
  return (
    <span className={`flex shrink-0 items-center gap-2 rounded-full border py-1 pl-1 pr-2 ${tone === "personal" ? "border-emerald-200 bg-white" : "border-slate-200"}`}>
      {image ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={image} alt="" referrerPolicy="no-referrer" className="h-7 w-7 shrink-0 rounded-full object-cover" />
      ) : (
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-indigo-600 text-xs font-semibold text-white">{initial ?? ""}</span>
      )}
      <svg width="14" height="14" viewBox="0 0 20 20" className="text-slate-400" aria-hidden><path fill="currentColor" d="M5 7l5 5 5-5z" /></svg>
    </span>
  );
}
