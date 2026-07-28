import { getAiConfig, getAiKey } from "./vault";
import { AI_PROVIDERS } from "./models";
import { anthropicClient } from "./anthropic";
import { openaiClient } from "./openai";

// Provider-agnostic contract. The briefing + chat logic (M3b) is written ONCE against this;
// swapping Anthropic ↔ OpenAI is just a different adapter, and the message/system shape is
// stored provider-neutral so a member's context transfers between providers unchanged.
export type AiMessage = { role: "user" | "assistant"; content: string };
export type AiCompleteInput = { system?: string; messages: AiMessage[]; maxTokens?: number };
export type AiResult = { text: string };

export interface AiClient {
  complete(input: AiCompleteInput): Promise<AiResult>;
}

export type ResolvedAi = { client: AiClient; assistantName: string; provider: string; model: string };

/** Build the member's configured AI client, or null if they haven't set a provider + key. */
export async function getAiClient(memberId: number): Promise<ResolvedAi | null> {
  const cfg = await getAiConfig(memberId);
  if (!cfg.provider || !cfg.hasKey) return null;
  const key = await getAiKey(memberId, cfg.provider);
  if (!key) return null;
  const model = cfg.model ?? AI_PROVIDERS[cfg.provider].defaultModel;
  const client = cfg.provider === "anthropic" ? anthropicClient(key, model) : openaiClient(key, model);
  return { client, assistantName: cfg.assistantName, provider: cfg.provider, model };
}
