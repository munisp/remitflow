import React, { useState } from 'react';
import { View, Text, ScrollView, TouchableOpacity, StyleSheet, TextInput, Alert, ActivityIndicator } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import DocumentPicker from 'react-native-document-picker';
import { trpc } from '../services/trpc';

// W13-C1: rewired to the REAL procs — trpc.kyc.status (query),
// trpc.kyc.uploadDocument (mutation), trpc.profile.update (mutation).
// The previous version called nonexistent kyc.getStatus / kyc.submit and
// fabricated a "submitted for review" success.

const STEPS = ['Personal Info', 'Identity Doc', 'Address', 'Review'];

// Must match the server's kyc_doc_type pgEnum values — anything else fails
// the DB insert in kyc.uploadDocument.
const ID_DOC_TYPES = [
  { id: 'passport', label: 'Passport' },
  { id: 'national_id', label: 'National ID' },
  { id: 'drivers_license', label: "Driver's License" },
] as const;

type IdDocType = (typeof ID_DOC_TYPES)[number]['id'];

interface PickedDocument {
  fileBase64: string;
  fileName: string;
  mimeType: string;
}

/** Read a picked file URI into base64 using only RN built-ins (no new deps). */
async function readUriAsBase64(uri: string): Promise<string> {
  const res = await fetch(uri);
  const blob = await res.blob();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Could not read the selected file'));
    reader.onload = () => {
      const result = String(reader.result ?? '');
      const comma = result.indexOf(',');
      resolve(comma >= 0 ? result.slice(comma + 1) : result);
    };
    reader.readAsDataURL(blob);
  });
}

export default function KYCScreen() {
  const navigation = useNavigation();
  const [step, setStep] = useState(0);
  const [form, setForm] = useState<{
    firstName: string;
    lastName: string;
    dateOfBirth: string;
    addressLine1: string;
    city: string;
    idType: IdDocType;
  }>({
    firstName: '', lastName: '', dateOfBirth: '',
    addressLine1: '', city: '',
    idType: 'passport',
  });
  const [pickedDoc, setPickedDoc] = useState<PickedDocument | null>(null);
  const [uploadedDocType, setUploadedDocType] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const { data: kycStatus, refetch: refetchStatus } = trpc.kyc.status.useQuery();
  const uploadMutation = trpc.kyc.uploadDocument.useMutation({
    onError: (e) => Alert.alert('Upload failed', e.message),
  });
  const profileMutation = trpc.profile.update.useMutation();

  const currentTier = kycStatus?.currentTier ?? 'tier0';
  const documents = kycStatus?.documents ?? [];
  const uploadedIdDoc = documents.find(
    (d) => d.docType === form.idType && (d.status === 'pending' || d.status === 'under_review' || d.status === 'approved'),
  );

  const handlePickAndUpload = async () => {
    try {
      const [file] = await DocumentPicker.pick({
        type: [DocumentPicker.types.images, DocumentPicker.types.pdf],
      });
      if (!file?.uri) return;
      const fileBase64 = await readUriAsBase64(file.uri);
      const picked: PickedDocument = {
        fileBase64,
        fileName: file.name ?? `${form.idType}.jpg`,
        mimeType: file.type ?? 'image/jpeg',
      };
      setPickedDoc(picked);
      const res = await uploadMutation.mutateAsync({
        type: form.idType,
        fileBase64: picked.fileBase64,
        fileName: picked.fileName,
        mimeType: picked.mimeType,
      });
      if (res.success) {
        setUploadedDocType(form.idType);
        Alert.alert(
          'Document uploaded',
          'Your document is queued for review by our compliance team. You will be notified of the outcome.',
        );
        void refetchStatus();
      }
    } catch (err) {
      if (DocumentPicker.isCancel(err)) return;
      Alert.alert(
        'Upload failed',
        err instanceof Error ? err.message : 'Could not upload the document. Please try again.',
      );
    }
  };

  const handleSubmit = async () => {
    if (submitting) return;
    setSubmitting(true);
    try {
      // Persist what the backend actually supports (name / dob / address).
      // There is no self-serve tier-upgrade endpoint: tier advances only via
      // admin document approval, so we do not claim otherwise.
      await profileMutation.mutateAsync({
        name: `${form.firstName} ${form.lastName}`.trim() || undefined,
        dateOfBirth: form.dateOfBirth || undefined,
        address: [form.addressLine1, form.city].filter(Boolean).join(', ') || undefined,
      });
      Alert.alert(
        'Details saved',
        uploadedDocType
          ? 'Your details and document have been submitted. Verification is completed by our compliance team — your tier upgrades only after approval.'
          : 'Your details were saved. Upload an identity document to proceed with verification.',
        [{ text: 'OK', onPress: () => navigation.goBack() }],
      );
    } catch (e) {
      Alert.alert('Error', e instanceof Error ? e.message : 'Could not save your details.');
    } finally {
      setSubmitting(false);
    }
  };

  if (currentTier !== 'tier0') {
    return (
      <View style={styles.container}>
        <TouchableOpacity style={styles.back} onPress={() => navigation.goBack()}>
          <Text style={styles.backText}>← Back</Text>
        </TouchableOpacity>
        <View style={styles.successContainer}>
          <Text style={styles.successIcon}>✅</Text>
          <Text style={styles.successTitle}>KYC {currentTier.replace('tier', 'Tier ')}</Text>
          <Text style={styles.successSub}>
            Your identity verification is approved at {currentTier.replace('tier', 'Tier ')}. Higher tiers unlock increased limits.
          </Text>
        </View>
      </View>
    );
  }

  return (
    <ScrollView style={styles.container}>
      <TouchableOpacity style={styles.back} onPress={() => navigation.goBack()}>
        <Text style={styles.backText}>← Back</Text>
      </TouchableOpacity>
      <Text style={styles.title}>KYC Verification</Text>
      <Text style={styles.tierNote}>
        Current tier: Tier 0 (no transfers). Complete verification to unlock sending.
      </Text>

      {/* Progress */}
      <View style={styles.progress}>
        {STEPS.map((s, i) => (
          <View key={s} style={styles.progressStep}>
            <View style={[styles.progressDot, i <= step && styles.progressDotActive]}>
              <Text style={styles.progressDotText}>{i + 1}</Text>
            </View>
            <Text style={[styles.progressLabel, i <= step && styles.progressLabelActive]}>{s}</Text>
          </View>
        ))}
      </View>

      <View style={styles.card}>
        {step === 0 && (
          <>
            <Text style={styles.stepTitle}>Personal Information</Text>
            {([
              { key: 'firstName', label: 'First Name', placeholder: 'John' },
              { key: 'lastName', label: 'Last Name', placeholder: 'Doe' },
              { key: 'dateOfBirth', label: 'Date of Birth', placeholder: 'YYYY-MM-DD' },
            ] as const).map(({ key, label, placeholder }) => (
              <View key={key} style={styles.field}>
                <Text style={styles.fieldLabel}>{label}</Text>
                <TextInput
                  style={styles.input}
                  value={form[key]}
                  onChangeText={(v) => setForm((f) => ({ ...f, [key]: v }))}
                  placeholder={placeholder}
                  placeholderTextColor="#6b7280"
                />
              </View>
            ))}
          </>
        )}

        {step === 1 && (
          <>
            <Text style={styles.stepTitle}>Identity Document</Text>
            <View style={styles.field}>
              <Text style={styles.fieldLabel}>Document Type</Text>
              <View style={styles.docTypes}>
                {ID_DOC_TYPES.map((t) => (
                  <TouchableOpacity
                    key={t.id}
                    style={[styles.docTypeBtn, form.idType === t.id && styles.docTypeBtnActive]}
                    onPress={() => setForm((f) => ({ ...f, idType: t.id }))}
                  >
                    <Text style={[styles.docTypeBtnText, form.idType === t.id && styles.docTypeBtnTextActive]}>
                      {t.label}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>
            <TouchableOpacity
              style={styles.uploadBtn}
              onPress={handlePickAndUpload}
              disabled={uploadMutation.isPending}
            >
              {uploadMutation.isPending ? (
                <ActivityIndicator color="#6366f1" />
              ) : (
                <Text style={styles.uploadBtnText}>📷 Upload Document Photo</Text>
              )}
            </TouchableOpacity>
            {(uploadedDocType === form.idType || uploadedIdDoc) && (
              <Text style={styles.uploadedNote}>
                {uploadedIdDoc?.status === 'approved'
                  ? 'This document is approved.'
                  : 'Document uploaded — pending compliance review.'}
              </Text>
            )}
          </>
        )}

        {step === 2 && (
          <>
            <Text style={styles.stepTitle}>Residential Address</Text>
            {([
              { key: 'addressLine1', label: 'Address', placeholder: '123 Main Street' },
              { key: 'city', label: 'City', placeholder: 'Lagos' },
            ] as const).map(({ key, label, placeholder }) => (
              <View key={key} style={styles.field}>
                <Text style={styles.fieldLabel}>{label}</Text>
                <TextInput
                  style={styles.input}
                  value={form[key]}
                  onChangeText={(v) => setForm((f) => ({ ...f, [key]: v }))}
                  placeholder={placeholder}
                  placeholderTextColor="#6b7280"
                />
              </View>
            ))}
          </>
        )}

        {step === 3 && (
          <>
            <Text style={styles.stepTitle}>Review & Submit</Text>
            {Object.entries(form).map(([k, v]) => (
              <View key={k} style={styles.reviewRow}>
                <Text style={styles.reviewLabel}>{k.replace(/([A-Z])/g, ' $1').replace(/^./, (s) => s.toUpperCase())}</Text>
                <Text style={styles.reviewValue}>{v || '—'}</Text>
              </View>
            ))}
            <View style={styles.reviewRow}>
              <Text style={styles.reviewLabel}>Document Uploaded</Text>
              <Text style={styles.reviewValue}>{uploadedDocType || uploadedIdDoc ? 'Yes — pending review' : 'No'}</Text>
            </View>
          </>
        )}
      </View>

      <View style={styles.navButtons}>
        {step > 0 && (
          <TouchableOpacity style={styles.prevBtn} onPress={() => setStep((s) => s - 1)}>
            <Text style={styles.prevBtnText}>← Back</Text>
          </TouchableOpacity>
        )}
        <TouchableOpacity
          style={[styles.nextBtn, { flex: step > 0 ? 1 : undefined }]}
          onPress={() => {
            if (step < 3) setStep((s) => s + 1);
            else void handleSubmit();
          }}
          disabled={submitting || uploadMutation.isPending}
        >
          {submitting ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.nextBtnText}>{step < 3 ? 'Next →' : 'Save & Submit'}</Text>
          )}
        </TouchableOpacity>
      </View>

      <View style={{ height: 32 }} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0f0f1a', padding: 16 },
  back: { marginTop: 48, marginBottom: 8 },
  backText: { color: '#6366f1', fontSize: 16, fontWeight: '600' },
  title: { fontSize: 24, fontWeight: '800', color: '#fff', marginBottom: 8 },
  tierNote: { color: '#f59e0b', fontSize: 13, marginBottom: 16 },
  progress: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 24 },
  progressStep: { alignItems: 'center', flex: 1 },
  progressDot: { width: 28, height: 28, borderRadius: 14, backgroundColor: '#2d2d4e', alignItems: 'center', justifyContent: 'center', marginBottom: 4 },
  progressDotActive: { backgroundColor: '#6366f1' },
  progressDotText: { color: '#fff', fontSize: 12, fontWeight: '700' },
  progressLabel: { color: '#6b7280', fontSize: 10, textAlign: 'center' },
  progressLabelActive: { color: '#6366f1' },
  card: { backgroundColor: '#1a1a2e', borderRadius: 16, padding: 20, borderWidth: 1, borderColor: '#2d2d4e', marginBottom: 16 },
  stepTitle: { fontSize: 18, fontWeight: '700', color: '#fff', marginBottom: 16 },
  field: { marginBottom: 14 },
  fieldLabel: { color: '#9ca3af', fontSize: 13, marginBottom: 6 },
  input: { backgroundColor: '#0f0f1a', borderRadius: 10, padding: 12, color: '#fff', fontSize: 15, borderWidth: 1, borderColor: '#2d2d4e' },
  docTypes: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
  docTypeBtn: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 8, backgroundColor: '#0f0f1a', borderWidth: 1, borderColor: '#2d2d4e' },
  docTypeBtnActive: { backgroundColor: '#6366f1', borderColor: '#6366f1' },
  docTypeBtnText: { color: '#9ca3af', fontSize: 13 },
  docTypeBtnTextActive: { color: '#fff' },
  uploadBtn: { backgroundColor: '#0f0f1a', borderRadius: 12, padding: 16, alignItems: 'center', borderWidth: 2, borderColor: '#2d2d4e', borderStyle: 'dashed', marginTop: 8 },
  uploadBtnText: { color: '#6366f1', fontWeight: '600' },
  uploadedNote: { color: '#f59e0b', fontSize: 12, marginTop: 10 },
  reviewRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: '#2d2d4e' },
  reviewLabel: { color: '#9ca3af', fontSize: 13 },
  reviewValue: { color: '#e2e8f0', fontSize: 13, fontWeight: '600', maxWidth: '60%', textAlign: 'right' },
  navButtons: { flexDirection: 'row', gap: 12 },
  prevBtn: { flex: 1, backgroundColor: '#1a1a2e', borderRadius: 14, padding: 16, alignItems: 'center', borderWidth: 1, borderColor: '#2d2d4e' },
  prevBtnText: { color: '#9ca3af', fontWeight: '600', fontSize: 15 },
  nextBtn: { backgroundColor: '#6366f1', borderRadius: 14, padding: 16, alignItems: 'center', paddingHorizontal: 32 },
  nextBtnText: { color: '#fff', fontWeight: '700', fontSize: 15 },
  successContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', paddingTop: 80 },
  successIcon: { fontSize: 80, marginBottom: 16 },
  successTitle: { fontSize: 28, fontWeight: '800', color: '#fff', marginBottom: 8 },
  successSub: { color: '#9ca3af', fontSize: 15, textAlign: 'center', lineHeight: 22 },
});
