// Shown instantly on every Personal tab switch (App Router streams this while the next page's
// server data loads), so tapping a tab feels immediate instead of "nothing happened, then it
// jumped". Mimics the chrome — a sticky top bar + a mobile bottom bar — so nothing flashes away.
export default function PersonalLoading() {
  return (
    <>
      <div className="sticky top-0 z-40 border-b border-emerald-100 bg-emerald-50/90 backdrop-blur">
        <div className="mx-auto flex max-w-3xl items-center gap-3 px-4 py-2.5 sm:px-6 sm:py-3">
          <div className="flex items-center gap-1.5 text-[15px] font-bold text-emerald-900 sm:text-base">
            <span>🔒</span> Personal
          </div>
          <div className="ml-auto flex items-center gap-1.5">
            <div className="h-7 w-14 animate-pulse rounded-md bg-emerald-100" />
            <div className="h-7 w-16 animate-pulse rounded-md bg-emerald-100" />
          </div>
        </div>
      </div>

      <main className="mx-auto max-w-2xl space-y-3 p-4 sm:p-6">
        <div className="h-28 animate-pulse rounded-2xl bg-emerald-100/60" />
        <div className="h-24 animate-pulse rounded-xl bg-slate-100" />
        <div className="h-40 animate-pulse rounded-xl bg-slate-100" />
      </main>

      <div className="fixed inset-x-0 bottom-0 z-50 flex justify-around border-t border-slate-200 bg-white/95 py-2 backdrop-blur sm:hidden" style={{ paddingBottom: "max(env(safe-area-inset-bottom), 0.5rem)" }}>
        {[0, 1, 2, 3, 4].map((i) => (
          <div key={i} className="flex flex-col items-center gap-1 py-1">
            <div className="h-5 w-5 animate-pulse rounded-full bg-slate-200" />
            <div className="h-2 w-8 animate-pulse rounded bg-slate-200" />
          </div>
        ))}
      </div>
    </>
  );
}
