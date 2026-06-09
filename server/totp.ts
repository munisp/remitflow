import { randomBytes, timingSafeEqual } from "crypto";
import { createHmac } from "crypto";
import { generateSecret, generateURI } from "otplib";
import QRCode from "qrcode";

export interface TOTPResult {
  secret: string;
  otpauth: string;
}

const B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

function b32decode(s: string): Buffer {
  const str = s.toUpperCase().replace(/=+$/, "");
  const out: number[] = [];
  let bits = 0, val = 0;
  for (const ch of str) {
    const idx = B32.indexOf(ch);
    if (idx < 0) continue;
    val = (val << 5) | idx; bits += 5;
    if (bits >= 8) { out.push((val >>> (bits - 8)) & 0xff); bits -= 8; }
  }
  return Buffer.from(out);
}

function hotp(secret: string, counter: number): string {
  const key = b32decode(secret);
  const buf = Buffer.alloc(8);
  buf.writeBigInt64BE(BigInt(counter));
  const hmac = createHmac("sha1", key).update(buf).digest();
  const offset = hmac[hmac.length - 1] & 0xf;
  const code = ((hmac[offset] & 0x7f) << 24) | ((hmac[offset+1] & 0xff) << 16) |
               ((hmac[offset+2] & 0xff) << 8) | (hmac[offset+3] & 0xff);
  return String(code % 1_000_000).padStart(6, "0");
}

export function generateTOTPSecret(email: string): TOTPResult {
  const secret = generateSecret({ length: 20 });
  const otpauth = `otpauth://totp/RemitFlow:${encodeURIComponent(email)}?secret=${secret}&issuer=RemitFlow&algorithm=SHA1&digits=6&period=30`;
  return { secret, otpauth };
}

export function generateTOTPUri(email: string, secret: string): string {
  return `otpauth://totp/RemitFlow:${encodeURIComponent(email)}?secret=${secret}&issuer=RemitFlow&algorithm=SHA1&digits=6&period=30`;
}

export async function generateQRCode(otpauth: string): Promise<string> {
  return QRCode.toDataURL(otpauth);
}

export async function verifyTOTP(token: string, secret: string): Promise<boolean> {
  try {
    const now = Math.floor(Date.now() / 30_000);
    for (let i = -1; i <= 1; i++) {
      const expected = hotp(secret, now + i);
      // Timing-safe comparison to prevent timing attacks
      if (expected.length === token.length &&
          timingSafeEqual(Buffer.from(expected), Buffer.from(token))) {
        return true;
      }
    }
    return false;
  } catch {
    return false;
  }
}
