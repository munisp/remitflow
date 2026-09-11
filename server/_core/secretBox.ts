/**
 * W9 / SPEC-wave9 Q3 — AES-256-GCM field encryption for secrets at rest.
 *
 * Key: env FIELD_ENCRYPTION_KEY — 64 hex chars or base64, decoding to 32 bytes.
 * PRODUCTION: missing/invalid key => throw (fail closed).
 * Non-production: ephemeral random key + console.warn (data won't survive restarts).
 *
 * Storage format: "v1:<ivHex>:<tagHex>:<ciphertextHex>".
 * decryptField() is dual-read: values not in v1 format are returned as-is (legacy plaintext),
 * so existing rows keep working; writers always encrypt.
 */
import crypto from "crypto";

const PREFIX = "v1";
let cachedKey: Buffer | null | undefined;

function loadKey(): Buffer | null {
  if (cachedKey !== undefined) return cachedKey;
  const raw = process.env.FIELD_ENCRYPTION_KEY?.trim();
  if (!raw) {
    if (process.env.NODE_ENV === "production") {
      throw new Error("FIELD_ENCRYPTION_KEY is required in production");
    }
    console.warn("[secretBox] FIELD_ENCRYPTION_KEY unset — using ephemeral key (non-production only)");
    cachedKey = crypto.randomBytes(32);
    return cachedKey;
  }
  let key: Buffer | null = null;
  if (/^[0-9a-fA-F]{64}$/.test(raw)) key = Buffer.from(raw, "hex");
  else {
    try {
      const b = Buffer.from(raw, "base64");
      if (b.length === 32) key = b;
    } catch { /* fall through */ }
  }
  if (!key || key.length !== 32) {
    throw new Error("FIELD_ENCRYPTION_KEY must decode to 32 bytes (64 hex chars or base64)");
  }
  cachedKey = key;
  return cachedKey;
}

export function isEncryptedField(stored: string): boolean {
  return typeof stored === "string" && stored.startsWith(PREFIX + ":");
}

export function encryptField(plaintext: string): string {
  const key = loadKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key!, iv);
  const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${PREFIX}:${iv.toString("hex")}:${tag.toString("hex")}:${ct.toString("hex")}`;
}

export function decryptField(stored: string): string {
  if (!isEncryptedField(stored)) return stored; // legacy plaintext passthrough
  const parts = stored.split(":");
  if (parts.length !== 4) throw new Error("corrupt encrypted field");
  const [, ivHex, tagHex, ctHex] = parts;
  const key = loadKey();
  const decipher = crypto.createDecipheriv("aes-256-gcm", key!, Buffer.from(ivHex, "hex"));
  decipher.setAuthTag(Buffer.from(tagHex, "hex"));
  return Buffer.concat([decipher.update(Buffer.from(ctHex, "hex")), decipher.final()]).toString("utf8");
}
