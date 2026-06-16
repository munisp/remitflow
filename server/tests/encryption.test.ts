/**
 * Encryption at Rest Business Logic Tests
 * Tests: AES-256-GCM encrypt/decrypt, PII masking, record-level encryption
 */
import { describe, it, expect, beforeAll } from "vitest";
import {
  initEncryption,
  encryptPii,
  decryptPii,
  isEncrypted,
  maskPii,
  encryptRecord,
  decryptRecord,
} from "../lib/encryptionAtRest";

beforeAll(() => {
  // Initialize with a test key (32 bytes hex = 64 chars)
  initEncryption("0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef");
});

describe("Encryption — encryptPii / decryptPii", () => {
  it("should encrypt plaintext into enc:iv:tag:ciphertext format", () => {
    const encrypted = encryptPii("22012345678");
    expect(encrypted).toMatch(/^enc:[0-9a-f]+:[0-9a-f]+:[0-9a-f]+$/);
  });

  it("should decrypt back to original plaintext", () => {
    const original = "A12345678"; // Passport number
    const encrypted = encryptPii(original);
    const decrypted = decryptPii(encrypted);
    expect(decrypted).toBe(original);
  });

  it("should produce different ciphertexts for same input (random IV)", () => {
    const input = "22012345678";
    const enc1 = encryptPii(input);
    const enc2 = encryptPii(input);
    expect(enc1).not.toBe(enc2); // Different IVs → different ciphertext
    // But both decrypt to same plaintext
    expect(decryptPii(enc1)).toBe(input);
    expect(decryptPii(enc2)).toBe(input);
  });

  it("should return non-encrypted text as-is from decryptPii", () => {
    expect(decryptPii("plain text")).toBe("plain text");
    expect(decryptPii("no-enc-prefix")).toBe("no-enc-prefix");
  });

  it("should handle empty string", () => {
    const encrypted = encryptPii("");
    expect(decryptPii(encrypted)).toBe("");
  });

  it("should handle unicode characters", () => {
    const original = "名前: 田中太郎";
    const encrypted = encryptPii(original);
    expect(decryptPii(encrypted)).toBe(original);
  });
});

describe("Encryption — isEncrypted", () => {
  it("should detect encrypted strings", () => {
    const encrypted = encryptPii("test");
    expect(isEncrypted(encrypted)).toBe(true);
  });

  it("should reject plaintext strings", () => {
    expect(isEncrypted("hello")).toBe(false);
    expect(isEncrypted("not:encrypted:data")).toBe(false);
  });
});

describe("Encryption — maskPii", () => {
  it("should mask all but last 4 characters by default", () => {
    expect(maskPii("22012345678")).toBe("*******5678");
  });

  it("should mask encrypted values after decryption", () => {
    const encrypted = encryptPii("22012345678");
    const masked = maskPii(encrypted);
    expect(masked).toBe("*******5678");
    expect(masked).not.toContain("enc:");
  });

  it("should handle short values", () => {
    expect(maskPii("AB", 4)).toBe("**");
  });

  it("should support custom showLast parameter", () => {
    expect(maskPii("123456789", 2)).toBe("*******89");
  });
});

describe("Encryption — encryptRecord / decryptRecord", () => {
  it("should encrypt known PII fields in a record", () => {
    const record = {
      name: "John Doe",
      bvn: "22012345678",
      nin: "12345678901",
      email: "john@example.com",
    };
    const encrypted = encryptRecord(record);
    expect(isEncrypted(encrypted.bvn as string)).toBe(true);
    expect(isEncrypted(encrypted.nin as string)).toBe(true);
    expect(encrypted.name).toBe("John Doe"); // Not a PII field
    expect(encrypted.email).toBe("john@example.com"); // Not in PII_FIELDS
  });

  it("should decrypt record back to original", () => {
    const original = {
      bvn: "22012345678",
      nin: "12345678901",
      passport_number: "A12345678",
      name: "Jane",
    };
    const encrypted = encryptRecord(original);
    const decrypted = decryptRecord(encrypted);
    expect(decrypted.bvn).toBe("22012345678");
    expect(decrypted.nin).toBe("12345678901");
    expect(decrypted.passport_number).toBe("A12345678");
    expect(decrypted.name).toBe("Jane");
  });

  it("should handle records with no PII fields", () => {
    const record = { name: "Alice", role: "admin" };
    const encrypted = encryptRecord(record);
    expect(encrypted).toEqual(record);
  });
});
