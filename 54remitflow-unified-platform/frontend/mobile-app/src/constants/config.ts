export const config = {
  API_URL: process.env.API_URL || 'https://api.remittance.com',
  API_TIMEOUT: 30000,
  CACHE_DURATION: 300000,
  MAX_RETRY_ATTEMPTS: 3,
  BIOMETRIC_ENABLED: true,
  OFFLINE_MODE_ENABLED: true,
  PUSH_NOTIFICATIONS_ENABLED: true,
};