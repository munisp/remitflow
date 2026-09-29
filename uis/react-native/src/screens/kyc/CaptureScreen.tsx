/**
 * wave-15 §8 (K6) — KYC camera capture flow (document → selfie challenge
 * → optional NFC → verdict), wired to the K4 server contract:
 *
 *   kycCapture.startSession {docType, nfcSupported}
 *     → {sessionId, nonce, challenge[], expiresAt}
 *   kycCapture.submitDocument {sessionId, nonce, docType, frames: base64[≤6]}
 *   kycCapture.submitChallengeEvents {sessionId, nonce, events[], sampledFrames[]}
 *   kycCapture.submitNfcData {sessionId, nonce, dg1, dg2Portrait, sod, aaSignature}
 *   kycCapture.finalize {sessionId, nonce} → {status, verdict}
 *   kycCapture.getSession {sessionId} → {status, verdict}
 *
 * ════════════════════════════════════════════════════════════════════
 * NATIVE MANIFEST CHANGES REQUIRED (owned by K7 / merge step — K6 may NOT
 * touch android/ or ios/):
 *   ios/…/Info.plist:
 *     - NSCameraUsageDescription (camera capture)
 *     - NFCReaderUsageDescription (ePassport NFC step)
 *     - com.apple.developer.nfc.readersession.formats = TAG (ISO7816)
 *       entitlement for passport reading
 *   android/app/src/main/AndroidManifest.xml:
 *     - <uses-permission android:name="android.permission.CAMERA" />
 *     - <uses-permission android:name="android.permission.NFC" />
 *     - <uses-feature android:name="android.hardware.nfc" android:required="false" />
 *     - <uses-feature android:name="android.hardware.camera.any" android:required="false" />
 *   New JS deps react-native-vision-camera + react-native-nfc-manager
 *   also need their native autolinking build (pods/gradle) at next
 *   native build.
 * ════════════════════════════════════════════════════════════════════
 *
 * Honest-UX rules:
 *  - Camera permission denied → no retry loops; show the reason and offer
 *    the existing image-picker upload path (back on KYCScreen).
 *  - NFC step only appears for passports when the device AND the session
 *    support it; otherwise it is skipped silently and honestly.
 *  - No verdict is ever fabricated client-side: the VerdictStep renders
 *    exactly what finalize/getSession return.
 */
import React, { useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  AppState,
} from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import { useCameraPermission } from 'react-native-vision-camera';
import { trpc } from '../../services/trpc';
import DocumentCaptureStep, { type CaptureSession } from './DocumentCaptureStep';
import SelfieChallengeStep from './SelfieChallengeStep';
import NfcStep from './NfcStep';
import VerdictStep from './VerdictStep';

type Stage = 'starting' | 'document' | 'selfie' | 'nfc' | 'verdict';

const STAGE_LABELS: Record<Exclude<Stage, 'starting'>, string> = {
  document: 'Document',
  selfie: 'Selfie check',
  nfc: 'Passport chip',
  verdict: 'Result',
};

/** Defensive NFC capability probe. react-native-nfc-manager is a new dep
 *  this wave; if it is not yet linked into a running build, require()
 *  throws at bundle time — catch and report "unsupported" so the flow
 *  still works end-to-end without NFC. */
async function probeNfcSupported(): Promise<boolean> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const mod = require('react-native-nfc-manager');
    const NfcManager = mod?.default ?? mod;
    if (!NfcManager?.isSupported) return false;
    return !!(await NfcManager.isSupported());
  } catch {
    return false;
  }
}

export default function CaptureScreen() {
  const navigation = useNavigation();
  const route = useRoute();
  const docType: string = (route.params as { docType?: string } | undefined)?.docType ?? 'passport';

  const { hasPermission, requestPermission } = useCameraPermission();
  const [permissionAsked, setPermissionAsked] = useState(false);
  const [stage, setStage] = useState<Stage>('starting');
  const [session, setSession] = useState<CaptureSession | null>(null);
  const [nfcSupported, setNfcSupported] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);
  const [nfcSkipNote, setNfcSkipNote] = useState<string | null>(null);
  const [appActive, setAppActive] = useState(AppState.currentState === 'active');
  const restartCountRef = useRef(0);

  const startSession = trpc.kycCapture.startSession.useMutation({
    onError: (e: any) => setStartError(e?.message ?? 'Could not start a verification session.'),
  });

  // Camera is only active while this screen is foregrounded.
  useEffect(() => {
    const sub = AppState.addEventListener('change', (s) => setAppActive(s === 'active'));
    return () => sub.remove();
  }, []);

  // Ask for camera permission once on mount.
  useEffect(() => {
    if (!hasPermission && !permissionAsked) {
      setPermissionAsked(true);
      void requestPermission();
    }
  }, [hasPermission, permissionAsked, requestPermission]);

  const beginSession = async () => {
    setStartError(null);
    const nfc = await probeNfcSupported();
    setNfcSupported(nfc);
    try {
      const res: any = await startSession.mutateAsync({ docType, nfcSupported: nfc });
      setSession({
        sessionId: res.sessionId,
        nonce: res.nonce,
        challenge: Array.isArray(res.challenge) ? res.challenge : [],
        expiresAt: res.expiresAt,
      });
      setStage('document');
    } catch {
      /* onError records the message */
    }
  };

  // Start a session once permission is granted.
  useEffect(() => {
    if (hasPermission && stage === 'starting' && !session && !startSession.isPending) {
      void beginSession();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasPermission, stage, session]);

  const goBackToKyc = () => {
    const nav = navigation as any;
    if (nav.canGoBack?.()) nav.goBack();
    else nav.navigate('KYC');
  };

  const restart = () => {
    restartCountRef.current += 1;
    setSession(null);
    setNfcSkipNote(null);
    setStage('starting');
    void beginSession();
  };

  const sessionExpired =
    !!session?.expiresAt && !Number.isNaN(Date.parse(session.expiresAt))
      ? Date.now() > Date.parse(session.expiresAt)
      : false;

  // NFC step applies to ePassports only, and only when both the device and
  // the freshly-created session support NFC.
  const showNfcStep = docType === 'passport' && nfcSupported;

  const advanceAfterSelfie = () => {
    if (showNfcStep) setStage('nfc');
    else setStage('verdict');
  };

  // ── Permission-denied fallback (no retry loop; offer the upload path) ──
  if (permissionAsked && !hasPermission) {
    return (
      <View style={styles.screen}>
        <View style={styles.center}>
          <Text style={styles.icon}>📷</Text>
          <Text style={styles.title}>Camera permission needed</Text>
          <Text style={styles.body}>
            RemitFlow needs camera access to photograph your document and run the liveness check.
            You denied camera access, so this flow cannot continue — you can enable it in system
            settings, or use photo upload instead.
          </Text>
          <TouchableOpacity style={styles.primaryBtn} onPress={() => void requestPermission()}>
            <Text style={styles.primaryBtnText}>Ask again</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.linkBtn} onPress={goBackToKyc}>
            <Text style={styles.linkText}>Upload a photo instead</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  if (startError) {
    return (
      <View style={styles.screen}>
        <View style={styles.center}>
          <Text style={styles.icon}>⚠️</Text>
          <Text style={styles.title}>Could not start verification</Text>
          <Text style={styles.body}>{startError}</Text>
          <TouchableOpacity style={styles.primaryBtn} onPress={() => void beginSession()}>
            <Text style={styles.primaryBtnText}>Retry</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.linkBtn} onPress={goBackToKyc}>
            <Text style={styles.linkText}>Back to KYC</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  if (stage === 'starting' || !session) {
    return (
      <View style={styles.screen}>
        <View style={styles.center}>
          <ActivityIndicator size="large" color="#6366f1" />
          <Text style={styles.body}>Starting a secure verification session…</Text>
        </View>
      </View>
    );
  }

  if (sessionExpired && stage !== 'verdict') {
    return (
      <View style={styles.screen}>
        <View style={styles.center}>
          <Text style={styles.icon}>⏱️</Text>
          <Text style={styles.title}>Session expired</Text>
          <Text style={styles.body}>
            Verification sessions are valid for 10 minutes. Start a new one when you are ready.
          </Text>
          <TouchableOpacity style={styles.primaryBtn} onPress={restart}>
            <Text style={styles.primaryBtnText}>Start a new session</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.linkBtn} onPress={goBackToKyc}>
            <Text style={styles.linkText}>Back to KYC</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  const stageOrder: Array<Exclude<Stage, 'starting'>> = showNfcStep
    ? ['document', 'selfie', 'nfc', 'verdict']
    : ['document', 'selfie', 'verdict'];

  return (
    <View style={styles.screen}>
      <TouchableOpacity style={styles.back} onPress={goBackToKyc}>
        <Text style={styles.backText}>← Cancel</Text>
      </TouchableOpacity>
      <Text style={styles.title}>Identity verification</Text>

      {/* Progress */}
      <View style={styles.progress}>
        {stageOrder.map((s, i) => {
          // 'starting' was handled by an early return above, so `stage`
          // is always one of stageOrder here.
          const currentIdx = stageOrder.indexOf(stage as Exclude<Stage, 'starting'>);
          return (
            <View key={s} style={styles.progressStep}>
              <View style={[styles.progressDot, i <= currentIdx && styles.progressDotActive]}>
                <Text style={styles.progressDotText}>{i + 1}</Text>
              </View>
              <Text style={[styles.progressLabel, i <= currentIdx && styles.progressLabelActive]}>
                {STAGE_LABELS[s]}
              </Text>
            </View>
          );
        })}
      </View>

      {nfcSkipNote && stage === 'verdict' && (
        <Text style={styles.skipNote}>Passport chip step skipped: {nfcSkipNote}</Text>
      )}

      <View style={styles.body}>
        {stage === 'document' && (
          <DocumentCaptureStep
            session={session}
            docType={docType}
            isActive={appActive}
            onDone={() => setStage('selfie')}
            onFallbackToUpload={goBackToKyc}
          />
        )}
        {stage === 'selfie' && (
          <SelfieChallengeStep session={session} isActive={appActive} onDone={advanceAfterSelfie} />
        )}
        {stage === 'nfc' && (
          <NfcStep
            session={session}
            onDone={() => setStage('verdict')}
            onSkip={(reason) => {
              setNfcSkipNote(reason);
              setStage('verdict');
            }}
          />
        )}
        {stage === 'verdict' && (
          <VerdictStep session={session} onRestart={restart} onClose={goBackToKyc} />
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#0f0f1a', padding: 16 },
  back: { marginTop: 48, marginBottom: 8 },
  backText: { color: '#6366f1', fontSize: 16, fontWeight: '600' },
  title: { fontSize: 24, fontWeight: '800', color: '#fff', marginBottom: 8 },
  progress: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 16 },
  progressStep: { alignItems: 'center', flex: 1 },
  progressDot: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: '#2d2d4e',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 4,
  },
  progressDotActive: { backgroundColor: '#6366f1' },
  progressDotText: { color: '#fff', fontSize: 12, fontWeight: '700' },
  progressLabel: { color: '#6b7280', fontSize: 10, textAlign: 'center' },
  progressLabelActive: { color: '#6366f1' },
  skipNote: { color: '#f59e0b', fontSize: 12, marginBottom: 8, textAlign: 'center' },
  body: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  icon: { fontSize: 64, marginBottom: 16 },
  primaryBtn: { backgroundColor: '#6366f1', borderRadius: 14, padding: 16, alignItems: 'center', alignSelf: 'stretch' },
  primaryBtnText: { color: '#fff', fontWeight: '700', fontSize: 15 },
  linkBtn: { alignItems: 'center', padding: 12, marginTop: 4 },
  linkText: { color: '#6366f1', fontSize: 14, fontWeight: '600' },
});
