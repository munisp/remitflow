/**
 * wave-15 §8 (K6) — Verdict step.
 *
 * Calls kycCapture.finalize once, then polls kycCapture.getSession until
 * the session reaches a terminal state. Polling is APP-STATE-GATED: it
 * runs only while the app is in the foreground (AppState listener), and
 * stops entirely on a terminal verdict or after a 3-minute timeout
 * (with a manual refresh button — no infinite spinner, no fabricated
 * success).
 *
 * Statuses rendered honestly:
 *  verified      → evidence passed automated checks; tier upgrade still
 *                  requires admin approval (W13 contract) — said plainly.
 *  manual_review → queued for human compliance review.
 *  failed        → rejected, with the server's reason if provided.
 *  expired       → session timed out; user can start over.
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
import { trpc } from '../../services/trpc';
import type { CaptureSession } from './DocumentCaptureStep';

interface Props {
  session: CaptureSession;
  onRestart: () => void;
  onClose: () => void;
}

const TERMINAL = new Set(['verified', 'failed', 'manual_review', 'expired']);
const POLL_INTERVAL_MS = 3000;
const POLL_TIMEOUT_MS = 3 * 60 * 1000;

export default function VerdictStep({ session, onRestart, onClose }: Props) {
  const [finalizeError, setFinalizeError] = useState<string | null>(null);
  const [finalStatus, setFinalStatus] = useState<string | null>(null);
  const [finalVerdict, setFinalVerdict] = useState<Record<string, unknown> | null>(null);
  const [timedOut, setTimedOut] = useState(false);
  const [appActive, setAppActive] = useState(AppState.currentState === 'active');
  const startedAtRef = useRef(Date.now());

  const finalize = trpc.kycCapture.finalize.useMutation({
    onError: (e: any) => setFinalizeError(e?.message ?? 'Could not finalize the session.'),
  });
  const getSession = trpc.kycCapture.getSession.useQuery(
    { sessionId: session.sessionId },
    {
      // App-state-gated polling: only while foregrounded and not terminal.
      refetchInterval: appActive && !finalStatus && !timedOut ? POLL_INTERVAL_MS : false,
      refetchOnWindowFocus: false,
    },
  );

  // Kick off finalization once on mount.
  useEffect(() => {
    finalize
      .mutateAsync({ sessionId: session.sessionId, nonce: session.nonce })
      .then((res: any) => {
        if (res?.status && TERMINAL.has(res.status)) {
          setFinalStatus(res.status);
          setFinalVerdict(res.verdict ?? null);
        }
      })
      .catch(() => {
        /* onError above records the message */
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // App-state gate.
  useEffect(() => {
    const sub = AppState.addEventListener('change', (s) => setAppActive(s === 'active'));
    return () => sub.remove();
  }, []);

  // Poll timeout — stop silently polling forever.
  useEffect(() => {
    const t = setTimeout(() => setTimedOut(true), POLL_TIMEOUT_MS);
    return () => clearTimeout(t);
  }, []);

  // Adopt terminal status from polling.
  useEffect(() => {
    const data: any = getSession.data;
    if (data?.status && TERMINAL.has(data.status)) {
      setFinalStatus(data.status);
      setFinalVerdict(data.verdict ?? null);
    }
  }, [getSession.data]);

  const verdictReason =
    finalVerdict && typeof finalVerdict.reason === 'string' ? finalVerdict.reason : null;

  if (finalizeError) {
    return (
      <View style={styles.center}>
        <Text style={styles.icon}>⚠️</Text>
        <Text style={styles.title}>Could not finish verification</Text>
        <Text style={styles.body}>{finalizeError}</Text>
        <TouchableOpacity style={styles.primaryBtn} onPress={onRestart}>
          <Text style={styles.primaryBtnText}>Start over</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.linkBtn} onPress={onClose}>
          <Text style={styles.linkText}>Back to KYC</Text>
        </TouchableOpacity>
      </View>
    );
  }

  if (!finalStatus) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color="#6366f1" />
        <Text style={styles.title}>Checking your documents…</Text>
        <Text style={styles.body}>
          {timedOut
            ? 'This is taking longer than expected. Automatic refreshing has stopped — check again manually or come back later. Do not resubmit unless asked.'
            : 'Automated checks are running on our servers. This usually takes under a minute. Polling only happens while the app is open.'}
        </Text>
        {timedOut && (
          <TouchableOpacity
            style={styles.primaryBtn}
            onPress={() => {
              startedAtRef.current = Date.now();
              setTimedOut(false);
              void getSession.refetch();
              setTimeout(() => setTimedOut(true), POLL_TIMEOUT_MS);
            }}
          >
            <Text style={styles.primaryBtnText}>Check again</Text>
          </TouchableOpacity>
        )}
      </View>
    );
  }

  if (finalStatus === 'verified') {
    return (
      <View style={styles.center}>
        <Text style={styles.icon}>✅</Text>
        <Text style={styles.title}>Automated checks passed</Text>
        <Text style={styles.body}>
          Your document and liveness evidence passed automated verification. Final approval — and
          any tier upgrade — is still completed by our compliance team; you will be notified.
        </Text>
        <TouchableOpacity style={styles.primaryBtn} onPress={onClose}>
          <Text style={styles.primaryBtnText}>Done</Text>
        </TouchableOpacity>
      </View>
    );
  }

  if (finalStatus === 'manual_review') {
    return (
      <View style={styles.center}>
        <Text style={styles.icon}>🕓</Text>
        <Text style={styles.title}>Sent for manual review</Text>
        <Text style={styles.body}>
          Some checks were inconclusive, so a compliance reviewer will look at your submission.
          You will be notified of the outcome — no further action is needed right now.
        </Text>
        <TouchableOpacity style={styles.primaryBtn} onPress={onClose}>
          <Text style={styles.primaryBtnText}>Done</Text>
        </TouchableOpacity>
      </View>
    );
  }

  if (finalStatus === 'expired') {
    return (
      <View style={styles.center}>
        <Text style={styles.icon}>⏱️</Text>
        <Text style={styles.title}>Session expired</Text>
        <Text style={styles.body}>
          Verification sessions are valid for 10 minutes. This one expired before completion.
        </Text>
        <TouchableOpacity style={styles.primaryBtn} onPress={onRestart}>
          <Text style={styles.primaryBtnText}>Start a new session</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.linkBtn} onPress={onClose}>
          <Text style={styles.linkText}>Back to KYC</Text>
        </TouchableOpacity>
      </View>
    );
  }

  // failed
  return (
    <View style={styles.center}>
      <Text style={styles.icon}>❌</Text>
      <Text style={styles.title}>Verification unsuccessful</Text>
      <Text style={styles.body}>
        {verdictReason ??
          'The automated checks could not verify this submission. You can try again with better lighting and a valid document, or use the photo-upload path for manual review.'}
      </Text>
      <TouchableOpacity style={styles.primaryBtn} onPress={onRestart}>
        <Text style={styles.primaryBtnText}>Try again</Text>
      </TouchableOpacity>
      <TouchableOpacity style={styles.linkBtn} onPress={onClose}>
        <Text style={styles.linkText}>Back to KYC</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  icon: { fontSize: 64, marginBottom: 16 },
  title: { color: '#fff', fontSize: 22, fontWeight: '800', textAlign: 'center', marginBottom: 10 },
  body: { color: '#9ca3af', fontSize: 14, textAlign: 'center', lineHeight: 21, marginBottom: 20 },
  primaryBtn: { backgroundColor: '#6366f1', borderRadius: 14, padding: 16, alignItems: 'center', alignSelf: 'stretch' },
  primaryBtnText: { color: '#fff', fontWeight: '700', fontSize: 15 },
  linkBtn: { alignItems: 'center', padding: 12, marginTop: 4 },
  linkText: { color: '#6366f1', fontSize: 14, fontWeight: '600' },
});
