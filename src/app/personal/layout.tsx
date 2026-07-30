import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = {
  title: "Personal · Finance OS",
  robots: { index: false, follow: false },
};

// The Spend/To-do dock now lives inside PersonalNav (rendered only on real app pages),
// so it never shows on the lock or onboarding screens.
export default function PersonalLayout({ children }: { children: ReactNode }) {
  // Reserve room for the mobile bottom tab bar + dock so page content never hides behind them.
  return <div className="min-h-screen bg-[#faf9f6] pb-[calc(4.25rem+env(safe-area-inset-bottom))] sm:pb-0">{children}</div>;
}
