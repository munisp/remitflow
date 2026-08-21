/**
 * Secure storage service (CLI-005).
 *
 * Sensitive values (session_id, salted PIN hash) are stored in the device
 * keystore via react-native-keychain (iOS Keychain / Android Keystore)
 * instead of plaintext AsyncStorage, which is unencrypted and extractable
 * via adb backup or on rooted/jailbroken devices.
 *
 * NOTE on library choice: this is a bare React Native 0.73 app without the
 * `expo` package, so expo-secure-store cannot autolink here without adding
 * the entire Expo modules infrastructure. react-native-keychain provides
 * the same keystore-backed guarantee and autolinks on bare RN.
 *
 * Fallback policy: AsyncStorage is used ONLY in __DEV__ builds when the
 * keystore is unavailable (e.g. some emulators). Release builds fail
 * closed — sensitive data is never silently written to plaintext storage.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Keychain from 'react-native-keychain';

const SERVICE_PREFIX = 'com.remitflow.secure.';

async function keychainAvailable(): Promise<boolean> {
  try {
    await Keychain.getSupportedBiometryType();
    return true;
  } catch {
    return false;
  }
}

async function devFallbackSet(key: string, value: string): Promise<void> {
  if (__DEV__) {
    console.warn(`[secureStorage] Keystore unavailable; using AsyncStorage for "${key}" (DEV ONLY)`);
    await AsyncStorage.setItem(key, value);
    return;
  }
  throw new Error(
    `[secureStorage] Secure keystore unavailable in a release build; refusing to store "${key}" in plaintext.`,
  );
}

async function devFallbackGet(key: string): Promise<string | null> {
  if (__DEV__) {
    return AsyncStorage.getItem(key);
  }
  return null;
}

async function devFallbackDelete(key: string): Promise<void> {
  if (__DEV__) {
    await AsyncStorage.removeItem(key);
  }
}

/**
 * Store a sensitive value in the device keystore.
 * Throws in release builds if the keystore is unavailable.
 */
export async function secureSet(key: string, value: string): Promise<void> {
  if (await keychainAvailable()) {
    await Keychain.setGenericPassword('remitflow', value, {
      service: SERVICE_PREFIX + key,
      accessible: Keychain.ACCESSIBLE.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
    });
    // Best-effort purge of any plaintext copy written by older builds.
    try {
      await AsyncStorage.removeItem(key);
    } catch {
      // ignore
    }
    return;
  }
  await devFallbackSet(key, value);
}

/**
 * Read a sensitive value. Migrates legacy plaintext AsyncStorage copies
 * into the keystore on first read and removes the plaintext copy.
 */
export async function secureGet(key: string): Promise<string | null> {
  if (await keychainAvailable()) {
    const creds = await Keychain.getGenericPassword({
      service: SERVICE_PREFIX + key,
    });
    if (creds && typeof creds !== 'boolean') {
      return creds.password;
    }
    // Legacy migration from plaintext AsyncStorage.
    let legacy: string | null = null;
    try {
      legacy = await AsyncStorage.getItem(key);
    } catch {
      legacy = null;
    }
    if (legacy) {
      try {
        await secureSet(key, legacy);
      } catch {
        // Keystore write failed — do not keep using the plaintext copy.
      }
      try {
        await AsyncStorage.removeItem(key);
      } catch {
        // ignore
      }
      return legacy;
    }
    return null;
  }
  return devFallbackGet(key);
}

/** Delete a sensitive value from both the keystore and any legacy location. */
export async function secureDelete(key: string): Promise<void> {
  if (await keychainAvailable()) {
    try {
      await Keychain.resetGenericPassword({ service: SERVICE_PREFIX + key });
    } catch {
      // ignore
    }
  } else {
    await devFallbackDelete(key);
  }
  try {
    await AsyncStorage.removeItem(key);
  } catch {
    // ignore
  }
}

export default { secureSet, secureGet, secureDelete };
