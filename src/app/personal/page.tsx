import { redirect } from "next/navigation";

// Personal view opens on Spends (the first tab). The monthly overview is /personal/sheet.
export default async function PersonalHome({
  searchParams,
}: {
  searchParams: Promise<{ y?: string; m?: string }>;
}) {
  const sp = await searchParams;
  const q = sp.y && sp.m ? `?y=${sp.y}&m=${sp.m}` : "";
  redirect(`/personal/expenses${q}`);
}
