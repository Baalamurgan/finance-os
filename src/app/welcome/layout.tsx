import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = {
  title: "Ledger — a calmer way to manage money",
  description:
    "One quiet place for your income, spending, debts, and plans. No clutter, no pressure — a finance app for people who didn't want another finance app.",
  openGraph: {
    title: "Ledger — a calmer way to manage money",
    description:
      "One quiet place for your income, spending, debts, and plans. No clutter, no pressure.",
    type: "website",
  },
  robots: { index: true, follow: true },
};

export default function MarketingLayout({ children }: { children: ReactNode }) {
  return (
    <div className="relative min-h-screen text-[#1c1c1a] antialiased">
      {/* full-bleed background layer so the warm paper covers the viewport
          (the app's body bg is slate-50) */}
      <div aria-hidden className="fixed inset-0 -z-10 bg-[#faf9f6]" />
      {children}
    </div>
  );
}
