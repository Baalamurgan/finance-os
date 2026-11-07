"use client";

// "Paid with" as tap tiles instead of a plain select — each a small card-like chip with the account's
// colour, an icon for its kind, and a one-line hint of where the money comes from. Grouped (e.g. "Mine" /
// "Family members' cards"). Submits through a hidden input when `name` is given.
export type PaidWithOption = { value: string; title: string; sub?: string; color?: string; type?: string; group?: string };

export const ACCOUNT_ICON: Record<string, string> = {
  credit_card: "💳", debit_card: "🏧", prepaid_card: "🎫", bank: "🏦", cash: "💵", upi: "📲",
};

export function PaidWithTiles({
  options, value, onChange, name, compact,
}: {
  options: PaidWithOption[];
  value: string;
  onChange: (v: string) => void;
  name?: string;
  compact?: boolean;
}) {
  const groups: { label: string | undefined; items: PaidWithOption[] }[] = [];
  for (const o of options) {
    const g = groups.find((x) => x.label === o.group);
    if (g) g.items.push(o);
    else groups.push({ label: o.group, items: [o] });
  }
  return (
    <div className="space-y-2">
      {name && <input type="hidden" name={name} value={value} />}
      {groups.map((g) => (
        <div key={g.label ?? "_"}>
          {g.label && <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-slate-400">{g.label}</div>}
          <div className={`grid gap-1.5 ${compact ? "grid-cols-2 sm:grid-cols-3" : "grid-cols-2"}`}>
            {g.items.map((o) => {
              const on = o.value === value;
              return (
                <button
                  key={o.value}
                  type="button"
                  onClick={() => onChange(o.value)}
                  aria-pressed={on}
                  className={`relative flex min-w-0 items-start gap-2 overflow-hidden rounded-xl border px-2.5 py-2 text-left transition ${on ? "border-emerald-400 bg-emerald-50 ring-1 ring-emerald-300" : "border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50"}`}
                >
                  <span className="absolute inset-y-0 left-0 w-1" style={{ background: o.color ?? "#cbd5e1" }} />
                  <span className="text-base leading-none">{ACCOUNT_ICON[o.type ?? ""] ?? "💰"}</span>
                  <span className="min-w-0 flex-1">
                    <span className={`block truncate text-[13px] font-medium ${on ? "text-emerald-900" : "text-slate-700"}`}>{o.title}</span>
                    {o.sub && <span className="block truncate text-[10px] text-slate-400">{o.sub}</span>}
                  </span>
                  {on && <span className="text-xs text-emerald-600">✓</span>}
                </button>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
