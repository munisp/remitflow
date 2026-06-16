/**
 * Haptic feedback utilities for mobile.
 * Uses the Web Vibration API — noop on unsupported platforms.
 */

const canVibrate = typeof navigator !== "undefined" && "vibrate" in navigator;

export const haptics = {
  /** Light tap — tab switches, selections (5ms) */
  light: () => canVibrate && navigator.vibrate(5),
  /** Selection change — toggle, checkbox (10ms) */
  selection: () => canVibrate && navigator.vibrate(10),
  /** Medium — pull-to-refresh trigger, confirm action (30ms) */
  medium: () => canVibrate && navigator.vibrate(30),
  /** Success — transfer sent, KYC approved (200ms) */
  success: () => canVibrate && navigator.vibrate(200),
  /** Error — double pulse (50-30-50) */
  error: () => canVibrate && navigator.vibrate([50, 30, 50]),
  /** Warning — short double pulse (30-20-30) */
  warning: () => canVibrate && navigator.vibrate([30, 20, 30]),
  /** Impact — button press (15ms) */
  impact: () => canVibrate && navigator.vibrate(15),
};
