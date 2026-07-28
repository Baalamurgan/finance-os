"use client";

import { useActionState, useState, useTransition } from "react";
import { saveAssistantConfig, removeAssistantKey, testAiConnection, type AiConfigState } from "@/app/personal/settings/ai-actions";
import { AI_PROVIDERS, type AiProviderId } from "@/lib/os/ai/models";

type Cfg = { provider: AiProviderId | null; model: string | null; assistantName: string; hasKey: boolean };

export function AssistantSettings({ initial }: { initial: Cfg }) {
  const [provider, setProvider] = useState<AiProviderId>(initial.provider ?? "anthropic");
  const [model, setModel] = useState<string>(initial.model ?? AI_PROVIDERS[provider].defaultModel);
  const def = AI_PROVIDERS[provider];

  const [state, formAction, saving] = useActionState<AiConfigState, FormData>(saveAssistantConfig, { ok: false });
  const [test, setTest] = useState<AiConfigState | null>(null);
  const [testing, startTest] = useTransition();

  const onProvider = (p: AiProviderId) => {
    setProvider(p);
    setModel(AI_PROVIDERS[p].defaultModel);
  };

  return (
    <div className="space-y-4">
      <form action={formAction} className="space-y-4 rounded-xl border border-slate-200 bg-white p-4">
        <input type="hidden" name="provider" value={provider} />

        <div>
          <label className="text-sm font-medium text-slate-700">Assistant name</label>
          <p className="text-xs text-slate-400">What you&apos;ll call it (voice wake word later). Default: Jarvis.</p>
          <input name="assistantName" defaultValue={initial.assistantName} placeholder="Jarvis" className="input mt-1.5 w-full" />
        </div>

        <div>
          <label className="text-sm font-medium text-slate-700">AI provider</label>
          <div className="mt-1.5 grid grid-cols-2 gap-2">
            {(Object.values(AI_PROVIDERS)).map((p) => (
              <button
                type="button"
                key={p.id}
                onClick={() => onProvider(p.id)}
                className={`rounded-lg border-2 px-3 py-2.5 text-sm font-medium transition ${provider === p.id ? "border-emerald-500 bg-emerald-50 text-emerald-700" : "border-slate-200 text-slate-600"}`}
              >
                {p.label}
              </button>
            ))}
          </div>
        </div>

        <div>
          <label className="text-sm font-medium text-slate-700">Model</label>
          <select name="model" value={model} onChange={(e) => setModel(e.target.value)} className="input mt-1.5 w-full">
            {def.models.map((m) => <option key={m} value={m}>{m}</option>)}
            {!def.models.includes(model) && <option value={model}>{model} (custom)</option>}
          </select>
          <input
            placeholder="…or type a custom model id"
            onChange={(e) => e.target.value.trim() && setModel(e.target.value.trim())}
            className="input mt-1.5 w-full text-xs"
          />
        </div>

        <div>
          <label className="text-sm font-medium text-slate-700">API key</label>
          <p className="text-xs text-slate-400">
            Your own key ({def.keyHint}). Get one at{" "}
            <a href={def.keyUrl} target="_blank" rel="noopener noreferrer" className="text-emerald-700 underline">{def.keyUrl.replace("https://", "")}</a>.
            Stored encrypted; never shown again.
          </p>
          <input
            name="apiKey"
            type="password"
            autoComplete="off"
            placeholder={initial.hasKey ? "•••••••••• (saved — leave blank to keep)" : "Paste your API key"}
            className="input mt-1.5 w-full"
          />
        </div>

        <div className="flex items-center gap-3">
          <button type="submit" disabled={saving} className="rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50">
            {saving ? "Saving…" : "Save"}
          </button>
          {state.message && <span className={`text-sm ${state.ok ? "text-emerald-700" : "text-red-600"}`}>{state.message}</span>}
        </div>
      </form>

      <div className="flex flex-wrap items-center gap-3 rounded-xl border border-slate-200 bg-white p-4">
        <button
          type="button"
          disabled={testing || !initial.hasKey}
          onClick={() => startTest(async () => setTest(await testAiConnection()))}
          className="rounded-md border border-slate-200 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
        >
          {testing ? "Testing…" : "Test connection"}
        </button>
        {!initial.hasKey && <span className="text-xs text-slate-400">Save a key first.</span>}
        {test && <span className={`text-sm ${test.ok ? "text-emerald-700" : "text-red-600"}`}>{test.message}</span>}

        {initial.hasKey && initial.provider && (
          <form action={removeAssistantKey} className="ml-auto">
            <input type="hidden" name="provider" value={initial.provider} />
            <button className="text-xs font-medium text-red-500 hover:underline">Remove key</button>
          </form>
        )}
      </div>

      <p className="text-xs text-slate-400">
        The assistant is on-demand — it never runs in the background. Your key stays yours; each family member configures their own.
      </p>
    </div>
  );
}
