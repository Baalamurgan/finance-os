import { redirect } from "next/navigation";

// Personal view opens on the Expenses tab by default (the daily-use screen). The
// monthly overview lives at /personal/sheet. Forward the selected month if present.
export default async function PersonalHome({
  searchParams,
}: {
  searchParams: Promise<{ y?: string; m?: string }>;
}) {
  const sp = await searchParams;
  const q = sp.y && sp.m ? `?y=${sp.y}&m=${sp.m}` : "";
  redirect(`/personal/expenses${q}`);
}
