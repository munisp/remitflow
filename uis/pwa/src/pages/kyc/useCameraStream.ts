/**
 * Camera stream hook for the KYC capture flow.
 *
 * iOS Safari requirements handled here:
 *  - getUserMedia must be called from a user gesture (callers start on tap);
 *  - the <video> element needs playsInline + muted + autoplay or it never
 *    renders inline (callers use <CameraView> which sets these);
 *  - facingMode is requested as `ideal` (not `exact`) because iOS Safari
 *    rejects OverconstrainedError on exact constraints; we then fall back to
 *    a bare {video: true} request if the constrained request fails.
 */
import { useCallback, useEffect, useRef, useState } from "react";

export type CameraFacing = "environment" | "user";

export type CameraError =
  | { kind: "unsupported" }
  | { kind: "denied" }
  | { kind: "unavailable"; message: string };

export interface CameraState {
  stream: MediaStream | null;
  error: CameraError | null;
  starting: boolean;
}

export function cameraSupported(): boolean {
  return (
    typeof navigator !== "undefined" &&
    !!navigator.mediaDevices &&
    typeof navigator.mediaDevices.getUserMedia === "function"
  );
}

export function useCameraStream(facing: CameraFacing, active: boolean) {
  const [state, setState] = useState<CameraState>({
    stream: null,
    error: null,
    starting: false,
  });
  const streamRef = useRef<MediaStream | null>(null);

  const stop = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    setState((s) => ({ ...s, stream: null }));
  }, []);

  const start = useCallback(async () => {
    if (!cameraSupported()) {
      setState({ stream: null, error: { kind: "unsupported" }, starting: false });
      return;
    }
    setState((s) => ({ ...s, starting: true, error: null }));
    const attempts: MediaStreamConstraints[] = [
      // Prefer the requested camera at a readable resolution (ideal, not exact —
      // iOS Safari throws OverconstrainedError on exact facingMode).
      { video: { facingMode: { ideal: facing }, width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false },
      // Fallback: any camera.
      { video: true, audio: false },
    ];
    let lastError: unknown = null;
    for (const constraints of attempts) {
      try {
        const stream = await navigator.mediaDevices.getUserMedia(constraints);
        streamRef.current = stream;
        setState({ stream, error: null, starting: false });
        return;
      } catch (err) {
        lastError = err;
        // Permission denied will not succeed on retry — stop immediately.
        if (
          err instanceof DOMException &&
          (err.name === "NotAllowedError" || err.name === "SecurityError")
        ) {
          break;
        }
      }
    }
    const denied =
      lastError instanceof DOMException &&
      (lastError.name === "NotAllowedError" || lastError.name === "SecurityError");
    setState({
      stream: null,
      starting: false,
      error: denied
        ? { kind: "denied" }
        : {
            kind: "unavailable",
            message:
              lastError instanceof Error
                ? lastError.message
                : "The camera could not be started.",
          },
    });
  }, [facing]);

  // Stop tracks when the step unmounts or becomes inactive.
  useEffect(() => {
    if (!active) stop();
    return () => stop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);

  return { ...state, start, stop };
}

/**
 * Video element wired for inline playback on iOS Safari. Attach the stream
 * via ref effect; srcObject is set imperatively (React does not bind it).
 */
export function bindStreamToVideo(
  video: HTMLVideoElement | null,
  stream: MediaStream | null,
) {
  if (!video) return;
  if (video.srcObject !== stream) {
    video.srcObject = stream;
  }
  if (stream) {
    // iOS Safari: play() can reject if interrupted — surface nothing, the
    // onPlaying handler in the caller gates analysis on real frames anyway.
    void video.play().catch(() => undefined);
  }
}
