import type { AiClient } from "./client";

// Anthropic adapter (fetch-based — no SDK coupling, so the provider stays swappable). The
// key is the member's own. Kept intentionally thin; tool-calling is layered in M3b.
export function anthropicClient(apiKey: string, model: string): AiClient {
  return {
    async complete({ system, messages, maxTokens }) {
      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          model,
          max_tokens: maxTokens ?? 1024,
          ...(system ? { system } : {}),
          messages: messages.map((m) => ({ role: m.role, content: m.content })),
        }),
      });
      if (!res.ok) {
        const detail = await res.text().catch(() => "");
        throw new Error(`Anthropic ${res.status}: ${detail.slice(0, 200)}`);
      }
      const data = (await res.json()) as { content?: { type: string; text?: string }[] };
      const text = (data.content ?? []).filter((b) => b.type === "text").map((b) => b.text ?? "").join("").trim();
      return { text };
    },
  };
}
