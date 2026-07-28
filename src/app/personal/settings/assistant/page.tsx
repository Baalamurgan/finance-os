import { loadPersonal } from "@/lib/loadPersonal";
import { PersonalNav } from "@/components/personal/PersonalNav";
import { AssistantSettings } from "@/components/personal/settings/AssistantSettings";
import { getAiConfig } from "@/lib/os/ai/vault";

export default async function AssistantSettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ y?: string; m?: string }>;
}) {
  const sp = await searchParams;
  const c = await loadPersonal(sp);
  const cfg = await getAiConfig(c.member.id);

  return (
    <>
      <PersonalNav active="setup" name={c.account.name} selYear={c.selYear} selMonth={c.selMonth} financeDue={c.cardReminders.length > 0} />
      <main className="mx-auto max-w-2xl space-y-4 p-4 sm:p-6">
        <div>
          <h1 className="text-xl font-bold text-slate-900">Assistant</h1>
          <p className="mt-0.5 text-sm text-slate-500">
            Bring your own AI. Pick a provider, paste your key, and name your assistant. It only runs when you ask.
          </p>
        </div>
        <AssistantSettings initial={cfg} />
      </main>
    </>
  );
}
