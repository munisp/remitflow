/**
 * Step 2 — selfie challenge.
 *
 * Renders the server-issued challenge sequence IN ORDER as animated prompts,
 * and detects the requested movements client-side with MediaPipe Face
 * Landmarker (blendshapes: eyeBlinkL/R, jawOpen, mouthSmile; head-pose turns
 * from the facial transformation matrix).
 *
 * Bundle hygiene (wave-14 constraint): @mediapipe/tasks-vision is imported via
 * dynamic import() so the ~2MB WASM runtime never lands in the entry bundle;
 * the WASM fileset + model are fetched from version-pinned CDNs only when this
 * step mounts. If the detector fails to load we degrade honestly — the user
 * can retry or fall back to the upload path; we never fabricate events.
 *
 * Honest UX: these on-device checks are heuristic quality/security signals
 * that accompany the ordered event log + sampled frames to the server. They
 * are NOT a certified liveness guarantee, and no copy here claims one.
 */
import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  kycCaptureApi,
  errorMessage,
  type ChallengeEvent,
} from "./api";
import { captureJpegFrame } from "./frameQuality";
import {
  bindStreamToVideo,
  cameraSupported,
  useCameraStream,
} from "./useCameraStream";

// Version-pinned to the dependency in package.json so the WASM fileset and the
// JS wrapper can never drift apart.
const VISION_WASM_BASE =
  "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm";
const FACE_LANDMARKER_MODEL_URL =
  "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task";

const CHALLENGE_TIMEOUT_MS = 15_000;
const SAMPLED_FRAME_LIMIT = 5; // contract: 3–5 frames
const BLINK_SCORE = 0.45;
const JAW_OPEN_SCORE = 0.4;
const SMILE_SCORE = 0.45;
const TURN_YAW_DEG = 18;

// ── Challenge token mapping ──────────────────────────────────────────────────
// The server owns the sequence; the client owns detection. Unknown tokens are
// rendered with a generic prompt and satisfied by any strong detected event —
// the ordered event log lets the server judge the actual movement.

type ChallengeKind =
  | "blink"
  | "blink_left"
  | "blink_right"
  | "smile"
  | "jaw_open"
  | "turn_left"
  | "turn_right"
  | "unknown";

function classifyChallenge(token: string): ChallengeKind {
  const t = token.toLowerCase().replace(/[\s-]+/g, "_");
  if (t.includes("blink_left") || t === "eyeblinkl" || t === "blink_l") return "blink_left";
  if (t.includes("blink_right") || t === "eyeblinkr" || t === "blink_r") return "blink_right";
  if (t.includes("blink")) return "blink";
  if (t.includes("smile")) return "smile";
  if (t.includes("jaw") || t.includes("open_mouth") || t.includes("mouth_open")) return "jaw_open";
  if (t.includes("turn_left") || t.includes("left")) return "turn_left";
  if (t.includes("turn_right") || t.includes("right")) return "turn_right";
  return "unknown";
}

function challengePrompt(token: string): string {
  switch (classifyChallenge(token)) {
    case "blink":
      return "Blink both eyes";
    case "blink_left":
      return "Blink your left eye";
    case "blink_right":
      return "Blink your right eye";
    case "smile":
      return "Smile";
    case "jaw_open":
      return "Open your mouth";
    case "turn_left":
      return "Turn your head to the left";
    case "turn_right":
      return "Turn your head to the right";
    default:
      return "Make a natural movement (blink, smile, or turn your head)";
  }
}

/** Minimal structural view of the tasks-vision API we use (types come from the package). */
type FaceLandmarkerT = import("@mediapipe/tasks-vision").FaceLandmarker;
type FaceLandmarkerResultT = import("@mediapipe/tasks-vision").FaceLandmarkerResult;

interface DetectedSignals {
  blinkLeft: number;
  blinkRight: number;
  jawOpen: number;
  smile: number;
  yawDeg: number | null;
  facePresent: boolean;
}

function blendScore(result: FaceLandmarkerResultT, name: string): number {
  const cats = result.faceBlendshapes?.[0]?.categories;
  if (!cats) return 0;
  const hit = cats.find((c) => c.categoryName === name);
  return hit?.score ?? 0;
}

function extractSignals(result: FaceLandmarkerResultT | undefined): DetectedSignals {
  if (!result || !result.faceBlendshapes?.length) {
    return { blinkLeft: 0, blinkRight: 0, jawOpen: 0, smile: 0, yawDeg: null, facePresent: false };
  }
  let yawDeg: number | null = null;
  const m = result.facialTransformationMatrixes?.[0]?.data;
  if (m && m.length >= 16) {
    // Yaw from the rotation block: atan2(-m[2], m[0]) of the column-major matrix.
    yawDeg = (Math.atan2(-m[8], m[0]) * 180) / Math.PI;
  }
  return {
    blinkLeft: blendScore(result, "eyeBlinkLeft"),
    blinkRight: blendScore(result, "eyeBlinkRight"),
    jawOpen: blendScore(result, "jawOpen"),
    smile: Math.max(
      blendScore(result, "mouthSmileLeft"),
      blendScore(result, "mouthSmileRight"),
    ),
    yawDeg,
    facePresent: true,
  };
}

function signalMatches(kind: ChallengeKind, s: DetectedSignals): boolean {
  switch (kind) {
    case "blink":
      return s.blinkLeft > BLINK_SCORE && s.blinkRight > BLINK_SCORE;
    case "blink_left":
      return s.blinkLeft > BLINK_SCORE;
    case "blink_right":
      return s.blinkRight > BLINK_SCORE;
    case "smile":
      return s.smile > SMILE_SCORE;
    case "jaw_open":
      return s.jawOpen > JAW_OPEN_SCORE;
    case "turn_left":
      // Camera image is mirrored for the user; a head turn to their left
      // yields negative yaw in the unmirrored frame.
      return s.yawDeg !== null && s.yawDeg < -TURN_YAW_DEG;
    case "turn_right":
      return s.yawDeg !== null && s.yawDeg > TURN_YAW_DEG;
    case "unknown":
      return (
        (s.blinkLeft > BLINK_SCORE && s.blinkRight > BLINK_SCORE) ||
        s.smile > SMILE_SCORE ||
        s.jawOpen > JAW_OPEN_SCORE
      );
  }
}

type DetectorState =
  | { phase: "idle" }
  | { phase: "loading" }
  | { phase: "ready"; landmarker: FaceLandmarkerT }
  | { phase: "failed"; message: string };

interface Props {
  sessionId: string;
  nonce: string;
  /** Server-issued ordered challenge tokens. */
  challenge: string[];
  onComplete: () => void;
  onUseUploadInstead: () => void;
}

const SelfieChallengeStep: React.FC<Props> = ({
  sessionId,
  nonce,
  challenge,
  onComplete,
  onUseUploadInstead,
}) => {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const rafRef = useRef(0);
  const lastVideoTimeRef = useRef(-1);
  const eventsRef = useRef<ChallengeEvent[]>([]);
  const sampledFramesRef = useRef<string[]>([]);
  const submittingRef = useRef(false);
  const challengeStartRef = useRef(Date.now());
  const completedRef = useRef(false);

  const { stream, error, starting, start } = useCameraStream("user", true);
  const [detector, setDetector] = useState<DetectorState>({ phase: "idle" });
  const [currentIndex, setCurrentIndex] = useState(0);
  const [facePresent, setFacePresent] = useState(false);
  const [secondsLeft, setSecondsLeft] = useState(CHALLENGE_TIMEOUT_MS / 1000);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const challenges = challenge.length > 0 ? challenge : ["blink"];
  const currentToken = challenges[Math.min(currentIndex, challenges.length - 1)];

  useEffect(() => {
    bindStreamToVideo(videoRef.current, stream);
  }, [stream]);

  // ── Lazy-load MediaPipe (dynamic import keeps WASM out of the entry bundle) ──
  const loadDetector = useCallback(async () => {
    setDetector({ phase: "loading" });
    try {
      const vision = await import("@mediapipe/tasks-vision");
      const fileset = await vision.FilesetResolver.forVisionTasks(VISION_WASM_BASE);
      const landmarker = await vision.FaceLandmarker.createFromOptions(fileset, {
        baseOptions: { modelAssetPath: FACE_LANDMARKER_MODEL_URL },
        runningMode: "VIDEO",
        numFaces: 1,
        outputFaceBlendshapes: true,
        outputFacialTransformationMatrixes: true,
      });
      setDetector({ phase: "ready", landmarker });
    } catch (err) {
      setDetector({
        phase: "failed",
        message: errorMessage(
          err,
          "The on-device face detector could not be loaded (network or browser restriction).",
        ),
      });
    }
  }, []);

  // Start detector load as soon as the camera stream is live.
  useEffect(() => {
    if (stream && detector.phase === "idle") void loadDetector();
  }, [stream, detector.phase, loadDetector]);

  // Reset per-challenge timer.
  useEffect(() => {
    challengeStartRef.current = Date.now();
    setSecondsLeft(CHALLENGE_TIMEOUT_MS / 1000);
  }, [currentIndex]);

  const sampleFrame = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    if (sampledFramesRef.current.length >= SAMPLED_FRAME_LIMIT) return;
    const frame = captureJpegFrame(video, 480, 0.8);
    if (frame) sampledFramesRef.current.push(frame);
  }, []);

  const submitAll = useCallback(async () => {
    if (submittingRef.current) return;
    submittingRef.current = true;
    setSubmitting(true);
    setSubmitError(null);
    try {
      const res = await kycCaptureApi.kycCapture.submitChallengeEvents.mutate({
        sessionId,
        nonce,
        events: eventsRef.current,
        sampledFrames: sampledFramesRef.current,
      });
      if (res.ok) {
        onComplete();
      } else {
        submittingRef.current = false;
        setSubmitting(false);
        setSubmitError(
          res.reason ??
            "The selfie challenge did not pass the server's checks. You can retry the challenge.",
        );
      }
    } catch (err) {
      submittingRef.current = false;
      setSubmitting(false);
      setSubmitError(errorMessage(err, "Submission failed. Check your connection and retry."));
    }
  }, [sessionId, nonce, onComplete]);

  const advanceChallenge = useCallback(
    (token: string, signals: DetectedSignals) => {
      const seq = eventsRef.current.length;
      eventsRef.current.push({
        seq,
        event: token,
        timestamp: Date.now(),
        payload: {
          detected: {
            blinkLeft: +signals.blinkLeft.toFixed(3),
            blinkRight: +signals.blinkRight.toFixed(3),
            jawOpen: +signals.jawOpen.toFixed(3),
            smile: +signals.smile.toFixed(3),
            yawDeg: signals.yawDeg === null ? null : +signals.yawDeg.toFixed(1),
          },
        },
      });
      sampleFrame();
      if (currentIndex + 1 >= challenges.length) {
        completedRef.current = true;
        void submitAll();
      } else {
        setCurrentIndex(currentIndex + 1);
      }
    },
    [currentIndex, challenges.length, sampleFrame, submitAll],
  );

  // ── Detection loop ─────────────────────────────────────────────────────────
  useEffect(() => {
    if (!stream || detector.phase !== "ready" || completedRef.current) return;
    const landmarker = detector.landmarker;
    const tick = () => {
      const video = videoRef.current;
      if (video && video.readyState >= 2 && video.currentTime !== lastVideoTimeRef.current) {
        lastVideoTimeRef.current = video.currentTime;
        let result: FaceLandmarkerResultT | undefined;
        try {
          result = landmarker.detectForVideo(video, performance.now());
        } catch {
          result = undefined;
        }
        const signals = extractSignals(result);
        setFacePresent(signals.facePresent);
        if (signals.facePresent && !submittingRef.current) {
          const kind = classifyChallenge(currentToken);
          if (signalMatches(kind, signals)) {
            advanceChallenge(currentToken, signals);
            return; // state change re-runs the effect for the next challenge
          }
        }
      }
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, [stream, detector, currentToken, advanceChallenge]);

  // ── Per-challenge timeout countdown ────────────────────────────────────────
  useEffect(() => {
    if (detector.phase !== "ready" || completedRef.current || submitting) return;
    const iv = setInterval(() => {
      const elapsed = Date.now() - challengeStartRef.current;
      const left = Math.max(0, Math.ceil((CHALLENGE_TIMEOUT_MS - elapsed) / 1000));
      setSecondsLeft(left);
    }, 500);
    return () => clearInterval(iv);
  }, [detector.phase, currentIndex, submitting]);

  const retryChallenge = () => {
    challengeStartRef.current = Date.now();
    setSecondsLeft(CHALLENGE_TIMEOUT_MS / 1000);
  };

  const timedOut = secondsLeft === 0 && !completedRef.current;

  // ── Fallbacks ──────────────────────────────────────────────────────────────
  const unsupported = !cameraSupported();
  if (unsupported || error) {
    const title = unsupported
      ? "Camera not available"
      : error!.kind === "denied"
        ? "Camera permission denied"
        : "Camera could not be started";
    const body = unsupported
      ? "This browser does not support in-page camera capture, so the selfie challenge can't run here. You can still complete verification by uploading a selfie instead."
      : error!.kind === "denied"
        ? "Camera access was blocked, so the selfie challenge can't run. Allow camera access in your browser settings and retry, or upload a selfie instead — both paths lead to the same review."
        : `${error!.kind === "unavailable" ? error!.message : ""} You can retry, or upload a selfie instead.`;
    return (
      <div className="space-y-4">
        <div className="p-5 rounded-xl bg-amber-50 border border-amber-100">
          <p className="font-semibold text-amber-800 mb-1">{title}</p>
          <p className="text-sm text-amber-700">{body}</p>
        </div>
        {error && (
          <button
            onClick={() => void start()}
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
  }

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold text-slate-900">Selfie challenge</h2>
        <p className="text-sm text-slate-500 mt-1">
          Follow the prompts in order. On-device checks confirm a live person is
          following along; the final decision is made by our verification
          pipeline — this is a security check, not a certified liveness
          guarantee.
        </p>
      </div>

      <div className="relative rounded-2xl overflow-hidden bg-slate-900 aspect-[3/4] max-h-[420px] mx-auto">
        {/* playsInline + muted + autoPlay are required for iOS Safari inline video */}
        <video
          ref={videoRef}
          playsInline
          muted
          autoPlay
          className="absolute inset-0 w-full h-full object-cover -scale-x-100"
        />
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <div
            className={`rounded-full border-4 transition-colors duration-300 ${
              facePresent ? "border-emerald-400/90" : "border-white/60"
            }`}
            style={{ width: "62%", aspectRatio: "0.78" }}
          />
        </div>
        {submitting && (
          <div className="absolute inset-0 bg-slate-900/60 flex items-center justify-center">
            <div className="flex items-center gap-2 text-white text-sm font-medium">
              <div className="w-5 h-5 border-2 border-white/40 border-t-white rounded-full animate-spin" />
              Submitting challenge results…
            </div>
          </div>
        )}
      </div>

      {/* Progress through the ordered challenge sequence */}
      <div className="flex items-center justify-center gap-2">
        {challenges.map((c, i) => (
          <div
            key={`${c}-${i}`}
            className={`h-2 rounded-full transition-all duration-300 ${
              i < currentIndex
                ? "w-6 bg-emerald-500"
                : i === currentIndex
                  ? "w-8 bg-indigo-600"
                  : "w-6 bg-slate-200"
            }`}
          />
        ))}
      </div>

      {detector.phase === "loading" && (
        <div className="p-4 rounded-xl bg-indigo-50 border border-indigo-100 text-sm text-indigo-700 flex items-center gap-2">
          <div className="w-4 h-4 border-2 border-indigo-300 border-t-indigo-600 rounded-full animate-spin" />
          Loading the on-device face detector… (first load downloads a small model)
        </div>
      )}

      {detector.phase === "failed" && (
        <div className="space-y-3">
          <div className="p-4 rounded-xl bg-amber-50 border border-amber-100 text-sm text-amber-700">
            {detector.message} The challenge can't run without it — you can
            retry, or use the upload path instead.
          </div>
          <button
            onClick={() => void loadDetector()}
            className="w-full py-3 bg-white border-2 border-indigo-200 text-indigo-700 font-semibold rounded-xl hover:bg-indigo-50 transition-colors"
          >
            Retry loading detector
          </button>
          <button
            onClick={onUseUploadInstead}
            className="w-full py-3 bg-gradient-to-r from-indigo-600 to-violet-600 text-white font-semibold rounded-xl shadow-lg shadow-indigo-200"
          >
            Upload photos instead
          </button>
        </div>
      )}

      {detector.phase === "ready" && !submitting && !completedRef.current && (
        <div className="text-center space-y-2">
          <p
            key={currentIndex}
            className="text-xl font-bold text-slate-900 animate-pulse"
          >
            {challengePrompt(currentToken)}
          </p>
          {!facePresent && (
            <p className="text-sm text-slate-500">
              Position your face inside the oval
            </p>
          )}
          {timedOut ? (
            <div className="space-y-2">
              <p className="text-sm text-amber-600">
                We didn't detect that movement in time.
              </p>
              <button
                onClick={retryChallenge}
                className="px-5 py-2 bg-indigo-600 text-white rounded-xl text-sm font-semibold"
              >
                Try again
              </button>
            </div>
          ) : (
            <p className="text-xs text-slate-400">
              Step {currentIndex + 1} of {challenges.length} · {secondsLeft}s left
            </p>
          )}
        </div>
      )}

      {submitError && (
        <div className="p-4 rounded-xl bg-red-50 border border-red-100 text-sm text-red-700 space-y-2">
          <p>{submitError}</p>
          <button
            onClick={() => {
              // Reset the whole challenge and try again honestly.
              eventsRef.current = [];
              sampledFramesRef.current = [];
              completedRef.current = false;
              submittingRef.current = false;
              setSubmitting(false);
              setSubmitError(null);
              setCurrentIndex(0);
            }}
            className="px-4 py-2 bg-red-600 text-white rounded-lg text-sm font-semibold"
          >
            Retry challenge
          </button>
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
    </div>
  );
};

export default SelfieChallengeStep;
