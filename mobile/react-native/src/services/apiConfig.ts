/**
 * RemitFlow React Native — API configuration
 *
 * The platform API base URL must be provided by the build environment.
 * Expo projects inject EXPO_PUBLIC_* variables at bundle time; bare RN
 * projects can set REMITFLOW_API_URL via react-native-config or edit the
 * fallback below. When nothing is configured the services fail loudly
 * instead of silently pointing at a non-existent host.
 */

declare const process: { env?: Record<string, string | undefined> } | undefined;

const configured =
  (typeof process !== "undefined" &&
    (process?.env?.EXPO_PUBLIC_API_URL || process?.env?.REMITFLOW_API_URL)) ||
  "";

/** Base URL of the RemitFlow platform API, without a trailing slash. */
export const API_BASE_URL = configured.replace(/\/$/, "");

/** True when a platform API URL has been configured for this build. */
export const isApiConfigured = (): boolean => API_BASE_URL.length > 0;

/** Resolve an API path (e.g. "/health") against the configured base. */
export function apiUrl(path: string): string {
  if (!isApiConfigured()) {
    throw new Error(
      "RemitFlow API URL is not configured. Set EXPO_PUBLIC_API_URL (or REMITFLOW_API_URL) for this build.",
    );
  }
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  return `${API_BASE_URL}${normalizedPath}`;
}
