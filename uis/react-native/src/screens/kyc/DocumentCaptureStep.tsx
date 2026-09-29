/**
 * wave-15 §8 (K6) — Document capture step.
 *
 * react-native-vision-camera view with a document-outline overlay,
 * lightweight pre-flight quality hints (resolution + a compressed-size
 * sharpness proxy — see captureUtils.ts for why it is a proxy, not a
 * Laplacian), and a 3-frame burst submitted to kycCapture.submitDocument.
 *
 * Honest-UX notes:
 *  - Client gates only WARN; the server pipeline (OCR/MRZ/authenticity)
 *    is authoritative and can still reject the document.
 *  - takePhoto (vision-camera v4) has no JPEG-quality option, so frame
 *    size is controlled by capping the burst count (3 ≤ the 6-frame
 *    contract limit) and dropping any frame over the 2 MB contract cap.
 */
import React, { useRef, useState } from 'react';
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
import {
  assessFrame,
  base64Bytes,
  MAX_FRAME_BYTES,
  readUriAsBase64,
} from './captureUtils';

export interface CaptureSession {
  sessionId: string;
  nonce: string;
  challenge: unknown[];
  expiresAt?: string;
}

interface Props {
  session: CaptureSession;
  docType: string;
  isActive: boolean;
  onDone: () => void;
  onFallbackToUpload: () => void;
}

const BURST_COUNT = 3;
const BURST_GAP_MS = 350;

const delay = (ms: number) => new Promise<void>((resolve) => { setTimeout(() => resolve(), ms); });

export default function DocumentCaptureStep({ session, docType, isActive, onDone, onFallbackToUpload }: Props) {
  const camera = useRef<Camera>(null);
  const device = useCameraDevice('back');
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [hint, setHint] = useState<string | null>(null);
  const submitDocument = trpc.kycCapture.submitDocument.useMutation();

  const captureBurst = async () => {
    if (busy || !camera.current) return;
    setBusy(true);
    setHint(null);
    setProgress(0);
    try {
      const frames: string[] = [];
      const warnings: string[] = [];
      for (let i = 0; i < BURST_COUNT; i++) {
        const photo = await camera.current.takePhoto({ flash: 'off' });
        const base64 = await readUriAsBase64(`file://${photo.path}`);
        const bytes = base64Bytes(base64);
        if (bytes > MAX_FRAME_BYTES) {
          // Contract cap is 2 MB/frame — drop oversize frames rather than
          // upload a payload the server must reject.
          warnings.push('One photo was too large and was dropped.');
        } else {
          const q = assessFrame({ compressedBytes: bytes, width: photo.width, height: photo.height });
          if (q.level === 'warn' && q.message) warnings.push(q.message);
          frames.push(base64);
        }
        setProgress(i + 1);
        if (i < BURST_COUNT - 1) await delay(BURST_GAP_MS);
      }
      if (frames.length === 0) {
        setHint('The captured photos were unusable (too large). Please try again with the document closer and steady.');
        return;
      }
      if (warnings.length > 0) setHint(warnings[0]);
      await submitDocument.mutateAsync({
        sessionId: session.sessionId,
        nonce: session.nonce,
        docType,
        frames,
      });
      onDone();
    } catch (e) {
      Alert.alert(
        'Capture failed',
        e instanceof Error ? e.message : 'Could not capture the document. You can retry or upload a photo instead.',
      );
    } finally {
      setBusy(false);
    }
  };

  if (!device) {
    return (
      <View style={styles.center}>
        <Text style={styles.title}>No camera found</Text>
        <Text style={styles.body}>
          This device does not report a usable back camera. You can upload a document photo instead.
        </Text>
        <TouchableOpacity style={styles.primaryBtn} onPress={onFallbackToUpload}>
          <Text style={styles.primaryBtnText}>Upload a photo instead</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.cameraWrap}>
        <Camera
          ref={camera}
          style={StyleSheet.absoluteFill}
          device={device}
          isActive={isActive && !busy}
          photo
        />
        {/* Document-outline overlay */}
        <View style={styles.overlay} pointerEvents="none">
          <View style={styles.docOutline} />
          <Text style={styles.overlayText}>
            Fit the {docType.replace(/_/g, ' ')} inside the frame
          </Text>
        </View>
      </View>

      {hint && <Text style={styles.hint}>{hint}</Text>}
      <Text style={styles.note}>
        Good lighting, no glare. Photos are checked on our servers — a warning here does not guarantee acceptance or rejection.
      </Text>

      <TouchableOpacity
        style={[styles.primaryBtn, busy && styles.btnDisabled]}
        onPress={captureBurst}
        disabled={busy}
      >
        {busy ? (
          <View style={styles.busyRow}>
            <ActivityIndicator color="#fff" />
            <Text style={styles.primaryBtnText}>  Capturing {progress}/{BURST_COUNT}…</Text>
          </View>
        ) : (
          <Text style={styles.primaryBtnText}>Capture document</Text>
        )}
      </TouchableOpacity>

      <TouchableOpacity style={styles.linkBtn} onPress={onFallbackToUpload} disabled={busy}>
        <Text style={styles.linkText}>Upload a photo instead</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  cameraWrap: { flex: 1, borderRadius: 16, overflow: 'hidden', backgroundColor: '#000' },
  overlay: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center' },
  docOutline: {
    width: '85%',
    aspectRatio: 1.586, // ID-1 / passport page aspect
    borderWidth: 2,
    borderColor: '#6366f1',
    borderRadius: 12,
    borderStyle: 'dashed',
  },
  overlayText: { color: '#fff', marginTop: 16, fontSize: 14, fontWeight: '600', textShadowColor: '#000', textShadowRadius: 4 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  title: { color: '#fff', fontSize: 20, fontWeight: '700', marginBottom: 8 },
  body: { color: '#9ca3af', fontSize: 14, textAlign: 'center', lineHeight: 20, marginBottom: 20 },
  hint: { color: '#f59e0b', fontSize: 13, marginTop: 12 },
  note: { color: '#6b7280', fontSize: 12, marginTop: 8, lineHeight: 17 },
  primaryBtn: { backgroundColor: '#6366f1', borderRadius: 14, padding: 16, alignItems: 'center', marginTop: 16 },
  primaryBtnText: { color: '#fff', fontWeight: '700', fontSize: 15 },
  busyRow: { flexDirection: 'row', alignItems: 'center' },
  btnDisabled: { opacity: 0.6 },
  linkBtn: { alignItems: 'center', padding: 12, marginTop: 4 },
  linkText: { color: '#6366f1', fontSize: 14, fontWeight: '600' },
});
