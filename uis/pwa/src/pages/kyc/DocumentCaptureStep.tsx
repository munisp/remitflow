/**
 * Step 1 — document capture.
 *
 * Live camera view with a document-outline overlay. Per-frame quality checks
 * (blur variance, glare ratio, resolution, motion stability) run on a
 * downsampled canvas. Auto-capture fires after N consecutive stable, passing
 * frames; a manual shutter is always available. On capture we take a 3-frame
 * burst (multi-frame cues for the server-side authenticity stage) and submit
 * via kycCapture.submitDocument.
 *
 * Honest UX: these are quality checks, not authenticity proof. Camera denied
 * or unavailable → graceful fallback offered to the upload path.
 */
import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  kycCaptureApi,
  errorMessage,
  type CaptureDocType,
} from "./api";
import {
  FrameQualityAnalyzer,
  QUALITY_LIMITS,
  captureBurst,
  type FrameQuality,
} from "./frameQuality";
import {
  bindStreamToVideo,
  cameraSupported,
  useCameraStream,
} from "./useCameraStream";

const STABLE_FRAMES_REQUIRED = 8; // ~0.5s of stable, passing frames at 60fps
const BURST_COUNT = 3; // ≤ server max of 6
const BURST_GAP_MS = 160;

interface Props {
  sessionId: string;
  nonce: string;
  docType: CaptureDocType;
  onComplete: () => void;
  /** Fallback to the classic file-upload path. */
  onUseUploadInstead: () => void;
}

const DocumentCaptureStep: React.FC<Props> = ({
  sessionId,
  nonce,
  docType,
  onComplete,
  onUseUploadInstead,
}) => {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const analyzerRef = useRef<FrameQualityAnalyzer | null>(null);
  const rafRef = useRef(0);
  const stableCountRef = useRef(0);
  const capturingRef = useRef(false);

  const { stream, error, starting, start } = useCameraStream("environment", true);
  const [quality, setQuality] = useState<FrameQuality | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [previewFrames, setPreviewFrames] = useState<string[] | null>(null);

  // Bind stream → video element (srcObject is not a React-managed prop).
  useEffect(() => {
    bindStreamToVideo(videoRef.current, stream);
  }, [stream]);

  const submitFrames = useCallback(
    async (frames: string[]) => {
      if (frames.length === 0) {
        setSubmitError("Could not read a frame from the camera. Try again.");
        return;
      }
      setSubmitting(true);
      setSubmitError(null);
      try {
        const res = await kycCaptureApi.kycCapture.submitDocument.mutate({
          sessionId,
          nonce,
          docType,
          frames,
        });
        if (res.ok) {
          onComplete();
        } else {
          // Server pipeline rejected the document frames — show the real reason.
          setPreviewFrames(null);
          setSubmitError(
            res.reason ??
              "The document photos did not pass the server's checks. Try again in better light.",
          );
        }
      } catch (err) {
        setPreviewFrames(null);
        setSubmitError(errorMessage(err, "Upload failed. Check your connection and try again."));
      } finally {
        setSubmitting(false);
        capturingRef.current = false;
      }
    },
    [sessionId, nonce, docType, onComplete],
  );

  const doCapture = useCallback(async () => {
    const video = videoRef.current;
    if (!video || capturingRef.current) return;
    capturingRef.current = true;
    setSubmitError(null);
    const frames = await captureBurst(video, BURST_COUNT, BURST_GAP_MS);
    if (frames.length === 0) {
      capturingRef.current = false;
      setSubmitError("Could not read a frame from the camera. Try again.");
      return;
    }
    setPreviewFrames(frames);
    await submitFrames(frames);
  }, [submitFrames]);

  // Per-frame quality analysis + auto-capture on sustained stability.
  useEffect(() => {
    if (!stream || previewFrames) return;
    if (!analyzerRef.current) {
      try {
        analyzerRef.current = new FrameQualityAnalyzer();
      } catch {
        return; // Canvas unavailable — manual shutter still works via <canvas> at capture time? No: keep upload fallback.
      }
    }
    const analyzer = analyzerRef.current;
    const tick = () => {
      const video = videoRef.current;
      if (video && video.readyState >= 2) {
        const q = analyzer.analyze(video);
        if (q) {
          setQuality(q);
          const steady =
            q.motionDelta === null ||
            q.motionDelta <= QUALITY_LIMITS.maxMotionDelta;
          if (q.ok && steady && !capturingRef.current) {
            stableCountRef.current += 1;
            if (stableCountRef.current >= STABLE_FRAMES_REQUIRED) {
              stableCountRef.current = 0;
              void doCapture();
              return; // stop the loop; unmount/effect re-run handles the rest
            }
          } else {
            stableCountRef.current = 0;
          }
        }
      }
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, [stream, previewFrames, doCapture]);

  // ── Graceful fallbacks ──────────────────────────────────────────────────────
  if (!cameraSupported()) {
    return (
      <FallbackCard
        title="Camera not available"
        body="This browser does not support in-page camera capture. You can still complete verification by uploading photos of your document instead."
        onUseUploadInstead={onUseUploadInstead}
      />
    );
  }
  if (error?.kind === "denied") {
    return (
      <FallbackCard
        title="Camera permission denied"
        body="Camera access was blocked, so we can't capture your document in the browser. You can allow camera access in your browser settings and retry, or upload photos of your document instead — both paths lead to the same review."
        onUseUploadInstead={onUseUploadInstead}
        onRetry={start}
      />
    );
  }
  if (error?.kind === "unavailable") {
    return (
      <FallbackCard
        title="Camera could not be started"
        body={`${error.message} You can retry, or upload photos of your document instead.`}
        onUseUploadInstead={onUseUploadInstead}
        onRetry={start}
      />
    );
  }

  const statusText = !stream
    ? "Starting camera…"
    : submitting
      ? "Uploading document photos…"
      : quality && !quality.ok
        ? quality.reasons[0]
        : quality && quality.motionDelta !== null && quality.motionDelta > QUALITY_LIMITS.maxMotionDelta
          ? "Hold the document steady…"
          : "Hold steady — capturing automatically";

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold text-slate-900">
          Scan your document
        </h2>
        <p className="text-sm text-slate-500 mt-1">
          Place your {docType.replace(/_/g, " ")} inside the outline. We check
          photo quality (focus, glare, stability) and capture automatically —
          the document itself is verified by the server.
        </p>
      </div>

      <div className="relative rounded-2xl overflow-hidden bg-slate-900 aspect-[4/3]">
        {/* playsInline + muted + autoPlay are required for iOS Safari inline video */}
        <video
          ref={videoRef}
          playsInline
          muted
          autoPlay
          className="absolute inset-0 w-full h-full object-cover"
        />
        {/* Document-outline overlay guide (ID-1 aspect) */}
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <div
            className={`rounded-xl border-4 transition-colors duration-300 ${
              quality?.ok ? "border-emerald-400/90" : "border-white/70"
            }`}
            style={{ width: "82%", aspectRatio: "1.586" }}
          >
            <div className="w-full h-full rounded-lg border border-white/20" />
          </div>
        </div>
        {stream && (
          <div className="absolute top-3 left-3 right-3 flex justify-center pointer-events-none">
            <span
              className={`px-3 py-1.5 rounded-full text-xs font-semibold backdrop-blur-sm ${
                quality?.ok
                  ? "bg-emerald-500/80 text-white"
                  : "bg-slate-900/70 text-white"
              }`}
            >
              {statusText}
            </span>
          </div>
        )}
        {submitting && (
          <div className="absolute inset-0 bg-slate-900/60 flex items-center justify-center">
            <div className="flex items-center gap-2 text-white text-sm font-medium">
              <div className="w-5 h-5 border-2 border-white/40 border-t-white rounded-full animate-spin" />
              Checking quality &amp; uploading…
            </div>
          </div>
        )}
      </div>

      {submitError && (
        <div className="p-4 rounded-xl bg-red-50 border border-red-100 text-sm text-red-700">
          {submitError}
        </div>
      )}

      {!stream && !starting && (
        <button
          onClick={() => void start()}
          className="w-full py-3 bg-gradient-to-r from-indigo-600 to-violet-600 text-white font-semibold rounded-xl shadow-lg shadow-indigo-200"
        >
          Enable camera
        </button>
      )}

      {stream && (
        <button
          onClick={() => void doCapture()}
          disabled={submitting}
          className="w-full py-3 bg-white border-2 border-indigo-200 text-indigo-700 font-semibold rounded-xl hover:bg-indigo-50 transition-colors disabled:opacity-50"
        >
          {submitting ? "Uploading…" : "Capture now"}
        </button>
      )}

      <p className="text-center text-sm text-slate-500">
        Camera not working?{" "}
        <button
          onClick={onUseUploadInstead}
          className="text-indigo-600 font-medium underline underline-offset-2"
        >
          Upload photos instead
        </button>
      </p>
    </div>
  );
};

const FallbackCard: React.FC<{
  title: string;
  body: string;
  onUseUploadInstead: () => void;
  onRetry?: () => void;
}> = ({ title, body, onUseUploadInstead, onRetry }) => (
  <div className="space-y-4">
    <div className="p-5 rounded-xl bg-amber-50 border border-amber-100">
      <p className="font-semibold text-amber-800 mb-1">{title}</p>
      <p className="text-sm text-amber-700">{body}</p>
    </div>
    {onRetry && (
      <button
        onClick={onRetry}
        className="w-full py-3 bg-white border-2 border-indigo-200 text-indigo-700 font-semibold rounded-xl hover:bg-indigo-50 transition-colors"
      >
        Retry camera
      </button>
    )}
    <button
      onClick={onUseUploadInstead}
      className="w-full py-3 bg-gradient-to-r from-indigo-600 to-violet-600 text-white font-semibold rounded-xl shadow-lg shadow-indigo-200"
    >
      Upload photos instead
    </button>
  </div>
);

export default DocumentCaptureStep;
