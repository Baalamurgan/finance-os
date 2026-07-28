import { prisma } from "@/lib/prisma";
import { encrypt, decrypt } from "@/lib/crypto";
import { AI_PROVIDERS, DEFAULT_ASSISTANT_NAME, isAiProvider, type AiProviderId } from "./models";

// Per-member assistant config + API-key vault. Prefs (provider/model/name) live on Member;
// the API key lives encrypted in Integration (provider=anthropic|openai, kind=apikey) — the
// same vault + AES-256-GCM the Google tokens use. The key is never returned to the client.

export type AiConfig = {
  provider: AiProviderId | null;
  model: string | null;
  assistantName: string;
  hasKey: boolean;
};

export async function getAiConfig(memberId: number): Promise<AiConfig> {
  const [member, keys] = await Promise.all([
    prisma.member.findUnique({ where: { id: memberId }, select: { assistantName: true, aiProvider: true, aiModel: true } }),
    prisma.integration.findMany({ where: { memberId, kind: "apikey" }, select: { provider: true } }),
  ]);
  const provider = isAiProvider(member?.aiProvider) ? member!.aiProvider : null;
  const hasKey = !!provider && keys.some((k) => k.provider === provider);
  return {
    provider,
    model: member?.aiModel ?? (provider ? AI_PROVIDERS[provider].defaultModel : null),
    assistantName: member?.assistantName?.trim() || DEFAULT_ASSISTANT_NAME,
    hasKey,
  };
}

export async function saveAiPrefs(memberId: number, prefs: { provider: AiProviderId; model?: string | null; assistantName?: string | null }): Promise<void> {
  await prisma.member.update({
    where: { id: memberId },
    data: {
      aiProvider: prefs.provider,
      aiModel: prefs.model?.trim() || AI_PROVIDERS[prefs.provider].defaultModel,
      assistantName: prefs.assistantName?.trim() || DEFAULT_ASSISTANT_NAME,
    },
  });
}

export async function saveAiKey(memberId: number, provider: AiProviderId, key: string): Promise<void> {
  const apiKeyEnc = encrypt(key.trim());
  await prisma.integration.upsert({
    where: { memberId_provider: { memberId, provider } },
    create: { memberId, provider, kind: "apikey", apiKeyEnc, status: "connected" },
    update: { kind: "apikey", apiKeyEnc, status: "connected" },
  });
}

export async function getAiKey(memberId: number, provider: AiProviderId): Promise<string | null> {
  const row = await prisma.integration.findUnique({
    where: { memberId_provider: { memberId, provider } },
    select: { apiKeyEnc: true },
  });
  return row?.apiKeyEnc ? decrypt(row.apiKeyEnc) : null;
}

export async function removeAiKey(memberId: number, provider: AiProviderId): Promise<void> {
  await prisma.integration.deleteMany({ where: { memberId, provider, kind: "apikey" } });
}
