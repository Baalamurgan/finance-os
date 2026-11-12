"use client";

import { CountUp } from "@/components/motion/CountUp";
import { useChangePulse } from "@/components/motion/useChangePulse";

// An amount in a list row / card that, when it CHANGES while you're looking (an edit saved, a step ticked,
// a refresh), rolls to the new figure and glows for a moment — so you can see what just moved. On first
// render (and when you switch month/tab) it's simply there: no roll, no glow.
export function FlashAmount({ text, className = "" }: { text: string; className?: string }) {
  const pulse = useChangePulse(text, "fo-flash");
  return (
    <span className={`rounded-[4px] ${pulse} ${className}`}>
      <CountUp text={text} onlyChanges />
    </span>
  );
}
