import type { ReactNode } from "react";

/* ── Device frames ──────────────────────────────────────────────────────── */

export function PhoneFrame({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`relative w-[260px] rounded-[2.4rem] border border-black/10 bg-white p-2 shadow-[0_40px_80px_-24px_rgba(28,28,26,0.35)] ring-1 ring-black/5 ${className}`}
    >
      <div className="absolute left-1/2 top-2 z-10 h-5 w-24 -translate-x-1/2 rounded-b-2xl bg-white" />
      <div className="overflow-hidden rounded-[1.9rem] bg-[#fbfaf7]">{children}</div>
    </div>
  );
}

export function BrowserFrame({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`overflow-hidden rounded-2xl border border-black/10 bg-white shadow-[0_40px_90px_-30px_rgba(28,28,26,0.35)] ring-1 ring-black/5 ${className}`}
    >
      <div className="flex items-center gap-2 border-b border-black/5 bg-[#faf9f6] px-4 py-3">
        <span className="h-2.5 w-2.5 rounded-full bg-black/10" />
        <span className="h-2.5 w-2.5 rounded-full bg-black/10" />
        <span className="h-2.5 w-2.5 rounded-full bg-black/10" />
        <div className="mx-auto flex items-center gap-1.5 rounded-md bg-white px-3 py-1 text-[11px] text-[#8a877f] ring-1 ring-black/5">
          <LockIcon /> finance.app
        </div>
      </div>
      {children}
    </div>
  );
}

/* ── Little primitives ──────────────────────────────────────────────────── */

function LockIcon() {
  return (
    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" aria-hidden>
      <rect x="5" y="11" width="14" height="9" rx="2" fill="#c9c6bd" />
      <path d="M8 11V8a4 4 0 0 1 8 0v3" stroke="#c9c6bd" strokeWidth="2" />
    </svg>
  );
}

function ArrowUp() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path d="M12 19V5M12 5l-6 6M12 5l6 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
function ArrowDown() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path d="M12 5v14M12 19l6-6M12 19l-6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function Row({
  name,
  meta,
  amount,
  positive = false,
}: {
  name: string;
  meta: string;
  amount: string;
  positive?: boolean;
}) {
  return (
    <div className="flex items-center gap-3 py-2.5">
      <span
        className={`grid h-8 w-8 shrink-0 place-items-center rounded-full ${
          positive ? "bg-[#e8f0ea] text-[#3f6152]" : "bg-[#f1efe9] text-[#8a877f]"
        }`}
      >
        {positive ? <ArrowUp /> : <ArrowDown />}
      </span>
      <div className="min-w-0 flex-1">
        <div className="truncate text-[13px] font-medium text-[#26251f]">{name}</div>
        <div className="truncate text-[11px] text-[#9b988f]">{meta}</div>
      </div>
      <div className={`text-[13px] font-semibold tabular-nums ${positive ? "text-[#3f6152]" : "text-[#26251f]"}`}>
        {amount}
      </div>
    </div>
  );
}

/* ── Screens (recreations of the real product) ─────────────────────────── */

/** Hero screen: a calm monthly overview. */
export function OverviewScreen() {
  return (
    <div className="flex flex-col px-5 pb-6 pt-9">
      <div className="flex items-center justify-between">
        <div>
          <div className="text-[11px] font-medium uppercase tracking-wide text-[#9b988f]">June</div>
          <div className="font-display text-[15px] text-[#26251f]">Everything&apos;s on track</div>
        </div>
        <span className="rounded-full bg-[#e8f0ea] px-2.5 py-1 text-[11px] font-medium text-[#3f6152]">
          Saved ₹21,495
        </span>
      </div>

      <div className="mt-6">
        <div className="text-[11px] text-[#9b988f]">Left to spend</div>
        <div className="font-display text-[38px] leading-none text-[#1c1c1a]">₹48,200</div>
        <div className="mt-3 h-2 overflow-hidden rounded-full bg-[#eeece5]">
          <div className="h-full w-[62%] rounded-full bg-[#3f6152]" />
        </div>
      </div>

      <div className="mt-5 grid grid-cols-3 gap-2">
        {[
          ["In", "₹1,74k"],
          ["Out", "₹1,26k"],
          ["Saved", "₹21k"],
        ].map(([k, v]) => (
          <div key={k} className="rounded-xl bg-white p-2.5 ring-1 ring-black/5">
            <div className="text-[10px] text-[#9b988f]">{k}</div>
            <div className="text-[13px] font-semibold text-[#26251f]">{v}</div>
          </div>
        ))}
      </div>

      <div className="mt-5 rounded-2xl bg-white p-3 ring-1 ring-black/5">
        <div className="divide-y divide-black/5">
          <Row name="Groceries" meta="Provision" amount="− ₹2,867" />
          <Row name="Salary" meta="Income" amount="+ ₹79,000" positive />
          <Row name="Electricity" meta="Utilities" amount="− ₹1,000" />
        </div>
      </div>
    </div>
  );
}

/** Transactions list. */
export function TransactionsScreen() {
  return (
    <div className="px-6 py-6">
      <div className="flex items-baseline justify-between">
        <h4 className="font-display text-lg text-[#1c1c1a]">Transactions</h4>
        <span className="text-[12px] text-[#9b988f]">June</span>
      </div>
      <div className="mt-4 rounded-2xl bg-white p-3 ring-1 ring-black/5">
        <div className="divide-y divide-black/5">
          <Row name="Vegetables & fruits" meta="Today · Amma" amount="− ₹2,105" />
          <Row name="Rent received" meta="Yesterday · G704" amount="+ ₹16,000" positive />
          <Row name="Petrol" meta="Mon · Bala" amount="− ₹1,240" />
          <Row name="Non-veg" meta="Sun · Harish" amount="− ₹220" />
          <Row name="Salary" meta="1 Jun" amount="+ ₹79,000" positive />
        </div>
      </div>
    </div>
  );
}

/** Debts / borrowed & lending. */
export function DebtsScreen() {
  return (
    <div className="px-6 py-6">
      <h4 className="font-display text-lg text-[#1c1c1a]">Who owes whom</h4>
      <div className="mt-4 space-y-3">
        <div className="rounded-2xl bg-white p-4 ring-1 ring-black/5">
          <div className="flex items-center justify-between text-[13px]">
            <span className="text-[#26251f]">You lent Harish</span>
            <span className="font-semibold text-[#3f6152]">₹10,015</span>
          </div>
          <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-[#eeece5]">
            <div className="h-full w-[40%] rounded-full bg-[#3f6152]" />
          </div>
          <div className="mt-2 text-[11px] text-[#9b988f]">Settles at month end</div>
        </div>
        <div className="rounded-2xl bg-white p-4 ring-1 ring-black/5">
          <div className="flex items-center justify-between text-[13px]">
            <span className="text-[#26251f]">BOB home loan</span>
            <span className="font-semibold text-[#b4685a]">₹61,750</span>
          </div>
          <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-[#eeece5]">
            <div className="h-full w-[72%] rounded-full bg-[#c98f83]" />
          </div>
          <div className="mt-2 text-[11px] text-[#9b988f]">18 of 60 paid</div>
        </div>
      </div>
    </div>
  );
}

/** Income sources. */
export function IncomeScreen() {
  return (
    <div className="px-6 py-6">
      <h4 className="font-display text-lg text-[#1c1c1a]">Income</h4>
      <div className="mt-1 text-[12px] text-[#9b988f]">₹3,45,102 this month</div>
      <div className="mt-4 rounded-2xl bg-white p-3 ring-1 ring-black/5">
        <div className="divide-y divide-black/5">
          <Row name="Bala · Salary" meta="Every month" amount="₹79,000" positive />
          <Row name="Harish · Salary" meta="Every month" amount="₹79,000" positive />
          <Row name="KA · Salary" meta="Every month" amount="₹60,000" positive />
          <Row name="G704 · Rent" meta="Every month" amount="₹16,000" positive />
        </div>
      </div>
    </div>
  );
}

/** Beautiful empty state. */
export function EmptyStateScreen() {
  return (
    <div className="flex h-full min-h-[300px] flex-col items-center justify-center px-8 py-10 text-center">
      <div className="grid h-16 w-16 place-items-center rounded-full bg-[#e8f0ea]">
        <svg width="26" height="26" viewBox="0 0 24 24" fill="none" aria-hidden>
          <path d="M5 13l4 4L19 7" stroke="#3f6152" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </div>
      <h4 className="mt-5 font-display text-lg text-[#1c1c1a]">Nothing to worry about yet</h4>
      <p className="mt-2 max-w-[15rem] text-[13px] leading-relaxed text-[#9b988f]">
        When you add something, it appears here — quietly. No badges, no red numbers shouting at you.
      </p>
    </div>
  );
}
