/**
 * wave-15 §8 (K6) — Selfie challenge step.
 *
 * Renders the server-issued challenge sequence (K4 startSession →
 * challenge[], steps from {blink, turnLeft, turnRight, smile, jawOpen})
 * one prompt at a time. During each step we capture frames at ~2 fps
 * with the front camera and record step_started / step_completed events
 * with timestamps. Events + sampled frames go to
 * kycCapture.submitChallengeEvents.
 *
 * AUTHORITATIVE validation is server-side (K2 mediapipe endpoint on the
 * sampled frames). v1 intentionally does NOT run client-side blendshape /
 * blink detection — no frame-processor worklets (react-native-worklets-
 * core is not an allowed dep this wave). The UI copy says so honestly.
 *
 * Frame budget: total sampled frames ≤ 6 (contract cap) and any frame
 * over the 2 MB cap is dropped before upload.
 */
import React, { useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { Camera, useCameraDevice } from 'react-native-vision-camera';
import { trpc } from '../../services/trpc';
import type { CaptureSession } from './DocumentCaptureStep';
import {
  base64Bytes,
  challengePrompt,
  challengeStepId,
  MAX_FRAME_BYTES,
  MAX_FRAMES,
  readUriAsBase64,
} from './captureUtils';

interface Props {
  session: CaptureSession;
  isActive: boolean;
  onDone: () => void;
}

interface ChallengeEvent {
  seq: number;
  event: 'step_started' | 'step_completed';
  step: string;
  /** epoch ms */
  at: number;
}

const FRAME_INTERVAL_MS = 500; // ~2 fps
const MAX_FRAMES_PER_STEP = 3;

const delay = (ms: number) => new Promise<void>((resolve) => { setTimeout(() => resolve(), ms); });

export default function SelfieChallengeStep({ session, isActive, onDone }: Props) {
  const camera = useRef<Camera>(null);
  const device = useCameraDevice('front');
  const steps = session.challenge.map(challengeStepId);

  const [stepIndex, setStepIndex] = useState(0);
  const [capturing, setCapturing] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const eventsRef = useRef<ChallengeEvent[]>([]);
  const framesRef = useRef<string[]>([]);
  const seqRef = useRef(0);
  const cancelledRef = useRef(false);
  const submitChallengeEvents = trpc.kycCapture.submitChallengeEvents.useMutation();

  useEffect(() => {
    cancelledRef.current = false;
    return () => {
      cancelledRef.current = true;
    };
  }, []);

  const pushEvent = (event: ChallengeEvent['event'], step: string) => {
    seqRef.current += 1;
    eventsRef.current.push({ seq: seqRef.current, event, step, at: Date.now() });
  };

  /** Capture up to `budget` frames at ~2 fps for one challenge step. */
  const captureStepFrames = async (budget: number) => {
    for (let i = 0; i < budget; i++) {
      if (cancelledRef.current || !camera.current) return;
      try {
        const photo = await camera.current.takePhoto({ flash: 'off' });
        const base64 = await readUriAsBase64(`file://${photo.path}`);
        if (base64Bytes(base64) <= MAX_FRAME_BYTES) {
          framesRef.current.push(base64);
        }
        // oversize frames are silently dropped here — the 2 MB cap is a
        // hard server contract and there is no JS-side resizer available.
      } catch {
        // A single failed snapshot (camera busy mid-step) is not fatal:
        // the server validates whatever sampled frames we do deliver.
      }
      if (i < budget - 1) await delay(FRAME_INTERVAL_MS);
    }
  };

  const runStep = async () => {
    if (capturing || submitting) return;
    const step = steps[stepIndex];
    const remainingBudget = MAX_FRAMES - framesRef.current.length;
    const budget = Math.min(MAX_FRAMES_PER_STEP, remainingBudget);
    setCapturing(true);
    pushEvent('step_started', step);
    if (budget > 0) await captureStepFrames(budget);
    else await delay(1500); // frame budget exhausted — still let the user perform the prompt
    pushEvent('step_completed', step);
    setCapturing(false);
    if (cancelledRef.current) return;

    if (stepIndex < steps.length - 1) {
      setStepIndex((i) => i + 1);
    } else {
      setSubmitting(true);
      try {
        await submitChallengeEvents.mutateAsync({
          sessionId: session.sessionId,
          nonce: session.nonce,
          events: eventsRef.current,
          sampledFrames: framesRef.current,
        });
        onDone();
      } catch (e) {
        Alert.alert(
          'Verification upload failed',
          e instanceof Error ? e.message : 'Could not submit the liveness check. Please try again.',
        );
        setSubmitting(false);
      }
    }
  };

  if (steps.length === 0) {
    // Defensive: contract guarantees 2-4 steps; if the server sent none,
    // skip this stage honestly instead of fabricating a liveness pass.
    return (
      <View style={styles.center}>
        <Text style={styles.title}>No liveness challenges issued</Text>
        <Text style={styles.body}>
          The server did not issue any challenges for this session. You can continue to the result —
          the verification service will decide whether that is acceptable.
        </Text>
        <TouchableOpacity style={styles.primaryBtn} onPress={onDone}>
          <Text style={styles.primaryBtnText}>Continue</Text>
        </TouchableOpacity>
      </View>
    );
  }

  if (!device) {
    return (
      <View style={styles.center}>
        <Text style={styles.title}>No front camera found</Text>
        <Text style={styles.body}>
          The liveness check needs a front-facing camera. Your session will be decided on the
          remaining evidence if you continue.
        </Text>
        <TouchableOpacity style={styles.primaryBtn} onPress={onDone}>
          <Text style={styles.primaryBtnText}>Continue without selfie check</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const step = steps[stepIndex];

  return (
    <View style={styles.container}>
      <View style={styles.cameraWrap}>
        <Camera
          ref={camera}
          style={StyleSheet.absoluteFill}
          device={device}
          isActive={isActive && !submitting}
          photo
        />
        <View style={styles.overlay} pointerEvents="none">
          <View style={styles.faceOutline} />
        </View>
      </View>

      <Text style={styles.stepCounter}>
        Step {stepIndex + 1} of {steps.length}
      </Text>
      <Text style={styles.prompt}>{challengePrompt(step)}</Text>
      <Text style={styles.note}>
        We take a few photos while you do this. A verification service on our servers — not this
        app — decides whether the challenge was performed.
      </Text>

      <TouchableOpacity
        style={[styles.primaryBtn, (capturing || submitting) && styles.btnDisabled]}
        onPress={runStep}
        disabled={capturing || submitting}
      >
        {submitting ? (
          <View style={styles.busyRow}>
            <ActivityIndicator color="#fff" />
            <Text style={styles.primaryBtnText}>  Submitting…</Text>
          </View>
        ) : capturing ? (
          <Text style={styles.primaryBtnText}>Capturing…</Text>
        ) : (
          <Text style={styles.primaryBtnText}>
            {stepIndex === 0 ? "I'm ready" : 'Next step'}
          </Text>
        )}
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  cameraWrap: { flex: 1, borderRadius: 16, overflow: 'hidden', backgroundColor: '#000' },
  overlay: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center' },
  faceOutline: {
    width: '62%',
    aspectRatio: 0.78,
    borderWidth: 2,
    borderColor: '#6366f1',
    borderRadius: 999,
    borderStyle: 'dashed',
  },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  title: { color: '#fff', fontSize: 20, fontWeight: '700', marginBottom: 8 },
  body: { color: '#9ca3af', fontSize: 14, textAlign: 'center', lineHeight: 20, marginBottom: 20 },
  stepCounter: { color: '#6b7280', fontSize: 12, marginTop: 12, textAlign: 'center' },
  prompt: { color: '#fff', fontSize: 22, fontWeight: '800', textAlign: 'center', marginTop: 4 },
  note: { color: '#6b7280', fontSize: 12, marginTop: 8, lineHeight: 17, textAlign: 'center' },
  primaryBtn: { backgroundColor: '#6366f1', borderRadius: 14, padding: 16, alignItems: 'center', marginTop: 16 },
  primaryBtnText: { color: '#fff', fontWeight: '700', fontSize: 15 },
  busyRow: { flexDirection: 'row', alignItems: 'center' },
  btnDisabled: { opacity: 0.6 },
});
