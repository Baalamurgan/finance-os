import type { AiClient } from "./client";

// OpenAI adapter (fetch-based, Chat Completions). Same AiClient contract as Anthropic, so
// the briefing/chat logic is written once and the provider is a per-member choice.
export function openaiClient(apiKey: string, model: string): AiClient {
  return {
    async complete({ system, messages, maxTokens }) {
      const res = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
        body: JSON.stringify({
          model,
          max_tokens: maxTokens ?? 1024,
          messages: [
            ...(system ? [{ role: "system", content: system }] : []),
            ...messages.map((m) => ({ role: m.role, content: m.content })),
          ],
        }),
      });
      if (!res.ok) {
        const detail = await res.text().catch(() => "");
        throw new Error(`OpenAI ${res.status}: ${detail.slice(0, 200)}`);
      }
      const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
      return { text: (data.choices?.[0]?.message?.content ?? "").trim() };
    },
  };
}
