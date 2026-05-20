/**
 * LivenessCapture — Active Liveness Webcam Component
 *
 * Replaces static image upload for the selfie/liveness KYC step.
 * Records a 4-second video clip via getUserMedia + MediaRecorder,
 * extracts a still frame for passive analysis, and returns both
 * the video blob and the still frame to the parent.
 *
 * Instructions shown to user:
 *  1. Look straight at the camera
 *  2. Blink naturally 2–3 times
 *  3. Slowly turn your head left, then right
 *
 * These instructions match what the Python ActiveLivenessAnalyzer
 * looks for: EAR-based blink detection + yaw/pitch head movement.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Camera, RefreshCw, CheckCircle2, AlertTriangle, Loader2, Eye } from "lucide-react";

export type LivenessCaptureResult = {
  /** Still JPEG frame extracted at the midpoint of the recording */
  stillFrameBlob: Blob;
  stillFrameDataUrl: string;
  /** Full video recording for active liveness analysis */
  videoBlob: Blob;
  /** Duration of the recording in milliseconds */
  durationMs: number;
};

type Props = {
  onCapture: (result: LivenessCaptureResult) => void;
  onCancel?: () => void;
  /** Recording duration in seconds. Default: 4 */
  recordingDurationSec?: number;
};

type Phase =
  | "idle"
  | "requesting_permission"
  | "preview"
  | "countdown"
  | "recording"
  | "processing"
  | "done"
  | "error";

const INSTRUCTIONS = [
  { icon: "👀", text: "Look straight at the camera" },
  { icon: "😉", text: "Blink naturally 2–3 times" },
  { icon: "↔️", text: "Slowly turn your head left, then right" },
];

export default function LivenessCapture({
  onCapture,
  onCancel,
  recordingDurationSec = 4,
}: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);

  const [phase, setPhase] = useState<Phase>("idle");
  const [countdown, setCountdown] = useState(3);
  const [recordingProgress, setRecordingProgress] = useState(0);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [stillPreview, setStillPreview] = useState<string | null>(null);

  // ── Cleanup on unmount ──────────────────────────────────────────────────────
  useEffect(() => {
    return () => {
      stopStream();
    };
  }, []);

  const stopStream = () => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
  };

  // ── Request camera permission and start preview ───────────────────────────
  const startPreview = useCallback(async () => {
    setPhase("requesting_permission");
    setErrorMsg(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 640 }, height: { ideal: 480 }, facingMode: "user" },
        audio: false,
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        videoRef.current.play();
      }
      setPhase("preview");
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes("Permission") || msg.includes("NotAllowed")) {
        setErrorMsg("Camera access denied. Please allow camera access in your browser settings and try again.");
      } else if (msg.includes("NotFound") || msg.includes("DevicesNotFound")) {
        setErrorMsg("No camera found. Please connect a camera and try again.");
      } else {
        setErrorMsg(`Camera error: ${msg}`);
      }
      setPhase("error");
    }
  }, []);

  // ── Countdown then record ─────────────────────────────────────────────────
  const startCountdown = useCallback(() => {
    setPhase("countdown");
    setCountdown(3);
    let c = 3;
    const iv = setInterval(() => {
      c -= 1;
      setCountdown(c);
      if (c <= 0) {
        clearInterval(iv);
        startRecording();
      }
    }, 1000);
  }, []);

  // ── Recording ─────────────────────────────────────────────────────────────
  const startRecording = useCallback(() => {
    if (!streamRef.current) return;
    setPhase("recording");
    setRecordingProgress(0);
    chunksRef.current = [];

    // Choose best supported MIME type
    const mimeType = ["video/webm;codecs=vp9", "video/webm;codecs=vp8", "video/webm", "video/mp4"]
      .find((m) => MediaRecorder.isTypeSupported(m)) ?? "";

    const recorder = new MediaRecorder(streamRef.current, mimeType ? { mimeType } : undefined);
    recorderRef.current = recorder;

    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) chunksRef.current.push(e.data);
    };

    recorder.onstop = () => {
      processRecording(mimeType || "video/webm");
    };

    recorder.start(200); // collect chunks every 200ms

    // Progress bar
    const totalMs = recordingDurationSec * 1000;
    const startTime = Date.now();
    const progressIv = setInterval(() => {
      const elapsed = Date.now() - startTime;
      setRecordingProgress(Math.min((elapsed / totalMs) * 100, 100));
    }, 100);

    // Auto-stop after duration
    setTimeout(() => {
      clearInterval(progressIv);
      setRecordingProgress(100);
      if (recorder.state !== "inactive") recorder.stop();
    }, totalMs);
  }, [recordingDurationSec]);

  // ── Process recording: extract still frame + build result ─────────────────
  const processRecording = useCallback(
    async (mimeType: string) => {
      setPhase("processing");
      try {
        const videoBlob = new Blob(chunksRef.current, { type: mimeType });
        const durationMs = recordingDurationSec * 1000;

        // Extract still frame from the live video element (current frame at stop time)
        let stillFrameBlob: Blob;
        let stillFrameDataUrl: string;

        if (canvasRef.current && videoRef.current) {
          const canvas = canvasRef.current;
          const video = videoRef.current;
          canvas.width = video.videoWidth || 640;
          canvas.height = video.videoHeight || 480;
          const ctx = canvas.getContext("2d");
          if (ctx) {
            ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
            stillFrameDataUrl = canvas.toDataURL("image/jpeg", 0.92);
            stillFrameBlob = await new Promise<Blob>((resolve) =>
              canvas.toBlob((b) => resolve(b!), "image/jpeg", 0.92)
            );
          } else {
            throw new Error("Could not get canvas context");
          }
        } else {
          throw new Error("Canvas or video element not available");
        }

        setStillPreview(stillFrameDataUrl);
        stopStream();
        setPhase("done");

        onCapture({ stillFrameBlob, stillFrameDataUrl, videoBlob, durationMs });
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        setErrorMsg(`Processing failed: ${msg}`);
        setPhase("error");
      }
    },
    [recordingDurationSec, onCapture]
  );

  const retake = () => {
    setStillPreview(null);
    setErrorMsg(null);
    stopStream();
    setPhase("idle");
  };

  // ─── Render ───────────────────────────────────────────────────────────────
  return (
    <div className="space-y-4">
      {/* Instructions */}
      {(phase === "idle" || phase === "preview") && (
        <div className="rounded-xl bg-blue-50 border border-blue-100 p-3 space-y-1.5">
          <p className="text-xs font-semibold text-blue-700 uppercase tracking-wide">
            Active Liveness Check — Instructions
          </p>
          {INSTRUCTIONS.map((ins, i) => (
            <div key={i} className="flex items-center gap-2 text-sm text-blue-800">
              <span className="text-base">{ins.icon}</span>
              <span>{ins.text}</span>
            </div>
          ))}
        </div>
      )}

      {/* Video preview / recording */}
      <div className="relative rounded-xl overflow-hidden bg-black aspect-video">
        <video
          ref={videoRef}
          className={`w-full h-full object-cover ${phase === "done" ? "hidden" : ""}`}
          muted
          playsInline
        />
        <canvas ref={canvasRef} className="hidden" />

        {/* Still frame preview after done */}
        {phase === "done" && stillPreview && (
          <img src={stillPreview} alt="Captured frame" className="w-full h-full object-cover" />
        )}

        {/* Idle overlay */}
        {phase === "idle" && (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/60 text-white gap-3">
            <Camera className="h-12 w-12 opacity-60" />
            <p className="text-sm opacity-80">Camera preview will appear here</p>
          </div>
        )}

        {/* Requesting permission overlay */}
        {phase === "requesting_permission" && (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/70 text-white gap-3">
            <Loader2 className="h-10 w-10 animate-spin" />
            <p className="text-sm">Requesting camera access…</p>
          </div>
        )}

        {/* Countdown overlay */}
        {phase === "countdown" && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/40">
            <div className="text-white text-7xl font-bold drop-shadow-lg animate-pulse">
              {countdown}
            </div>
          </div>
        )}

        {/* Recording indicator */}
        {phase === "recording" && (
          <div className="absolute top-3 left-3 flex items-center gap-2">
            <span className="h-3 w-3 rounded-full bg-red-500 animate-pulse" />
            <Badge variant="destructive" className="text-xs">REC</Badge>
          </div>
        )}

        {/* Recording progress bar */}
        {phase === "recording" && (
          <div className="absolute bottom-0 left-0 right-0 h-1.5 bg-white/20">
            <div
              className="h-full bg-red-500 transition-all duration-100"
              style={{ width: `${recordingProgress}%` }}
            />
          </div>
        )}

        {/* Processing overlay */}
        {phase === "processing" && (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/60 text-white gap-3">
            <Loader2 className="h-10 w-10 animate-spin" />
            <p className="text-sm">Processing liveness check…</p>
          </div>
        )}

        {/* Done overlay */}
        {phase === "done" && (
          <div className="absolute top-3 right-3">
            <Badge className="bg-emerald-600 text-white gap-1">
              <CheckCircle2 className="h-3 w-3" /> Captured
            </Badge>
          </div>
        )}

        {/* Face guide overlay (preview + countdown) */}
        {(phase === "preview" || phase === "countdown") && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <div className="w-48 h-60 border-2 border-white/50 rounded-full" />
          </div>
        )}
      </div>

      {/* Error state */}
      {phase === "error" && errorMsg && (
        <div className="flex items-start gap-2 rounded-xl bg-red-50 border border-red-200 p-3 text-sm text-red-700">
          <AlertTriangle className="h-4 w-4 flex-shrink-0 mt-0.5" />
          <span>{errorMsg}</span>
        </div>
      )}

      {/* Active liveness badge */}
      {(phase === "preview" || phase === "countdown" || phase === "recording") && (
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Eye className="h-3.5 w-3.5" />
          <span>Active liveness — blink detection + head movement analysis</span>
        </div>
      )}

      {/* Action buttons */}
      <div className="flex gap-3">
        {phase === "idle" && (
          <>
            <Button className="flex-1" onClick={startPreview}>
              <Camera className="h-4 w-4 mr-2" /> Open Camera
            </Button>
            {onCancel && (
              <Button variant="outline" onClick={onCancel}>
                Use Photo Instead
              </Button>
            )}
          </>
        )}

        {phase === "preview" && (
          <>
            <Button className="flex-1" onClick={startCountdown}>
              <Camera className="h-4 w-4 mr-2" /> Start Recording ({recordingDurationSec}s)
            </Button>
            <Button variant="outline" onClick={() => { stopStream(); setPhase("idle"); }}>
              Cancel
            </Button>
          </>
        )}

        {(phase === "error") && (
          <>
            <Button className="flex-1" onClick={startPreview}>
              <RefreshCw className="h-4 w-4 mr-2" /> Try Again
            </Button>
            {onCancel && (
              <Button variant="outline" onClick={onCancel}>
                Use Photo Instead
              </Button>
            )}
          </>
        )}

        {phase === "done" && (
          <Button variant="outline" className="flex-1" onClick={retake}>
            <RefreshCw className="h-4 w-4 mr-2" /> Retake
          </Button>
        )}
      </div>
    </div>
  );
}
