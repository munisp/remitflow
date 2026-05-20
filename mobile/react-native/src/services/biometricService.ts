/**
 * biometricService.ts
 * Handles Face ID / Touch ID / Fingerprint authentication for RemitFlow RN app.
 * Uses react-native-biometrics (install: pnpm add react-native-biometrics)
 */

import ReactNativeBiometrics, { BiometryTypes } from "react-native-biometrics";
import AsyncStorage from "@react-native-async-storage/async-storage";

const rnBiometrics = new ReactNativeBiometrics({ allowDeviceCredentials: true });

const BIOMETRIC_ENABLED_KEY = "@remitflow:biometric_enabled";
const BIOMETRIC_SESSION_KEY = "@remitflow:biometric_session";

export type BiometricType = "FaceID" | "TouchID" | "Biometrics" | "none";

/**
 * Check if biometrics are available on this device.
 */
export async function checkBiometricAvailability(): Promise<{
  available: boolean;
  biometryType: BiometricType;
}> {
  try {
    const { available, biometryType } = await rnBiometrics.isSensorAvailable();
    if (!available) return { available: false, biometryType: "none" };
    const type: BiometricType =
      biometryType === BiometryTypes.FaceID
        ? "FaceID"
        : biometryType === BiometryTypes.TouchID
        ? "TouchID"
        : "Biometrics";
    return { available: true, biometryType: type };
  } catch {
    return { available: false, biometryType: "none" };
  }
}

/**
 * Prompt the user for biometric authentication.
 * Returns true if authentication succeeded.
 */
export async function authenticateWithBiometrics(
  promptMessage = "Authenticate to access RemitFlow"
): Promise<boolean> {
  try {
    const { success } = await rnBiometrics.simplePrompt({ promptMessage });
    return success;
  } catch {
    return false;
  }
}

/**
 * Enable biometric login for the current session.
 * Stores a signed session token protected by biometrics.
 */
export async function enableBiometricLogin(sessionToken: string): Promise<boolean> {
  try {
    // Create a biometric-protected key pair
    const { publicKey } = await rnBiometrics.createKeys();
    // Sign the session token with the private key (requires biometric auth)
    const { success, signature } = await rnBiometrics.createSignature({
      promptMessage: "Enable biometric login",
      payload: sessionToken,
    });
    if (!success || !signature) return false;
    // Store the session token and public key
    await AsyncStorage.multiSet([
      [BIOMETRIC_ENABLED_KEY, "true"],
      [BIOMETRIC_SESSION_KEY, JSON.stringify({ sessionToken, publicKey, signature })],
    ]);
    return true;
  } catch {
    return false;
  }
}

/**
 * Retrieve the stored session token using biometric authentication.
 */
export async function getBiometricSession(): Promise<string | null> {
  try {
    const enabled = await AsyncStorage.getItem(BIOMETRIC_ENABLED_KEY);
    if (enabled !== "true") return null;
    const stored = await AsyncStorage.getItem(BIOMETRIC_SESSION_KEY);
    if (!stored) return null;
    const { sessionToken } = JSON.parse(stored);
    // Require biometric auth before returning the token
    const authenticated = await authenticateWithBiometrics("Verify your identity");
    if (!authenticated) return null;
    return sessionToken;
  } catch {
    return null;
  }
}

/**
 * Check if biometric login is enabled.
 */
export async function isBiometricLoginEnabled(): Promise<boolean> {
  try {
    const val = await AsyncStorage.getItem(BIOMETRIC_ENABLED_KEY);
    return val === "true";
  } catch {
    return false;
  }
}

/**
 * Disable biometric login and clear stored keys.
 */
export async function disableBiometricLogin(): Promise<void> {
  try {
    await rnBiometrics.deleteKeys();
    await AsyncStorage.multiRemove([BIOMETRIC_ENABLED_KEY, BIOMETRIC_SESSION_KEY]);
  } catch {
    // ignore
  }
}
