// Small illustrated empty state: a card, a coin and a bar chart floating gently (CSS only, server-safe).
// `tone` picks the app's accent: family indigo / personal emerald. Reduced motion: it simply sits still.

const TONES = {
  family: { a: "#6366f1", b: "#a5b4fc", soft: "#eef2ff" },
  personal: { a: "#10b981", b: "#6ee7b7", soft: "#ecfdf5" },
} as const;

export function EmptyArt({ tone = "family", title, children }: { tone?: keyof typeof TONES; title: string; children?: React.ReactNode }) {
  const t = TONES[tone];
  return (
    <div className="flex flex-col items-center px-4 py-8 text-center">
      <svg viewBox="0 0 160 110" className="h-28 w-40" aria-hidden>
        <ellipse cx="80" cy="102" rx="46" ry="5" className="fill-slate-200/70" />
        {/* chart card */}
        <g className="fo-float" style={{ animationDelay: "0s" }}>
          <rect x="34" y="22" width="78" height="58" rx="10" fill={t.soft} stroke={t.b} strokeWidth="1.5" />
          <rect x="46" y="54" width="9" height="16" rx="2" fill={t.b} />
          <rect x="60" y="44" width="9" height="26" rx="2" fill={t.a} opacity="0.75" />
          <rect x="74" y="50" width="9" height="20" rx="2" fill={t.b} />
          <rect x="88" y="36" width="9" height="34" rx="2" fill={t.a} />
          <line x1="44" y1="32" x2="70" y2="32" stroke={t.b} strokeWidth="3" strokeLinecap="round" />
        </g>
        {/* coin */}
        <g className="fo-float" style={{ animationDelay: "-1.2s" }}>
          <circle cx="122" cy="34" r="13" fill="#fcd34d" stroke="#d97706" strokeWidth="2" />
          <text x="122" y="39" textAnchor="middle" fontSize="13" fontWeight="800" fill="#92400e">₹</text>
        </g>
        {/* sparkles */}
        <g className="fo-float" style={{ animationDelay: "-2s" }} fill={t.a}>
          <path d="M24 30 l2 5 l5 2 l-5 2 l-2 5 l-2 -5 l-5 -2 l5 -2 z" opacity="0.6" />
          <circle cx="134" cy="70" r="2.5" opacity="0.5" />
          <circle cx="20" cy="66" r="2" opacity="0.4" />
        </g>
      </svg>
      <h3 className="mt-3 text-base font-semibold text-slate-800">{title}</h3>
      {children && <div className="mt-1.5 max-w-sm text-sm leading-relaxed text-slate-500">{children}</div>}
    </div>
  );
}
