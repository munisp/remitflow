/**
 * wave-15 §8 (K6) — NFC ePassport step (conditional).
 *
 * Rendered only when: docType is passport AND the device reports NFC
 * support (react-native-nfc-manager) AND the session was created with
 * nfcSupported=true. Reads DG1/DG2/SOD + active-auth signature via the
 * native-module contract in src/nfc/NfcPassport.ts (implemented natively
 * by K7) and submits to kycCapture.submitNfcData.
 *
 * Honesty rules:
 *  - UNAVAILABLE (native module not in this build / hardware absent)
 *    → skip this step with an explicit note, never fake a read.
 *  - USER_CANCEL / READ_ERROR → honest message, retry or skip.
 *  - BAC needs the MRZ key (document number + DOB + expiry); v1 asks the
 *    user to type them because the server-side MRZ OCR result is not sent
 *    back to the client. This is stated in the UI.
 */
import React, { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
} from 'react-native';
import { trpc } from '../../services/trpc';
import type { CaptureSession } from './DocumentCaptureStep';
import { NfcPassportError, readPassport } from '../../nfc/NfcPassport';

interface Props {
  session: CaptureSession;
  onDone: () => void;
  /** Skip honestly (unavailable / user declined / repeated read errors). */
  onSkip: (reason: string) => void;
}

/** YYMMDD — loose shape check only; the chip itself validates BAC. */
const MRZ_DATE_RE = /^\d{6}$/;

export default function NfcStep({ session, onDone, onSkip }: Props) {
  const [documentNumber, setDocumentNumber] = useState('');
  const [dateOfBirth, setDateOfBirth] = useState('');
  const [dateOfExpiry, setDateOfExpiry] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submitNfcData = trpc.kycCapture.submitNfcData.useMutation();

  const valid =
    documentNumber.trim().length >= 6 &&
    MRZ_DATE_RE.test(dateOfBirth.trim()) &&
    MRZ_DATE_RE.test(dateOfExpiry.trim());

  const handleRead = async () => {
    if (busy || !valid) return;
    setBusy(true);
    setError(null);
    try {
      const data = await readPassport({
        documentNumber: documentNumber.trim(),
        dateOfBirth: dateOfBirth.trim(),
        dateOfExpiry: dateOfExpiry.trim(),
      });
      await submitNfcData.mutateAsync({
        sessionId: session.sessionId,
        nonce: session.nonce,
        dg1: data.dg1,
        dg2Portrait: data.dg2Portrait,
        sod: data.sod,
        aaSignature: data.aaSignature,
      });
      onDone();
    } catch (e) {
      if (e instanceof NfcPassportError && e.code === 'UNAVAILABLE') {
        onSkip('NFC reading is not available on this device or in this build of the app.');
        return;
      }
      if (e instanceof NfcPassportError && e.code === 'USER_CANCEL') {
        setError('Scan cancelled. Hold the passport against the phone and try again, or skip this step.');
      } else {
        setError(
          e instanceof Error
            ? e.message
            : 'Could not read the passport chip. Check the details and try again, or skip this step.',
        );
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={styles.container}>
      <Text style={styles.icon}>📡</Text>
      <Text style={styles.title}>Read your passport chip</Text>
      <Text style={styles.body}>
        Your passport has an NFC chip that lets us verify it cryptographically. Type the details
        exactly as printed in the machine-readable zone (the two lines at the bottom of the photo
        page), then hold the passport against the back of your phone.
      </Text>

      <View style={styles.field}>
        <Text style={styles.fieldLabel}>Document number</Text>
        <TextInput
          style={styles.input}
          value={documentNumber}
          onChangeText={setDocumentNumber}
          placeholder="e.g. A12345678"
          placeholderTextColor="#6b7280"
          autoCapitalize="characters"
          autoCorrect={false}
        />
      </View>
      <View style={styles.row}>
        <View style={[styles.field, styles.half]}>
          <Text style={styles.fieldLabel}>Date of birth (YYMMDD)</Text>
          <TextInput
            style={styles.input}
            value={dateOfBirth}
            onChangeText={setDateOfBirth}
            placeholder="900101"
            placeholderTextColor="#6b7280"
            keyboardType="number-pad"
            maxLength={6}
          />
        </View>
        <View style={[styles.field, styles.half]}>
          <Text style={styles.fieldLabel}>Expiry (YYMMDD)</Text>
          <TextInput
            style={styles.input}
            value={dateOfExpiry}
            onChangeText={setDateOfExpiry}
            placeholder="301231"
            placeholderTextColor="#6b7280"
            keyboardType="number-pad"
            maxLength={6}
          />
        </View>
      </View>

      {error && <Text style={styles.error}>{error}</Text>}

      <TouchableOpacity
        style={[styles.primaryBtn, (!valid || busy) && styles.btnDisabled]}
        onPress={handleRead}
        disabled={!valid || busy}
      >
        {busy ? (
          <View style={styles.busyRow}>
            <ActivityIndicator color="#fff" />
            <Text style={styles.primaryBtnText}>  Hold passport to phone…</Text>
          </View>
        ) : (
          <Text style={styles.primaryBtnText}>Scan passport chip</Text>
        )}
      </TouchableOpacity>

      <TouchableOpacity
        style={styles.linkBtn}
        onPress={() => onSkip('You chose to skip the chip scan.')}
        disabled={busy}
      >
        <Text style={styles.linkText}>Skip — my passport has no chip or this keeps failing</Text>
      </TouchableOpacity>

      <Text style={styles.note}>
        Skipping is fine: verification continues with the photo evidence, but chip verification
        gives the strongest result.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, paddingTop: 8 },
  icon: { fontSize: 48, textAlign: 'center', marginBottom: 8 },
  title: { color: '#fff', fontSize: 20, fontWeight: '700', textAlign: 'center', marginBottom: 8 },
  body: { color: '#9ca3af', fontSize: 14, lineHeight: 20, textAlign: 'center', marginBottom: 20 },
  field: { marginBottom: 14 },
  row: { flexDirection: 'row', gap: 12 },
  half: { flex: 1 },
  fieldLabel: { color: '#9ca3af', fontSize: 13, marginBottom: 6 },
  input: {
    backgroundColor: '#0f0f1a',
    borderRadius: 10,
    padding: 12,
    color: '#fff',
    fontSize: 15,
    borderWidth: 1,
    borderColor: '#2d2d4e',
  },
  error: { color: '#f87171', fontSize: 13, marginBottom: 8, textAlign: 'center' },
  primaryBtn: { backgroundColor: '#6366f1', borderRadius: 14, padding: 16, alignItems: 'center', marginTop: 8 },
  primaryBtnText: { color: '#fff', fontWeight: '700', fontSize: 15 },
  busyRow: { flexDirection: 'row', alignItems: 'center' },
  btnDisabled: { opacity: 0.6 },
  linkBtn: { alignItems: 'center', padding: 12, marginTop: 4 },
  linkText: { color: '#6366f1', fontSize: 13, fontWeight: '600', textAlign: 'center' },
  note: { color: '#6b7280', fontSize: 12, marginTop: 12, lineHeight: 17, textAlign: 'center' },
});
