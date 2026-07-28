import { createCipheriv, createDecipheriv, randomBytes } from "crypto";

// AES-256-GCM encryption for secrets at rest (Google refresh tokens, AI API keys).
// The key is ENCRYPTION_KEY — 32 bytes, base64-encoded. Generate with:
//   node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
// Ciphertext format (base64): [12-byte IV][16-byte auth tag][ciphertext], so each
// value is self-describing and rotating the IV per-encrypt is automatic.

const ALGO = "aes-256-gcm";
const IV_LEN = 12; // GCM standard nonce length
const TAG_LEN = 16;

let cachedKey: Buffer | null = null;

function key(): Buffer {
  if (cachedKey) return cachedKey;
  const raw = process.env.ENCRYPTION_KEY;
  if (!raw) throw new Error("ENCRYPTION_KEY is not set — cannot encrypt/decrypt integration secrets.");
  const buf = Buffer.from(raw, "base64");
  if (buf.length !== 32) throw new Error(`ENCRYPTION_KEY must decode to 32 bytes (got ${buf.length}). Regenerate it.`);
  cachedKey = buf;
  return buf;
}

/** True when a usable ENCRYPTION_KEY is configured (lets the UI degrade gracefully). */
export function encryptionReady(): boolean {
  try {
    key();
    return true;
  } catch {
    return false;
  }
}

export function encrypt(plain: string): string {
  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv(ALGO, key(), iv);
  const enc = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, enc]).toString("base64");
}

export function decrypt(payload: string): string {
  const buf = Buffer.from(payload, "base64");
  const iv = buf.subarray(0, IV_LEN);
  const tag = buf.subarray(IV_LEN, IV_LEN + TAG_LEN);
  const enc = buf.subarray(IV_LEN + TAG_LEN);
  const decipher = createDecipheriv(ALGO, key(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(enc), decipher.final()]).toString("utf8");
}
