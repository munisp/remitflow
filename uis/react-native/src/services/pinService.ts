/**
 * App PIN service (CLI-005).
 *
 * The user's app-unlock PIN is NEVER stored in plaintext. Only a salted
 * SHA-256 hash is persisted, in keystore-backed storage (secureStorage),
 * which is sufficient for the offline unlock check. An attacker reading
 * device storage (root/backup extraction) cannot recover the PIN, so
 * PIN-reuse attacks against other services (banks) are prevented.
 *
 * Note: 4–6 digit PINs have a small keyspace; the hash only protects the
 * PIN at rest. Unlock attempts must additionally be rate-limited
 * server-side / in the unlock flow.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { secureSet, secureGet, secureDelete } from './secureStorage';
import { sha256Hex } from './sha256';

const PIN_RECORD_KEY = 'user_pin';
/** Non-sensitive flag (AsyncStorage): whether the user set a PIN. */
export const PIN_ENABLED_KEY = 'pin_enabled';

interface PinRecord {
  v: 1;
  salt: string;
  hash: string;
}

/** Generate a non-secret, unique-per-install salt (defeats rainbow tables). */
function generateSalt(): string {
  const rand = Math.floor(Math.random() * 0xffffffff)
    .toString(16)
    .padStart(8, '0');
  return `${Date.now().toString(16)}-${rand}`;
}

function hashPin(pin: string, salt: string): string {
  return sha256Hex(`${salt}:${pin}`);
}

/** Purge the plaintext PIN written by older builds, if present. */
async function purgeLegacyPlaintextPin(): Promise<void> {
  try {
    await AsyncStorage.removeItem(PIN_RECORD_KEY);
  } catch {
    // ignore
  }
}

export const PinService = {
  /** Store the PIN as a salted hash in keystore-backed storage. */
  async setPin(pin: string): Promise<void> {
    const salt = generateSalt();
    const record: PinRecord = {
      v: 1,
      salt,
      hash: hashPin(pin, salt),
    };
    await secureSet(PIN_RECORD_KEY, JSON.stringify(record));
    await purgeLegacyPlaintextPin();
  },

  /** Verify a candidate PIN against the stored salted hash. */
  async verifyPin(pin: string): Promise<boolean> {
    const raw = await secureGet(PIN_RECORD_KEY);
    if (!raw) return false;
    try {
      const record = JSON.parse(raw) as PinRecord;
      if (record.v !== 1 || !record.salt || !record.hash) return false;
      return hashPin(pin, record.salt) === record.hash;
    } catch {
      return false;
    }
  },

  /** True when a PIN hash is stored. */
  async hasPin(): Promise<boolean> {
    return (await secureGet(PIN_RECORD_KEY)) !== null;
  },

  /** Remove the stored PIN hash (e.g. on logout or PIN reset). */
  async clearPin(): Promise<void> {
    await secureDelete(PIN_RECORD_KEY);
    try {
      await AsyncStorage.removeItem(PIN_ENABLED_KEY);
    } catch {
      // ignore
    }
  },
};

export default PinService;
