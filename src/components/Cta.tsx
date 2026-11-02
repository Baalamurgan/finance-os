// ONE action-button system for every step / bill, in the Money Plan AND the In-Hand card:
//
//   kind "tap"    — solid green: one tap marks it done RIGHT AWAY.   "Pay" (bill) · "Sent" / "Received" (money move)
//   kind "window" — the same solid green + a "›": opens a form first (amount, source, card…).   "Pay ›"
//                   A credit-card bill is the same button in the CARD'S OWN colour (e.g. RBL violet).
//   kind "undo"   — small grey outline "Undo": reverses a done step.
//
// Every Pay is solid; only the "›" (a window follows) and a card's colour differ. Keep every pay/done control on these.
import type { ButtonHTMLAttributes, ReactNode } from "react";

export type CtaKind = "tap" | "window" | "undo";

const BASE = "inline-flex items-center gap-1 whitespace-nowrap rounded-full font-semibold transition-colors disabled:opacity-60";
export const CTA_CLASS: Record<CtaKind, string> = {
  tap: `${BASE} bg-emerald-600 px-2.5 py-0.5 text-[11px] text-white shadow-sm hover:bg-emerald-700 active:bg-emerald-800`,
  window: `${BASE} bg-emerald-600 px-2.5 py-0.5 text-[11px] text-white shadow-sm hover:bg-emerald-700 active:bg-emerald-800`,
  undo: `${BASE} border border-slate-200 bg-white px-2 py-0.5 text-[10px] font-medium text-slate-500 hover:border-slate-300 hover:text-slate-700`,
};

/** The label content for a kind: tap → "label", window → "label ›", undo → "Undo". */
export function CtaLabel({ kind, children }: { kind: CtaKind; children?: ReactNode }) {
  if (kind === "undo") return <>{children ?? "Undo"}</>;
  if (kind === "tap") return <>{children}</>;
  return <>{children}<span aria-hidden className="-mr-0.5">›</span></>;
}

/** A button in the shared style. `color` (window only) fills it with a card bill's card colour. */
export function Cta({ kind, color, children, className = "", style, type = "button", ...rest }: { kind: CtaKind; color?: string } & ButtonHTMLAttributes<HTMLButtonElement>) {
  const tint = kind === "window" && color ? { backgroundColor: color, ...style } : style;
  return (
    <button type={type} className={`${CTA_CLASS[kind]} ${className}`} style={tint} {...rest}>
      <CtaLabel kind={kind}>{children}</CtaLabel>
    </button>
  );
}
