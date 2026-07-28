"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { saveAiPrefs, saveAiKey, removeAiKey } from "@/lib/os/ai/vault";
import { getAiClient } from "@/lib/os/ai/client";
import { isAiProvider } from "@/lib/os/ai/models";

async function meMemberId(): Promise<number | null> {
  const session = await auth();
  if (!session?.user) return null;
  if (session.user.memberId) return session.user.memberId;
  const email = session.user.email?.toLowerCase();
  if (!email) return null;
  const m = await prisma.member.findFirst({ where: { email }, select: { id: true } });
  return m?.id ?? null;
}

export type AiConfigState = { ok: boolean; message?: string };

// Save provider/model/assistant name, and (optionally) a new API key. The key is only
// written when a non-empty value is submitted, so re-saving prefs never wipes it.
export async function saveAssistantConfig(_prev: AiConfigState, formData: FormData): Promise<AiConfigState> {
  const memberId = await meMemberId();
  if (!memberId) return { ok: false, message: "Not signed in." };
  const provider = String(formData.get("provider"));
  if (!isAiProvider(provider)) return { ok: false, message: "Pick a provider." };

  const model = String(formData.get("model") ?? "").trim() || null;
  const assistantName = String(formData.get("assistantName") ?? "").trim() || null;
  await saveAiPrefs(memberId, { provider, model, assistantName });

  const key = String(formData.get("apiKey") ?? "").trim();
  if (key) await saveAiKey(memberId, provider, key);

  revalidatePath("/personal/settings/assistant");
  return { ok: true, message: "Saved." };
}

export async function removeAssistantKey(formData: FormData) {
  const memberId = await meMemberId();
  if (!memberId) return;
  const provider = String(formData.get("provider"));
  if (!isAiProvider(provider)) return;
  await removeAiKey(memberId, provider);
  revalidatePath("/personal/settings/assistant");
}

// Round-trips a tiny prompt through the member's configured provider to prove the key works.
export async function testAiConnection(): Promise<AiConfigState> {
  const memberId = await meMemberId();
  if (!memberId) return { ok: false, message: "Not signed in." };
  const ai = await getAiClient(memberId);
  if (!ai) return { ok: false, message: "No provider + key configured yet." };
  try {
    const res = await ai.client.complete({
      system: "You are a connection test. Reply with exactly: ok",
      messages: [{ role: "user", content: "ping" }],
      maxTokens: 16,
    });
    return { ok: true, message: `${ai.assistantName} responded via ${ai.provider} (${ai.model}): "${res.text.slice(0, 40)}"` };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message.slice(0, 180) : "Test failed." };
  }
}
