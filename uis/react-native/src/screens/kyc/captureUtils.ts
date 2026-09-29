/**
 * wave-15 §8 (K6) — shared helpers for the KYC camera capture flow.
 *
 * Everything here is JS-only (no new native deps). The authoritative
 * quality/liveness/authenticity validation happens SERVER-side
 * (K4 kycCapture router → K1/K2 python services); the client-side gates
 * below are lightweight pre-flight hints only and are labelled as such
 * in the UI copy.
 */

/** Read a local file:// URI into base64 using only RN built-ins (same
 *  approach as KYCScreen.readUriAsBase64 — no new deps). */
export async function readUriAsBase64(uri: string): Promise<string> {
  const res = await fetch(uri);
  const blob = await res.blob();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Could not read the captured photo'));
    reader.onload = () => {
      const result = String(reader.result ?? '');
      const comma = result.indexOf(',');
      resolve(comma >= 0 ? result.slice(comma + 1) : result);
    };
    reader.readAsDataURL(blob);
  });
}

/** Byte length of a base64 payload (approximate decoded size). */
export function base64Bytes(base64: string): number {
  const padding = base64.endsWith('==') ? 2 : base64.endsWith('=') ? 1 : 0;
  return Math.floor((base64.length * 3) / 4) - padding;
}

/** K4 contract hard cap: 2 MB per frame. */
export const MAX_FRAME_BYTES = 2 * 1024 * 1024;
/** K4 contract hard cap: at most 6 frames per submission. */
export const MAX_FRAMES = 6;

/**
 * Lightweight sharpness proxy.
 *
 * Without frame processors (react-native-worklets-core is NOT an allowed
 * dep this wave) we cannot compute a true Laplacian blur variance on the
 * JS thread. At a fixed JPEG encoder quality, a blurrier image has fewer
 * high-frequency components and compresses smaller, so compressed-bytes
 * per megapixel is a rough, honest proxy for sharpness. It can false-fire
 * on genuinely low-detail scenes, so it only WARNS (user may proceed);
 * the server-side pipeline performs the real blur/authenticity analysis.
 */
export function sharpnessScore(compressedBytes: number, width: number, height: number): number {
  const megapixels = (width * height) / 1_000_000;
  if (megapixels <= 0) return 0;
  return compressedBytes / megapixels;
}

/** Empirical floor for the proxy above: below this we warn "possibly
 *  blurry". ~100 KB per megapixel at default JPEG quality. */
export const SHARPNESS_WARN_FLOOR = 100_000;

export interface QualityHint {
  level: 'ok' | 'warn';
  message?: string;
}

/** Pre-flight quality hints for one captured document frame. */
export function assessFrame(input: {
  compressedBytes: number;
  width: number;
  height: number;
}): QualityHint {
  const { compressedBytes, width, height } = input;
  if (compressedBytes > MAX_FRAME_BYTES) {
    return {
      level: 'warn',
      message: 'This photo is large and will be re-taken at lower resolution if the server rejects it.',
    };
  }
  if (width < 640 || height < 480) {
    return { level: 'warn', message: 'Resolution looks low — move closer and hold steady.' };
  }
  if (sharpnessScore(compressedBytes, width, height) < SHARPNESS_WARN_FLOOR) {
    return {
      level: 'warn',
      message: 'This photo may be blurry or overexposed. Consider retaking it in even light.',
    };
  }
  return { level: 'ok' };
}

/** Human-readable prompt for a server-issued challenge step. The server
 *  picks steps from {blink, turnLeft, turnRight, smile, jawOpen} (§6);
 *  unknown steps render a generic honest prompt instead of crashing. */
export function challengePrompt(step: string): string {
  switch (step) {
    case 'blink':
      return 'Blink naturally';
    case 'turnLeft':
      return 'Turn your head to the left';
    case 'turnRight':
      return 'Turn your head to the right';
    case 'smile':
      return 'Smile';
    case 'jawOpen':
      return 'Open your mouth briefly';
    default:
      return `Follow the prompt: ${step}`;
  }
}

/** Normalize a challenge item from the server into a step id string.
 *  The contract ships challenge[] — items may be plain strings or
 *  {step} / {type} objects depending on the final K4 shape. */
export function challengeStepId(item: unknown): string {
  if (typeof item === 'string') return item;
  if (item && typeof item === 'object') {
    const o = item as Record<string, unknown>;
    const v = o.step ?? o.type ?? o.action ?? o.id;
    if (typeof v === 'string') return v;
  }
  return 'unknown';
}
