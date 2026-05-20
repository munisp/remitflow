import React, { useEffect, useState, useCallback } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  TextInput,
  ActivityIndicator,
  Alert,
  StyleSheet,
} from 'react-native';
import { useAppDispatch, useAppSelector } from '../../store';
import { fetchKYCStatus } from '../../store/slices/kycSlice';

const KYC_API = process.env.KYC_API_URL || 'http://localhost:8098';

const NIGERIAN_STATES = [
  'Abia','Adamawa','Akwa Ibom','Anambra','Bauchi','Bayelsa','Benue','Borno',
  'Cross River','Delta','Ebonyi','Edo','Ekiti','Enugu','FCT Abuja','Gombe',
  'Imo','Jigawa','Kaduna','Kano','Katsina','Kebbi','Kogi','Kwara','Lagos',
  'Nasarawa','Niger','Ogun','Ondo','Osun','Oyo','Plateau','Rivers','Sokoto',
  'Taraba','Yobe','Zamfara',
];

type Step = 'info' | 'identity' | 'documents' | 'review' | 'complete';

export const KYCScreen = ({ navigation }: any) => {
  const dispatch = useAppDispatch();
  const { kycStatus, documents } = useAppSelector((s) => s.kyc);

  const [step, setStep] = useState<Step>('info');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [form, setForm] = useState({
    first_name: '',
    last_name: '',
    date_of_birth: '',
    phone_number: '',
    email: '',
    address: '',
    city: '',
    state: '',
    nin: '',
    bvn: '',
    tier: 'tier_1',
  });

  const [verified, setVerified] = useState({ nin: false, bvn: false, selfie: false });

  useEffect(() => {
    dispatch(fetchKYCStatus());
  }, [dispatch]);

  const updateField = useCallback((field: string, value: string) => {
    setForm((prev) => ({ ...prev, [field]: value }));
  }, []);

  const apiCall = async (url: string, body?: Record<string, unknown>) => {
    const opts: RequestInit = body
      ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }
      : { method: 'POST' };
    const res = await fetch(url, opts);
    return res.json();
  };

  const registerKYC = async () => {
    if (!form.first_name || !form.last_name || !form.phone_number || !form.address || !form.city || !form.state) {
      setError('Please fill all required fields');
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const data = await apiCall(`${KYC_API}/kyc/register`, { ...form, customer_id: 'mobile-user' });
      if (data.success) {
        setStep('identity');
      } else {
        setError(data.error || 'Registration failed');
      }
    } catch {
      setError('Network error. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const verifyNIN = async () => {
    if (form.nin.length !== 11) {
      setError('NIN must be 11 digits');
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const data = await apiCall(`${KYC_API}/kyc/verify/nin?customer_id=mobile-user&nin=${form.nin}`);
      if (data.success) {
        setVerified((p) => ({ ...p, nin: true }));
      } else {
        setError(data.error || 'NIN verification failed');
      }
    } catch {
      setError('Network error. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const verifyBVN = async () => {
    if (form.bvn.length !== 11) {
      setError('BVN must be 11 digits');
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const data = await apiCall(`${KYC_API}/kyc/verify/bvn?customer_id=mobile-user&bvn=${form.bvn}`);
      if (data.success) {
        setVerified((p) => ({ ...p, bvn: true }));
      } else {
        setError(data.error || 'BVN verification failed');
      }
    } catch {
      setError('Network error. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const captureSelfie = () => {
    Alert.alert('Selfie Capture', 'Camera would open for selfie capture', [
      {
        text: 'Simulate Capture',
        onPress: () => setVerified((p) => ({ ...p, selfie: true })),
      },
      { text: 'Cancel', style: 'cancel' },
    ]);
  };

  const submitKYC = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await apiCall(`${KYC_API}/kyc/approve?customer_id=mobile-user`);
      if (data.success) {
        setStep('complete');
        dispatch(fetchKYCStatus());
      } else {
        setError(data.error || 'Submission failed');
      }
    } catch {
      setError('Network error. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const tierLabels: Record<string, string> = {
    tier_1: 'Tier 1 \u2014 \u20A6300,000/day',
    tier_2: 'Tier 2 \u2014 \u20A61,000,000/day',
    tier_3: 'Tier 3 \u2014 Unlimited',
  };

  const stepIndex: Record<Step, number> = { info: 0, identity: 1, documents: 2, review: 3, complete: 4 };

  if (kycStatus === 'verified') {
    return (
      <ScrollView style={styles.container}>
        <View style={styles.successCard}>
          <Text style={styles.successIcon}>{'\u2713'}</Text>
          <Text style={styles.title}>KYC Verified</Text>
          <Text style={styles.subtitle}>Your identity has been successfully verified.</Text>
          <Text style={styles.infoText}>Documents: {documents.length} uploaded</Text>
        </View>
      </ScrollView>
    );
  }

  return (
    <ScrollView style={styles.container}>
      <Text style={styles.title}>KYC Verification</Text>

      <View style={styles.progressRow}>
        {(['Info', 'Identity', 'Documents', 'Review', 'Done'] as const).map((label, i) => (
          <View key={label} style={[styles.progressStep, i <= stepIndex[step] && styles.progressStepActive]}>
            <Text style={[styles.progressText, i <= stepIndex[step] && styles.progressTextActive]}>{label}</Text>
          </View>
        ))}
      </View>

      {error && (
        <View style={styles.errorBox}>
          <Text style={styles.errorText}>{error}</Text>
        </View>
      )}

      {step === 'info' && (
        <View style={styles.card}>
          <Text style={styles.sectionTitle}>Personal Information</Text>
          <TextInput style={styles.input} placeholder="First Name *" value={form.first_name} onChangeText={(v) => updateField('first_name', v)} />
          <TextInput style={styles.input} placeholder="Last Name *" value={form.last_name} onChangeText={(v) => updateField('last_name', v)} />
          <TextInput style={styles.input} placeholder="Date of Birth (YYYY-MM-DD)" value={form.date_of_birth} onChangeText={(v) => updateField('date_of_birth', v)} />
          <TextInput style={styles.input} placeholder="Phone (+234...) *" value={form.phone_number} onChangeText={(v) => updateField('phone_number', v)} keyboardType="phone-pad" />
          <TextInput style={styles.input} placeholder="Email" value={form.email} onChangeText={(v) => updateField('email', v)} keyboardType="email-address" />
          <TextInput style={styles.input} placeholder="Address *" value={form.address} onChangeText={(v) => updateField('address', v)} />
          <TextInput style={styles.input} placeholder="City *" value={form.city} onChangeText={(v) => updateField('city', v)} />

          <Text style={styles.label}>State *</Text>
          <ScrollView horizontal style={styles.stateScroll}>
            {NIGERIAN_STATES.map((s) => (
              <TouchableOpacity key={s} style={[styles.stateChip, form.state === s && styles.stateChipActive]} onPress={() => updateField('state', s)}>
                <Text style={[styles.stateChipText, form.state === s && styles.stateChipTextActive]}>{s}</Text>
              </TouchableOpacity>
            ))}
          </ScrollView>

          <Text style={styles.label}>KYC Tier</Text>
          {(['tier_1', 'tier_2', 'tier_3'] as const).map((t) => (
            <TouchableOpacity key={t} style={[styles.tierOption, form.tier === t && styles.tierOptionActive]} onPress={() => updateField('tier', t)}>
              <Text style={form.tier === t ? styles.tierTextActive : styles.tierText}>{tierLabels[t]}</Text>
            </TouchableOpacity>
          ))}

          <TouchableOpacity style={styles.primaryBtn} onPress={registerKYC} disabled={loading}>
            {loading ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryBtnText}>Continue</Text>}
          </TouchableOpacity>
        </View>
      )}

      {step === 'identity' && (
        <View style={styles.card}>
          <Text style={styles.sectionTitle}>Identity Verification</Text>

          <View style={styles.verifySection}>
            <Text style={styles.label}>NIN (11 digits)</Text>
            <View style={styles.row}>
              <TextInput style={[styles.input, styles.flexInput]} placeholder="Enter NIN" value={form.nin} onChangeText={(v) => updateField('nin', v)} keyboardType="numeric" maxLength={11} />
              <TouchableOpacity style={[styles.verifyBtn, verified.nin && styles.verifiedBtn]} onPress={verifyNIN} disabled={loading || verified.nin}>
                <Text style={styles.verifyBtnText}>{verified.nin ? 'Verified' : 'Verify'}</Text>
              </TouchableOpacity>
            </View>
          </View>

          <View style={styles.verifySection}>
            <Text style={styles.label}>BVN (11 digits)</Text>
            <View style={styles.row}>
              <TextInput style={[styles.input, styles.flexInput]} placeholder="Enter BVN" value={form.bvn} onChangeText={(v) => updateField('bvn', v)} keyboardType="numeric" maxLength={11} />
              <TouchableOpacity style={[styles.verifyBtn, verified.bvn && styles.verifiedBtn]} onPress={verifyBVN} disabled={loading || verified.bvn}>
                <Text style={styles.verifyBtnText}>{verified.bvn ? 'Verified' : 'Verify'}</Text>
              </TouchableOpacity>
            </View>
          </View>

          <View style={styles.btnRow}>
            <TouchableOpacity style={styles.secondaryBtn} onPress={() => setStep('info')}>
              <Text style={styles.secondaryBtnText}>Back</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.primaryBtn, (!verified.nin || !verified.bvn) && styles.disabledBtn]} onPress={() => setStep('documents')} disabled={!verified.nin || !verified.bvn}>
              <Text style={styles.primaryBtnText}>Continue</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}

      {step === 'documents' && (
        <View style={styles.card}>
          <Text style={styles.sectionTitle}>Document Upload</Text>

          <TouchableOpacity style={styles.uploadBtn} onPress={() => navigation.navigate('DocumentUpload')}>
            <Text style={styles.uploadBtnText}>Upload ID Document</Text>
          </TouchableOpacity>

          <TouchableOpacity style={styles.uploadBtn} onPress={() => navigation.navigate('DocumentUpload')}>
            <Text style={styles.uploadBtnText}>Upload Utility Bill</Text>
          </TouchableOpacity>

          <TouchableOpacity style={[styles.uploadBtn, verified.selfie && styles.verifiedBtn]} onPress={captureSelfie}>
            <Text style={styles.uploadBtnText}>{verified.selfie ? 'Selfie Captured' : 'Capture Selfie'}</Text>
          </TouchableOpacity>

          <View style={styles.btnRow}>
            <TouchableOpacity style={styles.secondaryBtn} onPress={() => setStep('identity')}>
              <Text style={styles.secondaryBtnText}>Back</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.primaryBtn} onPress={() => setStep('review')}>
              <Text style={styles.primaryBtnText}>Continue</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}

      {step === 'review' && (
        <View style={styles.card}>
          <Text style={styles.sectionTitle}>Review &amp; Submit</Text>

          <View style={styles.reviewRow}><Text style={styles.reviewLabel}>Name</Text><Text style={styles.reviewValue}>{form.first_name} {form.last_name}</Text></View>
          <View style={styles.reviewRow}><Text style={styles.reviewLabel}>Phone</Text><Text style={styles.reviewValue}>{form.phone_number}</Text></View>
          <View style={styles.reviewRow}><Text style={styles.reviewLabel}>Address</Text><Text style={styles.reviewValue}>{form.address}, {form.city}, {form.state}</Text></View>
          <View style={styles.reviewRow}><Text style={styles.reviewLabel}>NIN</Text><Text style={styles.reviewValue}>{verified.nin ? 'Verified' : 'Not Verified'}</Text></View>
          <View style={styles.reviewRow}><Text style={styles.reviewLabel}>BVN</Text><Text style={styles.reviewValue}>{verified.bvn ? 'Verified' : 'Not Verified'}</Text></View>
          <View style={styles.reviewRow}><Text style={styles.reviewLabel}>Selfie</Text><Text style={styles.reviewValue}>{verified.selfie ? 'Captured' : 'Not Captured'}</Text></View>
          <View style={styles.reviewRow}><Text style={styles.reviewLabel}>Tier</Text><Text style={styles.reviewValue}>{tierLabels[form.tier]}</Text></View>

          <View style={styles.btnRow}>
            <TouchableOpacity style={styles.secondaryBtn} onPress={() => setStep('documents')}>
              <Text style={styles.secondaryBtnText}>Back</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.primaryBtn} onPress={submitKYC} disabled={loading}>
              {loading ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryBtnText}>Submit KYC</Text>}
            </TouchableOpacity>
          </View>
        </View>
      )}

      {step === 'complete' && (
        <View style={styles.successCard}>
          <Text style={styles.successIcon}>{'\u2713'}</Text>
          <Text style={styles.title}>KYC Submitted!</Text>
          <Text style={styles.subtitle}>Your verification is being processed.</Text>
          <Text style={styles.infoText}>{tierLabels[form.tier]}</Text>
          <TouchableOpacity style={styles.primaryBtn} onPress={() => navigation.goBack()}>
            <Text style={styles.primaryBtnText}>Go to Dashboard</Text>
          </TouchableOpacity>
        </View>
      )}
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f5f5f5', padding: 16 },
  title: { fontSize: 24, fontWeight: 'bold', marginBottom: 16, color: '#1a1a1a' },
  subtitle: { fontSize: 14, color: '#666', marginBottom: 12 },
  progressRow: { flexDirection: 'row', marginBottom: 20, gap: 4 },
  progressStep: { flex: 1, paddingVertical: 8, backgroundColor: '#e5e7eb', borderRadius: 6, alignItems: 'center' },
  progressStepActive: { backgroundColor: '#667eea' },
  progressText: { fontSize: 11, color: '#666', fontWeight: '500' },
  progressTextActive: { color: '#fff' },
  card: { backgroundColor: '#fff', padding: 20, borderRadius: 12, marginBottom: 20, shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.1, shadowRadius: 4, elevation: 3 },
  sectionTitle: { fontSize: 18, fontWeight: '600', marginBottom: 16, color: '#1a1a1a' },
  label: { fontSize: 14, fontWeight: '500', color: '#374151', marginBottom: 6, marginTop: 8 },
  input: { borderWidth: 1, borderColor: '#ddd', borderRadius: 8, padding: 12, fontSize: 14, marginBottom: 12, backgroundColor: '#fafafa' },
  flexInput: { flex: 1 },
  stateScroll: { marginBottom: 12 },
  stateChip: { paddingHorizontal: 12, paddingVertical: 8, backgroundColor: '#f0f0f0', borderRadius: 20, marginRight: 8 },
  stateChipActive: { backgroundColor: '#667eea' },
  stateChipText: { fontSize: 13, color: '#374151' },
  stateChipTextActive: { color: '#fff', fontWeight: '600' },
  tierOption: { padding: 14, borderWidth: 1, borderColor: '#ddd', borderRadius: 8, marginBottom: 8 },
  tierOptionActive: { borderColor: '#667eea', backgroundColor: '#f0f4ff' },
  tierText: { fontSize: 14, color: '#374151' },
  tierTextActive: { fontSize: 14, color: '#667eea', fontWeight: '600' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 12 },
  btnRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 16, gap: 12 },
  primaryBtn: { backgroundColor: '#667eea', paddingVertical: 14, paddingHorizontal: 24, borderRadius: 8, alignItems: 'center', flex: 1 },
  primaryBtnText: { color: '#fff', fontSize: 16, fontWeight: '600' },
  secondaryBtn: { backgroundColor: '#e5e7eb', paddingVertical: 14, paddingHorizontal: 24, borderRadius: 8, alignItems: 'center', flex: 1 },
  secondaryBtnText: { color: '#374151', fontSize: 16, fontWeight: '600' },
  disabledBtn: { opacity: 0.5 },
  verifySection: { marginBottom: 16 },
  verifyBtn: { backgroundColor: '#667eea', paddingVertical: 12, paddingHorizontal: 16, borderRadius: 8 },
  verifiedBtn: { backgroundColor: '#10b981' },
  verifyBtnText: { color: '#fff', fontWeight: '600', fontSize: 14 },
  uploadBtn: { backgroundColor: '#f0f4ff', borderWidth: 1, borderColor: '#667eea', borderStyle: 'dashed', padding: 16, borderRadius: 8, alignItems: 'center', marginBottom: 12 },
  uploadBtnText: { color: '#667eea', fontWeight: '600', fontSize: 14 },
  reviewRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: '#f0f0f0' },
  reviewLabel: { fontSize: 14, color: '#666' },
  reviewValue: { fontSize: 14, fontWeight: '500', color: '#1a1a1a' },
  errorBox: { backgroundColor: '#fee2e2', padding: 12, borderRadius: 8, marginBottom: 12, borderWidth: 1, borderColor: '#fca5a5' },
  errorText: { color: '#b91c1c', fontSize: 14 },
  successCard: { backgroundColor: '#fff', padding: 32, borderRadius: 16, alignItems: 'center', marginTop: 40 },
  successIcon: { fontSize: 48, color: '#10b981', marginBottom: 16 },
  infoText: { fontSize: 14, color: '#666', marginTop: 8 },
});
