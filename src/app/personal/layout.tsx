import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = {
  title: "Personal · Finance OS",
  robots: { index: false, follow: false },
};

export default function PersonalLayout({ children }: { children: ReactNode }) {
  return <div className="min-h-screen bg-[#faf9f6]">{children}</div>;
}
