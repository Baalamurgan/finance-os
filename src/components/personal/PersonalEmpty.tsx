import { EmptyArt } from "@/components/motion/EmptyArt";

export function PersonalEmpty({ label }: { label: string }) {
  return (
    <main className="mx-auto max-w-md px-6 py-14">
      <EmptyArt tone="personal" title={`Nothing for ${label} yet`}>
        You haven&apos;t used this month. It fills in automatically once it&apos;s the current month —
        or use the month picker above to jump to a month you&apos;ve tracked.
      </EmptyArt>
    </main>
  );
}
