export function PersonalEmpty({ label }: { label: string }) {
  return (
    <main className="mx-auto max-w-md px-6 py-20 text-center">
      <div className="mx-auto grid h-16 w-16 place-items-center rounded-full bg-emerald-50 text-3xl">🗓️</div>
      <h2 className="mt-5 font-display text-xl text-slate-800">Nothing for {label} yet</h2>
      <p className="mt-2 text-sm leading-relaxed text-slate-500">
        You haven&apos;t used this month. It fills in automatically once it&apos;s the current month —
        or use the month picker above to jump to a month you&apos;ve tracked.
      </p>
    </main>
  );
}
