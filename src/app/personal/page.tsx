import { redirect } from "next/navigation";

// Personal view opens on the Today dashboard (the command center). The daily spend
// screen is /personal/expenses; the monthly overview is /personal/sheet.
export default async function PersonalHome({
  searchParams,
}: {
  searchParams: Promise<{ y?: string; m?: string }>;
}) {
  const sp = await searchParams;
  const q = sp.y && sp.m ? `?y=${sp.y}&m=${sp.m}` : "";
  redirect(`/personal/today${q}`);
}
