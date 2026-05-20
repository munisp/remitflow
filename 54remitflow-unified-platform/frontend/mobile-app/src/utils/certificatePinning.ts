/**
 * Certificate Pinning — RemitFlow Mobile App
 * Prevents MITM attacks by validating the server's TLS certificate
 * against known-good SHA-256 fingerprints.
 *
 * Usage: wrap all API calls through the pinned fetch/axios instance.
 * Fingerprints must be updated when certificates are renewed (every 90 days for Let's Encrypt).
 */

import { Platform } from 'react-native';

// SHA-256 fingerprints of the RemitFlow API server certificates
// Include current cert + next cert (for zero-downtime rotation)
// Update these values 2 weeks before certificate expiry
const PINNED_CERTIFICATES: Record<string, string[]> = {
  'api.remitflow.com': [
    // Primary certificate fingerprint (update before expiry)
    'sha256/REPLACE_WITH_ACTUAL_CERT_FINGERPRINT_BASE64==',
    // Backup certificate fingerprint (for rotation)
    'sha256/REPLACE_WITH_BACKUP_CERT_FINGERPRINT_BASE64==',
  ],
};

/**
 * Validates a certificate fingerprint against the pinned set.
 * Called by the native TLS layer via react-native-ssl-pinning.
 */
export function isPinnedCertificate(host: string, fingerprint: string): boolean {
  const pinnedFingerprints = PINNED_CERTIFICATES[host];
  if (!pinnedFingerprints) {
    // Unknown host — reject in production
    if (__DEV__) {
      console.warn(`[CertPin] No pinned cert for host: ${host} — allowing in dev mode`);
      return true;
    }
    return false;
  }
  return pinnedFingerprints.includes(fingerprint);
}

/**
 * Configuration object for react-native-ssl-pinning fetch.
 * Use this instead of the standard fetch for all API calls.
 *
 * Install: npx expo install react-native-ssl-pinning
 */
export const SSL_PINNING_CONFIG = {
  'api.remitflow.com': {
    includeSubdomains: false,
    publicKeyHashes: PINNED_CERTIFICATES['api.remitflow.com'],
  },
};

/**
 * Returns fetch options with SSL pinning enabled.
 * In development, pinning is bypassed to allow local testing.
 */
export function getPinnedFetchOptions(baseOptions: RequestInit = {}): RequestInit & { sslPinning?: object } {
  if (__DEV__) {
    return baseOptions;
  }

  return {
    ...baseOptions,
    // react-native-ssl-pinning specific option
    sslPinning: {
      certs: ['api_remitflow_com'],
    },
  };
}

/**
 * Certificate rotation procedure:
 * 1. Generate new certificate fingerprint:
 *    openssl s_client -connect api.remitflow.com:443 | openssl x509 -pubkey -noout | openssl pkey -pubin -outform der | openssl dgst -sha256 -binary | base64
 * 2. Add new fingerprint to PINNED_CERTIFICATES alongside existing one
 * 3. Release app update to stores (allow 2 weeks for adoption)
 * 4. Deploy new certificate to server
 * 5. Remove old fingerprint in next app release
 */

/**
 * Validates that pinned certificates are configured.
 * Called at app startup to warn developers about missing configuration.
 */
export function validateCertificatePinningConfig(): void {
  const hasPlaceholders = Object.values(PINNED_CERTIFICATES)
    .flat()
    .some(fp => fp.includes('REPLACE_WITH'));

  if (hasPlaceholders && !__DEV__) {
    throw new Error(
      '[CertPin] CRITICAL: Certificate pinning fingerprints are not configured. ' +
      'Replace REPLACE_WITH_ACTUAL_CERT_FINGERPRINT_BASE64 with real SHA-256 fingerprints before production release.'
    );
  }

  if (hasPlaceholders && __DEV__) {
    console.warn(
      '[CertPin] Certificate pinning fingerprints are placeholders. ' +
      'Configure real fingerprints before production release.'
    );
  }
}
