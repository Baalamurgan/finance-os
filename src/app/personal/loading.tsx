// Personal-side streaming skeleton (emerald chrome to match PersonalNav) — paints instantly while the
// month's data loads, instead of a blank screen on PWA open / tab switch.
export default function Loading() {
  return (
    <div className="animate-pulse">
      <div className="sticky top-0 h-12 border-b border-emerald-100 bg-emerald-50 dark:border-slate-800 dark:bg-slate-900" />
      <div className="mx-auto max-w-3xl space-y-4 p-4 sm:p-6">
        <div className="h-7 w-40 rounded bg-slate-200 dark:bg-slate-800" />
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <div className="h-24 rounded-xl bg-slate-100 dark:bg-slate-800/60" />
          <div className="h-24 rounded-xl bg-slate-100 dark:bg-slate-800/60" />
          <div className="h-24 rounded-xl bg-slate-100 dark:bg-slate-800/60" />
        </div>
        <div className="h-40 rounded-xl bg-slate-100 dark:bg-slate-800/60" />
        <div className="h-56 rounded-xl bg-slate-100 dark:bg-slate-800/60" />
      </div>
    </div>
  );
}
