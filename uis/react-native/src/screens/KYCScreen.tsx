import React, { useState } from 'react';
import { View, Text, ScrollView, TouchableOpacity, StyleSheet, TextInput, Alert, ActivityIndicator } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { trpc } from '../services/trpc';

const STEPS = ['Personal Info', 'Identity Doc', 'Address', 'Review'];

export default function KYCScreen() {
  const navigation = useNavigation();
  const [step, setStep] = useState(0);
  const [form, setForm] = useState({
    firstName: '', lastName: '', dateOfBirth: '', nationality: '',
    idType: 'passport', idNumber: '', addressLine1: '', city: '', country: '',
  });

  const { data: kycStatus } = trpc.kyc.getStatus.useQuery();
  const submitMutation = trpc.kyc.submit.useMutation({
    onSuccess: () => Alert.alert('KYC Submitted', 'Your KYC application has been submitted for review. You will be notified within 24-48 hours.', [{ text: 'OK', onPress: () => navigation.goBack() }]),
    onError: (e) => Alert.alert('Error', e.message),
  });

  if (kycStatus?.status === 'approved') {
    return (
      <View style={styles.container}>
        <TouchableOpacity style={styles.back} onPress={() => navigation.goBack()}>
          <Text style={styles.backText}>← Back</Text>
        </TouchableOpacity>
        <View style={styles.successContainer}>
          <Text style={styles.successIcon}>✅</Text>
          <Text style={styles.successTitle}>KYC Verified</Text>
          <Text style={styles.successSub}>Your identity has been verified. You have full access to all RemitFlow features.</Text>
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
            {[
              { key: 'firstName', label: 'First Name', placeholder: 'John' },
              { key: 'lastName', label: 'Last Name', placeholder: 'Doe' },
              { key: 'dateOfBirth', label: 'Date of Birth', placeholder: 'YYYY-MM-DD' },
              { key: 'nationality', label: 'Nationality', placeholder: 'Nigerian' },
            ].map(({ key, label, placeholder }) => (
              <View key={key} style={styles.field}>
                <Text style={styles.fieldLabel}>{label}</Text>
                <TextInput
                  style={styles.input}
                  value={form[key as keyof typeof form]}
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
                {['passport', 'national_id', 'drivers_license'].map((t) => (
                  <TouchableOpacity
                    key={t}
                    style={[styles.docTypeBtn, form.idType === t && styles.docTypeBtnActive]}
                    onPress={() => setForm((f) => ({ ...f, idType: t }))}
                  >
                    <Text style={[styles.docTypeBtnText, form.idType === t && styles.docTypeBtnTextActive]}>
                      {t.replace('_', ' ').replace(/\b\w/g, c => c.toUpperCase())}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>
            <View style={styles.field}>
              <Text style={styles.fieldLabel}>Document Number</Text>
              <TextInput
                style={styles.input}
                value={form.idNumber}
                onChangeText={(v) => setForm((f) => ({ ...f, idNumber: v }))}
                placeholder="A12345678"
                placeholderTextColor="#6b7280"
                autoCapitalize="characters"
              />
            </View>
            <TouchableOpacity style={styles.uploadBtn}>
              <Text style={styles.uploadBtnText}>📷 Upload Document Photo</Text>
            </TouchableOpacity>
          </>
        )}

        {step === 2 && (
          <>
            <Text style={styles.stepTitle}>Residential Address</Text>
            {[
              { key: 'addressLine1', label: 'Address', placeholder: '123 Main Street' },
              { key: 'city', label: 'City', placeholder: 'Lagos' },
              { key: 'country', label: 'Country', placeholder: 'Nigeria' },
            ].map(({ key, label, placeholder }) => (
              <View key={key} style={styles.field}>
                <Text style={styles.fieldLabel}>{label}</Text>
                <TextInput
                  style={styles.input}
                  value={form[key as keyof typeof form]}
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
                <Text style={styles.reviewLabel}>{k.replace(/([A-Z])/g, ' $1').replace(/^./, s => s.toUpperCase())}</Text>
                <Text style={styles.reviewValue}>{v || '—'}</Text>
              </View>
            ))}
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
            else submitMutation.mutate(form);
          }}
          disabled={submitMutation.isPending}
        >
          {submitMutation.isPending ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.nextBtnText}>{step < 3 ? 'Next →' : 'Submit KYC'}</Text>
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
  title: { fontSize: 24, fontWeight: '800', color: '#fff', marginBottom: 20 },
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
