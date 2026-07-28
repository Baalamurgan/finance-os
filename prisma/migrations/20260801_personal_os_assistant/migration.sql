-- Personal OS assistant config (per member). The API key is NOT here — it's stored
-- encrypted in Integration (provider=anthropic|openai, kind=apikey). These are just prefs.
ALTER TABLE "Member" ADD COLUMN "assistantName" TEXT;
ALTER TABLE "Member" ADD COLUMN "aiProvider" TEXT;
ALTER TABLE "Member" ADD COLUMN "aiModel" TEXT;
