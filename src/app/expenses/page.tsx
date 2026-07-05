import { formatINR } from "@/lib/format";
import { loadCommon } from "@/lib/load";
import { getTrackedExpenses, getInHand, type InHand } from "@/lib/queries";
import { NavHeader } from "@/components/NavHeader";
import { AddSpendModal } from "@/components/AddSpendModal";
import { SpendDeleteButton } from "@/components/SpendDeleteButton";

export default async function ExpensesPage({
  searchParams,
}: {
  searchParams: Promise<{ y?: string; m?: string }>;
}) {
  const sp = await searchParams;
  const c = await loadCommon(sp);
  if (!c) return null;

  const nav = (
    <NavHeader
      active="expenses"
      householdName={c.household.name}
      selYear={c.selYear}
      selMonth={c.selMonth}
      members={c.members}
      categories={c.categories}
      account={c.account}
      isHead={c.isHead}
      piggyBalance={c.piggyBalance}
      periodId={c.selected?.id ?? null}
      periodOpen={c.selected?.status === "open"}
      currentMemberId={c.currentMember?.id}
      windDownReminder={c.windDownReminder}
      canEdit={c.canEdit}
      pinEnabled={c.pinEnabled}
      hasBiometric={c.hasBiometric}
      actualIsHead={c.actualIsHead}
      viewingAsMember={c.viewingAsMember}
    />
  );

  if (c.noData || !c.selected) {
    return (
      <>
        {nav}
        <main className="mx-auto max-w-2xl p-16 text-center text-slate-500">
          No month selected. Start a month on the Sheet tab first.
        </main>
      </>
    );
  }

  const inHand = await getInHand(c.household.id, c.selected.id);
  const { cards } = await getTrackedExpenses(c.household.id, c.selected.id);
  const sinkingCards = cards.filter((card) => card.sinking); // only sinking funds are tracked now
  const open = c.selected.status === "open";

  const currentMemberId = c.currentMember?.id ?? null;
  const headMember = c.members.find((m) => m.role === "head") ?? null;
  const headGroup = inHand.byPerson.find((g) => g.memberId === headMember?.id) ?? null;
  const accountTotal = inHand.piggyTotal + (headGroup?.net ?? 0) + inHand.shared.net;
  const myGroup = inHand.byPerson.find((g) => g.memberId === currentMemberId) ?? null;
  const visibleGroups = c.isHead ? inHand.byPerson : myGroup ? [myGroup] : [];
  const showShared = c.isHead && (inHand.shared.lines.length > 0 || inHand.shared.miscSpent > 0);

  return (
    <>
      {nav}
      <main className="mx-auto max-w-5xl space-y-5 p-4 pb-28 sm:p-6">
        <div>
          <h1 className="text-xl font-bold text-slate-900">{c.selected.label} — monthly expenses</h1>
          <p className="text-sm text-slate-500">
            Everyone&apos;s monthly expenses under their name{c.isHead ? ", and what should be sitting in the account to cover them" : " — this is what should be in your hands this month"}.
          </p>
        </div>

        {/* head-only: what should be in the family bank account */}
        {c.isHead && (
          <div className="rounded-xl border border-slate-300 bg-slate-900 p-5 text-white">
            <div className="text-[11px] font-medium uppercase tracking-wide text-slate-300">
              Should be in {headMember?.name ?? "the"} account
            </div>
            <div className="mt-1 text-3xl font-extrabold tabular-nums">{formatINR(accountTotal)}</div>
            <div className="mt-1 text-xs text-slate-400">
              Piggy {formatINR(inHand.piggyTotal)} + your expenses {formatINR(headGroup?.net ?? 0)}
              {inHand.shared.net !== 0 ? ` + shared/pool ${formatINR(inHand.shared.net)}` : ""}
            </div>
          </div>
        )}

        {/* per-member monthly expenses */}
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {visibleGroups.map((g) => (
            <PersonGroup key={g.memberId ?? "shared"} group={g} isMe={g.memberId === currentMemberId} />
          ))}
          {showShared && <PersonGroup group={inHand.shared} />}
        </div>
        {!c.isHead && !myGroup && (
          <p className="rounded-xl border border-dashed border-slate-200 bg-white p-8 text-center text-sm text-slate-400">
            No monthly expenses are under your name this month.
          </p>
        )}

        {/* sinking funds (saved up in Piggy until the bill) */}
        {sinkingCards.length > 0 && (
          <section className="space-y-3">
            <div className="flex items-baseline justify-between border-t-2 border-dashed border-slate-200 pt-4">
              <h2 className="text-sm font-bold uppercase tracking-wider text-indigo-600">Sinking funds</h2>
              <span className="text-xs text-slate-400">saved monthly in Piggy until the bill · log the actual bill when paid</span>
            </div>
            <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
              {sinkingCards.map((card) => (
                <SpendCard
                  key={card.id}
                  card={card}
                  open={open}
                  periodId={c.selected!.id}
                  isHead={c.isHead}
                  members={c.members}
                  currentMemberId={currentMemberId}
                />
              ))}
            </div>
          </section>
        )}

        {!open && (
          <p className="text-center text-xs text-slate-400">This month is closed — spends are locked.</p>
        )}
      </main>
    </>
  );
}

function PersonGroup({ group, isMe }: { group: InHand["byPerson"][number] | InHand["shared"]; isMe?: boolean }) {
  const { name, lines, miscSpent, net } = group;
  return (
    <div className={`rounded-xl border p-4 ${isMe ? "border-indigo-200 bg-indigo-50/40" : "border-slate-200 bg-white"}`}>
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-sm font-semibold text-slate-800">{name}{isMe ? " (you)" : ""}</span>
        <span className={`text-right font-bold tabular-nums ${net < 0 ? "text-red-600" : "text-slate-900"}`}>
          {formatINR(net)}
          <span className="ml-1 text-[10px] font-normal text-slate-400">{net < 0 ? "to reclaim" : "to hold"}</span>
        </span>
      </div>
      <ul className="mt-2 divide-y divide-slate-100">
        {lines.map((l, i) => (
          <li key={i} className="flex items-center justify-between gap-2 py-1.5 text-xs">
            <span className="min-w-0 truncate text-slate-600">
              {l.label}
              {l.sinking && (
                <span className="ml-1.5 rounded-full bg-indigo-50 px-1.5 py-0.5 text-[9px] font-medium text-indigo-500">sinking</span>
              )}
            </span>
            <span className="shrink-0 tabular-nums text-slate-700">{formatINR(l.amount)}</span>
          </li>
        ))}
        {miscSpent > 0 && (
          <li className="flex items-center justify-between gap-2 py-1.5 text-xs">
            <span className="text-amber-600">Misc (unplanned)</span>
            <span className="tabular-nums text-red-600">− {formatINR(miscSpent)}</span>
          </li>
        )}
        {lines.length === 0 && miscSpent === 0 && <li className="py-1.5 text-xs text-slate-400">Nothing yet.</li>}
      </ul>
      {net < 0 && (
        <p className="mt-2 text-[11px] leading-tight text-amber-600">
          Fronted more than your expenses — reclaim from the treasurer, or deduct from next month.
        </p>
      )}
    </div>
  );
}

type SpendCardData = Awaited<ReturnType<typeof getTrackedExpenses>>["cards"][number];

function SpendCard({
  card,
  open,
  periodId,
  isHead,
  members,
  currentMemberId,
}: {
  card: SpendCardData;
  open: boolean;
  periodId: number;
  isHead: boolean;
  members: { id: number; name: string }[];
  currentMemberId?: number | null;
}) {
  return (
    <section className="flex flex-col rounded-xl border border-slate-200 bg-white">
      <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
        <h2 className="font-semibold text-slate-800">{card.name}</h2>
        {open && (
          <AddSpendModal
            periodId={periodId}
            trigger="card"
            fixedCategory={{ id: card.id, name: card.name }}
            isHead={isHead}
            members={members}
            currentMemberId={currentMemberId}
          />
        )}
      </div>

      <div className="px-4 pt-3">
        <div className="flex items-center justify-between text-sm">
          <span className="text-slate-500">
            Spent <b className="text-slate-800">{formatINR(card.spent)}</b>
          </span>
          <span className="text-xs font-medium text-indigo-600">
            {card.spent > card.allocation
              ? `₹${Math.round(card.spent - card.allocation).toLocaleString("en-IN")} from fund`
              : `${formatINR(card.remaining)} → fund`}
          </span>
        </div>
        <div className="mt-1 text-[11px] text-slate-400">
          Monthly share {formatINR(card.allocation)} · Fund{" "}
          <b className={card.fund < 0 ? "text-red-600" : "text-slate-600"}>{formatINR(card.fund)}</b> held — a bill over
          the share draws from the fund at month close.
        </div>
      </div>

      <div className="flex-1 divide-y divide-slate-100 overflow-y-auto px-4 py-2 sm:max-h-64">
        {card.spends.length === 0 && <p className="py-3 text-sm text-slate-400">No bill logged yet.</p>}
        {card.spends.map((s) => (
          <div key={s.id} className="flex items-center justify-between gap-2 py-2 text-sm">
            <div className="flex min-w-0 items-center gap-2">
              {s.imagePath && (
                <a href={s.imagePath} target="_blank" rel="noreferrer">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={s.imagePath} alt="receipt" className="h-9 w-9 rounded object-cover" />
                </a>
              )}
              <div className="min-w-0">
                <div className="truncate font-medium text-slate-800">{s.label}</div>
                <div className="text-[11px] text-slate-400">
                  {s.member?.name ?? "Shared"} ·{" "}
                  {new Date(s.createdAt).toLocaleDateString("en-IN", { day: "numeric", month: "short" })}
                </div>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <span className="tabular-nums text-slate-700">{formatINR(s.amount)}</span>
              {open && <SpendDeleteButton id={s.id} />}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
