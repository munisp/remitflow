/**
 * Client-side frame quality heuristics for the KYC document-capture step.
 *
 * These are QUALITY checks only (blur / glare / resolution / stability) — they
 * decide when a frame is good enough to submit to the server pipeline. They do
 * NOT prove liveness or document authenticity; server-side stages make those
 * calls. All analysis runs on a small downsampled canvas so it is cheap enough
 * to run per animation frame on mid-range phones.
 */

export interface FrameQuality {
  /** Variance of the Laplacian of the grayscale image; higher = sharper. */
  blurVariance: number;
  /** Fraction of pixels that are near-saturated (0..1); high = glare/overexposure. */
  glareRatio: number;
  /** True when the video source meets the minimum usable resolution. */
  resolutionOk: boolean;
  /** Mean absolute pixel difference vs the previous sampled frame (0..255). */
  motionDelta: number | null;
  ok: boolean;
  reasons: string[];
}

/** Tunables — deliberately lenient; the server pipeline is the authority. */
export const QUALITY_LIMITS = {
  /** Below this Laplacian variance the frame is too blurry to read a document. */
  minBlurVariance: 60,
  /** Above this saturated-pixel fraction, glare likely obscures the document. */
  maxGlareRatio: 0.25,
  /** Minimum source dimensions. */
  minWidth: 640,
  minHeight: 480,
  /** Mean abs diff below this means the camera is held steady. */
  maxMotionDelta: 6,
  /** Analysis canvas width (aspect preserved). */
  sampleWidth: 320,
} as const;

export class FrameQualityAnalyzer {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private prevLuma: Uint8Array | null = null;

  constructor() {
    this.canvas = document.createElement("canvas");
    const ctx = this.canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) throw new Error("Canvas 2D is unavailable in this browser");
    this.ctx = ctx;
  }

  /** Sample the current video frame and compute quality metrics. */
  analyze(video: HTMLVideoElement): FrameQuality | null {
    const vw = video.videoWidth;
    const vh = video.videoHeight;
    if (!vw || !vh) return null; // stream not ready yet

    const scale = QUALITY_LIMITS.sampleWidth / vw;
    const w = QUALITY_LIMITS.sampleWidth;
    const h = Math.max(1, Math.round(vh * scale));
    if (this.canvas.width !== w) this.canvas.width = w;
    if (this.canvas.height !== h) this.canvas.height = h;

    this.ctx.drawImage(video, 0, 0, w, h);
    const data = this.ctx.getImageData(0, 0, w, h).data;

    // Grayscale luminance plane.
    const luma = new Uint8Array(w * h);
    let saturated = 0;
    for (let i = 0; i < w * h; i++) {
      const r = data[i * 4];
      const g = data[i * 4 + 1];
      const b = data[i * 4 + 2];
      const y = (r * 299 + g * 587 + b * 114) / 1000;
      luma[i] = y;
      if (r > 245 && g > 245 && b > 245) saturated++;
    }
    const glareRatio = saturated / (w * h);

    // Laplacian variance (interior pixels only).
    let sum = 0;
    let sumSq = 0;
    let count = 0;
    for (let y = 1; y < h - 1; y++) {
      const row = y * w;
      for (let x = 1; x < w - 1; x++) {
        const lap =
          4 * luma[row + x] -
          luma[row + x - 1] -
          luma[row + x + 1] -
          luma[row - w + x] -
          luma[row + w + x];
        sum += lap;
        sumSq += lap * lap;
        count++;
      }
    }
    const mean = count ? sum / count : 0;
    const blurVariance = count ? sumSq / count - mean * mean : 0;

    // Motion delta vs previous sample.
    let motionDelta: number | null = null;
    if (this.prevLuma && this.prevLuma.length === luma.length) {
      let diff = 0;
      for (let i = 0; i < luma.length; i += 4) {
        diff += Math.abs(luma[i] - this.prevLuma[i]);
      }
      motionDelta = diff / (luma.length / 4);
    }
    this.prevLuma = luma;

    const resolutionOk =
      vw >= QUALITY_LIMITS.minWidth && vh >= QUALITY_LIMITS.minHeight;

    const reasons: string[] = [];
    if (!resolutionOk) reasons.push("Camera resolution is too low");
    if (blurVariance < QUALITY_LIMITS.minBlurVariance)
      reasons.push("Image is blurry — hold steady and focus");
    if (glareRatio > QUALITY_LIMITS.maxGlareRatio)
      reasons.push("Too much glare — tilt the document away from the light");

    return {
      blurVariance,
      glareRatio,
      resolutionOk,
      motionDelta,
      ok: reasons.length === 0,
      reasons,
    };
  }

  reset() {
    this.prevLuma = null;
  }
}

/** Draw the current video frame to a JPEG base64 string (no data: prefix). */
export function captureJpegFrame(
  video: HTMLVideoElement,
  maxEdge = 1280,
  quality = 0.85,
): string | null {
  const vw = video.videoWidth;
  const vh = video.videoHeight;
  if (!vw || !vh) return null;
  const scale = Math.min(1, maxEdge / Math.max(vw, vh));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(vw * scale);
  canvas.height = Math.round(vh * scale);
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
  const dataUrl = canvas.toDataURL("image/jpeg", quality);
  const comma = dataUrl.indexOf(",");
  return comma >= 0 ? dataUrl.slice(comma + 1) : dataUrl;
}

/** Capture a burst of frames ~gapMs apart (for server multi-frame authenticity cues). */
export async function captureBurst(
  video: HTMLVideoElement,
  count: number,
  gapMs: number,
  maxEdge = 1280,
): Promise<string[]> {
  const frames: string[] = [];
  for (let i = 0; i < count; i++) {
    const f = captureJpegFrame(video, maxEdge);
    if (f) frames.push(f);
    if (i < count - 1) await new Promise((r) => setTimeout(r, gapMs));
  }
  return frames;
}
