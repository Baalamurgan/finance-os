// Shown instantly on every tab navigation (App Router Suspense fallback) while
// the server renders the page — so tapping a tab gives immediate feedback
// instead of feeling frozen. Mimics the header + content + bottom nav.
export default function Loading() {
  return (
    <div className="animate-pulse">
      {/* top bar placeholder */}
      <div className="sticky top-0 z-40 border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-7xl items-center gap-3 px-4 py-3 sm:px-6">
          <div className="space-y-1.5">
            <div className="h-4 w-28 rounded bg-slate-200" />
            <div className="h-2.5 w-20 rounded bg-slate-100" />
          </div>
          <div className="ml-auto flex items-center gap-2">
            <div className="h-8 w-16 rounded-md bg-slate-200" />
            <div className="h-8 w-16 rounded-md bg-slate-200" />
            <div className="h-8 w-8 rounded-full bg-slate-200" />
          </div>
        </div>
      </div>

      {/* content shimmer */}
      <main className="mx-auto max-w-[68rem] space-y-4 p-6">
        <div className="flex items-center justify-between">
          <div className="h-6 w-48 rounded bg-slate-200" />
          <div className="h-6 w-20 rounded-full bg-slate-100" />
        </div>
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
          {[0, 1].map((col) => (
            <div key={col} className="space-y-3 rounded-xl border border-slate-200 bg-white p-5">
              <div className="h-4 w-24 rounded bg-slate-200" />
              {[0, 1, 2, 3, 4].map((row) => (
                <div key={row} className="flex items-center justify-between">
                  <div className="h-3.5 w-40 rounded bg-slate-100" />
                  <div className="h-3.5 w-16 rounded bg-slate-100" />
                </div>
              ))}
            </div>
          ))}
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div className="h-20 rounded-xl border border-slate-200 bg-white" />
          <div className="h-20 rounded-xl border border-slate-200 bg-white" />
        </div>
      </main>

      {/* bottom nav placeholder (mobile) keeps the chrome from vanishing */}
      <div className="fixed inset-x-0 bottom-0 z-50 flex border-t border-slate-200 bg-white sm:hidden">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="flex flex-1 flex-col items-center gap-1 py-2.5">
            <div className="h-5 w-5 rounded bg-slate-200" />
            <div className="h-2.5 w-10 rounded bg-slate-100" />
          </div>
        ))}
      </div>
    </div>
  );
}
