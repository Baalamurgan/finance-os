// Provider catalog for the bring-your-own-key assistant. Each member picks a provider and
// pastes their own key; the model is a sensible default they can change (or override with a
// custom id, since providers ship new models often). Dependency-free so UI + server share it.
export type AiProviderId = "anthropic" | "openai";

export type AiProviderDef = {
  id: AiProviderId;
  label: string;
  keyUrl: string;
  keyHint: string;
  models: string[];
  defaultModel: string;
};

export const AI_PROVIDERS: Record<AiProviderId, AiProviderDef> = {
  anthropic: {
    id: "anthropic",
    label: "Anthropic (Claude)",
    keyUrl: "https://console.anthropic.com/settings/keys",
    keyHint: "starts with sk-ant-",
    models: ["claude-sonnet-5", "claude-haiku-4-5-20251001", "claude-opus-4-8"],
    defaultModel: "claude-sonnet-5",
  },
  openai: {
    id: "openai",
    label: "OpenAI (GPT)",
    keyUrl: "https://platform.openai.com/api-keys",
    keyHint: "starts with sk-",
    models: ["gpt-5", "gpt-5-mini", "gpt-4.1-mini", "gpt-4o-mini"],
    defaultModel: "gpt-5-mini",
  },
};

export const DEFAULT_ASSISTANT_NAME = "Jarvis";

export function isAiProvider(v: string | null | undefined): v is AiProviderId {
  return v === "anthropic" || v === "openai";
}
