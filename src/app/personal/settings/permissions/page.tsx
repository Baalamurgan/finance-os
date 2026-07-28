import { loadPersonal } from "@/lib/loadPersonal";
import { PersonalNav } from "@/components/personal/PersonalNav";
import { GOOGLE_INTEGRATIONS } from "@/lib/integrations/google/catalog";
import { googleConnectedScopes } from "@/lib/integrations/google/tokens";
import { googleOAuthConfigured } from "@/lib/integrations/google/oauth";
import { encryptionReady } from "@/lib/crypto";
import { disconnectGoogleIntegration, revokeGoogleAccount } from "@/app/personal/settings/actions";

const BANNERS: Record<string, { tone: "ok" | "err"; text: string }> = {
  "ok=1": { tone: "ok", text: "Connected. Google access saved securely." },
  "err=denied": { tone: "err", text: "Google consent was cancelled — nothing changed." },
  "err=state": { tone: "err", text: "That sign-in link expired. Please try connecting again." },
  "err=exchange": { tone: "err", text: "Couldn't finish connecting to Google. Please retry." },
  "err=config": { tone: "err", text: "Google sign-in isn't configured on the server yet." },
  "err=unknown": { tone: "err", text: "Unknown integration." },
};

export default async function PermissionsPage({
  searchParams,
}: {
  searchParams: Promise<{ y?: string; m?: string; ok?: string; err?: string }>;
}) {
  const sp = await searchParams;
  const c = await loadPersonal(sp);

  const connected = new Set(await googleConnectedScopes(c.member.id));
  const configReady = googleOAuthConfigured() && encryptionReady();
  const bannerKey = sp.ok ? `ok=${sp.ok}` : sp.err ? `err=${sp.err}` : null;
  const banner = bannerKey ? BANNERS[bannerKey] : null;
  const anyConnected = GOOGLE_INTEGRATIONS.some((g) => connected.has(g.scope));

  return (
    <>
      <PersonalNav active="setup" name={c.account.name} selYear={c.selYear} selMonth={c.selMonth} financeDue={c.cardReminders.length > 0} />
      <main className="mx-auto max-w-2xl space-y-5 p-4 sm:p-6">
        <div>
          <h1 className="text-xl font-bold text-slate-900">Permissions & integrations</h1>
          <p className="mt-0.5 text-sm text-slate-500">
            Connect the services your Today dashboard uses. Each is granted separately, asks for the
            least access it needs, and can be disconnected any time.
          </p>
        </div>

        {banner && (
          <div className={`rounded-lg px-4 py-3 text-sm ${banner.tone === "ok" ? "bg-emerald-50 text-emerald-800" : "bg-red-50 text-red-700"}`}>
            {banner.text}
          </div>
        )}

        {!configReady && (
          <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
            Server setup incomplete — {googleOAuthConfigured() ? "" : "Google OAuth credentials"}
            {!googleOAuthConfigured() && !encryptionReady() ? " and " : ""}
            {encryptionReady() ? "" : "the encryption key"} {" "}
            {googleOAuthConfigured() && encryptionReady() ? "" : "must be configured before connecting."}
          </div>
        )}

        <section className="overflow-hidden rounded-xl border border-slate-200 bg-white">
          <div className="border-b border-slate-100 px-4 py-2.5 text-xs font-semibold uppercase tracking-wide text-slate-400">
            Google
          </div>
          <ul className="divide-y divide-slate-100">
            {GOOGLE_INTEGRATIONS.map((g) => {
              const on = connected.has(g.scope);
              return (
                <li key={g.key} className="flex items-start gap-3 px-4 py-4">
                  <span className="mt-0.5 text-2xl leading-none">{g.icon}</span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <h3 className="font-semibold text-slate-900">{g.label}</h3>
                      {on && (
                        <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-emerald-700">
                          Connected
                        </span>
                      )}
                    </div>
                    <p className="mt-0.5 text-sm text-slate-600">{g.why}</p>
                    <p className="mt-1 text-xs text-slate-400">{g.privacy}</p>
                    <p className="mt-1 font-mono text-[10px] text-slate-300">{g.scope}</p>
                  </div>
                  <div className="shrink-0 self-center">
                    {on ? (
                      <form action={disconnectGoogleIntegration}>
                        <input type="hidden" name="key" value={g.key} />
                        <button className="rounded-md border border-slate-200 px-3 py-1.5 text-sm font-medium text-slate-600 hover:bg-slate-50">
                          Disconnect
                        </button>
                      </form>
                    ) : (
                      <a
                        href={configReady ? `/api/integrations/google/start?key=${g.key}` : undefined}
                        aria-disabled={!configReady}
                        className={`rounded-md px-3 py-1.5 text-sm font-medium text-white ${configReady ? "bg-emerald-600 hover:bg-emerald-700" : "pointer-events-none bg-slate-300"}`}
                      >
                        Connect
                      </a>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        </section>

        {anyConnected && (
          <form action={revokeGoogleAccount}>
            <button className="text-xs font-medium text-red-500 hover:text-red-700 hover:underline">
              Revoke all Google access
            </button>
          </form>
        )}

        <p className="text-xs text-slate-400">
          Reminders &amp; to-dos stay in your Google account — we don&apos;t copy them into our database.
          Disconnecting your last Google integration fully revokes access at Google.
        </p>
      </main>
    </>
  );
}
