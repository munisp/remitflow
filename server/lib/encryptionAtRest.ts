/**
 * Column-level encryption for PII data — P2 Security 5.10
 * Encrypts sensitive fields (BVN, NIN, passport numbers) at rest.
 */
import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "crypto";
import { logger } from "../_core/logger";

const ALGORITHM = "aes-256-gcm";
const KEY_LENGTH = 32;
const IV_LENGTH = 16;
const TAG_LENGTH = 16;

let encryptionKey: Buffer | null = null;

export function initEncryption(keyOrEnvVar?: string): void {
  const rawKey = keyOrEnvVar ?? process.env.ENCRYPTION_KEY;
  if (!rawKey) {
    logger.warn("[Encryption] ENCRYPTION_KEY not set — PII encryption disabled");
    return;
  }

  if (rawKey.length === 64) {
    encryptionKey = Buffer.from(rawKey, "hex");
  } else {
    encryptionKey = scryptSync(rawKey, "remitflow-pii-salt", KEY_LENGTH);
  }
}

export function encryptPii(plaintext: string): string {
  if (!encryptionKey) return plaintext;

  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, encryptionKey, iv);

  let encrypted = cipher.update(plaintext, "utf8", "hex");
  encrypted += cipher.final("hex");
  const tag = cipher.getAuthTag();

  return `enc:${iv.toString("hex")}:${tag.toString("hex")}:${encrypted}`;
}

export function decryptPii(ciphertext: string): string {
  if (!encryptionKey) return ciphertext;
  if (!ciphertext.startsWith("enc:")) return ciphertext;

  const parts = ciphertext.split(":");
  if (parts.length !== 4) return ciphertext;

  const iv = Buffer.from(parts[1], "hex");
  const tag = Buffer.from(parts[2], "hex");
  const encrypted = parts[3];

  const decipher = createDecipheriv(ALGORITHM, encryptionKey, iv);
  decipher.setAuthTag(tag);

  let decrypted = decipher.update(encrypted, "hex", "utf8");
  decrypted += decipher.final("utf8");

  return decrypted;
}

export function isEncrypted(value: string): boolean {
  return value.startsWith("enc:");
}

export function maskPii(value: string, showLast = 4): string {
  const plain = isEncrypted(value) ? decryptPii(value) : value;
  if (plain.length <= showLast) return "*".repeat(plain.length);
  return "*".repeat(plain.length - showLast) + plain.slice(-showLast);
}

export const PII_FIELDS = [
  "bvn",
  "nin",
  "passport_number",
  "ssn",
  "tax_id",
  "bank_account_number",
  "card_number",
  "date_of_birth",
] as const;

export function encryptRecord<T extends Record<string, unknown>>(record: T): T {
  const result = { ...record };
  for (const field of PII_FIELDS) {
    if (typeof result[field] === "string") {
      (result as Record<string, unknown>)[field] = encryptPii(result[field] as string);
    }
  }
  return result;
}

export function decryptRecord<T extends Record<string, unknown>>(record: T): T {
  const result = { ...record };
  for (const field of PII_FIELDS) {
    if (typeof result[field] === "string" && isEncrypted(result[field] as string)) {
      (result as Record<string, unknown>)[field] = decryptPii(result[field] as string);
    }
  }
  return result;
}
