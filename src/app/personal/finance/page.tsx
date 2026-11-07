import { redirect } from "next/navigation";

// The old Finance tab (net worth + an unused savings pot) is replaced by the Net worth tab. Account pages under
// /personal/finance/[id] stay as they are.
export default async function FinancePage({ searchParams }: { searchParams: Promise<{ y?: string; m?: string }> }) {
  const sp = await searchParams;
  redirect(`/personal/networth${sp.y && sp.m ? `?y=${sp.y}&m=${sp.m}` : ""}`);
}
